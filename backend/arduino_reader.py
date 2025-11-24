import json
import os
import random
import statistics
import threading
import time
from typing import Protocol

import serial

USE_BLUETOOTH = os.getenv("USE_BLUETOOTH", "0").lower() in {"1", "true", "yes"}
PORTA = os.getenv("ARDUINO_PORT", "COM6")
PORTA_LIST = [
    entry.strip()
    for entry in os.getenv("ARDUINO_PORTS", PORTA).split(",")
    if entry.strip()
]
BAUDRATE = int(os.getenv("ARDUINO_BAUDRATE", "115200"))
BT_ADDRESS = os.getenv("ESP32_BT_ADDRESS")
BT_CHANNEL = int(os.getenv("ESP32_BT_CHANNEL", "1"))
ALLOW_SIMULATED = os.getenv("ALLOW_SIMULATED_DATA", "0").lower() in {"1", "true", "yes"}
INITIAL_SENSOR_COUNT = int(os.getenv("SENSOR_COUNT", "7"))
SENSOR_KEYS = [f"fsr{i}" for i in range(INITIAL_SENSOR_COUNT)]
DEFAULT_DISABLED_SENSORS: set[str] = set()
_extra_disabled = {
    sensor.strip()
    for sensor in os.getenv("DISABLED_SENSORS", "").split(",")
    if sensor.strip()
}
DISABLED_SENSORS = DEFAULT_DISABLED_SENSORS | _extra_disabled
DEFAULT_ALLOWED_SENSORS = {"fsr1", "fsr2"}
_allowed_from_env = {
    sensor.strip()
    for sensor in os.getenv("ALLOWED_SENSORS", "").split(",")
    if sensor.strip()
}
ALLOWED_SENSORS = _allowed_from_env or DEFAULT_ALLOWED_SENSORS
BASELINE_LEARN_RATE = float(os.getenv("SENSOR_BASELINE_ALPHA", "0.02"))
CONTACT_MIN_VOLTAGE = float(os.getenv("CONTACT_MIN_VOLTAGE", "0.35"))
MIN_ACTIVE_SENSORS = int(os.getenv("MIN_ACTIVE_SENSORS", "2"))
NOISE_THRESHOLD_VOLTAGE = float(os.getenv("NOISE_THRESHOLD_VOLTAGE", "0.15"))
NOISE_TRIGGER_COUNT = int(os.getenv("NOISE_TRIGGER_COUNT", "80"))
BASELINE_OFFSET_TOLERANCE = float(os.getenv("BASELINE_OFFSET_TOLERANCE", "0.02"))
OUTLIER_FACTOR = float(os.getenv("SENSOR_OUTLIER_FACTOR", "4.0"))
OUTLIER_TRIGGER_COUNT = int(os.getenv("SENSOR_OUTLIER_TRIGGER_COUNT", "60"))
OUTLIER_MIN_THRESHOLD = float(os.getenv("SENSOR_OUTLIER_MIN_VOLTAGE", "0.4"))

if USE_BLUETOOTH:
    try:
        import bluetooth  # type: ignore
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError("pybluez2 nao instalado. Adicione 'pybluez2' ao requirements e reinstale.") from exc


class _Connection(Protocol):
    def readline(self) -> bytes: ...
    def close(self) -> None: ...


class _SerialConnection:
    def __init__(self) -> None:
        if not PORTA_LIST:
            raise RuntimeError("Nenhuma porta serial configurada. Defina ARDUINO_PORT ou ARDUINO_PORTS.")
        last_error: Exception | None = None
        for port_name in PORTA_LIST:
            try:
                serial_port = serial.Serial(port_name, BAUDRATE, timeout=0.2)
                time.sleep(2)
                serial_port.reset_input_buffer()
                self._serial = serial_port
                self.port_name = port_name
                print(f"Conectado ao dispositivo serial na porta {port_name}")
                return
            except Exception as exc:
                last_error = exc
                print(f"Falha ao conectar na porta {port_name}: {exc}")
        raise RuntimeError(f"Nao foi possivel conectar nas portas {PORTA_LIST}. Ultimo erro: {last_error}")

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
_sensor_baseline: dict[str, float | None] = {sensor: None for sensor in SENSOR_KEYS}
_noise_counters: dict[str, int] = {sensor: 0 for sensor in SENSOR_KEYS}
_auto_disabled: set[str] = set()
_outlier_counters: dict[str, int] = {sensor: 0 for sensor in SENSOR_KEYS}


def _ensure_sensor_registry(count: int) -> None:
    """Expande a lista de sensores caso novas leituras tenham mais colunas."""
    if count <= len(SENSOR_KEYS):
        return
    current_len = len(SENSOR_KEYS)
    for idx in range(current_len, count):
        sensor = f"fsr{idx}"
        SENSOR_KEYS.append(sensor)
        _sensor_baseline[sensor] = None
        _noise_counters[sensor] = 0
        _outlier_counters[sensor] = 0


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


def _parse_packet(line: str):
    """
    Converte uma linha recebida em um dicionario de leituras.
    Aceita tanto JSON ({"fsr0": 1.0}) quanto valores separados por tab/espaco.
    """
    if line.startswith("{") and line.endswith("}"):
        data = json.loads(line)
        if isinstance(data, dict):
            return data
        return None
    parts = line.split()
    if not parts:
        return None
    if len(parts) > len(SENSOR_KEYS):
        _ensure_sensor_registry(len(parts))
        print(f"Detectados {len(parts)} sensores. Ajustando registro automaticamente.")
    if len(parts) < len(SENSOR_KEYS):
        # linha incompleta, ignora para evitar desalinhamento
        return None
    values = [float(value) for value in parts]
    return {sensor: values[idx] for idx, sensor in enumerate(SENSOR_KEYS)}


def _is_foot_active(payload: dict[str, float]) -> bool:
    active = sum(1 for value in payload.values() if value >= CONTACT_MIN_VOLTAGE)
    return active >= MIN_ACTIVE_SENSORS


def _apply_baseline(payload: dict[str, float], *, learn: bool, foot_active: bool) -> dict[str, float]:
    corrected: dict[str, float] = {}
    for sensor in SENSOR_KEYS:
        value = float(payload.get(sensor, 0.0))
        baseline = _sensor_baseline.get(sensor)
        if baseline is None:
            if learn and not foot_active:
                baseline = value
            else:
                baseline = 0.0
            _sensor_baseline[sensor] = baseline
        if learn and not foot_active:
            baseline = baseline + (value - baseline) * BASELINE_LEARN_RATE
            _sensor_baseline[sensor] = baseline
        corrected_value = value - baseline
        if corrected_value < BASELINE_OFFSET_TOLERANCE:
            corrected_value = 0.0
        corrected[sensor] = corrected_value
    return corrected


def _update_noise_detection(payload: dict[str, float], *, foot_active: bool) -> None:
    if foot_active:
        for sensor in SENSOR_KEYS:
            _noise_counters[sensor] = 0
        return
    for sensor, value in payload.items():
        if value > NOISE_THRESHOLD_VOLTAGE:
            _noise_counters[sensor] = _noise_counters.get(sensor, 0) + 1
            if _noise_counters[sensor] >= NOISE_TRIGGER_COUNT:
                _auto_disabled.add(sensor)
        else:
            _noise_counters[sensor] = max(_noise_counters.get(sensor, 0) - 1, 0)


def _update_outlier_detection(payload: dict[str, float]) -> None:
    magnitudes = [abs(value) for value in payload.values() if value != 0]
    if len(magnitudes) < 3:
        for sensor in SENSOR_KEYS:
            _outlier_counters[sensor] = 0
        return
    median_val = statistics.median(magnitudes)
    deviations = [abs(value - median_val) for value in magnitudes]
    mad = statistics.median(deviations) or 0.0
    threshold = max(OUTLIER_MIN_THRESHOLD, median_val + OUTLIER_FACTOR * mad)

    for sensor, value in payload.items():
        magnitude = abs(value)
        if magnitude > threshold:
            _outlier_counters[sensor] = _outlier_counters.get(sensor, 0) + 1
            if _outlier_counters[sensor] >= OUTLIER_TRIGGER_COUNT:
                if sensor not in _auto_disabled:
                    print(
                        f"Sensor {sensor} desativado automaticamente (valor {magnitude:.3f} excedeu {threshold:.3f})."
                    )
                _auto_disabled.add(sensor)
        else:
            _outlier_counters[sensor] = 0


def _apply_disabled_sensors(payload: dict[str, float]) -> dict[str, float]:
    disabled = DISABLED_SENSORS | _auto_disabled
    if ALLOWED_SENSORS:
        for sensor in SENSOR_KEYS:
            if sensor not in ALLOWED_SENSORS:
                disabled.add(sensor)
    if not disabled:
        return payload
    filtered = dict(payload)
    for sensor in disabled:
        if sensor in filtered:
            filtered[sensor] = 0.0
    return filtered


def _apply_sensor_filters(payload: dict[str, float], *, learn: bool = True) -> dict[str, float]:
    structured = {sensor: float(payload.get(sensor, 0.0)) for sensor in SENSOR_KEYS}
    foot_active = _is_foot_active(structured)
    corrected = _apply_baseline(structured, learn=learn, foot_active=foot_active)
    if learn:
        _update_noise_detection(corrected, foot_active=foot_active)
        _update_outlier_detection(corrected)
    return _apply_disabled_sensors(corrected)


def _serial_loop():
    global _last_data
    while not _stop_flag:
        conn = _open_connection_blocking()
        while not _stop_flag:
            try:
                raw_line = conn.readline().decode("utf-8", errors="ignore").strip()
                if not raw_line:
                    continue
                data = _parse_packet(raw_line)
                if data is not None:
                    data = _apply_sensor_filters(data)
                    with _data_lock:
                        _last_data = data
                    _data_event.set()
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
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
    for sensor in SENSOR_KEYS:
        fake[sensor] = 2.5 + 2.5 * random.uniform(-0.9, 0.9)
        fake[sensor] = max(0, min(5, fake[sensor]))  # garante entre 0 e 5 V
    return _apply_sensor_filters(fake, learn=False)


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
                return dict(data_copy)
    if allow_simulated:
        return _generate_fake_data()
    return None
