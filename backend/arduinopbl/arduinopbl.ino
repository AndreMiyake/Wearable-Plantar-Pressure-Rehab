#include "BluetoothSerial.h"

BluetoothSerial SerialBT;

const int fsrPins[7] = {34, 35, 32, 33, 25, 26, 27}; // pinos analógicos
float tensao[7];

void setup() {
  Serial.begin(115200);   // serial normal (pra debug)
  SerialBT.begin("FSR_esp"); // nome Bluetooth que vai aparecer no PC/celular
  Serial.println("✅ Bluetooth iniciado. Procure por 'FSR_esp' e conecte-se.");

  // Configura os pinos como entrada
  for (int i = 0; i < 7; i++) {
    pinMode(fsrPins[i], INPUT);
  }
}

void loop() {
  // Lê os sensores
  for (int i = 0; i < 7; i++) {
    int leitura = analogRead(fsrPins[i]);
    tensao[i] = (leitura / 4095.0) * 3.3;
  }

  // Envia pro Serial Plotter OU Bluetooth (formato tabulado)
  for (int i = 0; i < 7; i++) {
    SerialBT.print(tensao[i], 3);
    if (i < 6) SerialBT.print("\t");
  }
  SerialBT.println();

  delay(100);
}

