#ifndef TOOLBOX_COMMON_H
#define TOOLBOX_COMMON_H

/*
 * Toolbox Base — Common Utilities
 * LED blink, uptime, small helpers shared across all tools.
 */

#include <Arduino.h>

#ifndef TB_LED_PIN
#define TB_LED_PIN 10  // XIAO ESP32-C3 built-in LED
#endif

/**
 * Non-blocking LED heartbeat. Call in loop().
 * Brief flash every ~2 seconds.
 */
inline void tbLedBlink() {
    static unsigned long lastBlink = 0;
    static bool ledOn = false;
    unsigned long now = millis();
    if (!ledOn && (now - lastBlink > 2000)) {
        digitalWrite(TB_LED_PIN, LOW);  // LED on (active low)
        ledOn = true;
        lastBlink = now;
    } else if (ledOn && (now - lastBlink > 50)) {
        digitalWrite(TB_LED_PIN, HIGH); // LED off
        ledOn = false;
    }
}

/**
 * Quick LED flash to indicate activity.
 */
inline void tbLedFlash(unsigned long ms = 10) {
    digitalWrite(TB_LED_PIN, LOW);
    delay(ms);
    digitalWrite(TB_LED_PIN, HIGH);
}

/**
 * Initialize LED pin.
 */
inline void tbLedBegin() {
    pinMode(TB_LED_PIN, OUTPUT);
    digitalWrite(TB_LED_PIN, HIGH); // Off
}

#endif // TOOLBOX_COMMON_H
