import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useFleetStore } from '../store/useFleetStore';
import { FoxgloveCanvas } from './FoxgloveCanvas';
import {
  Layers,
  Sparkles,
  MapPin,
  Radio,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Navigation,
  Crosshair,
  Hand,
  XOctagon,
  Home,
  CheckCircle2,
  AlertTriangle,
  Compass,
} from 'lucide-react';

interface MapCanvasProps {
  mapboxToken?: string;
  onCoordinateClick?: (x: number, y: number) => void;
  selectedRobotHost?: string;
}

export function MapCanvas({ mapboxToken, onCoordinateClick, selectedRobotHost = '192.168.8.162' }: MapCanvasProps) {
  const [viewMode, setViewMode] = useState<'native' | 'foxglove'>('native');
  const [interactMode, setInteractMode] = useState<'pan' | 'nav_goal'>('nav_goal');
  const [showLidarOverlay, setShowLidarOverlay] = useState<boolean>(true);
  const [showPathOverlay, setShowPathOverlay] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoverWorldPos, setHoverWorldPos] = useState<{ x: number; y: number } | null>(null);

  // Interactive Goal Dragging State
  const [navTargetDrag, setNavTargetDrag] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isSettingGoal: boolean;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const robots = useFleetStore((state) => state.robots);
  const selectedRobotId = useFleetStore((state) => state.selectedRobotId);
  const activeNavGoal = useFleetStore((state) => state.activeNavGoal);
  const plannedPath = useFleetStore((state) => state.plannedPath);
  const navStatus = useFleetStore((state) => state.navStatus);
  const sendNavGoal = useFleetStore((state) => state.sendNavGoal);
  const cancelNavGoal = useFleetStore((state) => state.cancelNavGoal);

  const activeRobot = selectedRobotId ? robots[selectedRobotId] : Object.values(robots)[0];
  const hasLidar = activeRobot?.platform_type === 'anzym_rosorin' || activeRobot?.enabled_plugins?.includes('lidar_2d_3d') || true;

  // Auto-resize canvas buffer to match DOM element size 1:1
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
          canvas.width = Math.floor(rect.width);
          canvas.height = Math.floor(rect.height);
        }
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [viewMode]);

  // Zoom controls
  const handleZoomIn = () => setZoomLevel((z) => Math.min(5.0, Number((z + 0.25).toFixed(2))));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(0.4, Number((z - 0.25).toFixed(2))));
  const handleResetZoom = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const zoomDelta = e.deltaY < 0 ? 0.15 : -0.15;
    setZoomLevel((prev) => Math.max(0.4, Math.min(5.0, Number((prev + zoomDelta).toFixed(2)))));
  };

  // Convert canvas pixel coordinates to world coordinates (meters)
  const canvasToWorld = useCallback(
    (canvasX: number, canvasY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const centerX = canvas.width / 2 + panOffset.x;
      const centerY = canvas.height / 2 + panOffset.y;
      const worldX = (canvasX - centerX) / (zoomLevel * 35.0); // 35 pixels per meter scale
      const worldY = -(canvasY - centerY) / (zoomLevel * 35.0);
      return { x: Number(worldX.toFixed(2)), y: Number(worldY.toFixed(2)) };
    },
    [panOffset, zoomLevel]
  );

  // Helper to extract exact canvas internal buffer coordinates from mouse event
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Left click only
    const { x: clickX, y: clickY } = getCanvasPos(e);

    if (interactMode === 'pan') {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    } else if (interactMode === 'nav_goal') {
      setNavTargetDrag({
        startX: clickX,
        startY: clickY,
        currentX: clickX,
        currentY: clickY,
        isSettingGoal: true,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x: currentX, y: currentY } = getCanvasPos(e);
    const worldPos = canvasToWorld(currentX, currentY);
    setHoverWorldPos(worldPos);

    if (interactMode === 'pan' && isDragging) {
      setPanOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    } else if (interactMode === 'nav_goal' && navTargetDrag?.isSettingGoal) {
      setNavTargetDrag((prev) => (prev ? { ...prev, currentX, currentY } : null));
    }
  };

  const handleMouseUp = () => {
    if (interactMode === 'pan') {
      setIsDragging(false);
    } else if (interactMode === 'nav_goal' && navTargetDrag?.isSettingGoal && activeRobot) {
      const worldStart = canvasToWorld(navTargetDrag.startX, navTargetDrag.startY);
      const worldCurrent = canvasToWorld(navTargetDrag.currentX, navTargetDrag.currentY);

      // Compute heading angle from drag vector
      const dx = worldCurrent.x - worldStart.x;
      const dy = worldCurrent.y - worldStart.y;
      const theta = Math.hypot(dx, dy) > 0.1 ? Math.atan2(dy, dx) : 0.0;

      sendNavGoal(activeRobot.id, worldStart.x, worldStart.y, theta);

      if (onCoordinateClick) {
        onCoordinateClick(worldStart.x, worldStart.y);
      }

      setNavTargetDrag(null);
    }
  };

  const handleReturnHome = () => {
    if (activeRobot) {
      sendNavGoal(activeRobot.id, 0.0, 0.0, 0.0);
    }
  };

  const handleCancelGoal = () => {
    if (activeRobot) {
      cancelNavGoal(activeRobot.id);
    }
  };

  useEffect(() => {
    if (viewMode !== 'native') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let pulseAngle = 0;

    const render = () => {
      pulseAngle += 0.05;
      ctx.fillStyle = '#09080c'; // Deep obsidian iron black
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply Pan & Zoom Transform
      ctx.translate(canvas.width / 2 + panOffset.x, canvas.height / 2 + panOffset.y);
      ctx.scale(zoomLevel, zoomLevel);

      // 1. Draw Grid (centered at origin, 1 meter grid lines = 35px)
      const pxPerMeter = 35;
      const gridExtent = 1200;
      ctx.strokeStyle = '#26201a'; // Aged bronze iron grid line
      ctx.lineWidth = 1 / zoomLevel;
      for (let i = -gridExtent; i <= gridExtent; i += pxPerMeter) {
        ctx.beginPath();
        ctx.moveTo(i, -gridExtent);
        ctx.lineTo(i, gridExtent);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-gridExtent, i);
        ctx.lineTo(gridExtent, i);
        ctx.stroke();
      }

      // Draw Metric Axes Crosshair (Antique Brass Meridian Lines)
      ctx.strokeStyle = '#6e5329';
      ctx.lineWidth = 1.5 / zoomLevel;
      ctx.beginPath();
      ctx.moveTo(-gridExtent, 0);
      ctx.lineTo(gridExtent, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -gridExtent);
      ctx.lineTo(0, gridExtent);
      ctx.stroke();

      // Draw Home Origin (0,0) Marker (Brass Compass Hub)
      ctx.fillStyle = '#d4af37';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5 / zoomLevel, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#dcb94e';
      ctx.font = `${Math.max(9, 10 / zoomLevel)}px 'Space Mono', monospace`;
      ctx.fillText('(0,0) Meridian Origin', 6 / zoomLevel, -6 / zoomLevel);

      // 2. Draw Real-time Planned Path Polyline (/plan)
      if (showPathOverlay && plannedPath && plannedPath.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#f3ca52'; // Radiant Gold
        ctx.lineWidth = 3 / zoomLevel;
        ctx.setLineDash([6 / zoomLevel, 4 / zoomLevel]);
        ctx.shadowColor = '#c59b27'; // Antique brass glow
        ctx.shadowBlur = 10;

        ctx.beginPath();
        plannedPath.forEach((pt, idx) => {
          const ptScreenX = pt.x * pxPerMeter;
          const ptScreenY = -pt.y * pxPerMeter;
          if (idx === 0) ctx.moveTo(ptScreenX, ptScreenY);
          else ctx.lineTo(ptScreenX, ptScreenY);
        });
        ctx.stroke();
        ctx.restore();
      }

      // 3. Draw Active Navigation Goal Beacon
      if (activeNavGoal) {
        const goalScreenX = activeNavGoal.x * pxPerMeter;
        const goalScreenY = -activeNavGoal.y * pxPerMeter;

        // Animated Beacon Pulse Ring (Antique Brass Sextant Ring)
        ctx.save();
        ctx.translate(goalScreenX, goalScreenY);

        const ringRadius = (12 + Math.sin(pulseAngle) * 4) / zoomLevel;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.7)';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.arc(0, 0, ringRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // Goal Pin Center (Burnished Copper Hub)
        ctx.fillStyle = '#e07a5f';
        ctx.beginPath();
        ctx.arc(0, 0, 6 / zoomLevel, 0, 2 * Math.PI);
        ctx.fill();

        // Goal Heading Orientation Arrow (Gold Pointer)
        if (activeNavGoal.theta !== undefined) {
          ctx.rotate(-activeNavGoal.theta);
          ctx.strokeStyle = '#f3ca52';
          ctx.lineWidth = 2.5 / zoomLevel;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(24 / zoomLevel, 0);
          ctx.lineTo(16 / zoomLevel, -5 / zoomLevel);
          ctx.moveTo(24 / zoomLevel, 0);
          ctx.lineTo(16 / zoomLevel, 5 / zoomLevel);
          ctx.stroke();
        }

        ctx.restore();

        // Goal Text Label
        ctx.fillStyle = '#f3ca52';
        ctx.font = `${Math.max(10, 11 / zoomLevel)}px 'Space Mono', monospace`;
        ctx.fillText(
          `🎯 Waypoint: (${activeNavGoal.x.toFixed(1)}m, ${activeNavGoal.y.toFixed(1)}m)`,
          goalScreenX + 10 / zoomLevel,
          goalScreenY - 10 / zoomLevel
        );
      }

      // 4. Draw Interactive Nav Goal in Progress (Drag preview)
      if (navTargetDrag?.isSettingGoal) {
        const startWorld = canvasToWorld(navTargetDrag.startX, navTargetDrag.startY);
        const currentWorld = canvasToWorld(navTargetDrag.currentX, navTargetDrag.currentY);
        const startScreenX = startWorld.x * pxPerMeter;
        const startScreenY = -startWorld.y * pxPerMeter;
        const currentScreenX = currentWorld.x * pxPerMeter;
        const currentScreenY = -currentWorld.y * pxPerMeter;

        ctx.save();
        // Destination Pin Preview (Copper)
        ctx.fillStyle = '#e07a5f';
        ctx.beginPath();
        ctx.arc(startScreenX, startScreenY, 6 / zoomLevel, 0, 2 * Math.PI);
        ctx.fill();

        // Heading Vector Line (Gold)
        ctx.strokeStyle = '#f3ca52';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.setLineDash([4 / zoomLevel, 3 / zoomLevel]);
        ctx.beginPath();
        ctx.moveTo(startScreenX, startScreenY);
        ctx.lineTo(currentScreenX, currentScreenY);
        ctx.stroke();
        ctx.restore();
      }

      // 5. Draw Fleet Robots & LiDAR overlays
      Object.values(robots).forEach((robot) => {
        const isSelected = selectedRobotId === robot.id;
        const screenX = robot.position.x * pxPerMeter;
        const screenY = -robot.position.y * pxPerMeter;

        // Render LiDAR Scan ONLY for the active selected robot
        if (isSelected && showLidarOverlay && hasLidar) {
          const hasRealScan = robot.scan && Array.isArray(robot.scan.ranges) && robot.scan.ranges.length > 0;

          if (hasRealScan) {
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.rotate(-robot.position.theta);

            const scanData = robot.scan!;
            const ranges = scanData.ranges;
            const angleMin = scanData.angle_min ?? -Math.PI;
            const angleInc = scanData.angle_increment ?? (2 * Math.PI) / ranges.length;

            ranges.forEach((rangeMeters, i) => {
              if (
                !rangeMeters ||
                rangeMeters <= (scanData.range_min || 0.05) ||
                rangeMeters >= (scanData.range_max || 40)
              ) {
                return;
              }
              const angle = angleMin + i * angleInc;
              const screenDist = rangeMeters * pxPerMeter;

              const hitX = Math.cos(angle) * screenDist;
              const hitY = Math.sin(angle) * screenDist;

              // Laser ray (Warm golden ray)
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(212, 175, 55, 0.08)';
              ctx.lineWidth = 0.5 / zoomLevel;
              ctx.moveTo(0, 0);
              ctx.lineTo(hitX, hitY);
              ctx.stroke();

              // Laser Point (Warm amber, copper, and radiant brass)
              ctx.beginPath();
              ctx.fillStyle = i % 3 === 0 ? '#ff9e2c' : i % 3 === 1 ? '#e07a5f' : '#f3ca52';
              ctx.arc(hitX, hitY, 2.5 / zoomLevel, 0, 2 * Math.PI);
              ctx.fill();
            });

            ctx.restore();
          }
        }

        // Draw Robot Body Triangle (Steampunk Automaton Chevron)
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(-robot.position.theta);

        const colors: Record<string, string> = {
          ONLINE: '#2ec4b6', // Jade / Verdigris Brass
          OFFLINE: '#8e8271', // Patina Iron
          BUSY: '#f59e0b', // Incandescent Amber
          ERROR: '#ef4444', // Ruby Flame
          IDLE: '#b87333', // Hammered Copper
        };
        ctx.fillStyle = colors[robot.status] || '#c59b27';

        ctx.beginPath();
        ctx.moveTo(16 / zoomLevel, 0);
        ctx.lineTo(-10 / zoomLevel, -10 / zoomLevel);
        ctx.lineTo(-10 / zoomLevel, 10 / zoomLevel);
        ctx.closePath();
        ctx.fill();

        // Highlight ring around selected robot (Radiant Gold Bezel)
        if (isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = '#f3ca52';
          ctx.lineWidth = 2 / zoomLevel;
          ctx.arc(0, 0, 20 / zoomLevel, 0, 2 * Math.PI);
          ctx.stroke();
        }

        ctx.restore();

        // Label (Aged Parchment Typography)
        ctx.fillStyle = '#f4ecd8';
        ctx.font = `${Math.max(10, Math.min(14, 12 / zoomLevel))}px 'Space Mono', monospace`;
        ctx.fillText(robot.name || robot.id, screenX - 20, screenY - 25 / zoomLevel);
        ctx.fillStyle = '#bfae91';
        ctx.fillText(`POS: (${robot.position.x.toFixed(1)}, ${robot.position.y.toFixed(1)})`, screenX - 20, screenY + 32 / zoomLevel);
      });

      ctx.restore(); // Restore main canvas transform

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [
    robots,
    viewMode,
    showLidarOverlay,
    showPathOverlay,
    selectedRobotId,
    hasLidar,
    zoomLevel,
    panOffset,
    activeNavGoal,
    plannedPath,
    navTargetDrag,
    canvasToWorld,
  ]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Header Controls Bar */}
      <div className="mb-3 flex items-center justify-between bg-gradient-to-r from-[#14121a] via-[#1c1824] to-[#14121a] p-2.5 rounded-xl border border-[#4a3d2e] shadow-lg shadow-black/60">
        <div className="flex items-center space-x-2 text-xs font-serif font-bold text-gold-400 px-2 tracking-wide">
          <Compass className="w-4 h-4 text-gold-400" />
          <span>Navigational Chart & Spatial Plot</span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Interaction Mode Toggle */}
          {viewMode === 'native' && (
            <div className="flex items-center bg-[#0a090d] p-1 rounded-lg border border-[#382f25] shadow-gauge-inset">
              <button
                onClick={() => setInteractMode('nav_goal')}
                title="Click and drag on map to dispatch autonomous navigation goal"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-serif font-bold transition-all ${
                  interactMode === 'nav_goal'
                    ? 'steampunk-btn-brass'
                    : 'text-steampunk-parchment-muted hover:text-gold-300'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Nav Goal Mode</span>
              </button>

              <button
                onClick={() => setInteractMode('pan')}
                title="Pan and inspect canvas map"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-serif font-bold transition-all ${
                  interactMode === 'pan'
                    ? 'steampunk-btn-copper'
                    : 'text-steampunk-parchment-muted hover:text-gold-300'
                }`}
              >
                <Hand className="w-3.5 h-3.5" />
                <span>Pan Mode</span>
              </button>
            </div>
          )}

          {/* LiDAR Overlay Toggle */}
          {viewMode === 'native' && (
            <button
              onClick={() => setShowLidarOverlay(!showLidarOverlay)}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-mono font-semibold border transition-all ${
                showLidarOverlay
                  ? 'bg-[#251e14] text-gold-300 border-brass-500 shadow-brass-sm'
                  : 'bg-[#0a090d] text-[#8e8271] border-[#382f25] hover:text-[#f4ecd8]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${showLidarOverlay ? 'animate-pulse text-gold-400' : ''}`} />
              <span>LiDAR Overlay</span>
            </button>
          )}

          {/* View Switcher */}
          <div className="flex items-center bg-[#0a090d] p-1 rounded-lg border border-[#382f25] shadow-gauge-inset">
            <button
              onClick={() => setViewMode('native')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-serif font-bold transition-all ${
                viewMode === 'native'
                  ? 'steampunk-btn-brass'
                  : 'text-steampunk-parchment-muted hover:text-gold-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Native Map</span>
            </button>

            <button
              onClick={() => setViewMode('foxglove')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-serif font-bold transition-all ${
                viewMode === 'foxglove'
                  ? 'steampunk-btn-copper'
                  : 'text-steampunk-parchment-muted hover:text-copper-300'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Foxglove 3D</span>
            </button>
          </div>
        </div>
      </div>

      {/* Viewport Content */}
      <div ref={containerRef} className="relative flex-1 min-h-[420px] w-full h-full overflow-hidden">
        {viewMode === 'native' ? (
          <div className="relative w-full h-full">
            <canvas
              ref={canvasRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                setHoverWorldPos(null);
                handleMouseUp();
              }}
              className={`w-full h-full border border-[#4a3d2e] rounded-xl shadow-inner bg-[#09080c] block ${
                interactMode === 'nav_goal' ? 'cursor-crosshair' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            />

            {/* Info Badge */}
            <div className="absolute top-4 left-4 bg-[#0c0b0e]/95 backdrop-blur-md border border-[#5c4728] p-3 rounded-xl text-[#f4ecd8] text-xs space-y-1.5 shadow-2xl pointer-events-none">
              <div className="font-serif font-bold text-gold-400 flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="steampunk-rivet" />
                  <span>Target: {activeRobot?.name || activeRobot?.id}</span>
                </span>
                <span className="text-[10px] font-mono bg-[#251e16] text-brass-300 border border-brass-700/50 px-1.5 py-0.5 rounded">
                  {activeRobot?.platform_type || 'anzym_rosorin'}
                </span>
              </div>
              <div className="text-steampunk-parchment-muted text-[11px] flex items-center gap-2 font-mono">
                <span>Mode: <strong className="text-gold-400">{interactMode === 'nav_goal' ? 'Deploy Waypoint' : 'Pan & Zoom'}</strong></span>
                <span>•</span>
                <span className="text-copper-400">
                  Pos: ({activeRobot?.position?.x?.toFixed(2) || '0.00'}, {activeRobot?.position?.y?.toFixed(2) || '0.00'})
                </span>
                {hoverWorldPos && (
                  <>
                    <span>•</span>
                    <span className="text-[#2ec4b6] font-semibold">
                      Cursor: ({hoverWorldPos.x.toFixed(2)}m, {hoverWorldPos.y.toFixed(2)}m)
                    </span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-[#8e8271] italic pt-1 font-serif">
                {interactMode === 'nav_goal'
                  ? 'Drag cursor across coordinates to align destination angle'
                  : 'Click & drag canvas to navigate • Scroll wheel to magnify'}
              </div>
            </div>

            {/* Floating Navigation Control HUD */}
            <div className="absolute top-4 right-4 bg-[#0c0b0e]/95 backdrop-blur-md border border-[#5c4728] p-2 rounded-xl text-[#f4ecd8] text-xs flex items-center space-x-2 shadow-2xl">
              {navStatus === 'NAVIGATING' ? (
                <div className="flex items-center space-x-2 px-2.5 py-1 bg-[#0f2420] border border-[#2ec4b6]/50 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-[#2ec4b6] animate-ping" />
                  <span className="text-[#2ec4b6] font-serif font-bold text-[11px]">En Route to Waypoint</span>
                  <button
                    onClick={handleCancelGoal}
                    className="flex items-center space-x-1 px-2 py-0.5 bg-[#8c1d1d] hover:bg-[#a32222] border border-[#cb6d51] text-white rounded text-[10px] font-serif font-bold transition-colors"
                  >
                    <XOctagon className="w-3 h-3" />
                    <span>Halt</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleReturnHome}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#181520] hover:bg-[#251e2c] text-brass-300 rounded-lg font-serif font-bold text-xs border border-[#5c4728] transition-colors"
                >
                  <Home className="w-3.5 h-3.5 text-copper-400" />
                  <span>Return to Port (0,0)</span>
                </button>
              )}
            </div>

            {/* Canvas Zoom Controls Bar */}
            <div className="absolute bottom-4 right-4 bg-[#0c0b0e]/95 backdrop-blur-md border border-[#5c4728] p-1.5 rounded-xl text-[#f4ecd8] text-xs flex items-center space-x-1 shadow-2xl">
              <button
                onClick={handleZoomIn}
                title="Zoom In"
                className="p-1.5 hover:bg-[#251e2c] text-brass-300 hover:text-gold-300 rounded-lg transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <span className="px-2 font-mono text-xs text-gold-400 font-bold border-x border-[#382f25]">
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                onClick={handleZoomOut}
                title="Zoom Out"
                className="p-1.5 hover:bg-[#251e2c] text-brass-300 hover:text-gold-300 rounded-lg transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <button
                onClick={handleResetZoom}
                title="Reset Zoom & Pan"
                className="p-1.5 hover:bg-[#251e2c] text-copper-400 hover:text-copper-300 rounded-lg transition-colors border-l border-[#382f25]"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <FoxgloveCanvas
            robotHost={selectedRobotHost}
            foxglovePort={8765}
            layoutPreset="amr_3d_monitoring"
            robotName={activeRobot?.name || 'anzym_rosorin_01'}
          />
        )}
      </div>
    </div>
  );
}