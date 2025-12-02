import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { AlertTriangle, CheckCircle } from "lucide-react";

type ForecastPoint = { ds: string; yhat: number };
type SpikeInfo = { predicted_value: number; predicted_time: string };
type AgentForecastResult = {
  error?: string;
  spike_info?: SpikeInfo | null;
  forecast?: ForecastPoint[];
};

type TimeseriesResults = Record<string, AgentForecastResult>;

type ChartDatum = { ds: string; y: number };

interface TimeseriesResultsPanelProps {
  results: TimeseriesResults;
}

const cpuThreshold = 90; // matches PREDICTIVE_CPU_THRESHOLD default

const TimeseriesResultsPanel: React.FC<TimeseriesResultsPanelProps> = ({
  results,
}) => {
  return (
    <div className="w-full space-y-6">
      {Object.entries(results).map(([agentId, result]) => {
        const data: ChartDatum[] =
          (result.forecast ?? []).map((p: ForecastPoint) => ({
            ds: p.ds,
            y: p.yhat,
          })) ?? [];
        const spike = result.spike_info;

        return (
          <div
            key={agentId}
            className="bg-gray-900/60 border border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-blue-300 font-semibold">{agentId}</div>
              <div className="text-sm">
                {result.error ? (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> {result.error}
                  </span>
                ) : spike ? (
                  <span className="text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    Spike {spike.predicted_value}% at {spike.predicted_time}
                  </span>
                ) : (
                  <span className="text-green-400 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> No spike next hour
                  </span>
                )}
              </div>
            </div>

            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data}
                  margin={{ left: 12, right: 12, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.7} />
                      <stop
                        offset="100%"
                        stopColor="#60A5FA"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="ds" stroke="#9CA3AF" hide />
                  <YAxis
                    domain={[0, 100]}
                    stroke="#9CA3AF"
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#111827",
                      border: "1px solid #374151",
                    }}
                    formatter={(value: unknown) => {
                      const num =
                        typeof value === "number" ? value : Number(value ?? 0);
                      return [`${num.toFixed(2)}%`, "CPU forecast"];
                    }}
                    labelFormatter={(label: string) => `Time: ${label}`}
                  />
                  <ReferenceLine
                    y={cpuThreshold}
                    stroke="#F59E0B"
                    strokeDasharray="4 3"
                    label={{
                      value: "Threshold",
                      position: "left",
                      fill: "#F59E0B",
                      fontSize: 10,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="y"
                    stroke="#60A5FA"
                    fill="url(#gCpu)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {data.length > 0 && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-300">
                <div className="bg-gray-800/60 rounded p-2">
                  <div className="text-gray-400">Latest</div>
                  <div>{data[data.length - 1].y.toFixed(2)}%</div>
                </div>
                <div className="bg-gray-800/60 rounded p-2">
                  <div className="text-gray-400">Max</div>
                  <div>{Math.max(...data.map((d) => d.y)).toFixed(2)}%</div>
                </div>
                <div className="bg-gray-800/60 rounded p-2">
                  <div className="text-gray-400">Min</div>
                  <div>{Math.min(...data.map((d) => d.y)).toFixed(2)}%</div>
                </div>
                <div className="bg-gray-800/60 rounded p-2">
                  <div className="text-gray-400">Points</div>
                  <div>{data.length}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TimeseriesResultsPanel;
