import React, { useState, useEffect, useRef } from 'react';
import { Video, RefreshCw, ShieldAlert, Signal, Settings, Maximize2 } from 'lucide-react';

interface WebRTCPlayerProps {
  robotId?: string;
  robotName?: string;
  streamUrl?: string;
  topic?: string;
  platformType?: string;
  isRobotOnline?: boolean;
}

export const WebRTCPlayer: React.FC<WebRTCPlayerProps> = ({
  robotId = 'robot-1',
  robotName = 'anzym_rosorin_01',
  streamUrl = 'ws://localhost:8554/webrtc',
  topic = '/depth_cam/rgb0/image_raw',
  platformType = 'anzym_rosorin',
  isRobotOnline = true,
}) => {
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [fps, setFps] = useState<number>(30);
  const [latencyMs, setLatencyMs] = useState<number>(45);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startStream = () => {
    if (!isRobotOnline) {
      setConnectionState('disconnected');
      setIsStreaming(false);
      return;
    }
    setConnectionState('connecting');
    const timer = setTimeout(() => {
      setConnectionState('connected');
      setIsStreaming(true);
    }, 800);
    return () => clearTimeout(timer);
  };

  const stopStream = () => {
    setIsStreaming(false);
    setConnectionState('disconnected');
  };

  useEffect(() => {
    if (isRobotOnline) {
      startStream();
    } else {
      stopStream();
    }
  }, [robotId, streamUrl, isRobotOnline]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
      {/* Stream Header */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>{robotName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                {platformType}
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">{topic}</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400">
            <Signal className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>{latencyMs} ms</span>
          </div>

          <div className="flex items-center space-x-1 text-xs px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>{connectionState.toUpperCase()}</span>
          </div>

          <button
            onClick={isStreaming ? stopStream : startStream}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            title="Reconnect Stream"
          >
            <RefreshCw className={`w-4 h-4 ${connectionState === 'connecting' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Video Stream Viewport */}
      <div className="relative flex-1 bg-slate-950 flex items-center justify-center min-h-[220px]">
        {isStreaming ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
            {/* Try loading live MJPEG stream from robot web_video_server on port 8080 */}
            <img
              src={`http://${robotId.includes('192') ? robotId : '192.168.8.162'}:8080/stream?topic=${encodeURIComponent(topic)}`}
              alt="Camera Stream"
              onError={(e) => {
                // If web_video_server is not running or camera node died
                (e.target as HTMLElement).style.display = 'none';
                const fallback = document.getElementById('camera-standby-fallback');
                if (fallback) fallback.style.display = 'flex';
              }}
              className="w-full h-full object-contain"
            />

            {/* Diagnostic Standby Overlay when camera hardware is offline */}
            <div
              id="camera-standby-fallback"
              className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3 bg-slate-950/90"
            >
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400">
                <Video className="w-8 h-8 opacity-60" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Camera Feed Standby</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Physical depth camera sensor node is offline or waiting for USB initialization on <span className="font-mono text-amber-300">{robotName}</span>.
                </p>
                <div className="text-[11px] font-mono text-slate-500 mt-2 bg-slate-900 border border-slate-800 p-2 rounded-lg inline-block">
                  TOPIC: {topic}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500">
            <ShieldAlert className="w-10 h-10 text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-400">Camera Stream Offline</p>
              <p className="text-xs text-slate-500 font-mono mt-1">Robot offline or video pipeline stopped</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
