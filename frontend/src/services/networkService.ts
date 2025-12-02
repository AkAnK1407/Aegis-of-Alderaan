// services/networkService.ts

import {
  NetworkTopology,
  Device,
  Agent,
  LoadBalancingAction,
} from "../types/network";

/**
 * Prefer env-configured API URL with sensible local fallback.
 * - Vite: import.meta.env.VITE_API_URL
 * - Fallback: http://127.0.0.1:8000/api
 */
const API_URL: string = (() => {
  try {
    if (typeof import.meta !== "undefined") {
      const env = (
        import.meta as unknown as { env?: { VITE_API_URL?: string } }
      ).env;
      if (env?.VITE_API_URL) return env.VITE_API_URL;
    }
  } catch {
    // ignore, fallback to default
  }
  return "http://127.0.0.1:8000/api";
})();

class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(
    message: string,
    status: number,
    statusText: string,
    body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Helper to perform JSON requests with:
 * - AbortController timeout
 * - Basic response parsing and typed return
 * - Better error reporting
 */
async function fetchJSON<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    let body: unknown = null;
    if (response.status !== 204) {
      try {
        body = isJson ? await response.json() : await response.text();
      } catch {
        // keep body as null if parsing fails
      }
    }

    if (!response.ok) {
      // Derive a meaningful error message if present
      let message: string | null = null;
      if (isJson && body && typeof body === "object" && "message" in body) {
        const maybeMsg = (body as Record<string, unknown>).message;
        if (typeof maybeMsg === "string") {
          message = maybeMsg;
        }
      }
      throw new ApiError(
        message ?? `Request failed with status ${response.status}`,
        response.status,
        response.statusText,
        body
      );
    }

    return body as T;
  } catch (err: unknown) {
    const isAbort =
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name?: unknown }).name === "AbortError";
    if (isAbort) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Backend "status" shape
 */
type RawAgentMetrics = {
  dataCollected?: number;
  responseTime?: number;
  errorRate?: number;
};

type RawAgentStatus = {
  name?: string;
  agent_name?: string;
  type?: string;
  cpu?: number;
  memory?: number;
  workload?: number;
  connections?: unknown; // normalized below
  last_seen?: string | number | Date;
  metrics?: RawAgentMetrics;
};

type AgentStatusResponse = Record<string, RawAgentStatus>;

export const fetchAgentStatus = async (): Promise<AgentStatusResponse> => {
  return await fetchJSON<AgentStatusResponse>("/status");
};

/**
 * Fetch load balancing actions from backend
 */
export const fetchLoadBalancingActions = async (): Promise<
  LoadBalancingAction[]
> => {
  return await fetchJSON<LoadBalancingAction[]>("/load_balancing");
};

/**
 * AI analysis response can be extended as backend stabilizes
 */
export type AIAnalysisResponse = Record<string, unknown>;

export const fetchDeviceAIAnalysis = async (
  agentId: string,
  event: unknown,
  baseline: unknown
): Promise<AIAnalysisResponse> => {
  return await fetchJSON<AIAnalysisResponse>("/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId, event, baseline }),
  });
};

/**
 * Best-effort parsing helpers to keep UI resilient to partial/malformed data.
 */
function parseNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : new Date(NaN);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function getDeviceTypeFromIdOrHint(id: string, hint?: string): Device["type"] {
  const source = (hint || id || "").toLowerCase();
  if (source.includes("server")) return "server";
  if (
    source.includes("workstation") ||
    source.includes("endpoint") ||
    source.includes("client")
  )
    return "endpoint";
  if (
    source.includes("router") ||
    source.includes("switch") ||
    source.includes("gateway")
  )
    return "iot"; // adjust if you have a dedicated 'network' type
  return "iot";
}

function getStatusFromCpu(cpu: number): Device["status"] {
  if (cpu >= 80) return "critical";
  if (cpu >= 60) return "warning";
  return "healthy";
}

/**
 * Convert backend status payload into UI topology structure.
 * Robust to missing fields and keeps placeholders where needed.
 */
export const transformApiDataToTopology = (
  apiData: AgentStatusResponse
): NetworkTopology => {
  if (!apiData || typeof apiData !== "object") {
    return { devices: [], agents: [], connections: [] };
  }

  const entries = Object.entries(apiData);

  const devices: Device[] = entries.map(([id, data]) => {
    const cpu = parseNumber(data?.cpu, 0);
    const memory = parseNumber(data?.memory, 0);
    const workload = parseNumber(data?.workload, 0);

    // connections normalization: attempt to use array if provided; otherwise empty
    const normalizedConnections: Device["connections"] = Array.isArray(
      data?.connections
    )
      ? (data.connections as Device["connections"])
      : [];

    return {
      id,
      name: data?.name || id,
      type: getDeviceTypeFromIdOrHint(id, data?.type),
      position: { x: 0, y: 0, z: 0 }, // TODO: compute based on layout algorithm
      status: getStatusFromCpu(cpu),
      metrics: {
        cpu,
        memory,
        workload,
      },
      connections: normalizedConnections,
      lastSeen: parseDate(data?.last_seen),
    };
  });

  const agents: Agent[] = entries.map(([id, data]) => ({
    id,
    name: data?.agent_name || data?.name || id,
    deviceId: id,
    status: "active", // TODO: map concrete status if backend provides it
    metrics: {
      dataCollected: parseNumber(data?.metrics?.dataCollected, 0),
      responseTime: parseNumber(data?.metrics?.responseTime, 0),
      errorRate: parseNumber(data?.metrics?.errorRate, 0),
    },
    lastReport: parseDate(data?.last_seen),
  }));

  // If your backend provides connection edges, translate them here
  const connections: NetworkTopology["connections"] = [];

  return { devices, agents, connections };
};
