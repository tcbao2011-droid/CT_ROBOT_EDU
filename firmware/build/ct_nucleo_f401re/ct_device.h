/* =====================================================
   CT ROBOT EDU - GIAO THỨC NẠP CHƯƠNG TRÌNH QUA CỔNG NỐI TIẾP (portable)
   Lệnh từ máy tính (kết thúc bằng '\n'):
     ?          hỏi thông tin            -> "CTROBOT 1 <mạch> <dung lượng tối đa> <đang chạy> <có chương trình>\n"
     W <n>      chuẩn bị nhận n byte     -> "R\n" (sẵn sàng) hoặc "E size\n"
                rồi gửi n byte thô; mỗi 64 byte (và khối cuối) mạch trả 'K'.
                nhận đủ: kiểm tra, ghi flash, đọc lại, chạy -> "OK\n" hoặc "E <lý do>\n"
     X          dừng chương trình        -> "OK\n"
     G          chạy lại chương trình đã lưu -> "OK\n" hoặc "E none\n"
     C          xóa chương trình đã lưu  -> "OK\n"
   Nếu 3 giây không có byte nào trong lúc nhận, mạch hủy việc nạp ("E timeout\n").
===================================================== */
#pragma once
#include "ct_vm.h"

#define CT_BLOCK 64
#define CT_RX_TIMEOUT_MS 3000

struct CtIO {
  int (*read)();                          // -1 nếu chưa có byte
  void (*write)(const uint8_t* d, int n);
};

struct CtStorage {
  const uint8_t* (*base)();               // vùng flash lưu chương trình (đọc trực tiếp)
  uint32_t (*capacity)();                 // số byte tối đa của gói (gồm header)
  bool (*write)(const uint8_t* d, uint32_t n); // xóa + ghi + kiểm tra lại
  bool (*erase)();
};

class CtDevice {
 public:
  CtVm vm;
  const CtHal* hal = nullptr;
  CtIO io;
  CtStorage st;
  uint8_t boardId = 0;
  uint8_t* rx = nullptr;          // bộ đệm nhận, kích thước = st.capacity()

  void begin(const CtHal* h, CtIO i, CtStorage s, uint8_t board, uint8_t* buffer) {
    hal = h; io = i; st = s; boardId = board; rx = buffer;
    mode = LINE; lineLen = 0;
    runStored();
  }

  /* Gọi thường xuyên: đọc và xử lý byte đến, rồi chạy chương trình một đoạn. */
  void poll(uint16_t budget = 200) {
    for (int guard = 0; guard < 512; guard++) {
      const int c = io.read();
      if (c < 0) break;
      lastByte = hal->millis();
      feed((uint8_t)c);
    }
    if (mode == UPLOAD && (int32_t)(hal->millis() - lastByte) > CT_RX_TIMEOUT_MS) {
      mode = LINE; lineLen = 0;
      say("E timeout\n");
    }
    if (mode == LINE) vm.step(budget);
  }

  bool storedValid(const uint8_t** code, uint16_t* len) {
    return ct_parse_package(st.base(), st.capacity(), boardId, code, len);
  }
  bool runStored() {
    const uint8_t* code; uint16_t len;
    if (!storedValid(&code, &len)) return false;
    vm.start(hal, code, len);
    return true;
  }

 private:
  enum Mode { LINE, UPLOAD } mode = LINE;
  char line[24];
  uint8_t lineLen = 0;
  uint32_t expected = 0, got = 0, lastByte = 0;

  void say(const char* s) { io.write((const uint8_t*)s, (int)strlen(s)); }
  void sayNum(uint32_t v) {
    char buf[12]; int n = 0;
    char tmp[12]; int t = 0;
    if (v == 0) tmp[t++] = '0';
    while (v) { tmp[t++] = (char)('0' + v % 10); v /= 10; }
    while (t) buf[n++] = tmp[--t];
    io.write((const uint8_t*)buf, n);
  }

  void feed(uint8_t c) {
    if (mode == UPLOAD) {
      rx[got++] = c;
      if (got % CT_BLOCK == 0 || got == expected) { const uint8_t k = 'K'; io.write(&k, 1); }
      if (got == expected) finishUpload();
      return;
    }
    if (c == '\r') return;
    if (c != '\n') { if (lineLen < sizeof(line) - 1) line[lineLen++] = (char)c; return; }
    line[lineLen] = 0; lineLen = 0;
    command(line);
  }

  void command(const char* s) {
    switch (s[0]) {
      case '?': {
        const uint8_t* code; uint16_t len;
        const bool has = storedValid(&code, &len);
        say("CTROBOT 1 "); sayNum(boardId); say(" "); sayNum(st.capacity()); say(" ");
        sayNum(vm.running ? 1 : 0); say(" "); sayNum(has ? 1 : 0); say("\n");
        break;
      }
      case 'W': {
        uint32_t n = 0;
        for (const char* p = s + 1; *p; p++) if (*p >= '0' && *p <= '9') n = n * 10 + (uint32_t)(*p - '0');
        if (n < CT_HEADER_SIZE + 1 || n > st.capacity()) { say("E size\n"); break; }
        vm.stop();
        expected = n; got = 0; lastByte = hal->millis(); mode = UPLOAD;
        say("R\n");
        break;
      }
      case 'X': vm.stop(); say("OK\n"); break;
      case 'G': say(runStored() ? "OK\n" : "E none\n"); break;
      case 'C': vm.stop(); say(st.erase() ? "OK\n" : "E flash\n"); break;
      default: break; // bỏ qua rác (ví dụ ký tự lẻ khi vừa cắm cáp)
    }
  }

  void finishUpload() {
    mode = LINE;
    const uint8_t* code; uint16_t len;
    if (!ct_parse_package(rx, expected, boardId, &code, &len)) { say("E badpkg\n"); return; }
    if (!st.write(rx, expected)) { say("E flash\n"); return; }
    if (!runStored()) { say("E verify\n"); return; }
    say("OK\n");
  }
};
