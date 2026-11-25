import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ByteQueue } from "../src/firmware/serialUploader.js";
import { uploadMainPy, pyBytesLiteral } from "../src/firmware/micropythonUploader.js";

/* Mạch MicroPython giả nói đúng giao thức raw REPL; chạy được tập con Python mà bộ nạp dùng
   (open/write/close/os.stat). Literal bytes được kiểm bằng python3 thật nếu có. */

const have = spawnSync("python3", ["-c", "print(1)"]).status === 0;

function pyDecode(literal) {
  const r = spawnSync("python3", ["-I", "-c", `import sys;sys.stdout.buffer.write(${literal})`]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return Uint8Array.from(r.stdout);
}

function fakeBoard({ failOpen = false, shortWrite = false } = {}) {
  const queue = new ByteQueue();
  const state = { mode: "friendly", buffer: "", file: null, files: {}, reboots: 0 };
  const reply = s => queue.push(Buffer.from(s, "latin1"));
  const write = async data => {
    for (const b of data) {
      if (state.mode === "friendly") {
        if (b === 0x01) { state.mode = "raw"; state.buffer = ""; reply("raw REPL; CTRL-B to exit\r\n>"); }
        else if (b === 0x04) state.reboots++;
        continue;
      }
      if (b === 0x02) { state.mode = "friendly"; continue; }
      if (b === 0x03) continue;
      if (b === 0x04) {
        const code = state.buffer; state.buffer = "";
        let out = "", err = "";
        try {
          if (failOpen && code.startsWith("f=open")) throw new Error("OSError: [Errno 28] ENOSPC");
          if (code.startsWith("f=open")) state.file = [];
          else if (code.startsWith("f.write(")) {
            const bytes = pyDecode(code.slice(8, -1));
            state.file.push(...(shortWrite ? bytes.slice(1) : bytes));
          } else if (code === "f.close()") state.files["main.py"] = Uint8Array.from(state.file);
          else if (code.includes("os.stat")) out = `${state.files["main.py"].length}\r\n`;
          else throw new Error(`NameError: ${code}`);
        } catch (e) { err = e.message; }
        reply(`OK${out}\x04${err}\x04>`);
      } else state.buffer += String.fromCharCode(b);
    }
  };
  return { link: { queue, write }, state };
}

test("literal bytes khớp python3 thật cho mọi giá trị byte", { skip: !have && "không có python3" }, () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual([...pyDecode(pyBytesLiteral(all))], [...all]);
  const tricky = new TextEncoder().encode("print('xin chào \\n', \"q\")\r\n\t#é");
  assert.deepEqual([...pyDecode(pyBytesLiteral(tricky))], [...tricky]);
});

test("ghi main.py đúng nội dung (nhiều khối, ký tự đặc biệt) và khởi động lại mềm", { skip: !have && "không có python3" }, async () => {
  const code = `import time\n${"x = 'a\\\\b'  # tiếng Việt\n".repeat(60)}print("xong")\n`;
  const board = fakeBoard();
  const progress = [];
  await uploadMainPy(board.link, code, { onProgress: p => progress.push(p) });
  assert.equal(new TextDecoder().decode(board.state.files["main.py"]), code);
  assert.equal(progress.at(-1), 1);
  assert.equal(board.state.reboots, 1);
});

test("lỗi từ mạch (hết bộ nhớ) và ghi thiếu đều được báo rõ", { skip: !have && "không có python3" }, async () => {
  await assert.rejects(uploadMainPy(fakeBoard({ failOpen: true }).link, "print(1)\n"), /ENOSPC/);
  await assert.rejects(uploadMainPy(fakeBoard({ shortWrite: true }).link, "print(1)\n"), /không khớp/);
});

test("mạch không có MicroPython thì báo hướng dẫn", async () => {
  const link = { queue: new ByteQueue(), write: async () => {} };
  await assert.rejects(uploadMainPy(link, "print(1)\n"), /Không vào được chế độ nạp/);
});
