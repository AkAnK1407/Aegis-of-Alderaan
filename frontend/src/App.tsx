import React, { useCallback, useMemo, useRef, useState } from "react";
import { Shield, BarChart3, X } from "lucide-react";
import DeviceMetrics from "./components/DeviceMetrics";
import GuardianDashboard from "./components/GuardianDashboard";
import DeviceList from "./components/DeviceList";
import { useNetworkData } from "./hooks/useNetworkData";
import TimeseriesResultsPanel from "./components/TimeseriesResultsPanel";

// View modes for the primary content area
type ViewMode = "guardian" | "timeseries" | "metrics";

// Time series types (server response)
type ForecastPoint = {
  ds: string; // timestamp
  yhat: number; // predicted value (e.g., CPU%)
};

type SpikeInfo = {
  predicted_value: number;
  predicted_time: string;
};

type AgentForecastResult = {
  error?: string;
  spike_info?: SpikeInfo | null;
  forecast?: ForecastPoint[];
};

type TimeseriesResults = Record<string, AgentForecastResult>;

// Optional augmentation to support newer fields from useNetworkData without breaking older code
type ExtendedNetworkData = ReturnType<typeof useNetworkData> & {
  lastUpdated?: number | null;
  error?: string | null;
};

// Resolve API base URL and origin (CSV served at origin, API at /api)
const API_URL: string = (() => {
  try {
    if (typeof import.meta !== "undefined") {
      const env = (
        import.meta as unknown as { env?: { VITE_API_URL?: string } }
      ).env;
      if (env?.VITE_API_URL) return env.VITE_API_URL;
    }
  } catch {
    // ignore
  }
  return "http://127.0.0.1:8000/api";
})();

const API_ORIGIN: string = (() => {
  try {
    const url = new URL(API_URL);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://127.0.0.1:8000";
  }
})();

function App() {
  const {
    topology,
    selectedDevice,
    predictions,
    loadBalancingActions,
    isLoading,
    selectDevice,
    clearSelection,
    // Optional newer fields; safe if not present
    lastUpdated,
    error: networkError,
  } = useNetworkData() as ExtendedNetworkData;

  const [viewMode, setViewMode] = useState<ViewMode>("guardian");
  const [timeseriesResults, setTimeseriesResults] =
    useState<TimeseriesResults | null>(null);
  const [loadingTimeseries, setLoadingTimeseries] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [uiError, setUiError] = useState<string | null>(null);

  // Abort controller for Timeseries request (avoid updates after unmount)
  const tsControllerRef = useRef<AbortController | null>(null);

  const navigationItems = useMemo<
    Array<{
      mode: ViewMode;
      icon: React.ComponentType<{ className?: string }>;
      label: string;
      description: string;
    }>
  >(
    () => [
      {
        mode: "guardian",
        icon: Shield,
        label: "Guardian AI",
        description: "System oversight",
      },
      {
        mode: "timeseries",
        icon: BarChart3,
        label: "Time Series",
        description: "Predictive analytics",
      },
      {
        mode: "metrics",
        icon: BarChart3,
        label: "Analytics",
        description: "Device metrics",
      },
    ],
    []
  );

  const handleDownloadCSV = useCallback(async (): Promise<void> => {
    setUiError(null);
    setDownloading(true);
    try {
      const response = await fetch(`${API_ORIGIN}/metrics_history.csv`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to download CSV");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "metrics_history.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // No unused variable in catch
      setUiError("Error downloading CSV");
    } finally {
      setDownloading(false);
    }
  }, [API_ORIGIN]);

  const runTimeseriesAnalysis = useCallback(async (): Promise<void> => {
    setUiError(null);
    setLoadingTimeseries(true);
    setTimeseriesResults(null);

    // Abort previous request if still running
    if (tsControllerRef.current) {
      tsControllerRef.current.abort();
    }
    const controller = new AbortController();
    tsControllerRef.current = controller;

    try {
      const response = await fetch(`${API_URL}/timeseries`, {
        method: "POST",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Timeseries API failed with status ${response.status}`);
      }
      const data = (await response.json()) as { results?: TimeseriesResults };
      setTimeseriesResults(data?.results ?? null);
    } catch (e) {
      const isAbort = (e as { name?: string })?.name === "AbortError";
      if (isAbort) {
        return;
      }
      setUiError("Failed to run time series analysis.");
    } finally {
      setLoadingTimeseries(false);
    }
  }, []);

  const statusSummary = useMemo(() => {
    const counts = { healthy: 0, warning: 0, critical: 0 };
    if (!topology) return counts;
    for (const d of topology.devices) {
      counts[d.status] += 1;
    }
    return counts;
  }, [topology]);

  if (isLoading || !topology) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Initializing AI Guardian
          </h2>
          <p className="text-gray-400">Scanning network topology...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 overflow-auto">
      {/* Header */}
      <header className="bg-gray-800/30 backdrop-blur-md border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Shield className="h-8 w-8 text-blue-400" aria-hidden="true" />
              <div>
                <h1 className="text-xl font-bold text-white">
                  Neural Network Guardian
                </h1>
                <p className="text-sm text-gray-400">
                  AI-Driven Distributed System Monitor
                </p>
              </div>
            </div>

            <nav className="flex space-x-1" aria-label="Primary">
              {navigationItems.map((item) => {
                const active = viewMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    onClick={() => setViewMode(item.mode)}
                    // Use aria-current for navigation, instead of aria-pressed (which is for toggle buttons)
                    aria-current={active ? "page" : undefined}
                    type="button"
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                      active
                        ? "bg-blue-600/30 text-blue-400 border border-blue-500/30"
                        : "text-gray-300 hover:bg-gray-700/30 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <div className="text-left">
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs opacity-75">
                        {item.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Inline message area for network or UI errors */}
        {(networkError || uiError) && (
          <div
            className="mb-4 rounded border border-red-500/30 bg-red-900/30 text-red-200 px-4 py-2"
            role="alert"
            aria-live="polite"
          >
            {networkError || uiError}
          </div>
        )}

        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-120px)]">
          {/* Sidebar - Device List */}
          <div className="col-span-12 lg:col-span-3">
            <DeviceList
              devices={topology.devices}
              agents={topology.agents}
              selectedDevice={selectedDevice}
              onDeviceSelect={selectDevice}
            />
          </div>

          {/* Main Content Area */}
          <div className="col-span-12 lg:col-span-9">
            {viewMode === "guardian" && (
              <GuardianDashboard
                topology={topology}
                loadBalancingActions={loadBalancingActions}
              />
            )}

            {viewMode === "timeseries" && (
              <div className="h-full bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 p-4 flex flex-col items-center justify-center">
                <h2 className="text-xl font-bold text-white mb-4">
                  Time Series Analysis
                </h2>
                <div className="flex flex-wrap gap-3 mb-4">
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                    disabled={loadingTimeseries}
                    onClick={runTimeseriesAnalysis}
                    type="button"
                  >
                    {loadingTimeseries
                      ? "Running Analysis..."
                      : "Run Time Series Analysis"}
                  </button>
                  <button
                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-60"
                    disabled={downloading}
                    onClick={handleDownloadCSV}
                    type="button"
                  >
                    {downloading ? "Downloading..." : "Download Metrics CSV"}
                  </button>
                </div>
                <p className="text-gray-400">
                  Runs predictive analytics for all agents using historical
                  metrics.
                </p>

                {timeseriesResults && (
                  <div className="mt-6 w-full">
                    <h3 className="text-lg font-bold text-white mb-2">
                      Prediction Results
                    </h3>
                    <TimeseriesResultsPanel results={timeseriesResults} />
                    {Object.entries(timeseriesResults).map(
                      ([agentId, result]) => (
                        <div
                          key={agentId}
                          className="mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700"
                        >
                          <div className="font-semibold text-blue-400">
                            {agentId}
                          </div>

                          {result.error && (
                            <div className="text-red-400">
                              Error: {result.error}
                            </div>
                          )}

                          {result.spike_info ? (
                            <div className="text-yellow-400">
                              🚨 Predicted CPU spike to{" "}
                              {result.spike_info.predicted_value}% at{" "}
                              {result.spike_info.predicted_time}
                            </div>
                          ) : (
                            <div className="text-green-400">
                              No CPU spike predicted in next hour.
                            </div>
                          )}

                          {result.forecast && result.forecast.length > 0 && (
                            <div className="mt-2">
                              <span className="text-gray-300 text-xs">
                                Forecast (next 60 min):
                              </span>
                              <ul className="text-gray-400 text-xs max-h-32 overflow-y-auto">
                                {result.forecast.map((f, idx) => (
                                  <li key={`${agentId}-${idx}`}>
                                    {f.ds}: {f.yhat.toFixed(2)}%
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {viewMode === "metrics" && (
              <div className="h-full">
                {selectedDevice ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold text-white">
                        Device Analytics
                      </h2>
                      <button
                        onClick={clearSelection}
                        className="flex items-center space-x-2 px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                        type="button"
                      >
                        <X className="h-4 w-4" />
                        <span>Close</span>
                      </button>
                    </div>
                    <DeviceMetrics
                      device={selectedDevice}
                      predictions={predictions}
                    />
                  </div>
                ) : (
                  <div className="h-full bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 flex items-center justify-center">
                    <div className="text-center">
                      <BarChart3 className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                      <h3 className="text-xl font-bold text-white mb-2">
                        Select a Device
                      </h3>
                      <p className="text-gray-400">
                        Choose a device from the list to view detailed metrics
                        and predictions
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800/80 backdrop-blur-md border-t border-gray-700/50 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div
                className="w-2 h-2 bg-green-400 rounded-full animate-pulse"
                aria-hidden="true"
              ></div>
              <span className="text-green-400">System Online</span>
            </div>
            <span className="text-gray-400">
              {statusSummary.healthy} healthy, {statusSummary.warning} warning,{" "}
              {statusSummary.critical} critical
            </span>
          </div>
          <div className="text-gray-400">
            Last update:{" "}
            {lastUpdated
              ? new Date(lastUpdated).toLocaleTimeString()
              : new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
