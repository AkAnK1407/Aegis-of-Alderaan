import React, { useEffect, useRef } from 'react';
import { useState } from 'react';
import { gsap } from 'gsap';
import { NetworkTopology, LoadBalancingAction } from '../types/network';
import { fetchDeviceAIAnalysis } from '../services/networkService';
import { Shield, AlertTriangle, Activity, Zap, ArrowRight, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface GuardianDashboardProps {
  topology: NetworkTopology;
  loadBalancingActions: LoadBalancingAction[];
}

const GuardianDashboard: React.FC<GuardianDashboardProps> = ({ topology, loadBalancingActions }) => {
  const statsRef = useRef<HTMLDivElement>(null);
  const [aiAnalyses, setAIAnalyses] = useState<Record<string, any>>({});
  
  useEffect(() => {
    if (statsRef.current) {
      gsap.fromTo(
        statsRef.current.children,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 }
      );
    }
  }, [topology]);

  // Fetch AI analysis for all devices when topology changes
  useEffect(() => {
    async function fetchAllAIAnalyses() {
      const analyses: Record<string, any> = {};
      const devicesToAnalyze = topology.devices.filter(
        d => d.status === 'critical' || d.status === 'warning'
      );
      for (const device of devicesToAnalyze) {
        try {
          const aiResult = await fetchDeviceAIAnalysis(device.id, device.metrics, {});
          analyses[device.id] = aiResult.analysis || aiResult;
        } catch (err) {
          analyses[device.id] = { error: 'AI analysis failed' };
        }
      }
      setAIAnalyses(analyses);
    }
    if (topology && topology.devices.length > 0) {
      fetchAllAIAnalyses();
    }
  }, [topology]);

  const getSystemHealth = () => {
    const healthyDevices = topology.devices.filter(d => d.status === 'healthy').length;
    const totalDevices = topology.devices.length;
    return (healthyDevices / totalDevices) * 100;
  };

  const getAverageWorkload = () => {
    const totalWorkload = topology.devices.reduce((sum, device) => sum + device.metrics.workload, 0);
    return totalWorkload / topology.devices.length;
  };

  const getActiveAgents = () => {
    return topology.agents.filter(a => a.status === 'active').length;
  };

  const getCriticalDevices = () => {
    return topology.devices.filter(d => d.status === 'critical');
  };

  const getWarningDevices = () => {
    return topology.devices.filter(d => d.status === 'warning');
  };

  const systemHealth = getSystemHealth();
  const averageWorkload = getAverageWorkload();
  const activeAgents = getActiveAgents();
  const criticalDevices = getCriticalDevices();
  const warningDevices = getWarningDevices();

  const getActionIcon = (action: LoadBalancingAction) => {
    switch (action.status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'active': return <Activity className="h-4 w-4 text-blue-400" />;
      case 'pending': return <Clock className="h-4 w-4 text-yellow-400" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getActionColor = (action: LoadBalancingAction) => {
    switch (action.status) {
      case 'completed': return 'border-green-500 bg-green-900/20';
      case 'active': return 'border-blue-500 bg-blue-900/20';
      case 'pending': return 'border-yellow-500 bg-yellow-900/20';
      default: return 'border-gray-500 bg-gray-900/20';
    }
  };

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
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 font-medium">Active</span>
          </div>
          <div className="text-gray-300">
            Last scan: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* System Statistics */}
      <div ref={statsRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">System Health</p>
              <p className={`text-2xl font-bold ${systemHealth > 80 ? 'text-green-400' : systemHealth > 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                {systemHealth.toFixed(1)}%
              </p>
            </div>
            <Activity className="h-8 w-8 text-green-400" />
          </div>
          <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-500 ${
                systemHealth > 80 ? 'bg-green-500' : systemHealth > 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${systemHealth}%` }}
            />
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Avg. Workload</p>
              <p className={`text-2xl font-bold ${averageWorkload > 80 ? 'text-red-400' : averageWorkload > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
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
              <p className="text-2xl font-bold text-blue-400">{activeAgents}/{topology.agents.length}</p>
            </div>
            <Shield className="h-8 w-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Devices</p>
              <p className="text-2xl font-bold text-white">{topology.devices.length}</p>
            </div>
            <Activity className="h-8 w-8 text-gray-400" />
          </div>
        </div>
      </div>

      {/* AI Analysis for Critical/Warning Devices */}
      {(Object.keys(aiAnalyses).length > 0) && (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-400" />
            AI Analysis (Critical & Warning Devices)
          </h3>
          <div className="space-y-3">
            {Object.entries(aiAnalyses).map(([deviceId, ai]) => {
              const device = topology.devices.find(d => d.id === deviceId);
              if (!device) return null;
              return (
                <div key={device.id} className={`flex flex-col md:flex-row items-start md:items-center justify-between p-3 ${device.status === 'critical' ? 'bg-red-900/20 border border-red-500' : 'bg-yellow-900/20 border border-yellow-500'} rounded-lg`}>
                  <div className="flex items-center space-x-3">
                    <AlertTriangle className={`h-5 w-5 ${device.status === 'critical' ? 'text-red-400' : 'text-yellow-400'}`} />
                    <div>
                      <p className={`font-medium ${device.status === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{device.name}</p>
                      <p className="text-sm text-gray-400">Status: {device.status}</p>
                      {ai && (
                        <div className="mt-2 text-xs text-gray-300">
                          <div>
                            <span className="font-bold text-white">AI Analysis:</span> {ai.is_anomaly !== undefined ? (ai.is_anomaly ? <span className="text-red-400">Anomaly Detected</span> : <span className="text-green-400">Normal</span>) : <span className="text-yellow-400">{ai.error || 'Pending...'}</span>}
                          </div>
                          {ai.problematic_fields && ai.problematic_fields.length > 0 && (
                            <div>Problematic Fields: <span className="text-yellow-400">{ai.problematic_fields.join(', ')}</span></div>
                          )}
                          {ai.suggestion && (
                            <div>Suggestion: <span className="text-blue-400">{ai.suggestion}</span></div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right mt-2 md:mt-0">
                    <p className={`text-sm ${device.status === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>CPU: {device.metrics.cpu.toFixed(1)}%</p>
                    <p className={`text-sm ${device.status === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>Memory: {device.metrics.memory.toFixed(1)}%</p>
                    <p className={`text-sm ${device.status === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>Workload: {device.metrics.workload.toFixed(1)}%</p>
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
            {loadBalancingActions.map(action => {
              const sourceDevice = topology.devices.find(d => d.id === action.sourceDevice);
              const targetDevice = topology.devices.find(d => d.id === action.targetDevice);
              
              return (
                <div key={action.id} className={`p-4 rounded-lg border ${getActionColor(action)}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getActionIcon(action)}
                      <span className="font-medium text-white capitalize">{action.type}</span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        action.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                        action.status === 'active' ? 'bg-blue-900/30 text-blue-400' :
                        'bg-yellow-900/30 text-yellow-400'
                      }`}>
                        {action.status}
                      </span>
                    </div>
                    <div className="text-sm text-green-400">
                      +{action.estimatedBenefit.toFixed(1)}% efficiency
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4 text-sm text-gray-300">
                    <span>{sourceDevice?.name || 'Unknown'}</span>
                    <ArrowRight className="h-4 w-4" />
                    <span>{targetDevice?.name || 'Unknown'}</span>
                    <span className="ml-auto">
                      {action.workloadAmount.toFixed(1)}% workload
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
            <p className="text-sm text-gray-500">System is optimally balanced</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GuardianDashboard;