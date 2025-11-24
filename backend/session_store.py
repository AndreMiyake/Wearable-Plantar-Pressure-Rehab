from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session, object_session

from db import SessionLocal
from models import Patient, Physiotherapist, PressureSample, Session as DbSession

# Apenas os sensores ativos (fsr1 a fsr4) sao considerados no banco e nos calculos de regioes
SENSOR_KEYS = ["fsr1", "fsr2", "fsr3", "fsr4"]
REGIONS: Dict[str, List[str]] = {
    "HEEL": ["fsr2"],  # calcanhar
    "MIDFOOT": ["fsr4"],  # medio pe (lateral)
    "TOE": ["fsr1", "fsr3"],  # dedao e cabeca distal do primeiro metatarso
}
DEFAULT_PHYSIO_EMAIL = "fisioterapeuta@pbl2025.com"
DEFAULT_PHYSIO_NAME = "Fisioterapeuta PBL"


def _volts_to_kpa(value: float) -> float:
    safe_value = max(value, 0.0)
    return 100 * (safe_value ** 1.5)


def _get_db() -> Session:
    return SessionLocal()


def _get_default_physio(db: Session) -> Physiotherapist:
    physio = db.query(Physiotherapist).filter(Physiotherapist.email == DEFAULT_PHYSIO_EMAIL).one_or_none()
    if physio:
        return physio
    physio = Physiotherapist(email=DEFAULT_PHYSIO_EMAIL, name=DEFAULT_PHYSIO_NAME)
    db.add(physio)
    db.commit()
    db.refresh(physio)
    return physio


def list_patients() -> List[Dict]:
    db = _get_db()
    try:
        patients = db.query(Patient).order_by(Patient.created_at.desc()).all()
        return [
            {
                "id": patient.id,
                "name": patient.name,
                "identifier": patient.identifier,
                "age": patient.age,
                "created_at": patient.created_at.isoformat(),
            }
            for patient in patients
        ]
    finally:
        db.close()


def get_patient(patient_id: str) -> Dict:
    db = _get_db()
    try:
        patient = db.get(Patient, patient_id)
        if not patient:
            raise ValueError("Paciente não encontrado")
        return {
            "id": patient.id,
            "name": patient.name,
            "identifier": patient.identifier,
            "age": patient.age,
            "created_at": patient.created_at.isoformat(),
        }
    finally:
        db.close()


def create_patient(name: str, *, identifier: Optional[str] = None, age: Optional[int] = None) -> Dict:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Nome do paciente obrigatório")
    normalized_identifier = identifier.strip() if identifier else None
    if age is not None and age <= 0:
        raise ValueError("Idade do paciente deve ser maior que zero")

    db = _get_db()
    try:
        physio = _get_default_physio(db)
        patient = Patient(
            name=normalized,
            identifier=normalized_identifier,
            age=age,
            physiotherapist_id=physio.id,
        )
        db.add(patient)
        db.commit()
        db.refresh(patient)
        return {
            "id": patient.id,
            "name": patient.name,
            "identifier": patient.identifier,
            "age": patient.age,
            "created_at": patient.created_at.isoformat(),
        }
    finally:
        db.close()


def start_session(patient_id: str, note: Optional[str] = None) -> Dict:
    db = _get_db()
    try:
        patient = db.get(Patient, patient_id)
        if not patient:
            raise ValueError("Paciente não encontrado")
        existing = (
            db.query(DbSession)
            .filter(DbSession.patient_id == patient_id, DbSession.end_time.is_(None))
            .first()
        )
        if existing:
            raise ValueError("Paciente já possui uma sessão em andamento")
        physio_id = patient.physiotherapist_id
        session = DbSession(patient_id=patient_id, physiotherapist_id=physio_id, note=note)
        db.add(session)
        db.commit()
        db.refresh(session)
        return summarize_session(session)
    finally:
        db.close()


def append_sample(session_id: str, sensor_readings: Dict[str, float], timestamp: Optional[str] = None) -> Dict:
    db = _get_db()
    try:
        session = db.get(DbSession, session_id)
        if not session:
            raise ValueError("Sessão não encontrada")
        if session.end_time is not None:
            raise ValueError("Sessão já foi finalizada")

        sample = PressureSample(
            session_id=session_id,
            pressures=sensor_readings,
            timestamp=_parse_timestamp(timestamp),
        )
        db.add(sample)

        max_reading = max((_volts_to_kpa(sensor_readings.get(key, 0.0)) for key in SENSOR_KEYS), default=0.0)
        session.sample_count = (session.sample_count or 0) + 1
        session.max_pressure_kpa = max(session.max_pressure_kpa or 0, max_reading)

        db.commit()
        db.refresh(session)
        return summarize_session(session)
    finally:
        db.close()


def end_session(session_id: str) -> Dict:
    db = _get_db()
    try:
        session = db.get(DbSession, session_id)
        if not session:
            raise ValueError("Sessão não encontrada")
        if session.end_time is None:
            session.end_time = datetime.utcnow()
            db.commit()
            db.refresh(session)
        return summarize_session(session)
    finally:
        db.close()


def list_sessions(patient_id: str) -> List[Dict]:
    db = _get_db()
    try:
        sessions = (
            db.query(DbSession)
            .filter(DbSession.patient_id == patient_id)
            .order_by(DbSession.start_time.desc())
            .all()
        )
        return [summarize_session(session) for session in sessions]
    finally:
        db.close()


def get_session(session_id: str) -> Dict:
    db = _get_db()
    try:
        session = db.get(DbSession, session_id)
        if not session:
            raise ValueError("Sessão não encontrada")
        result = summarize_session(session)
        samples = (
            db.query(PressureSample)
            .filter(PressureSample.session_id == session_id)
            .order_by(PressureSample.timestamp)
            .all()
        )
        result["samples"] = [
            {
                "timestamp": sample.timestamp.isoformat(),
                "pressures": sample.pressures,
            }
            for sample in samples
        ]
        return result
    finally:
        db.close()


def summarize_session(session: DbSession) -> Dict:
    region_totals = {region: 0.0 for region in REGIONS}
    summary_samples: List[PressureSample] = list(getattr(session, "samples", []) or [])

    if not summary_samples:
        db_session = object_session(session)
        if db_session:
            summary_samples = (
                db_session.query(PressureSample)
                .filter(PressureSample.session_id == session.id)
                .order_by(PressureSample.timestamp)
                .all()
            )

    sample_count = session.sample_count or len(summary_samples)

    if summary_samples:
        for sample in summary_samples:
            pressures: Dict[str, float] = sample.pressures or {}
            for region, sensors in REGIONS.items():
                if sensors:
                    avg = sum(_volts_to_kpa(pressures.get(sensor, 0.0)) for sensor in sensors) / len(sensors)
                else:
                    avg = 0.0
                region_totals[region] += avg
        region_averages = {
            region: round(total / len(summary_samples), 2) if summary_samples else 0.0
            for region, total in region_totals.items()
        }
    else:
        region_averages = {region: 0.0 for region in REGIONS}

    return {
        "id": session.id,
        "patient_id": session.patient_id,
        "note": session.note,
        "start_time": session.start_time.isoformat() if session.start_time else None,
        "end_time": session.end_time.isoformat() if session.end_time else None,
        "sample_count": sample_count,
        "max_pressure_kpa": round(session.max_pressure_kpa or 0.0, 2),
        "duration_seconds": _duration_seconds(session.start_time, session.end_time),
        "region_averages": region_averages,
    }


def _duration_seconds(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if not start or not end:
        return None
    return round((end - start).total_seconds(), 2)


def _parse_timestamp(value: Optional[str]) -> datetime:
    if not value:
        return datetime.utcnow()
    cleaned = value.replace("Z", "+00:00")
    return datetime.fromisoformat(cleaned)
