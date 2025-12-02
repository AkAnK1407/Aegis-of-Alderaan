// Strongly-typed network domain models with reusable aliases and docs.
// These types are designed to be backward compatible with the existing codebase.

/**
 * Common aliases to improve clarity in API and component code.
 */
export type DeviceId = string;
export type AgentId = string;

/**
 * Enumerations (union types) for consistent usage across the app.
 */
export type DeviceType = "iot" | "camera" | "server" | "endpoint";
export type HealthStatus = "healthy" | "warning" | "critical";
export type AgentStatus = "active" | "inactive" | "error";
export type MetricName = "cpu" | "memory" | "workload";
export type LoadBalancingActionType = "offload" | "migrate" | "scale";
export type LoadBalancingStatus = "pending" | "active" | "completed";

/**
 * Basic geometry for device placement.
 */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/**
 * Metrics tracked per device.
 */
export interface DeviceMetrics {
  cpu: number;
  memory: number;
  workload: number;
  temperature?: number;
}

/**
 * Device in the network topology.
 */
export interface Device {
  id: DeviceId;
  name: string;
  type: DeviceType;
  position: Position;
  status: HealthStatus;
  metrics: DeviceMetrics;
  /**
   * Connection list by device id (adjacency).
   * Use NetworkTopology.connections for edge metadata (latency/strength).
   */
  connections: DeviceId[];
  lastSeen: Date;
}

/**
 * Metrics reported by agents associated with a device.
 */
export interface AgentMetrics {
  dataCollected: number;
  responseTime: number;
  errorRate: number;
}

/**
 * Monitoring agent information.
 */
export interface Agent {
  id: AgentId;
  name?: string; // Optional, if agents have names
  deviceId: DeviceId;
  status: AgentStatus;
  metrics: AgentMetrics;
  lastReport: Date;
}

/**
 * Rich connection between devices stored at the topology level.
 * - Use 'from' and 'to' as device ids for consistent references.
 */
export interface TopologyConnection {
  from: DeviceId;
  to: DeviceId;
  strength: number; // e.g., 0..1 (normalized), but not enforced here
  latency: number; // e.g., milliseconds
}

/**
 * Full network topology for visualization and analytics.
 */
export interface NetworkTopology {
  devices: Device[];
  agents: Agent[];
  connections: TopologyConnection[];
}

/**
 * Single prediction point.
 */
export interface PredictionPoint {
  timestamp: Date;
  value: number;
  confidence: number; // 0..1 confidence score
}

/**
 * Predictions for a device and metric over time.
 */
export interface PredictionData {
  deviceId: DeviceId;
  metric: MetricName;
  predictions: PredictionPoint[];
}

/**
 * Load balancing action suggested or executed by the system.
 */
export interface LoadBalancingAction {
  id: string;
  type: LoadBalancingActionType;
  sourceDevice: DeviceId;
  targetDevice: DeviceId;
  workloadAmount: number;
  status: LoadBalancingStatus;
  estimatedBenefit: number;
}
