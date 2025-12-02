"use client";

import React, { useRef, useEffect, useLayoutEffect, useState } from "react";
import * as THREE from "three";
import { gsap } from "gsap";
import { Device } from "../types/network";
// import "./NetworkVisualization.css";

interface Connection {
  from: string;
  to: string;
  strength: number; // 0..1
  latency: number;
}

interface NetworkVisualizationProps {
  devices: Device[];
  connections: Connection[];
  selectedDevice: Device | null;
  onDeviceSelect: (deviceId: string) => void;
}

type DeviceMeshBundle = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  label: THREE.Sprite;
};

const MIN_DISTANCE = 5;
const MAX_DISTANCE = 120;
const ROTATE_DAMPING = 0.95;
const WORLD_ROTATE_SPEED = 0.15; // deg/sec background rotation

export const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({
  devices,
  connections,
  selectedDevice,
  onDeviceSelect,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene>();
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const worldRef = useRef<THREE.Group>(); // rotate this instead of the whole scene
  const clockRef = useRef<THREE.Clock>();

  // Geometry/material pools (to avoid recreating for each device)
  const sphereGeoRef = useRef<THREE.SphereGeometry>();
  const materialsRef = useRef<Record<string, THREE.MeshPhongMaterial>>({});
  const deviceObjectsRef = useRef<Map<string, DeviceMeshBundle>>(new Map());

  // One combined connection line segments
  const connectionGeomRef = useRef<THREE.BufferGeometry>();
  const connectionMatRef = useRef<THREE.LineBasicMaterial>();
  const connectionLinesRef = useRef<THREE.LineSegments>();

  // Interaction
  const dragState = useRef({
    isMouseDown: false,
    lastX: 0,
    lastY: 0,
    velocityX: 0,
    velocityY: 0,
    dragDistance: 0,
  });

  const [isInitialized, setIsInitialized] = useState(false);

  const getMaterialForStatus = (status: Device["status"] | "default") => {
    const key = status ?? "default";
    if (!materialsRef.current[key]) {
      // Create lazily, share per status
      const baseColor =
        status === "healthy"
          ? 0x00ff00
          : status === "warning"
          ? 0xffff00
          : status === "critical"
          ? 0xff0000
          : 0x888888;

      const emissive =
        status === "healthy"
          ? 0x002200
          : status === "warning"
          ? 0x222200
          : status === "critical"
          ? 0x220000
          : 0x111111;

      materialsRef.current[key] = new THREE.MeshPhongMaterial({
        color: baseColor,
        emissive,
        transparent: true,
        opacity: 0.8,
      });
    }
    return materialsRef.current[key];
  };

  // Initialize Three.js scene
  useLayoutEffect(() => {
    if (!mountRef.current || isInitialized) return;

    const container = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.Fog(0x0a0a0a, 100, 250);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(30, 30, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 80, 50);
    dirLight.castShadow = true;

    scene.add(ambientLight);
    scene.add(dirLight);

    // World group (all visual content sits under this)
    const world = new THREE.Group();
    scene.add(world);

    // Shared geometry
    sphereGeoRef.current = new THREE.SphereGeometry(1, 20, 20);

    // Resize handling
    const onResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const { clientWidth, clientHeight } = container;
      rendererRef.current.setSize(clientWidth, clientHeight);
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // Basic orbit-like rotation via drag
    const onMouseDown = (e: MouseEvent) => {
      dragState.current.isMouseDown = true;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
      dragState.current.dragDistance = 0;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isMouseDown) return;
      const dx = e.clientX - dragState.current.lastX;
      const dy = e.clientY - dragState.current.lastY;
      dragState.current.dragDistance += Math.hypot(dx, dy);

      world.rotation.y += dx * 0.005;
      world.rotation.x += dy * 0.005;
      world.rotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, world.rotation.x)
      );

      dragState.current.velocityX = dx * 0.01;
      dragState.current.velocityY = dy * 0.01;

      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
    };
    const onMouseUp = () => {
      dragState.current.isMouseDown = false;
    };

    const onWheel = (e: WheelEvent) => {
      const dir = Math.sign(e.deltaY);
      const vec = camera.position.clone();
      const dist = vec.length();
      const next = THREE.MathUtils.clamp(
        dist * (1 + dir * 0.1),
        MIN_DISTANCE,
        MAX_DISTANCE
      );
      vec.setLength(next);
      camera.position.copy(vec);
    };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

    // Animate
    const clock = new THREE.Clock();

    const animate = () => {
      const dt = clock.getDelta();
      // Background slow rotation (only when not dragging)
      if (!dragState.current.isMouseDown) {
        world.rotation.y += THREE.MathUtils.degToRad(WORLD_ROTATE_SPEED) * dt;
        // Inertia
        world.rotation.y += dragState.current.velocityX;
        world.rotation.x += dragState.current.velocityY;
        dragState.current.velocityX *= ROTATE_DAMPING;
        dragState.current.velocityY *= ROTATE_DAMPING;
      }

      // Pulse devices based on workload
      deviceObjectsRef.current.forEach((bundle) => {
        const mesh = bundle.mesh;
        const workload = (mesh.userData?.workload as number) ?? 0;
        const scale =
          1 + Math.sin(clock.elapsedTime * 2) * 0.1 * (workload / 100);
        mesh.scale.setScalar(scale);
      });

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // Save refs
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    worldRef.current = world;
    clockRef.current = clock;

    setIsInitialized(true);

    // Cleanup
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);

      // Stop animation loop
      renderer.setAnimationLoop(null);

      // Dispose everything under world without touching refs to avoid stale-ref lint
      world.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else if (mat) mat.dispose();
        } else if (obj.type === "Sprite") {
          const s = obj as THREE.Sprite;
          if (s.material instanceof THREE.SpriteMaterial) {
            s.material.map?.dispose();
            s.material.dispose();
          }
        }
      });
      scene.remove(world);

      // Connections
      connectionGeomRef.current?.dispose();
      connectionMatRef.current?.dispose();

      // Shared geo
      sphereGeoRef.current?.dispose();

      // Materials
      Object.values(materialsRef.current).forEach((mat) => mat.dispose());
      materialsRef.current = {};

      // Renderer and DOM
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isInitialized]);

  // Build/update devices and connections when props change
  useEffect(() => {
    if (
      !isInitialized ||
      !sceneRef.current ||
      !worldRef.current ||
      !sphereGeoRef.current
    )
      return;

    const world = worldRef.current;

    // Remove old device meshes/labels from world
    deviceObjectsRef.current.forEach(({ mesh, label }) => {
      world.remove(mesh);
      world.remove(label);
      // Dispose label only; geometry/material are shared
      if (label.material instanceof THREE.SpriteMaterial) {
        label.material.map?.dispose();
        label.material.dispose();
      }
    });
    deviceObjectsRef.current.clear();

    // Create device meshes and labels
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    devices.forEach((device) => {
      const material = getMaterialForStatus(device.status ?? "default");

      const mesh = new THREE.Mesh(sphereGeoRef.current!, material);
      mesh.position.set(
        device.position.x,
        device.position.y,
        device.position.z
      );
      mesh.userData = {
        deviceId: device.id,
        workload: device.metrics?.workload ?? 0,
      };

      // Label sprite
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(128 * dpr);
      canvas.height = Math.floor(32 * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, 128, 32);
        ctx.fillStyle = "#ffffff";
        ctx.font = "12px Arial";
        ctx.textBaseline = "middle";
        ctx.fillText(device.name, 4, 16);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const maxAniso = rendererRef.current?.capabilities.getMaxAnisotropy
        ? rendererRef.current.capabilities.getMaxAnisotropy()
        : 1;
      texture.anisotropy = maxAniso;
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(
        device.position.x,
        device.position.y + 2,
        device.position.z
      );
      sprite.scale.set(4, 1, 1);

      world.add(mesh);
      world.add(sprite);

      deviceObjectsRef.current.set(device.id, { mesh, label: sprite });
    });

    // Build combined connection segments
    if (connectionLinesRef.current) {
      world.remove(connectionLinesRef.current);
      connectionGeomRef.current?.dispose();
      connectionMatRef.current?.dispose();
      connectionLinesRef.current = undefined;
    }

    const validConnections = connections
      .map((c) => {
        const from = devices.find((d) => d.id === c.from);
        const to = devices.find((d) => d.id === c.to);
        if (!from || !to) return null;
        return { c, from, to };
      })
      .filter((x): x is { c: Connection; from: Device; to: Device } => !!x);

    if (validConnections.length > 0) {
      const positions = new Float32Array(validConnections.length * 2 * 3);
      const colors = new Float32Array(validConnections.length * 2 * 3);

      const tmpColor = new THREE.Color();
      validConnections.forEach(({ c, from, to }, i) => {
        // positions
        positions[i * 6 + 0] = from.position.x;
        positions[i * 6 + 1] = from.position.y;
        positions[i * 6 + 2] = from.position.z;
        positions[i * 6 + 3] = to.position.x;
        positions[i * 6 + 4] = to.position.y;
        positions[i * 6 + 5] = to.position.z;

        // color based on strength (cyan brighter with higher strength)
        const strength = THREE.MathUtils.clamp(c.strength, 0, 1);
        const col = tmpColor.setHSL(
          0.5,
          1.0,
          THREE.MathUtils.lerp(0.3, 0.7, strength)
        );
        // both vertices same color
        colors[i * 6 + 0] = col.r;
        colors[i * 6 + 1] = col.g;
        colors[i * 6 + 2] = col.b;
        colors[i * 6 + 3] = col.r;
        colors[i * 6 + 4] = col.g;
        colors[i * 6 + 5] = col.b;
      });

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geom.computeBoundingSphere();

      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
      });

      const lines = new THREE.LineSegments(geom, mat);
      world.add(lines);

      connectionGeomRef.current = geom;
      connectionMatRef.current = mat;
      connectionLinesRef.current = lines;
    }

    // Raycasting for device selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      if (!cameraRef.current || !rendererRef.current) return;

      // Prevent selecting while dragging
      if (dragState.current.dragDistance > 5) {
        dragState.current.dragDistance = 0;
        return;
      }

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);
      const meshes = Array.from(deviceObjectsRef.current.values()).map(
        (b) => b.mesh
      );
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        const obj = intersects[0].object as THREE.Mesh;
        const deviceId = obj.userData.deviceId as string | undefined;
        if (deviceId) onDeviceSelect(deviceId);
      }
    };

    const dom = rendererRef.current?.domElement;
    dom?.addEventListener("click", handleClick);

    return () => {
      dom?.removeEventListener("click", handleClick);
    };
  }, [devices, connections, isInitialized, onDeviceSelect]);

  // Highlight selected device
  useEffect(() => {
    if (!isInitialized) return;

    deviceObjectsRef.current.forEach(({ mesh }) => {
      const isSelected =
        selectedDevice && mesh.userData.deviceId === selectedDevice.id;

      if (isSelected) {
        gsap.to(mesh.scale, {
          x: 1.5,
          y: 1.5,
          z: 1.5,
          duration: 0.25,
          ease: "power2.out",
        });
        gsap.to(mesh.material, {
          opacity: 1,
          duration: 0.25,
          ease: "power2.out",
        });
      } else {
        gsap.to(mesh.scale, {
          x: 1,
          y: 1,
          z: 1,
          duration: 0.25,
          ease: "power2.out",
        });
        gsap.to(mesh.material, {
          opacity: 0.6,
          duration: 0.25,
          ease: "power2.out",
        });
      }
    });
  }, [selectedDevice, isInitialized]);

  // Keep workloads in sync without re-creating meshes (better perf for pulsing)
  useEffect(() => {
    devices.forEach((d) => {
      const bundle = deviceObjectsRef.current.get(d.id);
      if (bundle) {
        bundle.mesh.userData.workload = d.metrics?.workload ?? 0;
        // Also adjust material color/emissive if status changed
        const targetMat = getMaterialForStatus(d.status ?? "default");
        if (bundle.mesh.material !== targetMat) {
          bundle.mesh.material = targetMat;
        }
      }
    });
  }, [devices]);

  return (
    <div
      ref={mountRef}
      className="w-full h-full bg-gradient-to-b from-gray-900 to-black rounded-lg overflow-hidden network-vis"
      aria-label="3D Network Visualization"
    />
  );
};

export default NetworkVisualization;
