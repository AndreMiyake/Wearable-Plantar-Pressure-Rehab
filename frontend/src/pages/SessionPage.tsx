import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import PlantarPressureCharts from "../components/PlantarPressureCharts";
import FootHeatmap from "../FootHeatmap";
import { Patient, Pressao, SessionDetail } from "../types";
import {
  appendSessionSample,
  endSession,
  fetchPatient,
  fetchPressure,
  fetchSession,
} from "../lib/api";
import { SENSOR_COORDS, SENSOR_KEYS, type SensorKey } from "../lib/sensors";

const COP_THRESHOLD = 1;
type RegionKey = "antepe" | "mediape" | "calcanhar";
const REGION_SENSORS: Record<RegionKey, SensorKey[]> = {
  antepe: ["fsr1", "fsr3"], // dedao + cabeca distal do primeiro metatarso
  mediape: ["fsr4"], // medio pe (lateral)
  calcanhar: ["fsr2"], // calcanhar
};
const REGION_LABELS: Record<RegionKey, string> = {
  antepe: "Antepe",
  mediape: "Medio pe",
  calcanhar: "Calcanhar",
};
const MAX_HISTORY_POINTS = 120;
const MAX_COP_HISTORY = 200;
const SENSOR_BOUNDS = computeSensorBounds(SENSOR_COORDS);

type PressureSnapshot = {
  timestamp: number;
  total: number;
  regions: Record<RegionKey, number>;
};

const voltsToKpa = (v: number) => 100 * Math.pow(Math.max(v, 0), 1.5);

const SessionPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initialPatient = (location.state as { patient?: Patient } | null)?.patient;
  const [patient, setPatient] = useState<Patient | null>(initialPatient ?? null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [pressao, setPressao] = useState<Pressao | null>(null);
  const [cop, setCop] = useState<{ x: number; y: number } | null>(null);
  const [copHistory, setCopHistory] = useState<Array<{ x: number; y: number }>>([]);
  const [maxKpa, setMaxKpa] = useState(0);
  const [regionBreakdown, setRegionBreakdown] = useState<Record<RegionKey, number>>({
    antepe: 0,
    mediape: 0,
    calcanhar: 0,
  });
  const [pressureHistory, setPressureHistory] = useState<PressureSnapshot[]>([]);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const hydratingHistoryRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    const loadSession = async () => {
      try {
        const data = await fetchSession(sessionId);
        setSession(data);
        if (!patient) {
          const fetched = await fetchPatient(data.patient_id);
          setPatient(fetched);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    };
    loadSession();
  }, [sessionId, patient]);

  useEffect(() => {
    if (!sessionId) return;
    if (session?.end_time) return;

    const timer = setInterval(async () => {
      try {
        const data = await fetchPressure();
        if (!data) return;
        setPressao(data);
        if (savingRef.current) return;
        savingRef.current = true;
        const summary = await appendSessionSample(sessionId, data, new Date().toISOString());
        setSession((prev) => (prev ? { ...prev, ...summary } : summary));
      } catch (err) {
        console.error(err);
      } finally {
        savingRef.current = false;
      }
    }, 150);

    return () => clearInterval(timer);
  }, [sessionId, session?.end_time]);

  useEffect(() => {
    if (!pressao) return;
    let highest = 0;
    let weightedX = 0;
    let weightedY = 0;
    let copWeight = 0;

    for (const key of SENSOR_KEYS) {
      const value = pressao[key] ?? 0;
      const kpa = voltsToKpa(value);
      if (kpa > highest) highest = kpa;
      if (kpa > COP_THRESHOLD) {
        const coords = SENSOR_COORDS[key];
        weightedX += coords.x * kpa;
        weightedY += coords.y * kpa;
        copWeight += kpa;
      }
    }

    const summaryMax = session?.max_pressure_kpa ?? 0;
    setMaxKpa(Math.max(summaryMax, highest));
    if (copWeight > 0) {
      const x = weightedX / copWeight;
      const y = weightedY / copWeight;
      const clamped = {
        x: clamp(x, SENSOR_BOUNDS.minX, SENSOR_BOUNDS.maxX),
        y: clamp(y, SENSOR_BOUNDS.minY, SENSOR_BOUNDS.maxY),
      };
      setCop(clamped);
      setCopHistory((prev) => {
        const next = [...prev, clamped];
        return next.length > MAX_COP_HISTORY ? next.slice(next.length - MAX_COP_HISTORY) : next;
      });
    } else {
      setCop(null);
      setCopHistory([]);
    }
    const snapshot = snapshotFromPressures(pressao, Date.now());
    setRegionBreakdown(snapshot.regions);

    if (hydratingHistoryRef.current) {
      hydratingHistoryRef.current = false;
      return;
    }

    setPressureHistory((prev) => {
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
    });
  }, [pressao, session?.max_pressure_kpa]);

  useEffect(() => {
    if (!session?.samples || session.samples.length === 0) return;
    const snapshots = session.samples
      .map((sample) => snapshotFromPressures(sample.pressures, new Date(sample.timestamp).getTime()))
      .slice(-MAX_HISTORY_POINTS);
    const lastSnapshot = snapshots[snapshots.length - 1];
    const lastSample = session.samples[session.samples.length - 1];

    hydratingHistoryRef.current = true;
    setPressureHistory(snapshots);
    if (lastSnapshot) {
      setRegionBreakdown(lastSnapshot.regions);
    }
    if (lastSample) {
      setPressao(lastSample.pressures);
    }
    const storedMax = session.samples.reduce(
      (maxValue, sample) => Math.max(maxValue, calculateMaxPressure(sample.pressures)),
      0,
    );
    setMaxKpa(Math.max(storedMax, session.max_pressure_kpa ?? 0));
  }, [session?.samples, session?.max_pressure_kpa]);


  const handleEndSession = async () => {
    if (!sessionId) return;
    setIsEnding(true);
    try {
      await endSession(sessionId);
      navigate("/home", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsEnding(false);
    }
  };

  const sessionStartedAt = session ? new Date(session.start_time).toLocaleString("pt-BR") : "-";
  const sessionDuration = session?.duration_seconds
    ? `${session.duration_seconds}s`
    : session?.end_time
    ? "Processando"
    : "Em andamento";

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Selecione uma sessão válida.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-950/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm uppercase text-purple-300 font-semibold tracking-[0.2em]">Sessão ativa</p>
            <h1 className="text-3xl font-bold">
              {patient ? patient.name : "Carregando paciente..."}
            </h1>
            <p className="text-sm text-slate-300">
              {session ? `Iniciada em ${sessionStartedAt}` : "Recuperando informações da sessão"}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 rounded-xl border border-white/20 text-sm font-semibold hover:bg-white/10 transition"
              onClick={() => navigate("/home")}
            >
              Voltar ao painel
            </button>
            <button
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-sm font-semibold shadow-lg disabled:opacity-50"
              onClick={handleEndSession}
              disabled={isEnding || Boolean(session?.end_time)}
            >
              {isEnding ? "Finalizando..." : "Finalizar sessão"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {error && <p className="text-red-400">{error}</p>}

        <section className="grid lg:grid-cols-2 gap-8 items-start">
          <div className="bg-white/5 rounded-3xl border border-white/10 p-6 space-y-4">
            <span className="text-xs uppercase tracking-widest text-slate-400">Heatmap plantar</span>
            <FootHeatmap sensorData={pressao} cop={cop} copHistory={copHistory} />
            <p className="text-sm text-slate-400 text-center">Atualizando a cada 0,1s</p>
          </div>

          <div className="space-y-4">
            <div className="bg-white/5 rounded-3xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4">Dados do paciente</h2>
              <ul className="text-sm text-slate-200 space-y-1">
                <li>
                  <span className="text-slate-400">Prontuário:</span>{" "}
                  {patient?.identifier || "não informado"}
                </li>
                <li>
                  <span className="text-slate-400">Idade:</span>{" "}
                  {patient?.age ? `${patient.age} anos` : "não informada"}
                </li>
                <li>
                  <span className="text-slate-400">Sessão iniciada às:</span> {sessionStartedAt}
                </li>
                <li>
                  <span className="text-slate-400">Duração:</span> {sessionDuration}
                </li>
              </ul>
            </div>

            <div className="bg-white/5 rounded-3xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4">Leitura atual</h2>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="bg-white/5 rounded-2xl p-4">
                  <p className="text-sm text-slate-300">Pressão máxima</p>
                  <p className="text-3xl font-bold">{maxKpa.toFixed(1)} kPa</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4">
                  <p className="text-sm text-slate-300">Amostras salvas</p>
                  <p className="text-3xl font-bold">{session?.sample_count ?? 0}</p>
                </div>
              </div>
            </div>

            <div className="bg-white/5 rounded-3xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold mb-4">Resumo da sessão</h2>
              <dl className="text-sm text-slate-300 space-y-2">
                <div className="flex justify-between">
                  <dt>Máx. registrado</dt>
                  <dd>{session ? `${session.max_pressure_kpa.toFixed(1)} kPa` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Status</dt>
                  <dd>
                    {session?.end_time ? "Encerrada" : "Em andamento"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>CoP atual</dt>
                  <dd>
                    {cop ? `(${cop.x.toFixed(0)}, ${cop.y.toFixed(0)})` : "sem contato"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <PlantarPressureCharts
          history={pressureHistory}
          regionLabels={REGION_LABELS}
          currentRegions={regionBreakdown}
        />
      </main>
    </div>
  );
};

export default SessionPage;

function snapshotFromPressures(pressures: Pressao, timestamp: number): PressureSnapshot {
  return {
    timestamp,
    total: calculateTotalPressure(pressures),
    regions: calculateRegionAverages(pressures),
  };
}

function calculateTotalPressure(pressures: Pressao): number {
  return SENSOR_KEYS.reduce((acc, key) => acc + voltsToKpa(pressures[key] ?? 0), 0);
}

function calculateMaxPressure(pressures: Pressao): number {
  return SENSOR_KEYS.reduce((highest, key) => Math.max(highest, voltsToKpa(pressures[key] ?? 0)), 0);
}

function calculateRegionAverages(pressao: Pressao): Record<RegionKey, number> {
  const result: Record<RegionKey, number> = {
    antepe: 0,
    mediape: 0,
    calcanhar: 0,
  };

  for (const region of Object.keys(REGION_SENSORS) as RegionKey[]) {
    const sensors = REGION_SENSORS[region];
    if (!sensors.length) continue;
    const sum = sensors.reduce((acc, key) => acc + voltsToKpa(pressao[key] ?? 0), 0);
    result[region] = sum / sensors.length;
  }

  return result;
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function computeSensorBounds(coords: Record<string, { x: number; y: number }>): Bounds {
  const values = Object.values(coords);
  if (!values.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...values.map((coord) => coord.x)),
    maxX: Math.max(...values.map((coord) => coord.x)),
    minY: Math.min(...values.map((coord) => coord.y)),
    maxY: Math.max(...values.map((coord) => coord.y)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
