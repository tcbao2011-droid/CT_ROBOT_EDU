/* =====================================================
   NẠP MÃ MICROPYTHON CHO ESP32 QUA WEB SERIAL (raw REPL)
   Ghi file main.py vào bộ nhớ của mạch rồi khởi động lại mềm, nên robot chạy
   độc lập và tự chạy lại mỗi lần bật nguồn. Mạch phải có firmware MicroPython.
   `link` giống serialUploader.js: { write(Uint8Array), queue: ByteQueue }.
===================================================== */

const CTRL_A = 0x01; // vào raw REPL
const CTRL_B = 0x02; // thoát raw REPL
const CTRL_C = 0x03; // ngắt chương trình đang chạy
const CTRL_D = 0x04; // chạy / khởi động lại mềm

const CHUNK = 192;
const enc = new TextEncoder();

/** Chuỗi byte -> literal b'...' của Python (chỉ ký tự ASCII an toàn, còn lại \xNN). */
export function pyBytesLiteral(bytes) {
  let out = "b'";
  for (const b of bytes) {
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x27) out += "\\'";
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x0d) out += "\\r";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return `${out}'`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readUntil(queue, marker, timeoutMs) {
  let got = "";
  const deadline = Date.now() + timeoutMs;
  while (!got.endsWith(marker)) {
    const left = deadline - Date.now();
    const b = left > 0 ? await queue.readByte(left) : null;
    if (b === null) throw new Error("Mạch không trả lời (hết thời gian chờ).");
    got += String.fromCharCode(b);
  }
  return got;
}

async function enterRawRepl(link) {
  for (let attempt = 0; attempt < 3; attempt++) {
    link.queue.clear();
    await link.write(Uint8Array.of(CTRL_C, CTRL_C));
    await sleep(150);
    link.queue.clear();
    await link.write(Uint8Array.of(CTRL_A));
    try {
      await readUntil(link.queue, "raw REPL; CTRL-B to exit\r\n>", 1500);
      return;
    } catch (_) { /* thử lại: mạch có thể đang khởi động */ }
  }
  throw new Error("Không vào được chế độ nạp của MicroPython. Kiểm tra: mạch đã nạp firmware MicroPython chưa, đã chọn đúng cổng chưa, và không có chương trình khác (Thonny, Arduino IDE) đang giữ cổng.");
}

async function exec(link, code, timeoutMs = 8000) {
  await link.write(enc.encode(code));
  await link.write(Uint8Array.of(CTRL_D));
  await readUntil(link.queue, "OK", timeoutMs);
  const out = await readUntil(link.queue, "\x04", timeoutMs);
  const err = await readUntil(link.queue, "\x04", timeoutMs);
  await readUntil(link.queue, ">", timeoutMs);
  if (err.length > 1) throw new Error(`Mạch báo lỗi: ${err.slice(0, -1).trim()}`);
  return out.slice(0, -1);
}

/**
 * Ghi `code` thành main.py trên mạch rồi khởi động lại mềm để chạy ngay.
 * @param code chuỗi mã MicroPython (đã gồm runtime, xem pythonGenerator.js)
 */
export async function uploadMainPy(link, code, { onLog = () => {}, onProgress = () => {}, boot = true } = {}) {
  const bytes = enc.encode(code);
  onLog("Đang vào chế độ nạp của MicroPython...");
  await enterRawRepl(link);

  onLog(`Đang ghi main.py (${bytes.length} byte)...`);
  await exec(link, "f=open('main.py','wb')");
  try {
    for (let at = 0; at < bytes.length; at += CHUNK) {
      await exec(link, `f.write(${pyBytesLiteral(bytes.subarray(at, at + CHUNK))})`);
      onProgress(Math.min(1, (at + CHUNK) / bytes.length));
    }
  } finally {
    await exec(link, "f.close()");
  }

  const size = Number((await exec(link, "import os\nprint(os.stat('main.py')[6])")).trim());
  if (size !== bytes.length) throw new Error(`Ghi file không khớp (mạch ${size} byte, cần ${bytes.length} byte). Hãy nạp lại.`);

  if (boot) {
    await link.write(Uint8Array.of(CTRL_B)); // thoát raw REPL
    await sleep(50);
    await link.write(Uint8Array.of(CTRL_D)); // khởi động lại mềm -> chạy main.py
    onLog("Nạp xong. Robot đang chạy chương trình; rút cáp vẫn tự chạy lại khi có nguồn.");
  }
  return { bytes: bytes.length };
}
