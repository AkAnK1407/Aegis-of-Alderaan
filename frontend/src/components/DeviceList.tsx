import React, { useMemo, useCallback, useState } from "react";
import { Device, Agent } from "../types/network";
import {
  Monitor,
  Camera,
  Server,
  Smartphone,
  Cpu,
  HardDrive,
  Activity,
  Circle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Timer,
  Wifi,
  Network,
  Search,
  Filter,
} from "lucide-react";

interface DeviceListProps {
  devices: Device[];
  agents: Agent[];
  selectedDevice: Device | null;
  onDeviceSelect: (deviceId: string) => void;
  loading?: boolean;
  error?: string | null;
}

type DeviceType = Device["type"];
type DeviceStatus = Device["status"];

const STATUS_COLORS: Record<DeviceStatus, string> = {
  healthy: "text-green-400",
  warning: "text-yellow-400",
  critical: "text-red-400",
};

const STATUS_BG_COLORS: Record<DeviceStatus, string> = {
  healthy: "bg-green-400",
  warning: "bg-yellow-400",
  critical: "bg-red-400",
};

const TYPE_ICON: Partial<Record<DeviceType, React.ReactNode>> = {
  server: <Server className="h-5 w-5" />,
  camera: <Camera className="h-5 w-5" />,
  iot: <Smartphone className="h-5 w-5" />,
  endpoint: <Monitor className="h-5 w-5" />,
};

const StatusBadge: React.FC<{ status: DeviceStatus }> = ({ status }) => {
  const icon =
    status === "healthy" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : status === "warning" ? (
      <AlertTriangle className="h-3.5 w-3.5" />
    ) : (
      <XCircle className="h-3.5 w-3.5" />
    );

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {icon}
      {status}
    </span>
  );
};

const MetricItem: React.FC<{
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "purple" | "green";
  tooltip?: string;
}> = ({ label, value, icon, color, tooltip }) => {
  const getColor = (v: number) => {
    if (v > 80) return "text-red-400";
    if (v > 60) return "text-yellow-400";
    return "text-green-400";
  };
  const iconColor =
    color === "blue"
      ? "text-blue-400"
      : color === "purple"
      ? "text-purple-400"
      : "text-green-400";
  return (
    <div className="text-center" title={tooltip}>
      <div className="flex items-center justify-center space-x-1 mb-1">
        <span className={iconColor}>{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`text-sm font-medium ${getColor(value)}`}>
        {value.toFixed(0)}%
      </p>
    </div>
  );
};

const agentStatusColor = (status: Agent["status"]): string => {
  switch (status) {
    case "active":
      return "text-green-400";
    case "inactive":
      return "text-gray-400";
    case "error":
      return "text-red-400";
    default:
      return "text-gray-400";
  }
};

const AgentBadge: React.FC<{ agent?: Agent }> = ({ agent }) => {
  if (!agent) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Wifi className="h-3 w-3" />
        No agent
      </span>
    );
  }

  const color = agentStatusColor(agent.status);

  return (
    <span
      className={`inline-flex items-center gap-2 text-xs ${color}`}
      title={`Agent status: ${agent.status}`}
    >
      <Network className="h-3 w-3" />
      Agent: {agent.status}
      {agent.metrics?.responseTime !== undefined && (
        <span className="inline-flex items-center gap-1 text-gray-400">
          <Timer className="h-3 w-3" />
          {Math.max(0, agent.metrics.responseTime).toFixed(0)}ms
        </span>
      )}
    </span>
  );
};

const DeviceRow: React.FC<{
  device: Device;
  agent?: Agent;
  selected?: boolean;
  onSelect: (id: string) => void;
}> = ({ device, agent, selected, onSelect }) => {
  const icon = TYPE_ICON[device.type] ?? <Circle className="h-5 w-5" />;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(device.id)}
        aria-current={selected ? "true" : undefined}
        className={`w-full text-left p-4 border-b border-gray-700/50 cursor-pointer transition-colors duration-150 hover:bg-gray-700/30 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          selected ? "bg-blue-900/30 border-l-4 border-l-blue-400" : ""
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-lg bg-gray-700/50 ${
                STATUS_COLORS[device.status]
              }`}
              aria-hidden="true"
            >
              {icon}
            </div>
            <div>
              <h4 className="font-medium text-white">{device.name}</h4>
              <p className="text-sm text-gray-400 capitalize">{device.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                STATUS_BG_COLORS[device.status]
              }`}
              aria-hidden="true"
            />
            <StatusBadge status={device.status} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <MetricItem
            label="CPU"
            value={device.metrics.cpu}
            icon={<Cpu className="h-3 w-3" />}
            color="blue"
            tooltip="Processor utilization"
          />
          <MetricItem
            label="MEM"
            value={device.metrics.memory}
            icon={<HardDrive className="h-3 w-3" />}
            color="purple"
            tooltip="Memory utilization"
          />
          <MetricItem
            label="LOAD"
            value={device.metrics.workload}
            icon={<Activity className="h-3 w-3" />}
            color="green"
            tooltip="Operational workload estimate"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <AgentBadge agent={agent} />
          <span className="inline-flex items-center gap-1">
            <Info className="h-3 w-3" />
            Last seen: {new Date().toLocaleTimeString()}
          </span>
        </div>
      </button>
    </li>
  );
};

const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  agents,
  selectedDevice,
  onDeviceSelect,
  loading = false,
  error = null,
}) => {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<DeviceType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "all">("all");

  const agentByDeviceId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) map.set(a.deviceId, a);
    return map;
  }, [agents]);

  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      const matchesQuery =
        !q ||
        d.name.toLowerCase().includes(q) ||
        String(d.type).toLowerCase().includes(q);
      const matchesType = typeFilter === "all" || d.type === typeFilter;
      const matchesStatus = statusFilter === "all" || d.status === statusFilter;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [devices, query, typeFilter, statusFilter]);

  const onSelect = useCallback(
    (id: string) => onDeviceSelect(id),
    [onDeviceSelect]
  );

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 h-full flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">
              Network Devices
            </h3>
            <p className="text-sm text-gray-400">
              {devices.length} devices detected
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-700/50 border border-gray-600 rounded px-2 py-1">
              <Search className="h-4 w-4 text-gray-400 mr-1" />
              <input
                aria-label="Search devices"
                className="bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                placeholder="Search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <select
                aria-label="Filter by type"
                className="bg-gray-700/50 border border-gray-600 rounded text-sm text-white px-2 py-1"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as DeviceType | "all")
                }
              >
                <option value="all">All types</option>
                <option value="server">Server</option>
                <option value="camera">Camera</option>
                <option value="endpoint">Endpoint</option>
                <option value="iot">IoT</option>
              </select>
              <select
                aria-label="Filter by status"
                className="bg-gray-700/50 border border-gray-600 rounded text-sm text-white px-2 py-1"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as DeviceStatus | "all")
                }
              >
                <option value="all">All status</option>
                <option value="healthy">Healthy</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
        {loading && (
          <div className="mt-3 text-xs text-gray-400">
            Loading real-time data…
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-red-400">Error: {error}</div>
        )}
      </div>

      <div className="overflow-y-auto grow">
        {!loading && filteredDevices.length === 0 && (
          <div className="p-6 text-center text-gray-400">
            No devices match your filters.
          </div>
        )}

        {loading && (
          <div className="p-4 space-y-3" aria-label="Loading devices">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                className="animate-pulse h-24 bg-gray-700/40 rounded border border-gray-700"
              />
            ))}
          </div>
        )}

        {!loading && filteredDevices.length > 0 && (
          <ul className="divide-y divide-gray-700/50">
            {filteredDevices.map((device) => {
              const agent = agentByDeviceId.get(device.id);
              const isSelected = selectedDevice?.id === device.id;
              return (
                <DeviceRow
                  key={device.id}
                  device={device}
                  agent={agent}
                  selected={!!isSelected}
                  onSelect={onSelect}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DeviceList;
