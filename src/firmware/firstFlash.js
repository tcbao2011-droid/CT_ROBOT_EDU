/* Hướng dẫn nạp firmware thông dịch lần đầu cho từng mạch (chỉ cần làm một lần cho mỗi mạch). */

export const FIRMWARE_FILES = {
  "stm32-blue-pill": "blue-pill",
  "stm32-black-pill": "black-pill",
  "stm32-nucleo-f401re": "nucleo-f401re",
};

export const FIRST_FLASH_STEPS = {
  "stm32-blue-pill": [
    "Blue Pill: cần cáp USB-TTL (CH340/CP2102) nối PA9→RX, PA10→TX, GND→GND, 3V3.",
    "Chuyển jumper BOOT0 sang 1, bấm RESET để vào chế độ nạp của chip.",
    "Dùng STM32CubeProgrammer (cổng UART) hoặc `stm32flash -w blue-pill.bin -v -g 0x08000000 /dev/ttyUSB0` để nạp file .bin vào địa chỉ 0x08000000.",
    "Trả BOOT0 về 0, bấm RESET. Từ giờ chọn cổng USB-TTL đó trong nút \"Nạp nhanh\".",
  ],
  "stm32-black-pill": [
    "Black Pill: giữ nút BOOT0, bấm nhả RESET (hoặc cắm USB khi đang giữ BOOT0) để vào chế độ DFU.",
    "Dùng STM32CubeProgrammer (USB) hoặc `dfu-util -a 0 -s 0x08000000:leave -D black-pill.bin` để nạp file .bin.",
    "Bấm RESET. Mạch hiện thành cổng COM/USB; chọn nó trong nút \"Nạp nhanh\".",
  ],
  "stm32-nucleo-f401re": [
    "Nucleo-F401RE: cắm cáp USB vào cổng ST-LINK, máy tính sẽ thấy một ổ đĩa tên NODE_F401RE.",
    "Chép (kéo thả) file nucleo-f401re.bin vào ổ đĩa đó; đèn ST-LINK nhấp nháy rồi mạch tự khởi động lại.",
    "Chọn cổng ST-LINK Virtual COM Port trong nút \"Nạp nhanh\".",
  ],
};

/* ESP32 / ESP32-S3 dùng MicroPython: nạp firmware MicroPython một lần bằng công cụ web, sau đó nạp chương trình từ phần mềm. */
export const ESP32_FIRST_FLASH_STEPS = [
  "ESP32 cần firmware MicroPython (chỉ làm một lần cho mỗi mạch). Tải file .bin mới nhất tại micropython.org/download/ESP32_GENERIC/ (ESP32-S3: ESP32_GENERIC_S3).",
  "Mở công cụ nạp trên web (Chrome/Edge): adafruit.github.io/Adafruit_WebSerial_ESPTool hoặc web.esphome.io, bấm Connect và chọn cổng của mạch.",
  "Nạp file .bin đã tải vào địa chỉ 0x1000 (ESP32) hoặc 0x0 (ESP32-S3). Nếu mạch không vào được chế độ nạp: giữ nút BOOT, bấm RESET rồi nhả BOOT.",
  "Bấm RESET trên mạch. Sau đó quay lại đây và bấm \"Nạp nhanh\" để nạp chương trình.",
];
