import React, { useEffect, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

// Registrar os componentes do Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface Pressao { [key: string]: number; }

// === CONSTANTES DO PROJETO ===
const SENSOR_KEYS = ["fsr0", "fsr1", "fsr2", "fsr3", "fsr4", "fsr5", "fsr6"];
type ViewMode = 'all' | 'foot' | 'graphs';

// ⚠️ AJUSTE AQUI: Limiar de pressão (em kPa) para detectar o pé no chão.
// Comece com 50 e vá ajustando.
const STANCE_THRESHOLD_KPA = 50.0;

// === Paleta de cores ===
const cores = [
  { limite: 0.2, cor: "#FFF9C4" },
  { limite: 0.4, cor: "#FFF176" },
  { limite: 0.6, cor: "#FFD54F" },
  { limite: 0.75, cor: "#FFB74D" },
  { limite: 0.9, cor: "#EF5350" },
  { limite: 1.0, cor: "#C62828" },
];
const getColor = (v: number) => {
  for (const c of cores) if (v <= c.limite) return c.cor;
  return cores[cores.length - 1].cor;
};

// === Conversão FSR-402 (Volts -> kPa) ===
const voltsToKpa = (v: number) => 100 * Math.pow(v, 1.5);

// === Gauge (semicírculo) ===
function Gauge({
  value,
  max = 400,
  label = "Pressão Máxima",
  sublabel,
}: { value: number; max?: number; label?: string; sublabel?: string }) {
  const size = 220, stroke = 18;
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dashArray = `${circumference * pct} ${circumference}`;
  const angle = -180 + 180 * pct;
  const needleLength = r - 6;
  const rad = (Math.PI * (angle / 180));
  const nx = cx + needleLength * Math.cos(rad);
  const ny = cy + needleLength * Math.sin(rad);

  return (
    <div style={{
      width: size, padding: 16, borderRadius: 16,
      background: "#ffffff", boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
      textAlign: "center"
    }}>
      <div style={{ fontWeight: 700, color: "#1f2937", marginBottom: 8, fontSize: 14 }}>{label}</div>
      <svg width={size} height={size/1.2} viewBox={`0 0 ${size} ${size/1.2}`}>
        <g transform={`translate(0, ${stroke/2})`}>
          <path
            d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
            fill="none" stroke="#e5e7eb" strokeWidth={stroke} strokeLinecap="round"
          />
          <path
            d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
            fill="none" stroke="#ef4444" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={dashArray}
          />
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#111827" strokeWidth={3} />
          <circle cx={cx} cy={cy} r={6} fill="#111827" />
        </g>
      </svg>
      <div style={{ marginTop: -6 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>
          {value.toFixed(1)} <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.8 }}>kPa</span>
        </div>
        {sublabel && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{sublabel}</div>}
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>0</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>máx: {max} kPa</div>
      </div>
    </div>
  );
}

// === Componente Principal ===
export default function App() {
  // --- STATES ---
  const [pressao, setPressao] = useState<Pressao | null>(null);
  const [maxInfo, setMaxInfo] = useState<{ sensor: string; valorKpa: number } | null>(null);
  const ema = useRef<number | null>(null);
  const alpha = 0.3;
  const [graphsData, setGraphsData] = useState<{ [key: string]: number[] }>({});
  const [view, setView] = useState<ViewMode>('all');

  // States para o TEMPO DE PASSADA
  const [gaitState, setGaitState] = useState<'SWING' | 'STANCE'>('SWING'); // Começa 'no ar'
  const [stepStartTime, setStepStartTime] = useState<number | null>(null);
  const [lastStepDuration, setLastStepDuration] = useState<number | null>(null); // Em segundos

  // --- EFEITOS (HOOKS) ---

  // EFEITO 1: Buscar dados
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("http://127.0.0.1:8000/pressao");
        const data = await res.json();
        
        if (data.pressao) {
          const newData: Pressao = data.pressao;
          // 1. Atualiza o state 'pressao' (para o Pé e Gauge)
          setPressao(newData);

          // 2. Atualiza o state 'graphsData' (para os Gráficos de Linha)
          setGraphsData((prevGraphsData) => {
            const updatedGraphs = { ...prevGraphsData };
            SENSOR_KEYS.forEach((key) => {
              if (newData[key] !== undefined) { 
                const newHistory = prevGraphsData[key] ? [...prevGraphsData[key]] : [];
                newHistory.push(voltsToKpa(newData[key]));
                if (newHistory.length > 30) newHistory.shift();
                updatedGraphs[key] = newHistory;
              }
            });
            return updatedGraphs;
          });
        }
      } catch (error) {
        console.error("Erro ao buscar dados:", error)
      }
    }, 200);
    return () => clearInterval(id);
  }, []);

  // EFEITO 2: Calcular Métricas + LÓGICA DO TEMPO DE PASSADA
  useEffect(() => {
    if (!pressao) return;

    const entriesLeft = SENSOR_KEYS
      .filter(k => k in pressao)
      .map(k => [k, pressao[k]] as [string, number]);

    if (entriesLeft.length === 0) return;

    // --- Cálculo da Pressão Máxima ---
    const [maxSensor, maxVolts] = entriesLeft.reduce(
      (p, c) => (c[1] > p[1] ? c : p),
      entriesLeft[0]
    );
    const maxKpa = voltsToKpa(maxVolts);
    setMaxInfo({ sensor: maxSensor, valorKpa: maxKpa });

    // --- Cálculo do Gauge (EMA) ---
    if (ema.current == null) ema.current = maxKpa;
    else ema.current = alpha * maxKpa + (1 - alpha) * (ema.current as number);

    // --- LÓGICA DO TEMPO DE PASSADA (STANCE TIME) ---
    const isTouching = maxKpa > STANCE_THRESHOLD_KPA;

    // Caso 1: Pé acabou de tocar o chão (SWING -> STANCE)
    if (isTouching && gaitState === 'SWING') {
      setGaitState('STANCE');
      setStepStartTime(Date.now());
      setLastStepDuration(null); // Limpa a duração antiga
    }

    // Caso 2: Pé acabou de sair do chão (STANCE -> SWING)
    if (!isTouching && gaitState === 'STANCE') {
      setGaitState('SWING');
      if (stepStartTime) {
        const durationMs = Date.now() - stepStartTime;
        setLastStepDuration(durationMs / 1000); // Salva em segundos
      }
      setStepStartTime(null);
    }

  }, [pressao, gaitState, stepStartTime]); // Adiciona os novos states como dependência

  // --- PREPARAÇÃO DE DADOS PARA RENDER ---

  // Dados para o PÉ (Heatmap)
  const leftVals = SENSOR_KEYS.map(k => {
    const v = pressao?.[k] ?? 0;
    return Math.min(1, Math.max(0, v / 5));
  });
  const kpaVals = SENSOR_KEYS.map(k => voltsToKpa(pressao?.[k] ?? 0));
  
  const footCoords = [
    { top: 130, left: 160 },   // FSR0
    { top: 140, left: 230 },   // FSR1
    { top: 210, left: 175 },   // FSR2
    { top: 225, left: 240 },   // FSR3
    { top: 285, left: 200 },   // FSR4
    { top: 350, left: 180 },   // FSR5
    { top: 350, left: 250 },   // FSR6 (Ajuste aqui se precisar)
  ];

  // Dados para os GRÁFICOS DE LINHA
  const graphOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const },
      tooltip: { mode: "index" as const, intersect: false },
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'Pressão (kPa)' }},
      x: { title: { display: true, text: 'Leitura (tempo)' }}
    }
  };

  const graphData = (sensorKey: string) => ({
    labels: Array.from({ length: graphsData[sensorKey]?.length || 0 }, (_, i) => i + 1),
    datasets: [
      {
        label: sensorKey.toUpperCase(),
        data: graphsData[sensorKey] || [],
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.3)",
        fill: true,
        tension: 0.1
      },
    ],
  });

  // --- COMPONENTE BOTÃO DAS ABAS ---
  const TabButton = ({ label, mode }: { label: string, mode: ViewMode }) => {
    const isActive = view === mode;
    return (
      <button
        onClick={() => setView(mode)}
        style={{
          padding: '8px 16px',
          border: 'none',
          borderRadius: 8,
          background: isActive ? '#a855f7' : '#fff',
          color: isActive ? '#fff' : '#374151',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          transition: 'all 0.2s',
        }}
      >
        {label}
      </button>
    )
  }
  
  // Card de métrica genérico
  const MetricCard = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div style={{
      background: "#fff", borderRadius: 16, padding: 16,
      boxShadow: "0 8px 24px rgba(0,0,0,0.06)", minWidth: 260
    }}>
      <div style={{ fontWeight: 700, marginBottom: 8, color: "#1f2937" }}>{title}</div>
      {children}
    </div>
  );


  // --- RENDERIZAÇÃO ---
  return (
    <div style={{
      minHeight: "100vh",
      background: "#f8f9fb",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      padding: 30,
      boxSizing: 'border-box'
    }}>
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 16, color: "#1f2937" }}>
        Análise da Pressão do Pé Direito
      </h1>

      {/* === ABAS DE SELEÇÃO === */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <TabButton label="Visão Geral" mode="all" />
        <TabButton label="Mapa de Calor" mode="foot" />
        <TabButton label="Gráficos" mode="graphs" />
      </div>

      {/* Container principal com Flex-wrap */}
      <div style={{ 
        display: "flex", 
        gap: 24, 
        flexWrap: "wrap", 
        alignItems: "flex-start", 
        justifyContent: "center", 
        width: '100%' 
      }}>
        
        {/* === Bloco 1: O Pé (Heatmap) + Gauge + Métricas === */}
        {(view === 'all' || view === 'foot') && (
          <>
            <div style={{ textAlign: "center", position: "relative" }}>
              {/* ... (código do pé, sem mudanças) ... */}
              <div
                style={{
                  position: "relative",
                  width: 420,
                  height: 450,
                  backgroundImage: "url('/foot1.png')",
                  backgroundSize: "contain",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center",
                  marginBottom: 10,
                  transform: "translateY(20px)",
                }}
              >
                {SENSOR_KEYS.map((key, i) => {
                  if (!footCoords[i]) return null; 
                  return (
                    <div
                      key={key}
                      style={{
                        position: "absolute",
                        top: footCoords[i].top,
                        left: footCoords[i].left,
                        width: 55,
                        height: 55,
                        borderRadius: 8,
                        backgroundColor: getColor(leftVals[i]),
                        boxShadow: "0 0 8px rgba(0,0,0,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 12,
                        color: "#111",
                        opacity: 0.9,
                      }}
                    >
                      <div style={{
                          position: "absolute", top: 3, left: 3,
                          background: "rgba(0,0,0,0.6)", color: "white",
                          padding: "1px 4px", borderRadius: 4,
                          fontSize: 10, fontWeight: 700,
                        }}>
                        {key.toUpperCase()}
                      </div>
                      {kpaVals[i].toFixed(1)} kPa
                    </div>
                  )
                })}
              </div>
              <div style={{ color: "#a855f7", fontWeight: 700 }}>PÉ DIREITO</div>
            </div>

            {/* Coluna de Métricas (Gauge + Cards) */}
            <div style={{ display: "grid", gap: 16, paddingTop: 20 }}>
              <Gauge
                value={(ema.current ?? 0)}
                max={400}
                label="Pressão Máxima (suavizada)"
                sublabel={maxInfo ? maxInfo.sensor.toUpperCase() : ""}
              />
              
              <MetricCard title="Métricas de Pressão">
                <div style={{ fontSize: 14, color: "#374151" }}>
                  <strong>Máxima instantânea:</strong>{" "}
                  {maxInfo ? `${maxInfo.valorKpa.toFixed(1)} kPa (${maxInfo.sensor.toUpperCase()})` : "—"}
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    (sensores {SENSOR_KEYS.map(k => k.toUpperCase()).join('–')})
                  </div>
                </div>
              </MetricCard>

              {/* === NOVO CARD DE TEMPO DE PASSADA === */}
              <MetricCard title="Métricas da Passada">
                <div style={{ fontSize: 14, color: "#374151" }}>
                  <strong>Tempo de apoio (última):</strong>{" "}
                  <span style={{fontWeight: 600, fontSize: 16, color: '#111827'}}>
                    {lastStepDuration ? `${lastStepDuration.toFixed(2)} s` : "Calculando..."}
                  </span>
                </div>
                 <div style={{ fontSize: 14, color: "#374151", marginTop: 8 }}>
                  <strong>Status atual:</strong>{" "}
                  <span style={{
                      fontWeight: 700, 
                      color: gaitState === 'STANCE' ? '#16a34a' : '#6b7280' 
                    }}>
                    {gaitState === 'STANCE' ? 'PÉ NO CHÃO' : 'NO AR'}
                  </span>
                </div>
              </MetricCard>

            </div>
          </>
        )}

        {/* === Bloco 2: Gráficos de Linha === */}
        {(view === 'all' || view === 'graphs') && SENSOR_KEYS.map((sensorKey) => (
          <div 
            key={sensorKey} 
            style={{ 
              width: 400, 
              height: 300, 
              background: '#fff', 
              padding: 20, 
              borderRadius: 12, 
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
              marginTop: 20
            }}
          >
            <Line data={graphData(sensorKey)} options={graphOptions} />
          </div>
        ))}

      </div>
    </div>
  );
}
