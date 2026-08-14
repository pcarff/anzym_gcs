import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useFleetStore } from '../store/useFleetStore';
import { FoxgloveCanvas } from './FoxgloveCanvas';
import { Layers, Sparkles, MapPin, Radio, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface MapCanvasProps {
  mapboxToken?: string;
  onCoordinateClick?: (x: number, y: number) => void;
  selectedRobotHost?: string;
}

export function MapCanvas({ mapboxToken, onCoordinateClick, selectedRobotHost = '192.168.8.162' }: MapCanvasProps) {
  const [viewMode, setViewMode] = useState<'native' | 'foxglove'>('native');
  const [showLidarOverlay, setShowLidarOverlay] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedMapType = useFleetStore((state) => state.selectedMapType);
  const robots = useFleetStore((state) => state.robots);
  const selectedRobotId = useFleetStore((state) => state.selectedRobotId);

  const activeRobot = selectedRobotId ? robots[selectedRobotId] : Object.values(robots)[0];
  const hasLidar = activeRobot?.platform_type === 'anzym_rosorin' || activeRobot?.enabled_plugins?.includes('lidar_2d_3d') || true;

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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Left click drag
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !onCoordinateClick || isDragging) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Adjust for pan and zoom
      const centerX = canvas.width / 2 + panOffset.x;
      const centerY = canvas.height / 2 + panOffset.y;

      const normX = (clickX - centerX) / (zoomLevel * canvas.width);
      const normY = (clickY - centerY) / (zoomLevel * canvas.height);

      const worldX = normX * 200;
      const worldY = -normY * 200;

      onCoordinateClick(worldX, worldY);
    },
    [onCoordinateClick, isDragging, panOffset, zoomLevel]
  );

  useEffect(() => {
    if (viewMode !== 'native') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let scanAngleOffset = 0;
    let animationId: number;

    const render = () => {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply Pan & Zoom Transform
      ctx.translate(canvas.width / 2 + panOffset.x, canvas.height / 2 + panOffset.y);
      ctx.scale(zoomLevel, zoomLevel);

      // Draw Grid (centered at origin)
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1 / zoomLevel;
      const gridExtent = 800;
      const gridStep = 40;
      for (let i = -gridExtent; i <= gridExtent; i += gridStep) {
        ctx.beginPath();
        ctx.moveTo(i, -gridExtent);
        ctx.lineTo(i, gridExtent);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-gridExtent, i);
        ctx.lineTo(gridExtent, i);
        ctx.stroke();
      }

      // Draw Origin Axis Cross
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

      // Draw robots & LiDAR overlays
      Object.values(robots).forEach((robot) => {
        const isSelected = selectedRobotId === robot.id;
        const screenX = robot.position.x * 3.5;
        const screenY = -robot.position.y * 3.5;

        // Render LiDAR Scan for active selected robot
        if (isSelected && showLidarOverlay && hasLidar) {
          ctx.save();
          ctx.translate(screenX, screenY);

          scanAngleOffset += 0.02;
          const hasRealScan = robot.scan && Array.isArray(robot.scan.ranges) && robot.scan.ranges.length > 0;

          if (hasRealScan) {
            // Plot real ROS2 LaserScan ranges
            const scanData = robot.scan!;
            const ranges = scanData.ranges;
            const angleMin = scanData.angle_min ?? -Math.PI;
            const angleInc = scanData.angle_increment ?? (2 * Math.PI) / ranges.length;

            ranges.forEach((rangeMeters, i) => {
              if (!rangeMeters || rangeMeters <= (scanData.range_min || 0.05) || rangeMeters >= (scanData.range_max || 40)) {
                return;
              }
              const angle = angleMin + i * angleInc;
              const screenDist = rangeMeters * 35;

              const hitX = Math.cos(angle) * screenDist;
              const hitY = Math.sin(angle) * screenDist;

              // Laser ray line
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(16, 185, 129, 0.12)';
              ctx.lineWidth = 0.5 / zoomLevel;
              ctx.moveTo(0, 0);
              ctx.lineTo(hitX, hitY);
              ctx.stroke();

              // Real LiDAR Point Cloud Hit
              ctx.beginPath();
              ctx.fillStyle = i % 4 === 0 ? 'rgba(56, 189, 248, 0.95)' : 'rgba(16, 185, 129, 0.95)';
              ctx.arc(hitX, hitY, 2.5 / zoomLevel, 0, 2 * Math.PI);
              ctx.fill();
            });
          } else {
            // Simulated 360-degree LiDAR Rays & Range Hits
            const numRays = 180;
            for (let i = 0; i < numRays; i++) {
              const angle = (i * (2 * Math.PI)) / numRays + scanAngleOffset;
              
              const obstacleSeed = Math.sin(angle * 5) * Math.cos(angle * 3);
              const distMeters = 15 + obstacleSeed * 12 + (Math.sin(angle * 8) > 0.5 ? -6 : 4);
              const screenDist = distMeters * 35;

              const hitX = Math.cos(angle) * screenDist;
              const hitY = Math.sin(angle) * screenDist;

              // Faint laser ray line
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
              ctx.lineWidth = 0.5 / zoomLevel;
              ctx.moveTo(0, 0);
              ctx.lineTo(hitX, hitY);
              ctx.stroke();

              // LiDAR Point Cloud Hit
              ctx.beginPath();
              ctx.fillStyle = i % 7 === 0 ? 'rgba(56, 189, 248, 0.9)' : 'rgba(16, 185, 129, 0.85)';
              ctx.arc(hitX, hitY, 1.8 / zoomLevel, 0, 2 * Math.PI);
              ctx.fill();
            }
          }

          // LiDAR Sweeping Radar Sweep Arc
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 75, scanAngleOffset, scanAngleOffset + 0.5);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
          ctx.fill();

          ctx.restore();
        }

        // Draw Robot Body
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

        // Robot triangle
        ctx.beginPath();
        ctx.moveTo(15 / zoomLevel, 0);
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
        ctx.fillText(`BAT: ${robot.battery}%`, screenX - 20, screenY + 32 / zoomLevel);
      });

      ctx.restore(); // Restore main canvas transform

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [robots, viewMode, showLidarOverlay, selectedRobotId, hasLidar, zoomLevel, panOffset]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Header View Switcher */}
      <div className="mb-3 flex items-center justify-between bg-slate-900/80 p-2 rounded-xl border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 px-2">
          <MapPin className="w-4 h-4 text-blue-400" />
          <span>Mapping & Spatial Visualization</span>
        </div>

        <div className="flex items-center space-x-2">
          {/* LiDAR Overlay Toggle Button */}
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
              <span>2D LiDAR Scan Overlay</span>
            </button>
          )}

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
              <span>Native Map Canvas</span>
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
              <span>Foxglove Studio 3D</span>
            </button>
          </div>
        </div>
      </div>

      {/* Viewport Content */}
      <div className="relative flex-1 min-h-[400px]">
        {viewMode === 'native' ? (
          <div className="relative w-full h-full">
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onClick={handleClick}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`w-full h-full border border-slate-800 rounded-xl shadow-inner bg-slate-950 ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            />
            
            {/* Map Info Overlay */}
            <div className="absolute top-4 left-4 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl text-slate-200 text-xs space-y-1.5">
              <div className="font-semibold text-slate-100 flex items-center justify-between gap-4">
                <span>Selected: {activeRobot?.name || activeRobot?.id}</span>
                <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">
                  {activeRobot?.platform_type || 'anzym_rosorin'}
                </span>
              </div>
              <div className="text-slate-400 text-[11px] flex items-center gap-2">
                <span>Active Fleet: {Object.keys(robots).length}</span>
                <span>•</span>
                <span className="text-emerald-400 font-mono">
                  {showLidarOverlay ? 'LiDAR /scan (15Hz)' : 'LiDAR hidden'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 italic pt-1">
                Scroll mouse wheel to Zoom • Left click & drag to Pan
              </div>
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