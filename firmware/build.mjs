/* Biên dịch firmware thông dịch cho một mạch (hoặc tất cả) bằng arduino-cli.
   Dùng: node firmware/build.mjs <blue-pill|black-pill|nucleo-f401re|all>
   Kết quả: public/firmware/<mạch>.bin (web phát cho người dùng tải để nạp lần đầu).
   Yêu cầu: arduino-cli + core STMicroelectronics:stm32 (arduino-cli core install STMicroelectronics:stm32). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARDS, stage } from "./stage.mjs";
import { resolveArduinoCli, arduinoCliEnv } from "../server/buildServer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
// Dùng đúng arduino-cli mà phần mềm dùng (tools/arduino-cli/arduino-cli.exe nếu có, hoặc trong PATH).
const cli = resolveArduinoCli();
const target = process.argv[2];
const keys = target === "all" ? Object.keys(BOARDS) : [target];
if (!keys.every(k => BOARDS[k])) {
  console.error(`Dùng: node firmware/build.mjs <${Object.keys(BOARDS).join("|")}|all>`);
  process.exit(2);
}

for (const key of keys) {
  const board = BOARDS[key];
  const name = `ct_${key.replace(/-/g, "_")}`;
  const sketch = stage(key, path.join(here, "build", name));
  const out = path.join(here, "build", `${name}_out`);
  console.log(`\n=== ${board.name} ===`);
  const run = spawnSync(cli, ["compile", "--fqbn", board.fqbn, "--output-dir", out, sketch], { stdio: "inherit", env: arduinoCliEnv() });
  if (run.error?.code === "ENOENT") { console.error("Không tìm thấy arduino-cli (để file vào tools/arduino-cli/, hoặc đặt ARDUINO_CLI_PATH, hoặc thêm vào PATH)."); process.exit(1); }
  if (run.status !== 0) process.exit(run.status || 1);
  const bin = path.join(out, `${name}.ino.bin`);
  const size = fs.statSync(bin).size;
  if (size > board.flashLimit) {
    console.error(`Firmware ${size} byte vượt ${board.flashLimit} byte, đè lên vùng lưu chương trình. Giảm dung lượng trước khi dùng.`);
    process.exit(1);
  }
  const dest = path.join(root, "public", "firmware");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(bin, path.join(dest, `${key}.bin`));
  console.log(`OK ${key}.bin (${size} byte, giới hạn ${board.flashLimit}) -> public/firmware/`);
}
