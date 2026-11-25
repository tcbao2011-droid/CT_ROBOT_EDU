// TỰ SINH bởi firmware/stage.mjs từ stm32-nucleo-f401re. Đừng sửa tay.
#pragma once
#define CT_BOARD_ID 3
#define CT_BOARD_NAME "Nucleo-F401RE"
#define CT_HOST_SERIAL Serial
#define CT_TRIG_PIN PA7
#define CT_ECHO_PIN PA6
#define CT_LINE_LEFT_PIN PA0
#define CT_LINE_RIGHT_PIN PA1
#define CT_BUZZER_PIN PB5
#define CT_SERVO_PIN PB3
#define CT_LED_PIN PA5
#define CT_LED_ACTIVE_LOW 0
#define CT_BT_RX PA12
#define CT_BT_TX PA11
#define CT_BT_SERIAL Serial6
#define CT_RANDOM_SEED_PIN PA0
#define CT_STORE_ADDR 0x08060000u
#define CT_STORE_CAPACITY 16400u
#define CT_STORE_SECTOR FLASH_SECTOR_7
#define CT_BUTTON_PIN PC13
#define CT_BUTTON_ACTIVE_LOW 1

static const uint32_t CT_PIN_TABLE[48] = {
  PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, 
  PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15, 
  PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7, 
  PB8, PB9, PB10, PB11, PB12, PB13, PB14, PB15, 
  PC0, PC1, PC2, PC3, PC4, PC5, PC6, PC7, 
  PC8, PC9, PC10, PC11, PC12, PC13, PC14, PC15, 
};
