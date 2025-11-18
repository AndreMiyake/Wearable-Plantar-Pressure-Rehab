import React from "react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import type { ChartOptions, TooltipItem } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type Snapshot<K extends string = string> = {
  timestamp: number;
  total: number;
  regions: Record<K, number>;
};

interface PlantarPressureChartsProps<K extends string = string> {
  history: Snapshot<K>[];
  regionLabels: Record<K, string>;
  currentRegions: Record<K, number>;
}

const COLOR_PALETTE = ["#f97316", "#38bdf8", "#a855f7", "#f43f5e", "#22d3ee"];

const tooltipOptions = {
  callbacks: {
    label: (ctx: TooltipItem<"line">) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} kPa`,
  },
};

const baseOptions: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { color: "#e2e8f0" } },
    tooltip: tooltipOptions,
  },
  scales: {
    x: {
      ticks: { color: "#94a3b8" },
      grid: { color: "rgba(148,163,184,0.1)" },
    },
    y: {
      ticks: { color: "#94a3b8" },
      grid: { color: "rgba(148,163,184,0.1)" },
      beginAtZero: true,
      title: {
        display: true,
        text: "Pressao relativa (kPa)",
        color: "#cbd5f5",
      },
    },
  },
};

const compactOptions: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: tooltipOptions,
  },
  scales: {
    x: { display: false, grid: { display: false } },
    y: {
      beginAtZero: true,
      display: false,
    },
  },
};

function PlantarPressureCharts<K extends string = string>({
  history,
  regionLabels,
  currentRegions,
}: PlantarPressureChartsProps<K>) {
  const regionKeys = Object.keys(regionLabels) as K[];
  const labels = history.map((sample) =>
    new Date(sample.timestamp).toLocaleTimeString("pt-BR", { minute: "2-digit", second: "2-digit" }),
  );
  const secondsWindow = history.length > 1 ? Math.round(history.length * 0.5) : 0;
  const totalSeries = history.map((sample) => sample.total);
  const normalizedTotalSeries = normalizeToBaseline(totalSeries);
  const hasSamples = history.length > 0;

  const regionDatasets = regionKeys.map((regionKey, index) => {
    const color = COLOR_PALETTE[index % COLOR_PALETTE.length];
    const values = history.map((snapshot) => snapshot.regions[regionKey] ?? 0);
    return {
      key: regionKey,
      label: regionLabels[regionKey],
      color,
      values,
      normalizedValues: normalizeToBaseline(values),
    };
  });

  const totalChartData = {
    labels,
    datasets: [
      {
        label: "Pressao total",
        data: normalizedTotalSeries,
        borderColor: "#ec4899",
        backgroundColor: "#ec489933",
        tension: 0.35,
        fill: true,
        pointRadius: 0,
      },
    ],
  };

  const generalChartData = {
    labels,
    datasets: regionDatasets.map((dataset) => ({
      label: dataset.label,
      data: dataset.normalizedValues,
      borderColor: dataset.color,
      backgroundColor: `${dataset.color}33`,
      tension: 0.3,
      fill: false,
      pointRadius: 0,
    })),
  };

  return (
    <section className="bg-white/5 rounded-3xl border border-white/10 p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Graficos de pressao plantar</p>
          <h2 className="text-lg font-semibold text-white">Evolucao recente</h2>
        </div>
        {secondsWindow > 0 && (
          <span className="text-xs text-slate-400">Ultimos {secondsWindow}s de coleta (0,5s)</span>
        )}
      </div>

      {!hasSamples && (
        <div className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-center text-slate-400">
          Ainda estamos acumulando dados para montar os graficos. Aguarde alguns segundos com a sessao ativa.
        </div>
      )}

      {hasSamples && (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Pressao total (kPa)</span>
                <span className="font-semibold text-white">
                  {totalSeries.length ? `${totalSeries[totalSeries.length - 1].toFixed(1)} kPa` : "—"}
                </span>
              </div>
              <div className="h-60">
                <Line data={totalChartData} options={baseOptions} />
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Distribuicao por regiao</span>
                <span className="font-semibold text-white">Comparativo simultaneo</span>
              </div>
              <div className="h-60">
                <Line data={generalChartData} options={baseOptions} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {regionDatasets.map(({ key, label, color, normalizedValues }) => (
              <div key={key as string} className="bg-white/5 rounded-2xl border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>{label}</span>
                  <span className="font-semibold text-white">
                    {(currentRegions[key] ?? 0).toFixed(1)} kPa
                  </span>
                </div>
                <div className="h-44">
                  <Line
                    data={{
                      labels,
                      datasets: [
                        {
                          label,
                          data: normalizedValues,
                          borderColor: color,
                          backgroundColor: `${color}33`,
                          tension: 0.25,
                          fill: true,
                          pointRadius: 0,
                        },
                      ],
                    }}
                    options={compactOptions}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default PlantarPressureCharts;

function normalizeToBaseline(values: number[]): number[] {
  if (!values.length) {
    return values;
  }
  const baseline = Math.min(...values);
  if (!Number.isFinite(baseline) || baseline === 0) {
    return values.slice();
  }
  return values.map((value) => Math.max(value - baseline, 0));
}
