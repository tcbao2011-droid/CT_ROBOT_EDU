/* =====================================================
   CT ROBOT EDU - FIRMWARE THÔNG DỊCH CHO STM32 (STM32duino)
   Dùng chung cho Blue Pill / Black Pill / Nucleo-F401RE.
   Cấu hình riêng từng mạch nằm trong board_config.h (do firmware/stage.mjs sinh ra
   từ chính khai báo mạch của phần mềm, nên chân luôn khớp với các khối).

   Chương trình người dùng (bytecode) được lưu ở cuối flash và tự chạy lại mỗi khi cấp điện.
===================================================== */
#pragma once
#include <Arduino.h>
#include <Servo.h>
#include "board_config.h"
#include "ct_device.h"

#if defined(STM32F1xx)
  #include "stm32f1xx_hal.h"
#elif defined(STM32F4xx)
  #include "stm32f4xx_hal.h"
#else
  #error "Chỉ hỗ trợ STM32F1 / STM32F4"
#endif

/* ---------- Lưu chương trình vào flash ---------- */

static uint8_t ctRxBuffer[CT_STORE_CAPACITY];

static const uint8_t* ctStoreBase() { return (const uint8_t*)CT_STORE_ADDR; }
static uint32_t ctStoreCapacity() { return CT_STORE_CAPACITY; }

static bool ctStoreErase() {
  HAL_FLASH_Unlock();
  FLASH_EraseInitTypeDef erase;
  uint32_t pageError = 0;
  memset(&erase, 0, sizeof(erase));
#if defined(STM32F1xx)
  erase.TypeErase = FLASH_TYPEERASE_PAGES;
  erase.Banks = FLASH_BANK_1;
  erase.PageAddress = CT_STORE_ADDR;
  erase.NbPages = (CT_STORE_CAPACITY + FLASH_PAGE_SIZE - 1) / FLASH_PAGE_SIZE;
#else
  erase.TypeErase = FLASH_TYPEERASE_SECTORS;
  erase.Sector = CT_STORE_SECTOR;
  erase.NbSectors = 1;
  erase.VoltageRange = FLASH_VOLTAGE_RANGE_3;
#endif
  const bool ok = HAL_FLASHEx_Erase(&erase, &pageError) == HAL_OK;
  HAL_FLASH_Lock();
  return ok;
}

static bool ctStoreWrite(const uint8_t* data, uint32_t n) {
  if (!ctStoreErase()) return false;
  HAL_FLASH_Unlock();
  bool ok = true;
#if defined(STM32F1xx)
  for (uint32_t i = 0; ok && i < n; i += 2) {
    const uint16_t half = (uint16_t)(data[i] | ((i + 1 < n ? data[i + 1] : 0xff) << 8));
    ok = HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, CT_STORE_ADDR + i, half) == HAL_OK;
  }
#else
  for (uint32_t i = 0; ok && i < n; i += 4) {
    uint32_t word = 0xffffffffu;
    for (uint32_t k = 0; k < 4 && i + k < n; k++) {
      word &= ~(0xffu << (8 * k));
      word |= (uint32_t)data[i + k] << (8 * k);
    }
    ok = HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, CT_STORE_ADDR + i, word) == HAL_OK;
  }
#endif
  HAL_FLASH_Lock();
  return ok && memcmp(ctStoreBase(), data, n) == 0;
}

/* ---------- Phần cứng ---------- */

static Servo ctServo;
static bool ctServoAttached = false;
// Cổng Bluetooth: core STM32duino 3.x tạo sẵn đối tượng này nhờ build_opt.h (-DENABLE_HWSERIALn).
#define CtBtSerial CT_BT_SERIAL

static int ctPin(int index) {
  if (index < 0 || index >= 48) return -1;
  const uint32_t p = CT_PIN_TABLE[index];
  return p == 0xffffffffu ? -1 : (int)p;
}

static void hwLed(int on) { digitalWrite(CT_LED_PIN, (on != 0) != (CT_LED_ACTIVE_LOW != 0) ? HIGH : LOW); }
static void hwBuzzer(int freq) { if (freq > 0) tone(CT_BUZZER_PIN, freq, 200); else noTone(CT_BUZZER_PIN); }
static void hwServo(int angle) {
  if (!ctServoAttached) { ctServo.attach(CT_SERVO_PIN); ctServoAttached = true; }
  ctServo.write(angle);
}
static int hwDistance() {
  digitalWrite(CT_TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(CT_TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(CT_TRIG_PIN, LOW);
  const unsigned long us = pulseIn(CT_ECHO_PIN, HIGH, 30000UL);
  return us == 0 ? 400 : (int)(us / 58UL);
}
static int hwLineLeft() { return digitalRead(CT_LINE_LEFT_PIN); }
static int hwLineRight() { return digitalRead(CT_LINE_RIGHT_PIN); }
#ifdef CT_BUTTON_PIN
static int hwButton() { return digitalRead(CT_BUTTON_PIN) == (CT_BUTTON_ACTIVE_LOW ? LOW : HIGH); }
#else
static int hwButton() { return 0; }
#endif
static int hwBtHasKey(int ch) { return CtBtSerial.available() > 0 && CtBtSerial.peek() == ch; }
static int hwBtRead() { return CtBtSerial.read(); }
static void hwBtSend(const uint8_t* text, int n) { CtBtSerial.write(text, n); CtBtSerial.write('\n'); }
static void hwDWrite(int index, int level) { const int p = ctPin(index); if (p < 0) return; pinMode(p, OUTPUT); digitalWrite(p, level ? HIGH : LOW); }
static int hwDRead(int index) { const int p = ctPin(index); if (p < 0) return 0; pinMode(p, INPUT); return digitalRead(p); }
static int hwARead(int index) { const int p = ctPin(index); return p < 0 ? 0 : analogRead(p); }
static void hwPwm(int index, int percent) { const int p = ctPin(index); if (p < 0) return; pinMode(p, OUTPUT); analogWrite(p, map(percent, 0, 100, 0, 255)); }
static uint32_t hwMillis() { return millis(); }
static long hwRandom(long lo, long hi) { return random(lo, hi); }

static const CtHal ctHal = {
  hwLed, hwBuzzer, hwServo, hwDistance, hwLineLeft, hwLineRight, hwButton,
  hwBtHasKey, hwBtRead, hwBtSend, hwDWrite, hwDRead, hwARead, hwPwm, hwMillis, hwRandom,
};

static int ioRead() { return CT_HOST_SERIAL.available() > 0 ? CT_HOST_SERIAL.read() : -1; }
static void ioWrite(const uint8_t* d, int n) { CT_HOST_SERIAL.write(d, n); }

static CtDevice ctDevice;

void ctSetup() {
  CT_HOST_SERIAL.begin(115200);
  CtBtSerial.begin(115200);
  pinMode(CT_TRIG_PIN, OUTPUT); digitalWrite(CT_TRIG_PIN, LOW);
  pinMode(CT_ECHO_PIN, INPUT);
  pinMode(CT_LINE_LEFT_PIN, INPUT);
  pinMode(CT_LINE_RIGHT_PIN, INPUT);
  pinMode(CT_LED_PIN, OUTPUT); hwLed(0);
  pinMode(CT_BUZZER_PIN, OUTPUT);
#ifdef CT_BUTTON_PIN
  pinMode(CT_BUTTON_PIN, CT_BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
#endif
  randomSeed(micros() ^ analogRead(CT_RANDOM_SEED_PIN));
  ctDevice.begin(&ctHal, CtIO{ioRead, ioWrite},
                 CtStorage{ctStoreBase, ctStoreCapacity, ctStoreWrite, ctStoreErase},
                 CT_BOARD_ID, ctRxBuffer);
}

void ctLoop() { ctDevice.poll(); }
