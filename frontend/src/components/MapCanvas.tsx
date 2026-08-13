/** MapCanvas component - 2D/3D map visualization with robot markers */

import { useEffect, useRef, useCallback } from 'react';
import { useFleetStore } from '../store/useFleetStore';
import { Waypoint } from '../types';

interface MapCanvasProps {
  mapboxToken?: string;
  onCoordinateClick?: (x: number, y: number) => void;
}

export function MapCanvas({ mapboxToken, onCoordinateClick }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedMapType = useFleetStore((state) => state.selectedMapType);
  const robots = useFleetStore((state) => state.robots);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !onCoordinateClick) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      // Convert to world coordinates (assuming 100x100 meter map)
      const worldX = (x - 0.5) * 200;
      const worldY = (y - 0.5) * 200;

      onCoordinateClick(worldX, worldY);
    },
    [onCoordinateClick]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render loop
    let animationId: number;
    const render = () => {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid
      ctx.strokeStyle = '#2d2d5e';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      // Draw robots
      Object.values(robots).forEach((robot) => {
        const screenX = canvas.width / 2 + robot.position.x * canvas.width / 200;
        const screenY = canvas.height / 2 - robot.position.y * canvas.height / 200;

        // Robot body
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(-robot.position.theta);

        // Color by status
        const colors: Record<string, string> = {
          ONLINE: '#00ff88',
          OFFLINE: '#ff4444',
          BUSY: '#ffaa00',
          ERROR: '#ff0000',
          IDLE: '#8888ff',
        };
        ctx.fillStyle = colors[robot.status] || '#888888';

        // Draw robot triangle
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-10, -10);
        ctx.lineTo(-10, 10);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Robot label
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText(robot.name || robot.id, screenX - 20, screenY - 20);
        ctx.fillText(`BAT: ${robot.battery}%`, screenX - 20, screenY + 30);
      });

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [robots]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onClick={handleClick}
        className="w-full h-full border border-gray-700 rounded-lg"
      />
      <div className="absolute top-4 left-4 bg-black bg-opacity-70 p-2 rounded text-white text-sm">
        <div>Robots: {Object.keys(robots).length}</div>
        <div>Map: {selectedMapType}</div>
        <div className="text-xs text-gray-400 mt-1">Click to set waypoint</div>
      </div>
    </div>
  );
}