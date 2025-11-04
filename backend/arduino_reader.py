import serial, json, threading, time, os

#$env:ARDUINO_PORT = "COM5" colocar no terminal pra selecionar a porta

PORTA = os.getenv("ARDUINO_PORT", "COM3")
BAUDRATE = 115200

_last_data = None
_stop_flag = False

def _serial_loop():
    global _last_data
    try:
        ser = serial.Serial(PORTA, BAUDRATE, timeout=0.1)
        time.sleep(2)  # dá tempo pro Arduino reiniciar
        ser.reset_input_buffer()
        while not _stop_flag:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if isinstance(data, dict):
                    _last_data = data
            except json.JSONDecodeError:
                # ignora linhas quebradas
                ser.reset_input_buffer()
                continue
    except Exception as e:
        print("Erro no loop serial:", e)
        time.sleep(1)
        _serial_loop()

# inicia thread assim que o módulo é importado
threading.Thread(target=_serial_loop, daemon=True).start()

import random, time

def read_pressure_data():
    """Simula leituras do Arduino (6 FSR por pé, total 12 sensores)."""
    time.sleep(1)  # ~20 Hz
    data = {}
    for i in range(12):
        # Gera valor oscilando entre 0 e 5 V, simulando um ciclo de passada
        data[f"fsr{i}"] = 2.5 + 2.5 * random.uniform(-0.9, 0.9)
        data[f"fsr{i}"] = max(0, min(5, data[f"fsr{i}"]))  # garante entre 0–5
    return data
