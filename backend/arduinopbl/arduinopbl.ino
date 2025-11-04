const int fsrPins[6] = {A0, A1, A2, A3, A4, A5};
const float VCC = 5.0;
const float ADC_RES = 1023.0;

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  Serial.print("{");
  for (int i = 0; i < 6; i++) {
    int raw = analogRead(fsrPins[i]);
    float voltage = (raw * VCC) / ADC_RES;

    Serial.print("\"fsr");
    Serial.print(i);
    Serial.print("\":");
    Serial.print(voltage, 3);

    if (i < 5) Serial.print(",");
  }
  Serial.println("}");
  delay(5);
}
