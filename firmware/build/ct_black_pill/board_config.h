// TỰ SINH bởi firmware/stage.mjs từ stm32-black-pill. Đừng sửa tay.
#pragma once
#define CT_BOARD_ID 2
#define CT_BOARD_NAME "Black Pill"
#define CT_HOST_SERIAL Serial
#define CT_TRIG_PIN PB0
#define CT_ECHO_PIN PB1
#define CT_LINE_LEFT_PIN PB8
#define CT_LINE_RIGHT_PIN PB9
#define CT_BUZZER_PIN PB5
#define CT_SERVO_PIN PB10
#define CT_LED_PIN PC13
#define CT_LED_ACTIVE_LOW 1
#define CT_BT_RX PA3
#define CT_BT_TX PA2
#define CT_BT_SERIAL Serial2
#define CT_RANDOM_SEED_PIN PA1
#define CT_STORE_ADDR 0x08060000u
#define CT_STORE_CAPACITY 16400u
#define CT_STORE_SECTOR FLASH_SECTOR_7
#define CT_BUTTON_PIN PA0
#define CT_BUTTON_ACTIVE_LOW 1

static const uint32_t CT_PIN_TABLE[48] = {
  PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, 
  PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15, 
  PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7, 
  PB8, PB9, PB10, 0xffffffffu, PB12, PB13, PB14, PB15, 
  0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 
  0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu, PC13, PC14, PC15, 
};
