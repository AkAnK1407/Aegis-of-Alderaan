// services/networkService.ts

import { NetworkTopology, Device, Agent } from '../types/network';

const API_URL = 'http://127.0.0.1:8000/api';

export const fetchAgentStatus = async (): Promise<Record<string, any>> => {
  const response = await fetch(`${API_URL}/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch agent status');
  }
  return await response.json();
};



// Fetch load balancing actions from backend
import { LoadBalancingAction } from '../types/network';
export const fetchLoadBalancingActions = async (): Promise<LoadBalancingAction[]> => {
  const response = await fetch(`${API_URL}/load_balancing`);
  if (!response.ok) {
    throw new Error('Failed to fetch load balancing actions');
  }
  return await response.json();
};

// Restore fetchDeviceAIAnalysis for GuardianDashboard
export const fetchDeviceAIAnalysis = async (agentId: string, event: any, baseline: any) => {
  const response = await fetch(`${API_URL}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, event, baseline }),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch AI analysis');
  }
  return await response.json();
};

export const transformApiDataToTopology = (apiData: Record<string, any>): NetworkTopology => {
  const devices: Device[] = Object.entries(apiData).map(([id, data]) => ({
    id,
    name: id,
    type: id.includes('server') ? 'server' : id.includes('workstation') ? 'endpoint' : 'iot',
    position: { x: 0, y: 0, z: 0 }, // Position can be calculated or static
    status: data.cpu > 80 ? 'critical' : data.cpu > 60 ? 'warning' : 'healthy',
    metrics: {
      cpu: data.cpu,
      memory: data.memory,
      workload: data.workload,
    },
    connections: [],
    lastSeen: new Date(data.last_seen),
  }));

  const agents: Agent[] = Object.entries(apiData).map(([id, data]) => ({
    id,
    name: id,
    deviceId: id,
    status: 'active', // Simplified status
    metrics: { dataCollected: 0, responseTime: 0, errorRate: 0 }, // Placeholder
    lastReport: new Date(data.last_seen),
  }));

  // You can build connections logic here if your API provides it
  return { devices, agents, connections: [] };
};