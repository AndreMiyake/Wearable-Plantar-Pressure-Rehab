"""Exporta sessões específicas para CSVs brutos usados na análise offline."""

from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from db import SessionLocal
from models import Patient, Physiotherapist, PressureSample, Session

TARGET_PATIENTS = {"controle", "paciente avc"}
SENSOR_KEYS = [f"fsr{i}" for i in range(7)]
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data-analysis" / "input"


def slugify(name: str) -> str:
    cleaned = []
    for ch in name.lower():
        if ch.isalnum():
            cleaned.append(ch)
        elif ch in {" ", "-", "_"}:
            cleaned.append("_")
    slug = "".join(cleaned).strip("_")
    return slug or "sessao"


def load_target_sessions(db_session) -> list[Session]:
    stmt = (
        select(Session)
        .options(
            selectinload(Session.samples),
            selectinload(Session.patient),
            selectinload(Session.physiotherapist),
        )
        .join(Patient, Session.patient_id == Patient.id)
        .join(Physiotherapist, Session.physiotherapist_id == Physiotherapist.id)
    )
    if TARGET_PATIENTS:
        stmt = stmt.where(Patient.name.in_(TARGET_PATIENTS))
    return list(db_session.scalars(stmt).all())


def _coerce_datetime(value, *, default: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return default
    return default


def _delta_seconds(raw_ts, start_raw, start_dt: datetime) -> float:
    """Normaliza timestamp (ms ou s) para segundos desde o início.

    - Para valores numéricos, converte milissegundos em segundos com heurística explícita.
    - Para datetime/string, usa o delta em segundos.
    """

    if isinstance(raw_ts, (int, float)) and isinstance(start_raw, (int, float)):
        delta = float(raw_ts) - float(start_raw)
        # Se a escala vier em milissegundos (valores grandes ou passos > 20 ms),
        # convertemos para segundos.
        if abs(start_raw) > 1e5 or abs(delta) > 20.0:
            return delta / 1000.0
        return delta

    current_ts = _coerce_datetime(raw_ts, default=start_dt)
    return (current_ts - start_dt).total_seconds()


def samples_to_rows(samples: Iterable[PressureSample]) -> list[dict]:
    ordered = sorted(samples, key=lambda s: s.timestamp or datetime.utcnow())
    if not ordered:
        return []
    start_raw = ordered[0].timestamp or datetime.utcnow()
    start_ts = _coerce_datetime(start_raw, default=datetime.utcnow())

    # Faça a normalização de tempo de forma consistente para a sessão inteira.
    numeric_timestamps = [
        s.timestamp for s in ordered if isinstance(s.timestamp, (int, float))
    ]
    use_numeric_path = len(numeric_timestamps) == len(ordered)
    if use_numeric_path:
        start_val = float(numeric_timestamps[0])
        deltas = [float(ts) - start_val for ts in numeric_timestamps]
        scale = 1000.0 if (abs(start_val) > 1e5 or max(abs(d) for d in deltas[1:] or [0.0]) > 20.0) else 1.0
        timestamps_seconds = [d / scale for d in deltas]
    else:
        timestamps_seconds = [
            _delta_seconds(s.timestamp or start_raw, start_raw, start_ts) for s in ordered
        ]

    rows = []
    for sample, delta_seconds in zip(ordered, timestamps_seconds):
        pressures = sample.pressures or {}
        row = {"timestamp": float(delta_seconds)}
        for key in SENSOR_KEYS:
            row[key] = pressures.get(key)
        rows.append(row)
    return rows


def export_session(session_obj: Session, seq_number: int) -> Path | None:
    rows = samples_to_rows(session_obj.samples)
    if not rows:
        return None

    label_source = (session_obj.patient.name if session_obj.patient else None) or (
        session_obj.physiotherapist.name if session_obj.physiotherapist else "sessao"
    )
    file_name = f"{slugify(label_source)}_sessao_{seq_number}.csv"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / file_name

    with output_path.open("w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=["timestamp", *SENSOR_KEYS])
        writer.writeheader()
        writer.writerows(rows)

    return output_path


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db_session:
        sessions = load_target_sessions(db_session)
        if not sessions:
            print("Nenhuma sessão encontrada para os filtros configurados.")
            return

        counters: defaultdict[str, int] = defaultdict(int)
        exported = 0
        for session_obj in sessions:
            label = (session_obj.patient.name if session_obj.patient else None) or (
                session_obj.physiotherapist.name if session_obj.physiotherapist else "sessao"
            )
            counters[label] += 1
            result_path = export_session(session_obj, counters[label])
            if result_path:
                exported += 1
                print(f"Exportada sessão {session_obj.id} -> {result_path}")

        print(f"Total de sessões exportadas: {exported}")


if __name__ == "__main__":
    main()
