import React, { useEffect, useRef, useState } from "react";

interface Pressao { [key: string]: number; }

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
      <div style={{ fontWeight: 700, color: "#1f2937", marginBottom: 8 }}>{label}</div>
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

export default function App() {
  const [pressao, setPressao] = useState<Pressao | null>(null);
  const leftKeys = ["fsr0", "fsr1", "fsr2", "fsr3", "fsr4", "fsr5"];
  const [maxInfo, setMaxInfo] = useState<{ sensor: string; valorKpa: number } | null>(null);
  const ema = useRef<number | null>(null);
  const alpha = 0.3;

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("http://127.0.0.1:8000/pressao");
        const data = await res.json();
        if (data.pressao) setPressao(data.pressao);
      } catch {}
    }, 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!pressao) return;
    const entriesLeft = leftKeys
      .filter(k => k in pressao)
      .map(k => [k, pressao[k]] as [string, number]);

    if (entriesLeft.length === 0) return;

    const [maxSensor, maxVolts] = entriesLeft.reduce(
      (p, c) => (c[1] > p[1] ? c : p),
      entriesLeft[0]
    );
    const maxKpa = voltsToKpa(maxVolts);
    setMaxInfo({ sensor: maxSensor, valorKpa: maxKpa });

    if (ema.current == null) ema.current = maxKpa;
    else ema.current = alpha * maxKpa + (1 - alpha) * (ema.current as number);
  }, [pressao]);

  // valores 0–1
  const leftVals = leftKeys.map(k => {
    const v = pressao?.[k] ?? 0;
    return Math.min(1, Math.max(0, v / 5));
  });

  const kpaVals = leftKeys.map(k => voltsToKpa(pressao?.[k] ?? 0));

  // coordenadas dos sensores no pé esquerdo
  const sensorPos = [
    { top: 10, left: 60 },  // FSR0 – dedo maior
    { top: 40, left: 30 },  // FSR1 – dedo lateral
    { top: 40, left: 90 },  // FSR2 – meio antepé
    { top: 90, left: 40 },  // FSR3 – arco
    { top: 130, left: 70 }, // FSR4 – calcanhar interno
    { top: 150, left: 20 }, // FSR5 – calcanhar externo
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f8f9fb",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      padding: 30
    }}>
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 24, color: "#1f2937" }}>
        Análise da Pressão do Pé Direito
      </h1>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "center" }}>
        
        
        {/* Pé esquerdo com contorno real */}
<div style={{ textAlign: "center", position: "relative" }}>
  <div
    style={{
      position: "relative",
      width: 420,
      height: 450,
      backgroundImage: "url('/foot1.png')", // 👈 nome da silhueta
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      marginBottom: 10,
      transform: "translateY(20px)",
    }}
  >
    {leftVals.map((v, i) => {
      const coords = [
        { top: 130, left: 160 },   // FSR0 (dedo maior)
        { top: 140, left: 230 },   // FSR1
        { top: 210, left: 175 }, // FSR2
        { top: 225, left: 240 },  // FSR3
        { top: 285, left: 200 }, // FSR4
        { top: 350, left: 180 },  // FSR5 (calcanhar)
      ];
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            top: coords[i].top,
            left: coords[i].left,
            width: 55,
            height: 55,
            borderRadius: 8,
            backgroundColor: getColor(v),
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
          <div
            style={{
              position: "absolute",
              top: 3,
              left: 3,
              background: "rgba(0,0,0,0.6)",
              color: "white",
              padding: "1px 4px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            FSR{i}
          </div>
          {kpaVals[i].toFixed(1)} kPa
        </div>
      );
    })}
  </div>
  <div style={{ color: "#a855f7", fontWeight: 700 }}>PÉ DIREITO</div>
</div>


        {/* gauge + métrica */}
        <div style={{ display: "grid", gap: 16 }}>
          <Gauge
            value={(ema.current ?? 0)}
            max={400}
            label="Pressão Máxima (suavizada)"
            sublabel={maxInfo ? maxInfo.sensor.toUpperCase() : ""}
          />
          <div style={{
            background: "#fff", borderRadius: 16, padding: 16,
            boxShadow: "0 8px 24px rgba(0,0,0,0.06)", minWidth: 260
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "#1f2937" }}>Métricas</div>
            <div style={{ fontSize: 14, color: "#374151" }}>
              <strong>Máxima instantânea:</strong>{" "}
              {maxInfo ? `${maxInfo.valorKpa.toFixed(1)} kPa (${maxInfo.sensor.toUpperCase()})` : "—"}
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                (sensores FSR0–FSR5)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
