"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gsap } from "gsap";
import { NetworkTopology, LoadBalancingAction } from "../types/network";
import { fetchDeviceAIAnalysis } from "../services/networkService";
import {
  Shield,
  AlertTriangle,
  Activity,
  Zap,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import "./GuardianDashboard.css";

interface GuardianDashboardProps {
  topology: NetworkTopology;
  loadBalancingActions: LoadBalancingAction[];
}

interface AIResult {
  is_anomaly?: boolean;
  problematic_fields?: string[];
  suggestion?: string;
  // Allow extra fields from backend safely typed as unknown
  [key: string]: unknown;
}
type AIError = { error: string };
type AIAnalysis = AIResult | AIError;

const isAIError = (ai: AIAnalysis): ai is AIError => "error" in ai;
const isAIResult = (ai: AIAnalysis): ai is AIResult => !("error" in ai);

const clampPercent = (v: number) =>
  Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

function toAIAnalysis(input: unknown): AIAnalysis {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const base = "analysis" in obj ? (obj.analysis as unknown) : obj;

    if (base && typeof base === "object") {
      const r = base as Record<string, unknown>;

      if ("error" in r && typeof r.error === "string") {
        return { error: r.error };
      }

      const out: AIResult = {};
      if ("is_anomaly" in r && typeof r.is_anomaly === "boolean")
        out.is_anomaly = r.is_anomaly;
      if (
        "problematic_fields" in r &&
        Array.isArray(r.problematic_fields) &&
        r.problematic_fields.every((x) => typeof x === "string")
      ) {
        out.problematic_fields = r.problematic_fields as string[];
      }
      if ("suggestion" in r && typeof r.suggestion === "string")
        out.suggestion = r.suggestion;
      return out;
    }
  }
  return { error: "Invalid AI response" };
}

const GuardianDashboard: React.FC<GuardianDashboardProps> = ({
  topology,
  loadBalancingActions,
}) => {
  const statsRef = useRef<HTMLDivElement>(null);

  const [aiAnalyses, setAIAnalyses] = useState<Record<string, AIAnalysis>>({});
  const [aiLoading, setAILoading] = useState<boolean>(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  // Animated stats cards
  useLayoutEffect(() => {
    if (!statsRef.current) return;

    const ctx = gsap.context(() => {
      const items = Array.from(statsRef.current!.children);
      gsap.fromTo(
        items,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power2.out" }
      );
    }, statsRef);

    return () => ctx.revert();
  }, [topology.devices.length]);

  // Derived values
  const {
    totalDevices,
    healthyCount,
    systemHealth,
    averageWorkload,
    activeAgents,
    criticalDevices,
    warningDevices,
  } = useMemo(() => {
    const devices = topology.devices ?? [];
    const total = devices.length;
    const healthy = devices.filter((d) => d.status === "healthy").length;

    const workloadSum = devices.reduce(
      (sum, d) => sum + clampPercent(d.metrics?.workload ?? 0),
      0
    );
    const avgWorkload = total > 0 ? workloadSum / total : 0;

    const agentsActive = (topology.agents ?? []).filter(
      (a) => a.status === "active"
    ).length;

    const critical = devices
      .filter((d) => d.status === "critical")
      .sort((a, b) => (b.metrics?.workload ?? 0) - (a.metrics?.workload ?? 0));
    const warning = devices
      .filter((d) => d.status === "warning")
      .sort((a, b) => (b.metrics?.workload ?? 0) - (a.metrics?.workload ?? 0));

    const healthPct = total > 0 ? (healthy / total) * 100 : 0;

    return {
      totalDevices: total,
      healthyCount: healthy,
      systemHealth: clampPercent(healthPct),
      averageWorkload: clampPercent(avgWorkload),
      activeAgents: agentsActive,
      criticalDevices: critical,
      warningDevices: warning,
    };
  }, [topology.devices, topology.agents]);

  // Fetch AI analysis for critical/warning devices (parallel, safe cleanup)
  useEffect(() => {
    let cancelled = false;

    async function fetchAllAIAnalyses() {
      const devicesToAnalyze = (topology.devices ?? []).filter(
        (d) => d.status === "critical" || d.status === "warning"
      );

      if (devicesToAnalyze.length === 0) {
        setAIAnalyses({});
        setLastScanAt(Date.now());
        return;
      }

      setAILoading(true);

      const results = await Promise.allSettled(
        devicesToAnalyze.map(async (device) => {
          try {
            const raw = await fetchDeviceAIAnalysis(
              device.id,
              device.metrics,
              {}
            );
            const analysis = toAIAnalysis(raw);
            return { id: device.id, analysis };
          } catch {
            return {
              id: device.id,
              analysis: { error: "AI analysis failed" } as AIAnalysis,
            };
          }
        })
      );

      if (cancelled) return;

      const mapped: Record<string, AIAnalysis> = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          mapped[r.value.id] = r.value.analysis;
        }
      }

      setAIAnalyses(mapped);
      setLastScanAt(Date.now());
      setAILoading(false);
    }

    if (topology && (topology.devices?.length ?? 0) > 0) {
      fetchAllAIAnalyses();
    } else {
      setAIAnalyses({});
      setLastScanAt(Date.now());
    }

    return () => {
      cancelled = true;
    };
  }, [topology]);

  const getActionIcon = (action: LoadBalancingAction) => {
    switch (action.status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case "active":
        return <Activity className="h-4 w-4 text-blue-400" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-400" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getActionColor = (action: LoadBalancingAction) => {
    switch (action.status) {
      case "completed":
        return "border-green-500 bg-green-900/20";
      case "active":
        return "border-blue-500 bg-blue-900/20";
      case "pending":
        return "border-yellow-500 bg-yellow-900/20";
      default:
        return "border-gray-500 bg-gray-900/20";
    }
  };

  const formatTime = (ts?: number | null) =>
    ts ? new Date(ts).toLocaleTimeString() : "—";

  const devicesNeedingAttention = useMemo(
    () => [...criticalDevices, ...warningDevices],
    [criticalDevices, warningDevices]
  );

  const healthProgressTone =
    systemHealth > 80
      ? "progress--good"
      : systemHealth > 60
      ? "progress--warn"
      : "progress--bad";

  return (
    <div className="space-y-6">
      {/* Guardian Header */}
      <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 backdrop-blur-sm rounded-lg p-6 border border-blue-500/30">
        <div className="flex items-center space-x-3 mb-4">
          <Shield className="h-8 w-8 text-blue-400" />
          <div>
            <h2 className="text-2xl font-bold text-white">Guardian AI</h2>
            <p className="text-blue-300">System Oversight & Load Balancing</p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-4">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 font-medium">Active</span>
          </div>
          <div className="text-gray-300">
            Last scan: {formatTime(lastScanAt)}
            {aiLoading && (
              <span className="ml-2 text-xs text-blue-300">(updating...)</span>
            )}
          </div>
        </div>
      </div>

      {/* System Statistics */}
      <div
        ref={statsRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">System Health</p>
              <p
                className={`text-2xl font-bold ${
                  systemHealth > 80
                    ? "text-green-400"
                    : systemHealth > 60
                    ? "text-yellow-400"
                    : "text-red-400"
                }`}
              >
                {systemHealth.toFixed(1)}%
              </p>
            </div>
            <Activity className="h-8 w-8 text-green-400" />
          </div>
          {/* Use <progress> to avoid inline style width */}
          <progress
            className={`progress ${healthProgressTone} mt-2`}
            value={Math.round(systemHealth)}
            max={100}
            aria-label="System health"
          />
          <div className="mt-2 text-xs text-gray-400">
            {healthyCount} of {totalDevices} devices healthy
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Avg. Workload</p>
              <p
                className={`text-2xl font-bold ${
                  averageWorkload > 80
                    ? "text-red-400"
                    : averageWorkload > 60
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {averageWorkload.toFixed(1)}%
              </p>
            </div>
            <Zap className="h-8 w-8 text-purple-400" />
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Active Agents</p>
              <p className="text-2xl font-bold text-blue-400">
                {activeAgents}/{topology.agents.length}
              </p>
            </div>
            <Shield className="h-8 w-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Devices</p>
              <p className="text-2xl font-bold text-white">{totalDevices}</p>
            </div>
            <Activity className="h-8 w-8 text-gray-400" />
          </div>
        </div>
      </div>

      {/* AI Analysis for Critical/Warning Devices */}
      {(devicesNeedingAttention.length > 0 || aiLoading) && (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-400" />
            AI Analysis (Critical & Warning Devices)
          </h3>

          {aiLoading && (
            <div className="text-sm text-blue-300 mb-3">
              Analyzing devices with AI…
            </div>
          )}

          <div className="space-y-3">
            {devicesNeedingAttention.map((device) => {
              const ai = aiAnalyses[device.id];
              const statusIsCritical = device.status === "critical";
              const colorBox = statusIsCritical
                ? "bg-red-900/20 border border-red-500"
                : "bg-yellow-900/20 border border-yellow-500";

              const cpu = clampPercent(device.metrics.cpu ?? 0);
              const mem = clampPercent(device.metrics.memory ?? 0);
              const wl = clampPercent(device.metrics.workload ?? 0);

              return (
                <div
                  key={device.id}
                  className={`flex flex-col md:flex-row items-start md:items-center justify-between p-3 rounded-lg ${colorBox}`}
                >
                  <div className="flex items-center space-x-3">
                    <AlertTriangle
                      className={`h-5 w-5 ${
                        statusIsCritical ? "text-red-400" : "text-yellow-400"
                      }`}
                    />
                    <div>
                      <p
                        className={`font-medium ${
                          statusIsCritical ? "text-red-400" : "text-yellow-400"
                        }`}
                      >
                        {device.name}
                      </p>
                      <p className="text-sm text-gray-400">
                        Status: {device.status}
                      </p>

                      <div className="mt-2 text-xs text-gray-300">
                        <div>
                          <span className="font-bold text-white">
                            AI Analysis:
                          </span>{" "}
                          {ai ? (
                            isAIError(ai) ? (
                              <span className="text-yellow-400">
                                {ai.error}
                              </span>
                            ) : ai.is_anomaly !== undefined ? (
                              ai.is_anomaly ? (
                                <span className="text-red-400">
                                  Anomaly Detected
                                </span>
                              ) : (
                                <span className="text-green-400">Normal</span>
                              )
                            ) : (
                              <span className="text-gray-400">No signal</span>
                            )
                          ) : aiLoading ? (
                            <span className="text-blue-300">Pending…</span>
                          ) : (
                            <span className="text-gray-400">No data</span>
                          )}
                        </div>

                        {ai &&
                          isAIResult(ai) &&
                          ai.problematic_fields &&
                          ai.problematic_fields.length > 0 && (
                            <div>
                              Problematic Fields:{" "}
                              <span className="text-yellow-400">
                                {ai.problematic_fields.join(", ")}
                              </span>
                            </div>
                          )}

                        {ai && isAIResult(ai) && ai.suggestion && (
                          <div>
                            Suggestion:{" "}
                            <span className="text-blue-400">
                              {ai.suggestion}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right mt-2 md:mt-0">
                    <p
                      className={`text-sm ${
                        statusIsCritical ? "text-red-400" : "text-yellow-400"
                      }`}
                    >
                      CPU: {cpu.toFixed(1)}%
                    </p>
                    <p
                      className={`text-sm ${
                        statusIsCritical ? "text-red-400" : "text-yellow-400"
                      }`}
                    >
                      Memory: {mem.toFixed(1)}%
                    </p>
                    <p
                      className={`text-sm ${
                        statusIsCritical ? "text-red-400" : "text-yellow-400"
                      }`}
                    >
                      Workload: {wl.toFixed(1)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load Balancing Actions */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
          <Zap className="h-5 w-5 mr-2 text-blue-400" />
          Load Balancing Actions
        </h3>

        {loadBalancingActions.length > 0 ? (
          <div className="space-y-3">
            {loadBalancingActions.map((action) => {
              const sourceDevice = topology.devices.find(
                (d) => d.id === action.sourceDevice
              );
              const targetDevice = topology.devices.find(
                (d) => d.id === action.targetDevice
              );

              return (
                <div
                  key={action.id}
                  className={`p-4 rounded-lg border ${getActionColor(action)}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getActionIcon(action)}
                      <span className="font-medium text-white capitalize">
                        {action.type}
                      </span>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          action.status === "completed"
                            ? "bg-green-900/30 text-green-400"
                            : action.status === "active"
                            ? "bg-blue-900/30 text-blue-400"
                            : "bg-yellow-900/30 text-yellow-400"
                        }`}
                      >
                        {action.status}
                      </span>
                    </div>
                    <div className="text-sm text-green-400">
                      +{(action.estimatedBenefit ?? 0).toFixed(1)}% efficiency
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 text-sm text-gray-300">
                    <span>{sourceDevice?.name || "Unknown"}</span>
                    <ArrowRight className="h-4 w-4" />
                    <span>{targetDevice?.name || "Unknown"}</span>
                    <span className="ml-auto">
                      {(action.workloadAmount ?? 0).toFixed(1)}% workload
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Zap className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No load balancing actions required</p>
            <p className="text-sm text-gray-500">
              System is optimally balanced
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GuardianDashboard;
