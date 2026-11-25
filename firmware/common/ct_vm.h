/* =====================================================
   CT ROBOT EDU - BỘ THÔNG DỊCH BYTECODE (portable, không phụ thuộc Arduino)
   Khớp với src/firmware/bytecode.js. Chạy hợp tác: mỗi lần gọi step() chỉ
   thực hiện tối đa `budget` lệnh hoặc dừng khi đang chờ (DELAY) để firmware
   còn thời gian đọc cổng nối tiếp (nhận chương trình mới / lệnh STOP).
===================================================== */
#pragma once
#include <stdint.h>
#include <string.h>
#include <math.h>

#define CT_VM_STACK 32
#define CT_VM_VARS 64
#define CT_HEADER_SIZE 16
#define CT_FORMAT_VERSION 1

enum CtOp : uint8_t {
  OP_HALT = 0x00, OP_PUSH_I8 = 0x01, OP_PUSH_I16 = 0x02, OP_PUSH_F32 = 0x03, OP_LOAD = 0x04, OP_STORE = 0x05,
  OP_DUP = 0x06, OP_POP = 0x07,
  OP_ADD = 0x10, OP_SUB = 0x11, OP_MUL = 0x12, OP_DIV = 0x13, OP_MOD = 0x14, OP_POW = 0x15,
  OP_EQ = 0x20, OP_NEQ = 0x21, OP_LT = 0x22, OP_GT = 0x23, OP_LTE = 0x24, OP_GTE = 0x25, OP_NOT = 0x2a,
  OP_JMP = 0x30, OP_JZ = 0x31, OP_JNZ = 0x32,
  OP_FN1 = 0x40, OP_MIN = 0x41, OP_MAX = 0x42, OP_CONSTRAIN = 0x43, OP_BETWEEN = 0x44, OP_RANDOM = 0x45, OP_ROUNDP = 0x46,
  OP_DELAY = 0x50, OP_MILLIS = 0x51,
  OP_SYS = 0x60,
};

enum CtSys : uint8_t {
  SYS_LED = 0, SYS_BUZZER = 1, SYS_SERVO = 2, SYS_DISTANCE = 3, SYS_LINE_LEFT = 4, SYS_LINE_RIGHT = 5, SYS_BUTTON = 6,
  SYS_BT_HAS_KEY = 7, SYS_BT_READ = 8, SYS_BT_SEND = 9, SYS_DWRITE = 10, SYS_DREAD = 11, SYS_AREAD = 12, SYS_PWM = 13,
};

enum CtError : uint8_t {
  CT_OK = 0, CT_ERR_STACK = 1, CT_ERR_PC = 2, CT_ERR_OP = 3, CT_ERR_VAR = 4, CT_ERR_SYS = 5,
};

/* Cầu nối phần cứng: mỗi mạch cung cấp bản riêng. Con trỏ nào null thì lệnh đó là no-op / trả 0. */
struct CtHal {
  void (*led)(int on);
  void (*buzzer)(int freq);
  void (*servo)(int angle);
  int (*distance)();
  int (*lineLeft)();
  int (*lineRight)();
  int (*button)();
  int (*btHasKey)(int ch);
  int (*btRead)();
  void (*btSend)(const uint8_t* text, int len);
  void (*dwrite)(int pin, int level);
  int (*dread)(int pin);
  int (*aread)(int pin);
  void (*pwm)(int pin, int percent);
  uint32_t (*millis)();
  long (*random)(long lo, long hi);
};

static inline uint32_t ct_crc32(const uint8_t* data, uint32_t len) {
  uint32_t crc = 0xffffffffu;
  for (uint32_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

/* Kiểm tra gói chương trình; trả về true nếu hợp lệ và đặt con trỏ mã/độ dài. */
static inline bool ct_parse_package(const uint8_t* pkg, uint32_t avail, uint8_t boardId, const uint8_t** code, uint16_t* codeLen) {
  if (avail < CT_HEADER_SIZE) return false;
  if (pkg[0] != 'C' || pkg[1] != 'T' || pkg[2] != 'R' || pkg[3] != 'B') return false;
  if (pkg[4] != CT_FORMAT_VERSION || pkg[5] != boardId) return false;
  const uint16_t len = (uint16_t)(pkg[8] | (pkg[9] << 8));
  if (len == 0 || (uint32_t)len + CT_HEADER_SIZE > avail) return false;
  const uint32_t crc = (uint32_t)pkg[12] | ((uint32_t)pkg[13] << 8) | ((uint32_t)pkg[14] << 16) | ((uint32_t)pkg[15] << 24);
  if (ct_crc32(pkg + CT_HEADER_SIZE, len) != crc) return false;
  *code = pkg + CT_HEADER_SIZE;
  *codeLen = len;
  return true;
}

class CtVm {
 public:
  const CtHal* hal = nullptr;
  const uint8_t* code = nullptr;
  uint16_t len = 0, pc = 0;
  float stack[CT_VM_STACK];
  uint8_t sp = 0;
  float vars[CT_VM_VARS];
  bool running = false, waiting = false;
  uint32_t waitUntil = 0;
  CtError error = CT_OK;

  void start(const CtHal* h, const uint8_t* c, uint16_t n) {
    hal = h; code = c; len = n; pc = 0; sp = 0;
    for (int i = 0; i < CT_VM_VARS; i++) vars[i] = 0;
    running = true; waiting = false; error = CT_OK;
  }
  void stop() { running = false; waiting = false; }

  /* Chạy tối đa `budget` lệnh. Trả về true nếu chương trình còn chạy. */
  bool step(uint16_t budget) {
    if (!running) return false;
    if (waiting) {
      if ((int32_t)(now() - waitUntil) < 0) return true;
      waiting = false;
    }
    while (budget--) {
      if (!exec()) return running;
      if (waiting) return true;
    }
    return true;
  }

 private:
  uint32_t now() { return hal && hal->millis ? hal->millis() : 0; }
  bool fail(CtError e) { error = e; running = false; return false; }
  bool push(float v) { if (sp >= CT_VM_STACK) return fail(CT_ERR_STACK); stack[sp++] = v; return true; }
  bool pop(float& v) { if (sp == 0) return fail(CT_ERR_STACK); v = stack[--sp]; return true; }
  bool u8(uint8_t& v) { if (pc >= len) return fail(CT_ERR_PC); v = code[pc++]; return true; }
  bool u16(uint16_t& v) { if (pc + 1 >= len) return fail(CT_ERR_PC); v = (uint16_t)(code[pc] | (code[pc + 1] << 8)); pc += 2; return true; }

  static float fmodFloor(float a, float b) {
    if (b == 0) return 0;
    float r = fmodf(a, b);
    if (r != 0 && ((r < 0) != (b < 0))) r += b;
    return r;
  }
  static float fn1(uint8_t id, float v) {
    const float D2R = 3.14159265f / 180.0f, R2D = 180.0f / 3.14159265f;
    switch (id) {
      case 0: return v < 0 ? 0 : sqrtf(v);
      case 1: return v < 0 ? -v : v;
      case 2: return floorf(v + 0.5f);
      case 3: return floorf(v);
      case 4: return ceilf(v);
      case 5: return sinf(v * D2R);
      case 6: return cosf(v * D2R);
      case 7: return tanf(v * D2R);
      case 8: return asinf(v) * R2D;
      case 9: return acosf(v) * R2D;
      case 10: return atanf(v) * R2D;
      case 11: return v <= 0 ? 0 : logf(v);
      case 12: return v <= 0 ? 0 : log10f(v);
      case 13: return expf(v);
      case 14: return powf(10.0f, v);
    }
    return 0;
  }

  bool exec() {
    uint8_t op;
    if (pc >= len) return fail(CT_ERR_PC);
    op = code[pc++];
    float a, b, c;
    uint8_t k;
    uint16_t addr;
    switch (op) {
      case OP_HALT: running = false; return false;
      case OP_PUSH_I8: if (!u8(k)) return false; return push((float)(int8_t)k);
      case OP_PUSH_I16: { uint16_t v; if (!u16(v)) return false; return push((float)(int16_t)v); }
      case OP_PUSH_F32: {
        if (pc + 3 >= len) return fail(CT_ERR_PC);
        uint32_t bits = (uint32_t)code[pc] | ((uint32_t)code[pc + 1] << 8) | ((uint32_t)code[pc + 2] << 16) | ((uint32_t)code[pc + 3] << 24);
        pc += 4; float f; memcpy(&f, &bits, 4); return push(f);
      }
      case OP_LOAD: if (!u8(k)) return false; if (k >= CT_VM_VARS) return fail(CT_ERR_VAR); return push(vars[k]);
      case OP_STORE: if (!u8(k) || !pop(a)) return false; if (k >= CT_VM_VARS) return fail(CT_ERR_VAR); vars[k] = a; return true;
      case OP_DUP: if (sp == 0) return fail(CT_ERR_STACK); return push(stack[sp - 1]);
      case OP_POP: return pop(a);
      case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD: case OP_POW:
      case OP_EQ: case OP_NEQ: case OP_LT: case OP_GT: case OP_LTE: case OP_GTE:
      case OP_MIN: case OP_MAX: case OP_ROUNDP: {
        if (!pop(b) || !pop(a)) return false;
        float r = 0;
        switch (op) {
          case OP_ADD: r = a + b; break;
          case OP_SUB: r = a - b; break;
          case OP_MUL: r = a * b; break;
          case OP_DIV: r = b == 0 ? 0 : a / b; break;
          case OP_MOD: r = fmodFloor(a, b); break;
          case OP_POW: r = powf(a, b); break;
          case OP_EQ: r = a == b; break;
          case OP_NEQ: r = a != b; break;
          case OP_LT: r = a < b; break;
          case OP_GT: r = a > b; break;
          case OP_LTE: r = a <= b; break;
          case OP_GTE: r = a >= b; break;
          case OP_MIN: r = a < b ? a : b; break;
          case OP_MAX: r = a > b ? a : b; break;
          case OP_ROUNDP: { float p = powf(10.0f, b); r = floorf(a * p + 0.5f) / p; break; }
        }
        return push(r);
      }
      case OP_NOT: if (!pop(a)) return false; return push(a == 0 ? 1 : 0);
      case OP_JMP: if (!u16(addr)) return false; if (addr > len) return fail(CT_ERR_PC); pc = addr; return true;
      case OP_JZ: case OP_JNZ:
        if (!u16(addr) || !pop(a)) return false;
        if (addr > len) return fail(CT_ERR_PC);
        if ((a == 0) == (op == OP_JZ)) pc = addr;
        return true;
      case OP_FN1: if (!u8(k) || !pop(a)) return false; return push(fn1(k, a));
      case OP_CONSTRAIN:
        if (!pop(c) || !pop(b) || !pop(a)) return false;
        if (b > c) { float t = b; b = c; c = t; }
        return push(a < b ? b : (a > c ? c : a));
      case OP_BETWEEN:
        if (!pop(c) || !pop(b) || !pop(a)) return false;
        if (b > c) { float t = b; b = c; c = t; }
        return push(a >= b && a <= c ? 1 : 0);
      case OP_RANDOM: {
        if (!pop(b) || !pop(a)) return false;
        long lo = (long)a, hi = (long)b;
        if (hi < lo) { long t = lo; lo = hi; hi = t; }
        return push(hal && hal->random ? (float)hal->random(lo, hi + 1) : (float)lo);
      }
      case OP_DELAY: {
        if (!pop(a)) return false;
        if (a > 0) { waitUntil = now() + (uint32_t)a; waiting = true; }
        return true;
      }
      case OP_MILLIS: return push((float)now());
      case OP_SYS: if (!u8(k)) return false; return sys(k);
      default: return fail(CT_ERR_OP);
    }
  }

  bool sys(uint8_t id) {
    float a, b;
    switch (id) {
      case SYS_LED: if (!pop(a)) return false; if (hal->led) hal->led(a != 0); return true;
      case SYS_BUZZER: {
        if (!pop(a)) return false;
        int f = (int)a; if (f < 0) f = 0; if (f > 10000) f = 10000;
        if (hal->buzzer) hal->buzzer(f);
        if (f > 0) { waitUntil = now() + 200; waiting = true; } // như robot.buzzer(): kêu 200 ms rồi mới chạy tiếp
        return true;
      }
      case SYS_SERVO: {
        if (!pop(a)) return false;
        int v = (int)a; if (v < 0) v = 0; if (v > 180) v = 180;
        if (hal->servo) hal->servo(v);
        return true;
      }
      case SYS_DISTANCE: return push(hal->distance ? (float)hal->distance() : 400.0f);
      case SYS_LINE_LEFT: return push(hal->lineLeft ? (float)hal->lineLeft() : 0.0f);
      case SYS_LINE_RIGHT: return push(hal->lineRight ? (float)hal->lineRight() : 0.0f);
      case SYS_BUTTON: return push(hal->button ? (float)hal->button() : 0.0f);
      case SYS_BT_HAS_KEY: if (!pop(a)) return false; return push(hal->btHasKey ? (float)(hal->btHasKey((int)a) != 0) : 0.0f);
      case SYS_BT_READ: return push(hal->btRead ? (float)hal->btRead() : -1.0f);
      case SYS_BT_SEND: {
        uint8_t n; if (!u8(n)) return false;
        if ((uint32_t)pc + n > len) return fail(CT_ERR_PC);
        if (hal->btSend) hal->btSend(code + pc, n);
        pc += n; return true;
      }
      case SYS_DWRITE: if (!pop(b) || !pop(a)) return false; if (hal->dwrite) hal->dwrite((int)a, b != 0); return true;
      case SYS_DREAD: if (!pop(a)) return false; return push(hal->dread ? (float)hal->dread((int)a) : 0.0f);
      case SYS_AREAD: if (!pop(a)) return false; return push(hal->aread ? (float)hal->aread((int)a) : 0.0f);
      case SYS_PWM: {
        if (!pop(b) || !pop(a)) return false;
        int p = (int)b; if (p < 0) p = 0; if (p > 100) p = 100;
        if (hal->pwm) hal->pwm((int)a, p);
        return true;
      }
    }
    return fail(CT_ERR_SYS);
  }
};
