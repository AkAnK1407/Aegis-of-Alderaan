export interface Device {
  id: string;
  name: string;
  type: 'iot' | 'camera' | 'server' | 'endpoint';
  position: { x: number; y: number; z: number };
  status: 'healthy' | 'warning' | 'critical';
  metrics: {
    cpu: number;
    memory: number;
    workload: number;
    temperature?: number;
  };
  connections: string[];
  lastSeen: Date;
}

export interface Agent {
  id: string;
  name?: string; // Optional, if agents have names
  deviceId: string;
  status: 'active' | 'inactive' | 'error';
  metrics: {
    dataCollected: number;
    responseTime: number;
    errorRate: number;
  };
  lastReport: Date;
}

export interface NetworkTopology {
  devices: Device[];
  agents: Agent[];
  connections: Array<{
    from: string;
    to: string;
    strength: number;
    latency: number;
  }>;
}

export interface PredictionData {
  deviceId: string;
  metric: 'cpu' | 'memory' | 'workload';
  predictions: Array<{
    timestamp: Date;
    value: number;
    confidence: number;
  }>;
}

export interface LoadBalancingAction {
  id: string;
  type: 'offload' | 'migrate' | 'scale';
  sourceDevice: string;
  targetDevice: string;
  workloadAmount: number;
  status: 'pending' | 'active' | 'completed';
  estimatedBenefit: number;
}