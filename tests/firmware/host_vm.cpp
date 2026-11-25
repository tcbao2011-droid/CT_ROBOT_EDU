// Chạy bytecode CT Robot EDU trên máy tính với phần cứng giả; in vết các lệnh phần cứng.
// Dùng: host_vm <file.bin> <thời gian chạy tối đa ms> [giá trị khoảng cách, cách nhau dấu phẩy]
#include <stdio.h>
#include <stdlib.h>
#include <vector>
#include "../../firmware/common/ct_vm.h"

static uint32_t g_ms = 0;
static std::vector<int> g_dist = {400};
static size_t g_distIdx = 0;
static uint32_t g_rng = 12345;

static void ev(const char* name, int a = 0, int b = 0, bool two = false) {
  if (two) printf("%u %s %d %d\n", g_ms, name, a, b); else printf("%u %s %d\n", g_ms, name, a);
}
static void led(int on) { ev("LED", on); }
static void buzzer(int f) { ev("BUZ", f); }
static void servo(int a) { ev("SERVO", a); }
static int distance() { int v = g_dist[g_distIdx % g_dist.size()]; g_distIdx++; return v; }
static int line() { return 1; }
static int button() { return 0; }
static int btHas(int c) { return c == 'F'; }
static int btRead() { return -1; }
static void btSend(const uint8_t* t, int n) { printf("%u BT %.*s\n", g_ms, n, (const char*)t); }
static void dw(int p, int l) { ev("DW", p, l, true); }
static int dr(int p) { return p == 5 ? 1 : 0; }
static int ar(int p) { return 100 + p; }
static void pwm(int p, int v) { ev("PWM", p, v, true); }
static uint32_t millisFn() { return g_ms; }
static long rnd(long lo, long hi) { g_rng = g_rng * 1103515245u + 12345u; return lo + (long)((g_rng >> 8) % (uint32_t)(hi - lo)); }

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  FILE* f = fopen(argv[1], "rb");
  if (!f) return 2;
  std::vector<uint8_t> pkg(65536);
  size_t n = fread(pkg.data(), 1, pkg.size(), f);
  fclose(f);
  uint32_t limit = (uint32_t)atoi(argv[2]);
  if (argc > 3) { g_dist.clear(); char* s = argv[3]; for (char* t = strtok(s, ","); t; t = strtok(nullptr, ",")) g_dist.push_back(atoi(t)); }

  const uint8_t* code; uint16_t len;
  const int boardId = argc > 4 ? atoi(argv[4]) : 1;
  if (!ct_parse_package(pkg.data(), (uint32_t)n, (uint8_t)boardId, &code, &len)) { printf("BAD_PACKAGE\n"); return 3; }

  static const CtHal hal = { led, buzzer, servo, distance, line, line, button, btHas, btRead, btSend, dw, dr, ar, pwm, millisFn, rnd };
  CtVm vm;
  vm.start(&hal, code, len);
  uint32_t guard = 0;
  while (vm.step(64) && g_ms <= limit) {
    g_ms++;                 // mỗi vòng ngoài = 1 ms
    if (++guard > 5000000) break;
  }
  if (vm.error) printf("ERROR %d\n", vm.error);
  else if (!vm.running) printf("%u HALT\n", g_ms);
  // in vài biến để kiểm tra
  printf("VARS %g %g %g %g\n", vm.vars[0], vm.vars[1], vm.vars[2], vm.vars[3]);
  return 0;
}
