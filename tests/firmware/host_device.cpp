// Giả lập mạch: nói giao thức nạp qua stdin/stdout, flash giả trong RAM, vết phần cứng ghi ra stderr.
// Dùng: host_device <mã mạch> <dung lượng gói>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <time.h>
#include <vector>
#include "../../firmware/common/ct_device.h"

static uint32_t g_cap = 4080 + 16;
static std::vector<uint8_t> g_flash;
static bool g_failWrite = false;

static uint32_t millisFn() { timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000); }
static int readFn() { uint8_t c; ssize_t n = read(0, &c, 1); if (n == 1) return c; if (n == 0) exit(0); return -1; }
static void writeFn(const uint8_t* d, int n) { fwrite(d, 1, n, stdout); fflush(stdout); }
static const uint8_t* base() { return g_flash.data(); }
static uint32_t cap() { return g_cap; }
static bool erase() { std::fill(g_flash.begin(), g_flash.end(), 0xff); return true; }
static bool wr(const uint8_t* d, uint32_t n) {
  if (g_failWrite) return false;
  erase();
  for (uint32_t i = 0; i < n; i++) { if (g_flash[i] != 0xff) return false; g_flash[i] = d[i]; }
  for (uint32_t i = 0; i < n; i++) if (g_flash[i] != d[i]) return false;
  return true;
}
static void led(int on) { fprintf(stderr, "LED %d\n", on); }
static void servo(int a) { fprintf(stderr, "SERVO %d\n", a); }
static const CtHal hal = { led, nullptr, servo, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, millisFn, nullptr };

int main(int argc, char** argv) {
  const int board = argc > 1 ? atoi(argv[1]) : 1;
  if (argc > 2) g_cap = (uint32_t)atoi(argv[2]);
  if (argc > 3) g_failWrite = atoi(argv[3]) != 0;
  g_flash.assign(g_cap, 0xff);
  std::vector<uint8_t> buffer(g_cap);
  fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
  static CtDevice dev;
  dev.begin(&hal, CtIO{readFn, writeFn}, CtStorage{base, cap, wr, erase}, (uint8_t)board, buffer.data());
  fprintf(stderr, "READY\n");
  for (;;) { dev.poll(); usleep(200); }
}
