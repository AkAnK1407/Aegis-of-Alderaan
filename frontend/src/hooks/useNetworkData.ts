// hooks/useNetworkData.ts

import { useState, useEffect, useCallback } from 'react';
import { NetworkTopology, Device, PredictionData, LoadBalancingAction } from '../types/network';
import { fetchAgentStatus, transformApiDataToTopology, fetchLoadBalancingActions } from '../services/networkService';

const POLLING_INTERVAL = 5000; // Poll every 5 seconds
const LOAD_BALANCING_POLL_INTERVAL = 5000; // Poll load balancing actions every 5 seconds

export const useNetworkData = () => {
  const [topology, setTopology] = useState<NetworkTopology | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [predictions, setPredictions] = useState<PredictionData[]>([]);
  const [loadBalancingActions, setLoadBalancingActions] = useState<LoadBalancingAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Use useCallback to memoize the fetch function
  const fetchData = useCallback(async () => {
    try {
      const apiData = await fetchAgentStatus();
      const newTopology = transformApiDataToTopology(apiData);
      setTopology(newTopology);

      // If a device is selected, update its data without losing the selection
      if (selectedDevice) {
        const updatedDevice = newTopology.devices.find(d => d.id === selectedDevice.id);
        if (updatedDevice) {
          setSelectedDevice(updatedDevice);
        } else {
          // The selected device is no longer in the topology
          setSelectedDevice(null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch network data:", err);
    } finally {
      // Set loading to false only on the first successful fetch
      if (isLoading) {
        setIsLoading(false);
      }
    }
  }, [selectedDevice, isLoading]); // Dependency array for useCallback

  // Poll load balancing actions
  useEffect(() => {
    const fetchLoadBalancing = async () => {
      try {
        const actions = await fetchLoadBalancingActions();
        setLoadBalancingActions(actions);
      } catch (err) {
        console.error("Failed to fetch load balancing actions:", err);
      }
    };
    fetchLoadBalancing(); // Initial fetch
    const intervalId = setInterval(fetchLoadBalancing, LOAD_BALANCING_POLL_INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    // Fetch data immediately on component mount
    fetchData();

    // Set up the polling interval
    const intervalId = setInterval(fetchData, POLLING_INTERVAL);

    // Cleanup function to clear the interval when the component unmounts
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchData]); // The effect depends on our memoized fetchData function

  const selectDevice = (deviceId: string) => {
    if (!topology) return;
    const device = topology.devices.find(d => d.id === deviceId);
    if (device) {
      setSelectedDevice(device);
      // You can add logic here to fetch predictions for the selected device
      // For now, it's empty as per your original code.
      setPredictions([]);
    }
  };

  const clearSelection = () => {
    setSelectedDevice(null);
    setPredictions([]);
  };

  return {
    topology,
    selectedDevice,
    predictions,
    loadBalancingActions,
    isLoading,
    selectDevice,
    clearSelection,
  };
};