import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  Cpu,
  HardDrive,
  Zap,
  ThermometerSun,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Device, PredictionData } from "../types/network";
import styles from "./DeviceMetrics.module.css";

/* ----------------------------------------------------------------
   Types
------------------------------------------------------------------ */
interface NormalizedPredictionPoint {
  timestamp: Date;
  value: number | null;
  confidence: number | null;
}

interface NormalizedPrediction {
  metric: string;
  predictions: NormalizedPredictionPoint[];
}

interface UnifiedDataPoint {
  timestamp: Date;
  label: string;
  [metric: string]: Date | string | number | null;
}

interface DeviceMetricsProps {
  device: Device;
  predictions: PredictionData[];
  showLoader?: boolean;
  error?: string | null;
  thresholds?: {
    cpuWarning?: number;
    cpuCritical?: number;
    memoryWarning?: number;
    memoryCritical?: number;
    workloadWarning?: number;
    workloadCritical?: number;
    temperatureWarning?: number;
    temperatureCritical?: number;
  };
}

interface TrendInfo {
  cpu?: number | null;
  memory?: number | null;
  workload?: number | null;
  temperature?: number | null;
}

interface RechartsTooltipPayload {
  dataKey: string;
  name: string;
  value: number | null;
  payload: UnifiedDataPoint;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  label?: string;
}

/* ----------------------------------------------------------------
   Constants
------------------------------------------------------------------ */
const palette = {
  cpu: { stroke: "#3B82F6", fill: "#3B82F6" },
  memory: { stroke: "#8B5CF6", fill: "#8B5CF6" },
  workload: { stroke: "#10B981", fill: "#10B981" },
  temperature: { stroke: "#F97316", fill: "#F97316" },
  grid: "#374151",
  axis: "#9CA3AF",
};

const defaultThresholds = {
  cpuWarning: 60,
  cpuCritical: 80,
  memoryWarning: 60,
  memoryCritical: 80,
  workloadWarning: 60,
  workloadCritical: 80,
  temperatureWarning: 70,
  temperatureCritical: 85,
};

/* ----------------------------------------------------------------
   Helpers
------------------------------------------------------------------ */
function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function parseTimestamp(raw: unknown, fallbackIndex: number): Date {
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") return new Date(raw);
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return new Date(Date.now() + fallbackIndex * 60000);
}

function normalizePredictions(
  predictions: PredictionData[]
): NormalizedPrediction[] {
  return predictions.map((p) => {
    const normalizedPoints: NormalizedPredictionPoint[] = (
      p.predictions || []
    ).map((pt, idx) => ({
      timestamp: parseTimestamp(pt.timestamp, idx),
      value: Number.isFinite(pt.value) ? pt.value : null,
      confidence: Number.isFinite(pt.confidence) ? pt.confidence : null,
    }));
    return { metric: p.metric, predictions: normalizedPoints };
  });
}

function buildUnified(preds: NormalizedPrediction[]): UnifiedDataPoint[] {
  if (preds.length === 0) return [];
  const minLen = Math.min(
    ...preds.map((p) => p.predictions.length).filter((l) => l > 0)
  );
  if (!isFinite(minLen) || minLen <= 0) return [];
  return Array.from({ length: minLen }).map((_, idx) => {
    const baseTs = preds[0].predictions[idx].timestamp;
    const row: UnifiedDataPoint = {
      timestamp: baseTs,
      label: baseTs.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    preds.forEach((pr) => {
      row[pr.metric] = pr.predictions[idx].value;
    });
    return row;
  });
}

function getSeverityClass(value: number, warn: number, crit: number): string {
  if (value >= crit) return "text-red-400";
  if (value >= warn) return "text-yellow-400";
  return "text-green-400";
}

function getBarColor(value: number, warn: number, crit: number): string {
  if (value >= crit) return styles.barCritical;
  if (value >= warn) return styles.barWarning;
  return styles.barNormal;
}

function getAnomalyBadge(
  value: number,
  warn: number,
  crit: number
): React.ReactNode {
  if (value >= crit) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400">
        <XCircle className="h-3 w-3" /> Critical
      </span>
    );
  }
  if (value >= warn) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-400">
        <AlertTriangle className="h-3 w-3" /> Elevated
      </span>
    );
  }
  return null;
}

function getTrendIcon(
  curr?: number | null,
  prev?: number | null
): React.ReactNode {
  if (curr == null || prev == null) return null;
  if (curr > prev) return <TrendingUp className="h-4 w-4 text-yellow-400" />;
  if (curr < prev) return <TrendingDown className="h-4 w-4 text-green-400" />;
  return <CheckCircle2 className="h-4 w-4 text-gray-400" />;
}

/* ----------------------------------------------------------------
   Metric Card
------------------------------------------------------------------ */
interface MetricCardProps {
  label: string;
  value?: number | null;
  prev?: number | null;
  icon: React.ReactNode;
  warning: number;
  critical: number;
  unit?: string;
  metricKey: "cpu" | "memory" | "workload" | "temperature";
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  prev,
  icon,
  warning,
  critical,
  unit = "%",
  metricKey,
}) => {
  if (value == null) {
    return (
      <div className="bg-gray-900/30 rounded-lg p-4 border border-gray-700/60 space-y-2">
        <div className="flex items-center space-x-3 opacity-60">
          <div className="h-8 w-8 flex items-center justify-center rounded bg-gray-700/40 text-gray-500">
            {icon}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {label}
            </p>
            <p className="text-xs text-gray-500">No data</p>
          </div>
        </div>
      </div>
    );
  }

  const severityClass = getSeverityClass(value, warning, critical);
  const anomalyBadge = getAnomalyBadge(value, warning, critical);
  const trend = getTrendIcon(value, prev);
  const clamped = clamp(value);
  const barClass = getBarColor(value, warning, critical);

  return (
    <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/60 space-y-2">
      <div className="flex justify-between items-start">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 flex items-center justify-center rounded bg-gray-700/40">
            {icon}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {label}
            </p>
            <p className={`text-xl font-bold ${severityClass}`}>
              {value.toFixed(1)}
              {unit}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          {anomalyBadge}
          {trend}
        </div>
      </div>

      <div className={styles.progressWrapper}>
        <progress
          className={`${styles.progressElement} ${barClass}`}
          value={Math.round(clamped)}
          max={100}
          aria-label={`${label} ${value.toFixed(1)}${unit}`}
          data-metric={metricKey}
        />
        <div className={styles.progressGloss} aria-hidden="true" />
      </div>

      <p className="text-[10px] text-gray-500 leading-tight">
        Warning ≥ {warning}
        {unit}, Critical ≥ {critical}
        {unit}
      </p>
    </div>
  );
};

/* ----------------------------------------------------------------
   Custom Tooltip
------------------------------------------------------------------ */
const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className={styles.tooltip}
      role="dialog"
      aria-label={`Forecast details at ${label}`}
    >
      <p className="text-xs font-semibold text-gray-300 mb-1">{label}</p>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex justify-between text-xs">
            <span className="text-gray-400">{p.name}</span>
            <span className="font-medium text-gray-200">
              {typeof p.value === "number" ? p.value.toFixed(2) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Main Component
------------------------------------------------------------------ */
const DeviceMetrics: React.FC<DeviceMetricsProps> = ({
  device,
  predictions,
  showLoader = false,
  error = null,
  thresholds = {},
}) => {
  const mergedThresholds = { ...defaultThresholds, ...thresholds };

  const normalized = useMemo(
    () => normalizePredictions(predictions),
    [predictions]
  );
  const unifiedData = useMemo(() => buildUnified(normalized), [normalized]);

  const trends: TrendInfo = useMemo(() => {
    if (unifiedData.length < 2) return {};
    const prevPoint = unifiedData[unifiedData.length - 2];
    return {
      cpu: typeof prevPoint.cpu === "number" ? prevPoint.cpu : null,
      memory: typeof prevPoint.memory === "number" ? prevPoint.memory : null,
      workload:
        typeof prevPoint.workload === "number" ? prevPoint.workload : null,
      temperature:
        typeof prevPoint.temperature === "number"
          ? prevPoint.temperature
          : null,
    };
  }, [unifiedData]);

  const metrics = device?.metrics ?? { cpu: 0, memory: 0, workload: 0 };
  const temperatureValue =
    typeof metrics.temperature === "number" &&
    Number.isFinite(metrics.temperature)
      ? metrics.temperature
      : null;

  const statusClass = (() => {
    switch (device.status) {
      case "healthy":
        return "text-green-400 bg-green-900/20 border-green-500";
      case "warning":
        return "text-yellow-400 bg-yellow-900/20 border-yellow-500";
      case "critical":
        return "text-red-400 bg-red-900/20 border-red-500";
      default:
        return "text-gray-400 bg-gray-800/40 border-gray-600";
    }
  })();

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-600 text-red-300 rounded-lg p-4">
        <p className="font-semibold">Error loading metrics</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (showLoader) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-40 bg-gray-700/30 rounded-lg" />
        <div className="h-40 bg-gray-700/30 rounded-lg" />
        <div className="h-80 bg-gray-700/30 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{device.name}</h2>
            <p className="text-gray-400 capitalize">{device.type} Device</p>
          </div>
          <div
            className={`px-3 py-1 rounded-full border ${statusClass}`}
            aria-label={`Device status: ${device.status}`}
          >
            <span className="text-sm font-medium capitalize flex items-center gap-1">
              {device.status === "critical" ? (
                <XCircle className="h-4 w-4" />
              ) : device.status === "warning" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {device.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="CPU Usage"
            value={metrics.cpu}
            prev={trends.cpu}
            icon={<Cpu className="h-5 w-5 text-blue-400" />}
            warning={mergedThresholds.cpuWarning}
            critical={mergedThresholds.cpuCritical}
            metricKey="cpu"
          />
          <MetricCard
            label="Memory"
            value={metrics.memory}
            prev={trends.memory}
            icon={<HardDrive className="h-5 w-5 text-purple-400" />}
            warning={mergedThresholds.memoryWarning}
            critical={mergedThresholds.memoryCritical}
            metricKey="memory"
          />
          <MetricCard
            label="Workload"
            value={metrics.workload}
            prev={trends.workload}
            icon={<Activity className="h-5 w-5 text-green-400" />}
            warning={mergedThresholds.workloadWarning}
            critical={mergedThresholds.workloadCritical}
            metricKey="workload"
          />
          {temperatureValue != null && (
            <MetricCard
              label="Temperature"
              value={temperatureValue}
              prev={trends.temperature}
              icon={<ThermometerSun className="h-5 w-5 text-orange-400" />}
              warning={mergedThresholds.temperatureWarning}
              critical={mergedThresholds.temperatureCritical}
              metricKey="temperature"
              unit="°C"
            />
          )}
        </div>
      </div>

      {/* Snapshot Bars */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-400" />
          Real-time Snapshot
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-3 text-xs text-gray-400 mb-2">
            Live usage compared against dynamic thresholds; anomalies
            automatically highlighted.
          </div>
          <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* CPU */}
            <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/60">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">CPU</span>
                <span
                  className={getSeverityClass(
                    metrics.cpu,
                    mergedThresholds.cpuWarning,
                    mergedThresholds.cpuCritical
                  )}
                >
                  {metrics.cpu.toFixed(1)}%
                </span>
              </div>
              <div className={styles.progressWrapper}>
                <progress
                  className={`${styles.progressElement} ${getBarColor(
                    metrics.cpu,
                    mergedThresholds.cpuWarning,
                    mergedThresholds.cpuCritical
                  )}`}
                  value={Math.round(clamp(metrics.cpu))}
                  max={100}
                  aria-label={`CPU usage ${metrics.cpu.toFixed(1)}%`}
                />
                <div className={styles.progressGloss} aria-hidden="true" />
              </div>
            </div>

            {/* Memory */}
            <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/60">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">Memory</span>
                <span
                  className={getSeverityClass(
                    metrics.memory,
                    mergedThresholds.memoryWarning,
                    mergedThresholds.memoryCritical
                  )}
                >
                  {metrics.memory.toFixed(1)}%
                </span>
              </div>
              <div className={styles.progressWrapper}>
                <progress
                  className={`${styles.progressElement} ${getBarColor(
                    metrics.memory,
                    mergedThresholds.memoryWarning,
                    mergedThresholds.memoryCritical
                  )}`}
                  value={Math.round(clamp(metrics.memory))}
                  max={100}
                  aria-label={`Memory usage ${metrics.memory.toFixed(1)}%`}
                />
                <div className={styles.progressGloss} aria-hidden="true" />
              </div>
            </div>

            {/* Workload */}
            <div className="bg-gray-900/40 rounded-lg p-4 border border-gray-700/60">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">Workload</span>
                <span
                  className={getSeverityClass(
                    metrics.workload,
                    mergedThresholds.workloadWarning,
                    mergedThresholds.workloadCritical
                  )}
                >
                  {metrics.workload.toFixed(1)}%
                </span>
              </div>
              <div className={styles.progressWrapper}>
                <progress
                  className={`${styles.progressElement} ${getBarColor(
                    metrics.workload,
                    mergedThresholds.workloadWarning,
                    mergedThresholds.workloadCritical
                  )}`}
                  value={Math.round(clamp(metrics.workload))}
                  max={100}
                  aria-label={`Workload ${metrics.workload.toFixed(1)}%`}
                />
                <div className={styles.progressGloss} aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Predictions */}
      {unifiedData.length > 0 ? (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            24‑Hour Predictions
            <span className="text-xs font-medium text-gray-400">
              Forecasted resource utilization
            </span>
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={unifiedData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
                <XAxis
                  dataKey="label"
                  stroke={palette.axis}
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: palette.grid }}
                  minTickGap={24}
                />
                <YAxis
                  stroke={palette.axis}
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: palette.grid }}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine
                  y={mergedThresholds.cpuWarning}
                  stroke="#FBBF24"
                  strokeDasharray="4 4"
                  ifOverflow="visible"
                  label={{
                    value: "Warn",
                    position: "right",
                    fill: "#FBBF24",
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  y={mergedThresholds.cpuCritical}
                  stroke="#EF4444"
                  strokeDasharray="3 3"
                  ifOverflow="visible"
                  label={{
                    value: "Crit",
                    position: "right",
                    fill: "#EF4444",
                    fontSize: 10,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke={palette.cpu.stroke}
                  fill={palette.cpu.fill}
                  name="CPU %"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke={palette.memory.stroke}
                  fill={palette.memory.fill}
                  name="Memory %"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="workload"
                  stroke={palette.workload.stroke}
                  fill={palette.workload.fill}
                  name="Workload %"
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Forecast lines reflect model outputs; thresholds currently drawn for
            CPU.
          </p>
        </div>
      ) : (
        <div className="bg-gray-800/40 rounded-lg p-6 border border-gray-700 text-center">
          <p className="text-sm text-gray-400">
            No prediction data available. Once forecasting begins, a 24‑hour
            projection will appear here.
          </p>
        </div>
      )}
    </div>
  );
};

export default DeviceMetrics;
