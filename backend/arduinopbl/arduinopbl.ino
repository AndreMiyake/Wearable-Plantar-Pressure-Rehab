#include "BluetoothSerial.h"

BluetoothSerial SerialBT;

const uint8_t fsrPins[] = {34, 35, 32, 33, 25, 26, 27};
const uint8_t NUM_SENSORS = sizeof(fsrPins) / sizeof(fsrPins[0]);

// ADC do ESP32 opera em torno de 3.3 V com 12 bits (0-4095).
const float VCC = 3.3;
const float ADC_RES = 4095.0;
const uint16_t LOOP_DELAY_MS = 5;

String buildPayload() {
  String payload = "{";
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    const int raw = analogRead(fsrPins[i]);
    const float voltage = (raw * VCC) / ADC_RES;

    payload += "\"fsr";
    payload += i;
    payload += "\":";
    payload += String(voltage, 3);

    if (i < NUM_SENSORS - 1) {
      payload += ",";
    }
  }
  payload += "}";
  return payload;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  if (!SerialBT.begin("FSR_esp")) {  // pode trocar o nome conforme necessidade
    Serial.println("Falha ao iniciar Bluetooth!");
  } else {
    Serial.println("Bluetooth iniciado como 'FSR_esp'");
  }
}

void loop() {
  const String payload = buildPayload();

  Serial.println(payload);
  if (SerialBT.hasClient()) {  // so transmite quando algum dispositivo emparelhou
    SerialBT.println(payload);
  }

  delay(LOOP_DELAY_MS);
}
