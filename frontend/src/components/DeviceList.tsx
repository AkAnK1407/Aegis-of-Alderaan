import React from 'react';
import { Device, Agent } from '../types/network';
import { Monitor, Camera, Server, Smartphone, Cpu, HardDrive, Activity, Circle } from 'lucide-react';

interface DeviceListProps {
  devices: Device[];
  agents: Agent[];
  selectedDevice: Device | null;
  onDeviceSelect: (deviceId: string) => void;
}

const DeviceList: React.FC<DeviceListProps> = ({ devices, agents, selectedDevice, onDeviceSelect }) => {
  const getDeviceIcon = (type: Device['type']) => {
    switch (type) {
      case 'server': return <Server className="h-5 w-5" />;
      case 'camera': return <Camera className="h-5 w-5" />;
      case 'iot': return <Smartphone className="h-5 w-5" />;
      case 'endpoint': return <Monitor className="h-5 w-5" />;
      default: return <Circle className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status: Device['status']) => {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'critical': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getAgentForDevice = (deviceId: string) => {
    return agents.find(agent => agent.deviceId === deviceId);
  };

  const getMetricColor = (value: number) => {
    if (value > 80) return 'text-red-400';
    if (value > 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 h-full">
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Network Devices</h3>
        <p className="text-sm text-gray-400">{devices.length} devices detected</p>
      </div>
      
      <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
        {devices.map(device => {
          const agent = getAgentForDevice(device.id);
          const isSelected = selectedDevice?.id === device.id;
          
          return (
            <div
              key={device.id}
              onClick={() => onDeviceSelect(device.id)}
              className={`p-4 border-b border-gray-700/50 cursor-pointer transition-all duration-200 hover:bg-gray-700/30 ${
                isSelected ? 'bg-blue-900/30 border-l-4 border-l-blue-400' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg bg-gray-700/50 ${getStatusColor(device.status)}`}>
                    {getDeviceIcon(device.type)}
                  </div>
                  <div>
                    <h4 className="font-medium text-white">{device.name}</h4>
                    <p className="text-sm text-gray-400 capitalize">{device.type}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    device.status === 'healthy' ? 'bg-green-400' :
                    device.status === 'warning' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                  <span className={`text-xs font-medium ${getStatusColor(device.status)}`}>
                    {device.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center">
                  <div className="flex items-center justify-center space-x-1 mb-1">
                    <Cpu className="h-3 w-3 text-blue-400" />
                    <span className="text-xs text-gray-400">CPU</span>
                  </div>
                  <p className={`text-sm font-medium ${getMetricColor(device.metrics.cpu)}`}>
                    {device.metrics.cpu.toFixed(0)}%
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="flex items-center justify-center space-x-1 mb-1">
                    <HardDrive className="h-3 w-3 text-purple-400" />
                    <span className="text-xs text-gray-400">MEM</span>
                  </div>
                  <p className={`text-sm font-medium ${getMetricColor(device.metrics.memory)}`}>
                    {device.metrics.memory.toFixed(0)}%
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="flex items-center justify-center space-x-1 mb-1">
                    <Activity className="h-3 w-3 text-green-400" />
                    <span className="text-xs text-gray-400">LOAD</span>
                  </div>
                  <p className={`text-sm font-medium ${getMetricColor(device.metrics.workload)}`}>
                    {device.metrics.workload.toFixed(0)}%
                  </p>
                </div>
              </div>

              {agent && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Agent: {agent.status}</span>
                  <span>{agent.metrics.responseTime.toFixed(0)}ms</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DeviceList;