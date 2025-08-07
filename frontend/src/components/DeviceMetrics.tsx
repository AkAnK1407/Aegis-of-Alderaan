import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Device, PredictionData } from '../types/network';
import { Activity, Cpu, HardDrive, Zap, ThermometerSun } from 'lucide-react';

interface DeviceMetricsProps {
  device: Device;
  predictions: PredictionData[];
}

const DeviceMetrics: React.FC<DeviceMetricsProps> = ({ device, predictions }) => {
  const getStatusColor = (status: Device['status']) => {
    switch (status) {
      case 'healthy': return 'text-green-400 bg-green-900/20 border-green-500';
      case 'warning': return 'text-yellow-400 bg-yellow-900/20 border-yellow-500';
      case 'critical': return 'text-red-400 bg-red-900/20 border-red-500';
    }
  };

  const getMetricColor = (value: number) => {
    if (value > 80) return 'text-red-400';
    if (value > 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  const formatPredictionData = (predictions: PredictionData[]) => {
    if (predictions.length === 0) return [];
    
    return predictions[0].predictions.map((prediction, index) => {
      const dataPoint: any = {
        time: index,
        timestamp: prediction.timestamp.toLocaleTimeString(),
      };
      
      predictions.forEach(pred => {
        dataPoint[pred.metric] = pred.predictions[index]?.value || 0;
      });
      
      return dataPoint;
    });
  };

  const predictionData = formatPredictionData(predictions);

  return (
    <div className="space-y-6">
      {/* Device Header */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{device.name}</h2>
            <p className="text-gray-400 capitalize">{device.type} Device</p>
          </div>
          <div className={`px-3 py-1 rounded-full border ${getStatusColor(device.status)}`}>
            <span className="text-sm font-medium capitalize">{device.status}</span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center space-x-3">
            <Cpu className="h-8 w-8 text-blue-400" />
            <div>
              <p className="text-sm text-gray-400">CPU Usage</p>
              <p className={`text-xl font-bold ${getMetricColor(device.metrics.cpu)}`}>
                {device.metrics.cpu.toFixed(1)}%
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <HardDrive className="h-8 w-8 text-purple-400" />
            <div>
              <p className="text-sm text-gray-400">Memory</p>
              <p className={`text-xl font-bold ${getMetricColor(device.metrics.memory)}`}>
                {device.metrics.memory.toFixed(1)}%
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Activity className="h-8 w-8 text-green-400" />
            <div>
              <p className="text-sm text-gray-400">Workload</p>
              <p className={`text-xl font-bold ${getMetricColor(device.metrics.workload)}`}>
                {device.metrics.workload.toFixed(1)}%
              </p>
            </div>
          </div>
          
          {device.metrics.temperature && (
            <div className="flex items-center space-x-3">
              <ThermometerSun className="h-8 w-8 text-orange-400" />
              <div>
                <p className="text-sm text-gray-400">Temperature</p>
                <p className={`text-xl font-bold ${getMetricColor(device.metrics.temperature * 2.5)}`}>
                  {device.metrics.temperature.toFixed(1)}°C
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Real-time Metrics */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
          <Zap className="h-5 w-5 mr-2 text-yellow-400" />
          Real-time Performance
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">CPU</span>
              <span className={`text-sm font-bold ${getMetricColor(device.metrics.cpu)}`}>
                {device.metrics.cpu.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${
                  device.metrics.cpu > 80 ? 'bg-red-500' : 
                  device.metrics.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${device.metrics.cpu}%` }}
              />
            </div>
          </div>
          
          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">Memory</span>
              <span className={`text-sm font-bold ${getMetricColor(device.metrics.memory)}`}>
                {device.metrics.memory.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${
                  device.metrics.memory > 80 ? 'bg-red-500' : 
                  device.metrics.memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${device.metrics.memory}%` }}
              />
            </div>
          </div>
          
          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">Workload</span>
              <span className={`text-sm font-bold ${getMetricColor(device.metrics.workload)}`}>
                {device.metrics.workload.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${
                  device.metrics.workload > 80 ? 'bg-red-500' : 
                  device.metrics.workload > 60 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${device.metrics.workload}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Predictions Chart */}
      {predictionData.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">24-Hour Predictions</h3>
          
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={predictionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="timestamp" 
                  stroke="#9CA3AF"
                  fontSize={12}
                />
                <YAxis 
                  stroke="#9CA3AF"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#FFFFFF'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stackId="1"
                  stroke="#3B82F6"
                  fill="#3B82F6"
                  fillOpacity={0.3}
                  name="CPU %"
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stackId="2"
                  stroke="#8B5CF6"
                  fill="#8B5CF6"
                  fillOpacity={0.3}
                  name="Memory %"
                />
                <Area
                  type="monotone"
                  dataKey="workload"
                  stackId="3"
                  stroke="#10B981"
                  fill="#10B981"
                  fillOpacity={0.3}
                  name="Workload %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeviceMetrics;