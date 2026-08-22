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
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply Pan & Zoom Transform
      ctx.translate(canvas.width / 2 + panOffset.x, canvas.height / 2 + panOffset.y);
      ctx.scale(zoomLevel, zoomLevel);

      // 1. Draw Grid (centered at origin, 1 meter grid lines = 35px)
      const pxPerMeter = 35;
      const gridExtent = 1200;
      ctx.strokeStyle = '#1e293b';
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

      // Draw Metric Axes Crosshair
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5 / zoomLevel;
      ctx.beginPath();
      ctx.moveTo(-gridExtent, 0);
      ctx.lineTo(gridExtent, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -gridExtent);
      ctx.lineTo(0, gridExtent);
      ctx.stroke();

      // Draw Home Origin (0,0) Marker
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(0, 0, 4 / zoomLevel, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = `${Math.max(9, 10 / zoomLevel)}px monospace`;
      ctx.fillText('(0,0) Origin', 6 / zoomLevel, -6 / zoomLevel);

      // 2. Draw Real-time Planned Path Polyline (/plan)
      if (showPathOverlay && plannedPath && plannedPath.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3 / zoomLevel;
        ctx.setLineDash([6 / zoomLevel, 4 / zoomLevel]);
        ctx.shadowColor = '#0284c7';
        ctx.shadowBlur = 8;

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

        // Animated Beacon Pulse Ring
        ctx.save();
        ctx.translate(goalScreenX, goalScreenY);

        const ringRadius = (12 + Math.sin(pulseAngle) * 4) / zoomLevel;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.arc(0, 0, ringRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // Goal Pin Center
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(0, 0, 6 / zoomLevel, 0, 2 * Math.PI);
        ctx.fill();

        // Goal Heading Orientation Arrow
        if (activeNavGoal.theta !== undefined) {
          ctx.rotate(-activeNavGoal.theta);
          ctx.strokeStyle = '#38bdf8';
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
        ctx.fillStyle = '#38bdf8';
        ctx.font = `${Math.max(10, 11 / zoomLevel)}px monospace`;
        ctx.fillText(
          `🎯 Goal: (${activeNavGoal.x.toFixed(1)}m, ${activeNavGoal.y.toFixed(1)}m)`,
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
        // Destination Pin Preview
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(startScreenX, startScreenY, 6 / zoomLevel, 0, 2 * Math.PI);
        ctx.fill();

        // Heading Vector Line
        ctx.strokeStyle = '#f59e0b';
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

              // Laser ray
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
              ctx.lineWidth = 0.5 / zoomLevel;
              ctx.moveTo(0, 0);
              ctx.lineTo(hitX, hitY);
              ctx.stroke();

              // Laser Point
              ctx.beginPath();
              ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#10b981';
              ctx.arc(hitX, hitY, 2.5 / zoomLevel, 0, 2 * Math.PI);
              ctx.fill();
            });

            ctx.restore();
          }
        }

        // Draw Robot Body Triangle
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(-robot.position.theta);

        const colors: Record<string, string> = {
          ONLINE: '#10b981',
          OFFLINE: '#ef4444',
          BUSY: '#f59e0b',
          ERROR: '#dc2626',
          IDLE: '#6366f1',
        };
        ctx.fillStyle = colors[robot.status] || '#94a3b8';

        ctx.beginPath();
        ctx.moveTo(16 / zoomLevel, 0);
        ctx.lineTo(-10 / zoomLevel, -10 / zoomLevel);
        ctx.lineTo(-10 / zoomLevel, 10 / zoomLevel);
        ctx.closePath();
        ctx.fill();

        // Highlight ring around selected robot
        if (isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2 / zoomLevel;
          ctx.arc(0, 0, 20 / zoomLevel, 0, 2 * Math.PI);
          ctx.stroke();
        }

        ctx.restore();

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = `${Math.max(10, Math.min(14, 12 / zoomLevel))}px monospace`;
        ctx.fillText(robot.name || robot.id, screenX - 20, screenY - 25 / zoomLevel);
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
      <div className="mb-3 flex items-center justify-between bg-slate-900/80 p-2 rounded-xl border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 px-2">
          <Compass className="w-4 h-4 text-blue-400" />
          <span>Autonomous Navigation & Spatial Map</span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Interaction Mode Toggle */}
          {viewMode === 'native' && (
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setInteractMode('nav_goal')}
                title="Click and drag on map to dispatch autonomous navigation goal"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  interactMode === 'nav_goal'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Nav Goal Mode</span>
              </button>

              <button
                onClick={() => setInteractMode('pan')}
                title="Pan and inspect canvas map"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  interactMode === 'pan'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    : 'text-slate-400 hover:text-slate-200'
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
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                showLidarOverlay
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${showLidarOverlay ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>LiDAR Overlay</span>
            </button>
          )}

          {/* View Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('native')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                viewMode === 'native'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Native Map</span>
            </button>

            <button
              onClick={() => setViewMode('foxglove')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                viewMode === 'foxglove'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                  : 'text-slate-400 hover:text-slate-200'
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
              className={`w-full h-full border border-slate-800 rounded-xl shadow-inner bg-slate-950 block ${
                interactMode === 'nav_goal' ? 'cursor-crosshair' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            />

            {/* Info Badge */}
            <div className="absolute top-4 left-4 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl text-slate-200 text-xs space-y-1.5 shadow-xl pointer-events-none">
              <div className="font-semibold text-slate-100 flex items-center justify-between gap-4">
                <span>Active Target: {activeRobot?.name || activeRobot?.id}</span>
                <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">
                  {activeRobot?.platform_type || 'anzym_rosorin'}
                </span>
              </div>
              <div className="text-slate-400 text-[11px] flex items-center gap-2">
                <span>Mode: <strong className="text-emerald-400">{interactMode === 'nav_goal' ? 'Click & Drag Target Goal' : 'Pan & Zoom'}</strong></span>
                <span>•</span>
                <span className="text-blue-400 font-mono">
                  Pos: ({activeRobot?.position?.x?.toFixed(2) || '0.00'}, {activeRobot?.position?.y?.toFixed(2) || '0.00'})
                </span>
                {hoverWorldPos && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400 font-mono font-semibold">
                      Cursor: ({hoverWorldPos.x.toFixed(2)}m, {hoverWorldPos.y.toFixed(2)}m)
                    </span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-slate-500 italic pt-1">
                {interactMode === 'nav_goal'
                  ? 'Click & drag cursor to set destination waypoint and heading angle'
                  : 'Left click & drag to pan • Scroll wheel to zoom'}
              </div>
            </div>

            {/* Floating Navigation Control HUD */}
            <div className="absolute top-4 right-4 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-2 rounded-xl text-slate-200 text-xs flex items-center space-x-2 shadow-2xl">
              {navStatus === 'NAVIGATING' ? (
                <div className="flex items-center space-x-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-emerald-300 font-medium text-[11px]">Navigating to Goal</span>
                  <button
                    onClick={handleCancelGoal}
                    className="flex items-center space-x-1 px-2 py-0.5 bg-red-600/80 hover:bg-red-600 text-white rounded text-[10px] font-semibold transition-colors"
                  >
                    <XOctagon className="w-3 h-3" />
                    <span>Cancel Goal</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleReturnHome}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium text-xs border border-slate-700 transition-colors"
                >
                  <Home className="w-3.5 h-3.5 text-blue-400" />
                  <span>Return Home (0,0)</span>
                </button>
              )}
            </div>

            {/* Canvas Zoom Controls Bar */}
            <div className="absolute bottom-4 right-4 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-1.5 rounded-xl text-slate-200 text-xs flex items-center space-x-1 shadow-2xl">
              <button
                onClick={handleZoomIn}
                title="Zoom In"
                className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <span className="px-2 font-mono text-xs text-blue-400 font-semibold border-x border-slate-800">
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                onClick={handleZoomOut}
                title="Zoom Out"
                className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <button
                onClick={handleResetZoom}
                title="Reset Zoom & Pan"
                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors border-l border-slate-800"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <FoxgloveCanvas
            robotHost={selectedRobotHost}
            foxglovePort={9090}
            layoutPreset="amr_3d_monitoring"
            robotName={activeRobot?.name || 'anzym_rosorin_01'}
          />
        )}
      </div>
    </div>
  );
}