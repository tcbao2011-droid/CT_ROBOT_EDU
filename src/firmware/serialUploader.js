/* =====================================================
   NẠP CHƯƠNG TRÌNH QUA CỔNG NỐI TIẾP (Web Serial)
   Nói chuyện với firmware thông dịch (firmware/common/ct_device.h).
   Lớp giao thức không phụ thuộc trình duyệt: nhận `transport`
   { write(Uint8Array), queue: ByteQueue } nên kiểm thử được với mạch giả.
===================================================== */

import { BOARD_IDS } from "./bytecode.js";

export const BLOCK_SIZE = 64;
const BOARD_NAMES = { 1: "Blue Pill", 2: "Black Pill", 3: "Nucleo-F401RE" };
export const boardNameOf = id => BOARD_NAMES[id] || `mạch #${id}`;

export class ByteQueue {
  constructor() {
    this.bytes = [];
    this.waiters = [];
  }
  push(chunk) {
    for (const b of chunk) this.bytes.push(b);
    const waiters = this.waiters.splice(0);
    waiters.forEach(w => w());
  }
  clear() { this.bytes.length = 0; }
  async #wait(deadline) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== done); resolve(); }, left);
      const done = () => { clearTimeout(timer); resolve(); };
      this.waiters.push(done);
    });
    return true;
  }
  async readByte(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (this.bytes.length === 0) if (!(await this.#wait(deadline))) return null;
    return this.bytes.shift();
  }
  async readLine(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = this.bytes.indexOf(10);
      if (at >= 0) {
        const line = this.bytes.splice(0, at + 1);
        return String.fromCharCode(...line).replace(/[\r\n]+$/, "");
      }
      if (!(await this.#wait(deadline))) return null;
    }
  }
}

const text = s => new TextEncoder().encode(s);

async function ask(link, command, timeoutMs = 1500) {
  link.queue.clear();
  await link.write(text(`${command}\n`));
  return link.queue.readLine(timeoutMs);
}

/** Hỏi mạch đang cắm: { boardId, capacity, running, hasProgram } hoặc ném lỗi. */
export async function probe(link) {
  let line = null;
  for (let attempt = 0; attempt < 4 && !line?.startsWith("CTROBOT"); attempt++) {
    // Lệnh rỗng trước để bỏ phần dở dang nếu mạch đang chờ dữ liệu; rồi hỏi thông tin.
    await link.write(text("\n"));
    await new Promise(r => setTimeout(r, 30));
    line = await ask(link, "?", 800);
    while (line && !line.startsWith("CTROBOT")) line = await link.queue.readLine(200);
  }
  if (!line?.startsWith("CTROBOT")) {
    throw new Error("Mạch không trả lời. Kiểm tra: đã nạp firmware CT Robot EDU cho mạch chưa, đã chọn đúng cổng COM/USB chưa, và cáp USB có truyền dữ liệu không.");
  }
  const [, version, board, capacity, running, has] = line.split(" ");
  return { version: Number(version), boardId: Number(board), capacity: Number(capacity), running: running === "1", hasProgram: has === "1" };
}

/**
 * Nạp gói bytecode (Uint8Array từ compileWorkspace) vào mạch. Mạch tự chạy ngay khi nạp xong
 * và tự chạy lại mỗi lần cấp điện.
 */
export async function uploadPackage(link, pkg, { onLog = () => {}, onProgress = () => {} } = {}) {
  onLog("Đang kết nối với mạch...");
  const info = await probe(link);
  const wanted = pkg[5];
  if (info.boardId !== wanted) {
    throw new Error(`Chương trình này biên dịch cho ${boardNameOf(wanted)} nhưng mạch đang cắm là ${boardNameOf(info.boardId)}. Hãy chọn đúng mạch rồi nạp lại.`);
  }
  if (pkg.length > info.capacity) {
    throw new Error(`Chương trình ${pkg.length} byte vượt dung lượng ${info.capacity} byte của mạch.`);
  }
  onLog(`Mạch: ${boardNameOf(info.boardId)} (còn ${info.capacity} byte cho chương trình).`);

  link.queue.clear();
  await link.write(text(`W ${pkg.length}\n`));
  const ready = await link.queue.readLine(2000);
  if (ready !== "R") throw new Error(`Mạch từ chối nhận chương trình (${ready ?? "không trả lời"}).`);

  for (let sent = 0; sent < pkg.length;) {
    const chunk = pkg.subarray(sent, Math.min(sent + BLOCK_SIZE, pkg.length));
    await link.write(chunk);
    sent += chunk.length;
    const ack = await link.queue.readByte(2500);
    if (ack !== 0x4b) throw new Error("Mất kết nối khi đang gửi chương trình. Hãy nạp lại.");
    onProgress(sent / pkg.length);
  }
  onLog("Đang ghi vào bộ nhớ flash của mạch (có thể mất vài giây)...");
  const result = await link.queue.readLine(25000);
  if (result !== "OK") {
    const reason = {
      "E flash": "Ghi flash thất bại.",
      "E badpkg": "Mạch từ chối gói chương trình (sai mã mạch hoặc sai CRC).",
      "E verify": "Đọc lại flash không khớp.",
      "E timeout": "Mạch hủy vì nhận dữ liệu quá chậm.",
    }[result] || `Mạch báo lỗi: ${result ?? "không trả lời"}.`;
    throw new Error(reason);
  }
  onLog("Nạp xong. Robot đang chạy chương trình, rút cáp vẫn chạy độc lập khi có nguồn.");
  return info;
}

export async function stopProgram(link) { return (await ask(link, "X", 2000)) === "OK"; }
export async function runProgram(link) { return (await ask(link, "G", 2000)) === "OK"; }
export async function clearProgram(link) { return (await ask(link, "C", 25000)) === "OK"; }

/* ---------- Web Serial (trình duyệt Chrome / Edge) ---------- */

export const webSerialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

export async function openWebSerial({ baudRate = 115200 } = {}) {
  if (!webSerialSupported()) {
    throw new Error("Trình duyệt này không hỗ trợ Web Serial. Hãy dùng Chrome hoặc Edge bản mới trên máy tính (https).");
  }
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate });
  const queue = new ByteQueue();
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let closed = false;
  (async () => {
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) queue.push(value);
      }
    } catch (_) { /* cổng bị rút */ }
  })();
  return {
    queue,
    write: data => writer.write(data),
    async close() {
      closed = true;
      try { await reader.cancel(); } catch (_) {}
      try { reader.releaseLock(); } catch (_) {}
      try { writer.releaseLock(); } catch (_) {}
      try { await port.close(); } catch (_) {}
    },
  };
}

export { BOARD_IDS };
