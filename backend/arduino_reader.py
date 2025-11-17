import json
import os
import random
import threading
import time
from typing import Protocol

import serial

USE_BLUETOOTH = os.getenv("USE_BLUETOOTH", "0").lower() in {"1", "true", "yes"}
PORTA = os.getenv("ARDUINO_PORT", "COM6")
BAUDRATE = int(os.getenv("ARDUINO_BAUDRATE", "115200"))
BT_ADDRESS = os.getenv("ESP32_BT_ADDRESS")
BT_CHANNEL = int(os.getenv("ESP32_BT_CHANNEL", "1"))
ALLOW_SIMULATED = os.getenv("ALLOW_SIMULATED_DATA", "0").lower() in {"1", "true", "yes"}
SIMULATED_SENSOR_COUNT = 7

if USE_BLUETOOTH:
    try:
        import bluetooth  # type: ignore
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError("pybluez nao instalado. Adicione 'pybluez' ao requirements e reinstale.") from exc


class _Connection(Protocol):
    def readline(self) -> bytes: ...
    def close(self) -> None: ...


class _SerialConnection:
    def __init__(self) -> None:
        self._serial = serial.Serial(PORTA, BAUDRATE, timeout=0.2)
        time.sleep(2)
        self._serial.reset_input_buffer()

    def readline(self) -> bytes:
        return self._serial.readline()

    def close(self) -> None:
        try:
            self._serial.close()
        except Exception:
            pass


class _BluetoothConnection:
    def __init__(self) -> None:
        if not BT_ADDRESS:
            raise RuntimeError("ESP32_BT_ADDRESS nao configurado para conexao Bluetooth.")
        sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
        sock.connect((BT_ADDRESS, BT_CHANNEL))
        sock.settimeout(0.2)
        self._socket = sock
        self._reader = sock.makefile("rb")

    def readline(self) -> bytes:
        return self._reader.readline()

    def close(self) -> None:
        for obj in (self._reader, self._socket):
            try:
                obj.close()
            except Exception:
                pass


_last_data = None
_stop_flag = False
_data_lock = threading.Lock()
_data_event = threading.Event()


def _open_connection_blocking() -> _Connection:
    while not _stop_flag:
        try:
            if USE_BLUETOOTH:
                conn = _BluetoothConnection()
                print(f"Conectado ao ESP32 via Bluetooth ({BT_ADDRESS}:{BT_CHANNEL})")
            else:
                conn = _SerialConnection()
                print(f"Conectado ao dispositivo serial na porta {PORTA}")
            return conn
        except Exception as e:
            target = BT_ADDRESS if USE_BLUETOOTH else PORTA
            print(f"Nao foi possivel conectar a {target}: {e}. Tentando novamente em 1 segundo...")
            time.sleep(1)


def _serial_loop():
    global _last_data
    while not _stop_flag:
        conn = _open_connection_blocking()
        while not _stop_flag:
            try:
                line = conn.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                if not (line.startswith("{") and line.endswith("}")):
                    continue
                data = json.loads(line)
                if isinstance(data, dict):
                    with _data_lock:
                        _last_data = data
                    _data_event.set()
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            except Exception as e:
                print("Erro na leitura do dispositivo:", e)
                try:
                    conn.close()
                except Exception:
                    pass
                break


# inicia thread assim que o modulo e importado
threading.Thread(target=_serial_loop, daemon=True).start()


def _generate_fake_data():
    """Retorna leituras simuladas para os 7 sensores."""
    fake = {}
    for i in range(SIMULATED_SENSOR_COUNT):
        fake[f"fsr{i}"] = 2.5 + 2.5 * random.uniform(-0.9, 0.9)
        fake[f"fsr{i}"] = max(0, min(5, fake[f"fsr{i}"]))  # garante entre 0 e 5 V
    return fake


def read_pressure_data(timeout=1.0, allow_simulated=ALLOW_SIMULATED):
    """
    Retorna o ultimo pacote recebido do Arduino.
    Se nada chegar dentro do timeout e allow_simulated=True, devolve dados fake.
    """
    got_data = _data_event.wait(timeout)
    if got_data:
        with _data_lock:
            if _last_data is not None:
                data_copy = dict(_last_data)
                _data_event.clear()
                return data_copy
    if allow_simulated:
        return _generate_fake_data()
    return None
