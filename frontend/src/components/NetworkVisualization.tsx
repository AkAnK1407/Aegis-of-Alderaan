import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Device } from '../types/network';



interface NetworkVisualizationProps {
  devices: Device[];
  connections: Array<{ from: string; to: string; strength: number; latency: number }>;
  selectedDevice: Device | null;
  onDeviceSelect: (deviceId: string) => void;
}

const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({
  devices,
  connections,
  selectedDevice,
  onDeviceSelect,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>();
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const deviceMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const connectionLinesRef = useRef<THREE.LineSegments[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!mountRef.current || isInitialized) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    
    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(30, 30, 30);
    
    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Controls
    const controls = {
      mouseX: 0,
      mouseY: 0,
      isMouseDown: false,
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!controls.isMouseDown) return;
      const deltaX = event.clientX - controls.mouseX;
      const deltaY = event.clientY - controls.mouseY;
      
      scene.rotation.y += deltaX * 0.01;
      scene.rotation.x += deltaY * 0.01;
      
      controls.mouseX = event.clientX;
      controls.mouseY = event.clientY;
    };

    const handleMouseDown = (event: MouseEvent) => {
      controls.isMouseDown = true;
      controls.mouseX = event.clientX;
      controls.mouseY = event.clientY;
    };

    const handleMouseUp = () => {
      controls.isMouseDown = false;
    };

    const handleWheel = (event: WheelEvent) => {
      camera.position.multiplyScalar(1 + event.deltaY * 0.001);
    };

    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel);

    // Store references
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      // Rotate scene slowly
      scene.rotation.y += 0.001;
      
      // Update device animations
      deviceMeshesRef.current.forEach((mesh, deviceId) => {
        const device = devices.find(d => d.id === deviceId);
        if (device) {
          // Pulsing effect based on workload
          const scale = 1 + Math.sin(Date.now() * 0.005) * 0.1 * (device.metrics.workload / 100);
          mesh.scale.setScalar(scale);
        }
      });
      
      renderer.render(scene, camera);
    };
    animate();

    setIsInitialized(true);

    return () => {
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.dispose();
    };
  }, [isInitialized]);

  useEffect(() => {
    if (!sceneRef.current || !isInitialized) return;

    // Clear existing devices
    deviceMeshesRef.current.forEach(mesh => {
      sceneRef.current?.remove(mesh);
    });
    deviceMeshesRef.current.clear();

    // Clear existing connections
    connectionLinesRef.current.forEach(line => {
      sceneRef.current?.remove(line);
    });
    connectionLinesRef.current.length = 0;

    // Create device meshes
    devices.forEach(device => {
      const geometry = new THREE.SphereGeometry(1, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color: getDeviceColor(device),
        emissive: getDeviceEmissive(device),
        transparent: true,
        opacity: 0.8,
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(device.position.x, device.position.y, device.position.z);
      mesh.userData = { deviceId: device.id };

      // Add click handler
      sceneRef.current?.add(mesh);
      deviceMeshesRef.current.set(device.id, mesh);

      // Add device label
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = 128;
      canvas.height = 32;
      context.fillStyle = '#ffffff';
      context.font = '12px Arial';
      context.fillText(device.name, 4, 20);
      
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(device.position.x, device.position.y + 2, device.position.z);
      sprite.scale.set(4, 1, 1);
      sceneRef.current?.add(sprite);
    });

    // Create connections
    connections.forEach(connection => {
      const fromDevice = devices.find(d => d.id === connection.from);
      const toDevice = devices.find(d => d.id === connection.to);
      
      if (fromDevice && toDevice) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(fromDevice.position.x, fromDevice.position.y, fromDevice.position.z),
          new THREE.Vector3(toDevice.position.x, toDevice.position.y, toDevice.position.z),
        ]);
        
        const material = new THREE.LineBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.3 + connection.strength * 0.7,
        });
        
        const line = new THREE.Line(geometry, material);
        sceneRef.current?.add(line);
        connectionLinesRef.current.push(line as any);
      }
    });

    // Add raycaster for click detection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      if (!cameraRef.current || !rendererRef.current) return;
      
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, cameraRef.current);
      const intersects = raycaster.intersectObjects(Array.from(deviceMeshesRef.current.values()));
      
      if (intersects.length > 0) {
        const deviceId = intersects[0].object.userData.deviceId;
        onDeviceSelect(deviceId);
      }
    };

    rendererRef.current?.domElement.addEventListener('click', handleClick);

    return () => {
      rendererRef.current?.domElement.removeEventListener('click', handleClick);
    };
  }, [devices, connections, onDeviceSelect, isInitialized]);

  useEffect(() => {
    if (!selectedDevice) return;

    // Highlight selected device
    deviceMeshesRef.current.forEach((mesh, deviceId) => {
      if (deviceId === selectedDevice.id) {
        gsap.to(mesh.scale, {
          x: 1.5,
          y: 1.5,
          z: 1.5,
          duration: 0.3,
          ease: "power2.out",
        });
        gsap.to((mesh.material as THREE.MeshPhongMaterial), {
          opacity: 1,
          duration: 0.3,
        });
      } else {
        gsap.to(mesh.scale, {
          x: 1,
          y: 1,
          z: 1,
          duration: 0.3,
          ease: "power2.out",
        });
        gsap.to((mesh.material as THREE.MeshPhongMaterial), {
          opacity: 0.5,
          duration: 0.3,
        });
      }
    });
  }, [selectedDevice]);

  const getDeviceColor = (device: Device): number => {
    switch (device.status) {
      case 'healthy': return 0x00ff00;
      case 'warning': return 0xffff00;
      case 'critical': return 0xff0000;
      default: return 0x888888;
    }
  };

  const getDeviceEmissive = (device: Device): number => {
    switch (device.status) {
      case 'healthy': return 0x002200;
      case 'warning': return 0x222200;
      case 'critical': return 0x220000;
      default: return 0x111111;
    }
  };

  return (
    <div 
      ref={mountRef} 
      className="w-full h-full bg-gradient-to-b from-gray-900 to-black rounded-lg overflow-hidden"
      style={{ minHeight: '500px' }}
    />
  );
};

export default NetworkVisualization;