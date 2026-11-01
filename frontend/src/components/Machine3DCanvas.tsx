import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCw, ZoomIn, ZoomOut, Move, RefreshCw, Eye, Layers, Sparkles } from 'lucide-react';

export type ViewMode = 'assembled' | 'exploded' | 'component' | 'xray';
export type SelectedComponent = 'rotor' | 'stator' | 'bearing_de' | 'bearing_nde' | 'terminal_box' | 'cooling_fan' | null;

interface Hotspot3D {
  id: SelectedComponent;
  name: string;
  subTitle: string;
  position: THREE.Vector3;
  type: 'temperature' | 'vibration' | 'current' | 'rpm';
  status: 'normal' | 'warning' | 'critical' | 'offline';
  value: string;
  unit: string;
  limit?: string;
  screenPos: { x: number; y: number; visible: boolean };
}

interface Machine3DCanvasProps {
  rpm: number;
  temperature: number;
  vibration: number;
  current: number;
  isRunning: boolean;
  selectedComponent: SelectedComponent;
  onSelectComponent: (comp: SelectedComponent) => void;
  viewMode: ViewMode;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
}

export const Machine3DCanvas: React.FC<Machine3DCanvasProps> = ({
  rpm,
  temperature,
  vibration,
  current,
  isRunning,
  selectedComponent,
  onSelectComponent,
  viewMode,
  autoRotate,
  onToggleAutoRotate,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Animated Mesh Component references
  const rotorMeshGroupRef = useRef<THREE.Group | null>(null);
  const coolingFanMeshRef = useRef<THREE.Group | null>(null);
  const housingMeshGroupRef = useRef<THREE.Group | null>(null);
  const deBearingGroupRef = useRef<THREE.Group | null>(null);
  const ndeBearingGroupRef = useRef<THREE.Group | null>(null);
  const terminalBoxGroupRef = useRef<THREE.Group | null>(null);
  const statorGroupRef = useRef<THREE.Group | null>(null);

  // Exploded view animation state
  const explosionProgressRef = useRef<number>(0);
  const targetExplosionRef = useRef<number>(0);

  // Hotspots 2D Screen Positions state
  const [hotspots, setHotspots] = useState<Hotspot3D[]>([
    {
      id: 'terminal_box',
      name: 'Terminal Box',
      subTitle: 'Junction & Current Bus',
      position: new THREE.Vector3(0, 1.7, 0),
      type: 'temperature',
      status: 'normal',
      value: '--',
      unit: '°C',
      screenPos: { x: 0, y: 0, visible: false },
    },
    {
      id: 'stator',
      name: 'Stator Core',
      subTitle: 'Copper Windings & Field',
      position: new THREE.Vector3(0, 0.4, 1.2),
      type: 'current',
      status: 'normal',
      value: '--',
      unit: 'A',
      screenPos: { x: 0, y: 0, visible: false },
    },
    {
      id: 'rotor',
      name: 'Rotor & Shaft',
      subTitle: 'Magnetic Induction Shaft',
      position: new THREE.Vector3(0, 0.1, -0.6),
      type: 'rpm',
      status: 'normal',
      value: '--',
      unit: 'RPM',
      screenPos: { x: 0, y: 0, visible: false },
    },
    {
      id: 'bearing_de',
      name: 'Bearing (DE)',
      subTitle: 'Drive-End Roller Bearing',
      position: new THREE.Vector3(0, 0, 2.2),
      type: 'vibration',
      status: 'normal',
      value: '--',
      unit: 'm/s²',
      screenPos: { x: 0, y: 0, visible: false },
    },
    {
      id: 'bearing_nde',
      name: 'Bearing (NDE)',
      subTitle: 'Non-Drive-End Bearing',
      position: new THREE.Vector3(0, 0, -2.2),
      type: 'vibration',
      status: 'normal',
      value: '--',
      unit: 'm/s²',
      screenPos: { x: 0, y: 0, visible: false },
    },
    {
      id: 'cooling_fan',
      name: 'Cooling Fan',
      subTitle: 'Radial Impeller & Shroud',
      position: new THREE.Vector3(0, 0, -2.9),
      type: 'temperature',
      status: 'normal',
      value: '--',
      unit: '°C',
      screenPos: { x: 0, y: 0, visible: false },
    },
  ]);

  // Update target explosion based on viewMode
  useEffect(() => {
    targetExplosionRef.current = viewMode === 'exploded' ? 1.0 : 0.0;
  }, [viewMode]);

  // Synchronize Hotspot readouts with incoming telemetry
  useEffect(() => {
    const tempStatus = !isRunning ? 'offline' : temperature >= 60 ? 'critical' : temperature >= 45 ? 'warning' : 'normal';
    const vibStatus = !isRunning ? 'offline' : vibration >= 3.0 ? 'critical' : vibration >= 1.5 ? 'warning' : 'normal';
    const currStatus = !isRunning ? 'offline' : current >= 3.0 ? 'critical' : current >= 2.0 ? 'warning' : 'normal';
    const rpmStatus = !isRunning ? 'offline' : rpm < 750 ? 'warning' : 'normal';

    setHotspots((prev) =>
      prev.map((h) => {
        if (h.id === 'terminal_box') {
          return {
            ...h,
            value: isNaN(temperature) ? '--' : `${temperature.toFixed(1)}`,
            status: tempStatus,
          };
        }
        if (h.id === 'stator') {
          return {
            ...h,
            value: isNaN(temperature) ? '--' : `${(temperature * 1.08).toFixed(1)}`,
            status: tempStatus,
          };
        }
        if (h.id === 'rotor') {
          return {
            ...h,
            value: isRunning ? `${Math.round(rpm)}` : '0',
            status: rpmStatus,
          };
        }
        if (h.id === 'bearing_de') {
          return {
            ...h,
            value: isNaN(vibration) ? '--' : `${vibration.toFixed(2)}`,
            status: vibStatus,
          };
        }
        if (h.id === 'bearing_nde') {
          return {
            ...h,
            value: isNaN(vibration) ? '--' : `${(vibration * 0.85).toFixed(2)}`,
            status: vibStatus,
          };
        }
        if (h.id === 'cooling_fan') {
          return {
            ...h,
            value: isNaN(temperature) ? '--' : `${(temperature * 0.88).toFixed(1)}`,
            status: tempStatus,
          };
        }
        return h;
      })
    );
  }, [temperature, vibration, current, rpm, isRunning]);

  // 3D Scene Initialization
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(4.8, 3.2, 5.4);
    cameraRef.current = camera;

    // WebGL Renderer with High-DPI and Antialiasing
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't clip under ground plane
    controls.minDistance = 2.5;
    controls.maxDistance = 15;
    controls.target.set(0, 0.4, 0);
    controlsRef.current = controls;

    // =========================================================================
    // LIGHTING & ENVIRONMENT
    // =========================================================================
    const ambientLight = new THREE.AmbientLight(0x0f172a, 1.8);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 2.5); // Cyan key light
    dirLight1.position.set(5, 8, 5);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x818cf8, 1.8); // Indigo fill light
    dirLight2.position.set(-6, 4, -5);
    scene.add(dirLight2);

    const bottomGlow = new THREE.PointLight(0x06b6d4, 3.5, 8); // Base ring underglow
    bottomGlow.position.set(0, -0.4, 0);
    scene.add(bottomGlow);

    const topAccent = new THREE.PointLight(0xa855f7, 2.0, 6); // Purple stator accent
    topAccent.position.set(0, 2.2, 0);
    scene.add(topAccent);

    // =========================================================================
    // MATERIALS REPOSITORY
    // =========================================================================
    const metalHousingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25,
      envMapIntensity: 1.2,
    });

    const industrialBlueMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.65,
      roughness: 0.35,
    });

    const chromeShaftMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.95,
      roughness: 0.12,
    });

    const copperWindingMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0xb45309,
      emissiveIntensity: 0.2,
    });

    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.9,
      roughness: 0.3,
    });

    const bronzeBearingMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.85,
      roughness: 0.2,
    });

    const neonGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: false,
    });

    // =========================================================================
    // 1. CYBERNETIC PEDESTAL BASE & HOLOGRAPHIC RINGS
    // =========================================================================
    const pedestalGroup = new THREE.Group();

    // Base Cylinder
    const baseGeo = new THREE.CylinderGeometry(3.6, 3.8, 0.25, 48);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      metalness: 0.9,
      roughness: 0.4,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.55;
    baseMesh.receiveShadow = true;
    pedestalGroup.add(baseMesh);

    // Glowing Concentric Rings
    const ring1Geo = new THREE.RingGeometry(3.2, 3.25, 64);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.y = -0.42;
    pedestalGroup.add(ring1);

    const ring2Geo = new THREE.RingGeometry(2.4, 2.43, 64);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = -0.42;
    pedestalGroup.add(ring2);

    // Grid Floor ticks
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const tickGeo = new THREE.BoxGeometry(0.04, 0.01, 0.35);
      const tickMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.position.set(Math.cos(angle) * 3.4, -0.42, Math.sin(angle) * 3.4);
      tick.rotation.y = -angle;
      pedestalGroup.add(tick);
    }
    scene.add(pedestalGroup);

    // =========================================================================
    // 2. MAIN MOTOR HOUSING & STATOR ASSEMBLY
    // =========================================================================
    const housingGroup = new THREE.Group();
    housingMeshGroupRef.current = housingGroup;

    // Stator Body Cylinder
    const statorBodyGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.6, 32, 1, true);
    const statorBody = new THREE.Mesh(statorBodyGeo, industrialBlueMat);
    statorBody.rotation.x = Math.PI / 2;
    statorBody.castShadow = true;
    statorBody.receiveShadow = true;
    housingGroup.add(statorBody);

    // Cooling Ribs (Heat Fins around chassis)
    const finCount = 18;
    for (let i = 0; i < finCount; i++) {
      const angle = (i / finCount) * Math.PI * 2;
      const finGeo = new THREE.BoxGeometry(0.08, 0.22, 2.5);
      const fin = new THREE.Mesh(finGeo, metalHousingMat);
      fin.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 1.45, 0);
      fin.rotation.z = angle;
      fin.castShadow = true;
      housingGroup.add(fin);
    }

    // Heavy Industrial Mounting Feet
    const footMat = darkSteelMat;
    const foot1Geo = new THREE.BoxGeometry(0.5, 0.4, 2.6);
    const foot1 = new THREE.Mesh(foot1Geo, footMat);
    foot1.position.set(-1.1, -1.25, 0);
    foot1.castShadow = true;
    housingGroup.add(foot1);

    const foot2 = foot1.clone();
    foot2.position.set(1.1, -1.25, 0);
    housingGroup.add(foot2);

    // Mounting Bolt details
    [-1, 1].forEach((xSide) => {
      [-1, 1].forEach((zSide) => {
        const boltGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 12);
        const bolt = new THREE.Mesh(boltGeo, chromeShaftMat);
        bolt.position.set(xSide * 1.1, -1.0, zSide * 1.0);
        housingGroup.add(bolt);
      });
    });

    // =========================================================================
    // 3. STATOR WINDINGS (Visible inside casing)
    // =========================================================================
    const statorGroup = new THREE.Group();
    statorGroupRef.current = statorGroup;

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const windingGeo = new THREE.TorusGeometry(1.22, 0.08, 8, 24);
      const winding = new THREE.Mesh(windingGeo, copperWindingMat);
      winding.rotation.y = Math.PI / 2;
      winding.position.set(Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, (i - 5.5) * 0.22);
      statorGroup.add(winding);
    }
    housingGroup.add(statorGroup);

    // =========================================================================
    // 4. TERMINAL BOX (Top junction box)
    // =========================================================================
    const terminalBoxGroup = new THREE.Group();
    terminalBoxGroupRef.current = terminalBoxGroup;

    const boxGeo = new THREE.BoxGeometry(1.1, 0.65, 1.2);
    const boxMesh = new THREE.Mesh(boxGeo, metalHousingMat);
    boxMesh.position.set(0, 1.65, 0);
    boxMesh.castShadow = true;
    terminalBoxGroup.add(boxMesh);

    // Conduit gland entry
    const glandGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16);
    const gland = new THREE.Mesh(glandGeo, bronzeBearingMat);
    gland.rotation.z = Math.PI / 2;
    gland.position.set(0.65, 1.65, 0.2);
    terminalBoxGroup.add(gland);

    // Status LED on Terminal Box
    const ledGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 2.0, 0.45);
    terminalBoxGroup.add(led);

    housingGroup.add(terminalBoxGroup);
    scene.add(housingGroup);

    // =========================================================================
    // 5. ROTOR & SHAFT ASSEMBLY (Dynamic Rotational Subtree)
    // =========================================================================
    const rotorGroup = new THREE.Group();
    rotorMeshGroupRef.current = rotorGroup;

    // Main Drive Shaft
    const shaftGeo = new THREE.CylinderGeometry(0.32, 0.32, 5.8, 32);
    const shaftMesh = new THREE.Mesh(shaftGeo, chromeShaftMat);
    shaftMesh.rotation.x = Math.PI / 2;
    shaftMesh.castShadow = true;
    rotorGroup.add(shaftMesh);

    // Keyway slot on Drive End shaft
    const keywayGeo = new THREE.BoxGeometry(0.12, 0.12, 0.9);
    const keyway = new THREE.Mesh(keywayGeo, darkSteelMat);
    keyway.position.set(0, 0.32, 2.4);
    rotorGroup.add(keyway);

    // Laminated Rotor Core (Silicon steel pack)
    const rotorCoreGeo = new THREE.CylinderGeometry(0.95, 0.95, 2.1, 32);
    const rotorCore = new THREE.Mesh(rotorCoreGeo, darkSteelMat);
    rotorCore.rotation.x = Math.PI / 2;
    rotorCore.castShadow = true;
    rotorGroup.add(rotorCore);

    // Squirrel Cage Copper Bars / Conductors
    const barCount = 16;
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2;
      const barGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.12, 8);
      const bar = new THREE.Mesh(barGeo, copperWindingMat);
      bar.position.set(Math.cos(angle) * 0.92, Math.sin(angle) * 0.92, 0);
      bar.rotation.x = Math.PI / 2;
      rotorGroup.add(bar);
    }

    // Rotor End Rings
    [-1.06, 1.06].forEach((zPos) => {
      const ringGeo = new THREE.TorusGeometry(0.88, 0.08, 12, 32);
      const endRing = new THREE.Mesh(ringGeo, copperWindingMat);
      endRing.position.z = zPos;
      rotorGroup.add(endRing);
    });

    scene.add(rotorGroup);

    // =========================================================================
    // 6. DRIVE-END (DE) BEARING & END-BELL SHIELD
    // =========================================================================
    const deGroup = new THREE.Group();
    deBearingGroupRef.current = deGroup;

    // End Shield Flange
    const deShieldGeo = new THREE.CylinderGeometry(1.42, 1.42, 0.35, 32);
    const deShield = new THREE.Mesh(deShieldGeo, metalHousingMat);
    deShield.rotation.x = Math.PI / 2;
    deShield.position.z = 1.45;
    deShield.castShadow = true;
    deGroup.add(deShield);

    // Bearing Outer Race Ring
    const deBearingRingGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.4, 24);
    const deBearingRing = new THREE.Mesh(deBearingRingGeo, bronzeBearingMat);
    deBearingRing.rotation.x = Math.PI / 2;
    deBearingRing.position.z = 1.7;
    deBearingRing.castShadow = true;
    deGroup.add(deBearingRing);

    // Vibration Sensor Stud (DE Mount Point)
    const deSensorGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
    const deSensorMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, metalness: 0.9 });
    const deSensor = new THREE.Mesh(deSensorGeo, deSensorMat);
    deSensor.position.set(0, 1.45, 1.45);
    deGroup.add(deSensor);

    scene.add(deGroup);

    // =========================================================================
    // 7. NON-DRIVE-END (NDE) BEARING & REAR SHIELD
    // =========================================================================
    const ndeGroup = new THREE.Group();
    ndeBearingGroupRef.current = ndeGroup;

    const ndeShieldGeo = new THREE.CylinderGeometry(1.42, 1.42, 0.35, 32);
    const ndeShield = new THREE.Mesh(ndeShieldGeo, metalHousingMat);
    ndeShield.rotation.x = Math.PI / 2;
    ndeShield.position.z = -1.45;
    ndeShield.castShadow = true;
    ndeGroup.add(ndeShield);

    const ndeBearingRingGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.4, 24);
    const ndeBearingRing = new THREE.Mesh(ndeBearingRingGeo, bronzeBearingMat);
    ndeBearingRing.rotation.x = Math.PI / 2;
    ndeBearingRing.position.z = -1.7;
    ndeGroup.add(ndeBearingRing);

    scene.add(ndeGroup);

    // =========================================================================
    // 8. COOLING FAN & AERODYNAMIC REAR COWL
    // =========================================================================
    const fanGroup = new THREE.Group();
    coolingFanMeshRef.current = fanGroup;

    // Fan Hub
    const fanHubGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.25, 24);
    const fanHub = new THREE.Mesh(fanHubGeo, industrialBlueMat);
    fanHub.rotation.x = Math.PI / 2;
    fanGroup.add(fanHub);

    // 8 Curved Aerodynamic Fan Blades
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const bladeGeo = new THREE.BoxGeometry(0.08, 0.55, 0.22);
      const blade = new THREE.Mesh(bladeGeo, industrialBlueMat);
      blade.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0);
      blade.rotation.z = angle + 0.35; // Pitch angle
      fanGroup.add(blade);
    }
    fanGroup.position.z = -2.1;
    scene.add(fanGroup);

    // Fan Shroud Cover Cowl
    const cowlGeo = new THREE.CylinderGeometry(1.48, 1.48, 1.0, 32, 1, true);
    const cowlMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.5,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });
    const cowl = new THREE.Mesh(cowlGeo, cowlMat);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.z = -2.25;
    scene.add(cowl);

    // Shroud Wire Mesh Grille
    const grilleGeo = new THREE.CircleGeometry(1.42, 24);
    const grilleMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      wireframe: true,
    });
    const grille = new THREE.Mesh(grilleGeo, grilleMat);
    grille.position.z = -2.76;
    scene.add(grille);

    // =========================================================================
    // ANIMATION & RENDER LOOP (60 FPS Performance Optimized)
    // =========================================================================
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      // Smooth Explosion Interpolation
      const curExplosion = explosionProgressRef.current;
      const tgtExplosion = targetExplosionRef.current;
      explosionProgressRef.current = THREE.MathUtils.lerp(curExplosion, tgtExplosion, 0.08);
      const exp = explosionProgressRef.current;

      // Apply Exploded Offset Transforms
      if (deBearingGroupRef.current) {
        deBearingGroupRef.current.position.z = 1.45 * exp * 1.8;
      }
      if (ndeBearingGroupRef.current) {
        ndeBearingGroupRef.current.position.z = -1.45 * exp * 1.8;
      }
      if (coolingFanMeshRef.current) {
        coolingFanMeshRef.current.position.z = -2.1 - exp * 2.2;
      }
      if (terminalBoxGroupRef.current) {
        terminalBoxGroupRef.current.position.y = exp * 1.2;
      }

      // Live Dynamic Rotor Rotation
      // Velocity proportional to real measured RPM
      if (isRunning && rpm > 0) {
        const radPerSec = (rpm / 60) * Math.PI * 2 * 0.15; // Scaled visual speed
        if (rotorMeshGroupRef.current) {
          rotorMeshGroupRef.current.rotation.z += radPerSec * delta;
        }
        if (coolingFanMeshRef.current) {
          coolingFanMeshRef.current.rotation.z += radPerSec * delta;
        }
      }

      // Auto Orbit Rotation
      if (controlsRef.current) {
        controlsRef.current.autoRotate = autoRotate;
        controlsRef.current.autoRotateSpeed = 1.2;
        controlsRef.current.update();
      }

      // Update 2D Screen Project Coordinates for Hotspots
      if (cameraRef.current && container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        const tempVec = new THREE.Vector3();

        setHotspots((currentHotspots) =>
          currentHotspots.map((hotspot) => {
            // Calculate actual world position accounting for exploded offsets
            let worldPos = hotspot.position.clone();
            if (hotspot.id === 'bearing_de') {
              worldPos.z += deBearingGroupRef.current?.position.z || 0;
            } else if (hotspot.id === 'bearing_nde') {
              worldPos.z += ndeBearingGroupRef.current?.position.z || 0;
            } else if (hotspot.id === 'terminal_box') {
              worldPos.y += terminalBoxGroupRef.current?.position.y || 0;
            } else if (hotspot.id === 'cooling_fan') {
              worldPos.z = coolingFanMeshRef.current?.position.z || -2.1;
            }

            tempVec.copy(worldPos);
            tempVec.project(cameraRef.current!);

            // Check if hotspot is facing the camera
            const isBehind = tempVec.z > 1.0;
            const x = (tempVec.x * 0.5 + 0.5) * width;
            const y = (-(tempVec.y * 0.5) + 0.5) * height;

            return {
              ...hotspot,
              screenPos: {
                x,
                y,
                visible: !isBehind && x >= 0 && x <= width && y >= 0 && y <= height,
              },
            };
          })
        );
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []); // Run once on mount

  // Camera Reset Function
  const handleResetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(4.8, 3.2, 5.4);
    controlsRef.current.target.set(0, 0.4, 0);
    controlsRef.current.update();
  }, []);

  // Zoom Controls
  const handleZoom = useCallback((direction: 'in' | 'out') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const factor = direction === 'in' ? 0.8 : 1.25;
    cameraRef.current.position.multiplyScalar(factor);
    controlsRef.current.update();
  }, []);

  return (
    <div className="relative w-full h-full min-h-[500px] select-none rounded-2xl bg-gradient-to-b from-slate-950/90 via-slate-900/60 to-slate-950/95 overflow-hidden border border-slate-800/80 shadow-2xl backdrop-blur-xl">
      {/* 3D WebGL Canvas Viewport */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Real-Time HTML Overlay Hotspots pinned to 3D Coordinates */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {hotspots.map((spot) => {
          if (!spot.screenPos.visible) return null;

          const isSelected = selectedComponent === spot.id;
          const statusColors = {
            normal: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-emerald-500/20',
            warning: 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-amber-500/20',
            critical: 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-rose-500/30 animate-pulse',
            offline: 'bg-slate-800/40 border-slate-700/50 text-slate-400',
          };

          const dotColors = {
            normal: 'bg-emerald-400',
            warning: 'bg-amber-400',
            critical: 'bg-rose-500',
            offline: 'bg-slate-500',
          };

          return (
            <div
              key={spot.id}
              style={{
                left: `${spot.screenPos.x}px`,
                top: `${spot.screenPos.y}px`,
                transform: 'translate(-50%, -100%)',
              }}
              className="absolute pointer-events-auto transition-all duration-75 z-10"
            >
              {/* Hotspot Card */}
              <button
                onClick={() => onSelectComponent(spot.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl border backdrop-blur-md shadow-lg transition-all transform hover:scale-105 ${
                  isSelected
                    ? 'ring-2 ring-cyan-400 bg-cyan-950/90 border-cyan-400 text-white scale-105 shadow-cyan-500/40'
                    : statusColors[spot.status]
                }`}
              >
                {/* Status Glow Dot */}
                <div className="relative flex items-center justify-center">
                  <div className={`h-2 w-2 rounded-full ${dotColors[spot.status]}`} />
                  {spot.status === 'critical' && (
                    <div className="absolute h-4 w-4 rounded-full bg-rose-500 animate-ping opacity-75" />
                  )}
                </div>

                {/* Hotspot Title & Value */}
                <div className="text-left font-mono">
                  <div className="text-[11px] font-bold tracking-tight text-white flex items-center gap-1">
                    <span>{spot.name}</span>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-300">
                    <span className="text-cyan-300">{spot.value}</span> {spot.unit}
                  </div>
                </div>
              </button>

              {/* Connecting Anchor Point Pin */}
              <div className="w-0.5 h-3 bg-gradient-to-b from-cyan-400/80 to-transparent mx-auto mt-0.5" />
            </div>
          );
        })}
      </div>

      {/* Floating 3D Navigation & Viewport Controls Toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800/80 shadow-2xl backdrop-blur-xl z-20">
        {/* Auto Rotate Toggle */}
        <button
          onClick={onToggleAutoRotate}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            autoRotate
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
          title="Toggle 360° Auto-Rotation"
        >
          <RotateCw className={`h-3.5 w-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Auto Rotate</span>
        </button>

        {/* Zoom In */}
        <button
          onClick={() => handleZoom('in')}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        {/* Zoom Out */}
        <button
          onClick={() => handleZoom('out')}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        {/* Reset Camera Position */}
        <button
          onClick={handleResetCamera}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all"
          title="Reset Camera View"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>

      {/* Watermark / Digital Twin Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none z-10">
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950/80 px-3 py-1 text-xs font-bold text-cyan-300 border border-cyan-500/30 backdrop-blur-md shadow-lg">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
          <span>REAL-TIME DIGITAL TWIN</span>
        </span>
        <span className="text-[11px] font-mono text-slate-400 bg-slate-950/60 px-2.5 py-1 rounded-lg border border-slate-800 backdrop-blur-md">
          {isRunning ? '● SYNCHRONIZED' : '○ STANDBY'}
        </span>
      </div>
    </div>
  );
};

export default Machine3DCanvas;
