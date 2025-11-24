import React, { useEffect, useRef } from "react";
import "./Heatmap.css";
import { SENSOR_COORDS, SENSOR_KEYS } from "./lib/sensors";

const CANVAS_WIDTH = 420;
const CANVAS_HEIGHT = 450;
const voltsToKpa = (v: number) => 100 * Math.pow(v, 1.5);

const MAX_PRESSURE_KPA = 150.0;
const SENSOR_RADIUS = 80;

interface FootHeatmapProps {
  sensorData: Record<string, number> | null;
  cop: { x: number; y: number } | null;
  copHistory?: Array<{ x: number; y: number }>;
}

const GRADIENT_STOPS = [
  { stop: 0.0, color: [59, 130, 246] },
  { stop: 0.55, color: [22, 163, 74] },
  { stop: 0.85, color: [250, 204, 21] },
  { stop: 1.0, color: [239, 68, 68] },
];

const FootHeatmap: React.FC<FootHeatmapProps> = ({ sensorData, cop, copHistory = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!sensorData) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const key of SENSOR_KEYS) {
      const coords = SENSOR_COORDS[key];
      if (!coords) continue;
      const voltage = sensorData[key] || 0;
      const kpaValue = voltsToKpa(voltage);
      if (kpaValue <= 0) continue;

      const intensity = Math.min(kpaValue / MAX_PRESSURE_KPA, 1);
      const [r, g, b] = interpolateColor(intensity);
      const innerColor = `rgba(${r}, ${g}, ${b}, ${Math.min(0.85, 0.35 + intensity)})`;
      const outerColor = `rgba(${r}, ${g}, ${b}, 0)`;

      const gradient = ctx.createRadialGradient(coords.x, coords.y, 0, coords.x, coords.y, SENSOR_RADIUS);
      gradient.addColorStop(0, innerColor);
      gradient.addColorStop(1, outerColor);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, SENSOR_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Desenha linha de trajetória do CoP
    if (copHistory.length > 1) {
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "rgba(59, 130, 246, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const [first, ...rest] = copHistory;
      ctx.moveTo(first.x, first.y);
      for (const point of rest) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
    }

    ctx.restore();
  }, [sensorData, cop, copHistory]);

  return (
    <div className="heatmap-wrapper">
      <canvas ref={canvasRef} className="heatmap-canvas" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      <div className="foot-outline-image" />
      {cop && (
        <div
          className="cop-dot"
          title={`CoP: (${cop.x.toFixed(1)}, ${cop.y.toFixed(1)})`}
          style={{
            top: cop.y - 10,
            left: cop.x - 10,
          }}
        />
      )}
    </div>
  );
};

export default FootHeatmap;

function interpolateColor(value: number): [number, number, number] {
  const clamped = Math.min(Math.max(value, 0), 1);
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const current = GRADIENT_STOPS[i];
    const next = GRADIENT_STOPS[i + 1];
    if (clamped >= current.stop && clamped <= next.stop) {
      const range = next.stop - current.stop || 1;
      const t = (clamped - current.stop) / range;
      return [
        Math.round(current.color[0] + (next.color[0] - current.color[0]) * t),
        Math.round(current.color[1] + (next.color[1] - current.color[1]) * t),
        Math.round(current.color[2] + (next.color[2] - current.color[2]) * t),
      ];
    }
  }
  const last = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  return last.color as [number, number, number];
}
