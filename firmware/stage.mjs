/* Dựng thư mục sketch Arduino cho từng mạch từ khai báo mạch của phần mềm.
   Dùng: node firmware/stage.mjs <blue-pill|black-pill|nucleo-f401re> [thư mục đích]
   Sinh board_config.h (chân, bảng chân, vùng flash) rồi chép các header dùng chung. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bluePill from "../src/extensions/builtin/stm32BluePill.js";
import blackPill from "../src/extensions/builtin/stm32BlackPill.js";
import nucleo from "../src/extensions/builtin/stm32NucleoF401RE.js";
import { BOARD_IDS, MAX_CODE_BYTES, HEADER_SIZE } from "../src/firmware/bytecode.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const BOARDS = {
  "blue-pill": {
    ext: bluePill, name: "Blue Pill",
    fqbn: "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8,upload_method=swdMethod",
    // Cổng nối với máy tính: USART1 (PA9/PA10) qua cáp USB-TTL (USB gốc của Blue Pill clone hay lỗi điện trở D+).
    hostSerial: "Serial", btSerialNo: 2, store: { addr: "0x0800F000", capacity: MAX_CODE_BYTES[1] + HEADER_SIZE },
    flashLimit: 0xf000, seedPin: "PA0",
  },
  "black-pill": {
    ext: blackPill, name: "Black Pill",
    fqbn: "STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE,usb=CDCgen,xserial=generic,upload_method=dfuMethod",
    hostSerial: "Serial", btSerialNo: 2, store: { addr: "0x08060000", sector: "FLASH_SECTOR_7", capacity: MAX_CODE_BYTES[2] + HEADER_SIZE },
    flashLimit: 0x60000, seedPin: "PA1",
  },
  "nucleo-f401re": {
    ext: nucleo, name: "Nucleo-F401RE",
    fqbn: "STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F401RE,upload_method=MassStorage",
    hostSerial: "Serial", btSerialNo: 6, store: { addr: "0x08060000", sector: "FLASH_SECTOR_7", capacity: MAX_CODE_BYTES[3] + HEADER_SIZE },
    flashLimit: 0x60000, seedPin: "PA0",
  },
};

function pinTable(validPins) {
  const valid = new Set(validPins);
  const out = [];
  for (const port of ["A", "B", "C"]) {
    for (let n = 0; n < 16; n++) out.push(valid.has(`P${port}${n}`) ? `P${port}${n}` : "0xffffffffu");
  }
  return out;
}

export function boardConfigHeader(key) {
  const board = BOARDS[key];
  const profile = board.ext.profiles[0];
  const s = profile.sensors;
  const id = BOARD_IDS[board.ext.id];
  const bt = profile.bluetoothPins;
  const button = board.ext.blocks.find(b => b.type.endsWith("_button"));
  const lines = [
    `// TỰ SINH bởi firmware/stage.mjs từ ${board.ext.id}. Đừng sửa tay.`,
    "#pragma once",
    `#define CT_BOARD_ID ${id}`,
    `#define CT_BOARD_NAME "${board.name}"`,
    `#define CT_HOST_SERIAL ${board.hostSerial}`,
    `#define CT_TRIG_PIN ${s.trig}`,
    `#define CT_ECHO_PIN ${s.echo}`,
    `#define CT_LINE_LEFT_PIN ${s.lineLeft}`,
    `#define CT_LINE_RIGHT_PIN ${s.lineRight}`,
    `#define CT_BUZZER_PIN ${s.buzzer}`,
    `#define CT_SERVO_PIN ${s.servo}`,
    `#define CT_LED_PIN ${s.led}`,
    `#define CT_LED_ACTIVE_LOW ${profile.ledActiveLow ? 1 : 0}`,
    `#define CT_BT_RX ${bt.rx}`,
    `#define CT_BT_TX ${bt.tx}`,
    `#define CT_BT_SERIAL Serial${board.btSerialNo}`,
    `#define CT_RANDOM_SEED_PIN ${board.seedPin}`,
    `#define CT_STORE_ADDR ${board.store.addr}u`,
    `#define CT_STORE_CAPACITY ${board.store.capacity}u`,
  ];
  if (board.store.sector) lines.push(`#define CT_STORE_SECTOR ${board.store.sector}`);
  if (button) {
    // Chân/độ tích cực của nút nằm trong tooltip chung của khối; lấy từ spec qua generator không tiện nên đọc từ profile mô tả.
    lines.push(`#define CT_BUTTON_PIN ${board.buttonPin}`, `#define CT_BUTTON_ACTIVE_LOW 1`);
  }
  lines.push("", `static const uint32_t CT_PIN_TABLE[48] = {`, ...pinTable(profile.pinRules.validPins).reduce((rows, p, i) => {
    if (i % 8 === 0) rows.push("  ");
    rows[rows.length - 1] += `${p}, `;
    return rows;
  }, []), "};", "");
  return lines.join("\n");
}

BOARDS["black-pill"].buttonPin = "PA0";
BOARDS["nucleo-f401re"].buttonPin = "PC13";

export function stage(key, dest) {
  const board = BOARDS[key];
  if (!board) throw new Error(`Mạch không hợp lệ: ${key}. Chọn: ${Object.keys(BOARDS).join(", ")}`);
  const sketchName = path.basename(dest);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "board_config.h"), boardConfigHeader(key));
  // Core STM32duino chỉ tạo SerialN khi được bật qua build_opt.h (arduino-cli đọc file này cạnh .ino).
  const bt = board.ext.profiles[0].bluetoothPins;
  fs.writeFileSync(path.join(dest, "build_opt.h"),
    `-DENABLE_HWSERIAL${board.btSerialNo}\n-DPIN_SERIAL${board.btSerialNo}_RX=${bt.rx}\n-DPIN_SERIAL${board.btSerialNo}_TX=${bt.tx}\n`);
  for (const file of ["ct_vm.h", "ct_device.h", "ct_stm32_main.h"]) {
    fs.copyFileSync(path.join(here, "common", file), path.join(dest, file));
  }
  fs.writeFileSync(path.join(dest, `${sketchName}.ino`),
    `// CT Robot EDU - firmware thông dịch cho ${board.name} (tự sinh)\n#include "ct_stm32_main.h"\n\nvoid setup() { ctSetup(); }\nvoid loop() { ctLoop(); }\n`);
  return dest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const key = process.argv[2];
  const dest = path.resolve(process.argv[3] || path.join(here, "build", `ct_${key.replace(/-/g, "_")}`));
  console.log(stage(key, dest));
}
