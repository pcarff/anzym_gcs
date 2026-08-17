import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, RefreshCw, ShieldAlert, Signal, Settings, Maximize2 } from 'lucide-react';

interface WebRTCPlayerProps {
  robotId?: string;
  robotName?: string;
  robotHost?: string;
  streamUrl?: string;
  topic?: string;
  platformType?: string;
  isRobotOnline?: boolean;
  videoPort?: number;
}

export const WebRTCPlayer: React.FC<WebRTCPlayerProps> = ({
  robotId = 'robot-1',
  robotName = 'anzym_rosorin_01',
  robotHost,
  streamUrl,
  topic = '/depth_cam/rgb0/image_raw',
  platformType = 'anzym_rosorin',
  isRobotOnline = true,
  videoPort = 8080,
}) => {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the MJPEG stream URL from the robot's host IP
  const buildStreamUrl = useCallback((): string | null => {
    // Prefer explicit streamUrl prop if provided
    if (streamUrl && !streamUrl.includes('webrtc')) {
      return streamUrl;
    }
    // Use the robot's actual host IP for web_video_server MJPEG stream
    const host = robotHost;
    if (!host) return null;
    return `http://${host}:${videoPort}/stream?topic=${encodeURIComponent(topic)}`;
  }, [robotHost, streamUrl, topic, videoPort]);

  const mjpegUrl = buildStreamUrl();

  const handleImgLoad = useCallback(() => {
    setConnectionState('connected');
    setRetryCount(0);
  }, []);

  const handleImgError = useCallback(() => {
    setConnectionState('error');
    // Auto-retry after a delay (up to 5 retries)
    if (retryCount < 5) {
      retryTimerRef.current = setTimeout(() => {
        setRetryCount((c) => c + 1);
      }, 3000);
    }
  }, [retryCount]);

  // Reset state when robot or topic changes
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (isRobotOnline && mjpegUrl) {
      setConnectionState('connecting');
      setRetryCount(0);
    } else {
      setConnectionState('disconnected');
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [robotId, robotHost, topic, isRobotOnline, mjpegUrl]);

  const handleReconnect = () => {
    setRetryCount(0);
    if (isRobotOnline && mjpegUrl) {
      setConnectionState('connecting');
    }
  };

  const isStreaming = isRobotOnline && mjpegUrl && connectionState !== 'disconnected';
  // Append retry count to URL to force browser to re-fetch on retry
  const imgSrc = mjpegUrl ? `${mjpegUrl}&_retry=${retryCount}` : '';

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
          {robotHost && (
            <div className="text-xs text-slate-500 font-mono">
              {robotHost}:{videoPort}
            </div>
          )}

          <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-md font-medium border ${
            connectionState === 'connected'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : connectionState === 'connecting'
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : connectionState === 'error'
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              connectionState === 'connected' ? 'bg-emerald-400 animate-pulse'
              : connectionState === 'connecting' ? 'bg-amber-400 animate-ping'
              : connectionState === 'error' ? 'bg-rose-400'
              : 'bg-slate-500'
            }`} />
            <span>{connectionState.toUpperCase()}</span>
          </div>

          <button
            onClick={handleReconnect}
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
            {/* MJPEG stream from robot's web_video_server */}
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Camera Stream"
              onLoad={handleImgLoad}
              onError={handleImgError}
              className={`w-full h-full object-contain ${connectionState !== 'connected' ? 'hidden' : ''}`}
            />

            {/* Diagnostic Standby Overlay when camera feed is not yet connected or errored */}
            {connectionState !== 'connected' && (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3 bg-slate-950/90">
                <div className={`p-3 border rounded-full ${
                  connectionState === 'error'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                }`}>
                  <Video className="w-8 h-8 opacity-60" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    {connectionState === 'error' ? 'Camera Feed Unavailable' : 'Connecting to Camera...'}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {connectionState === 'error'
                      ? <>Camera sensor node is offline or <span className="font-mono text-amber-300">web_video_server</span> is not running on <span className="font-mono text-amber-300">{robotName}</span>.</>
                      : <>Connecting to video stream on <span className="font-mono text-amber-300">{robotHost || 'unknown host'}</span>...</>
                    }
                  </p>
                  <div className="text-[11px] font-mono text-slate-500 mt-2 bg-slate-900 border border-slate-800 p-2 rounded-lg inline-block">
                    {robotHost ? `${robotHost}:${videoPort}` : 'No host IP'} → {topic}
                  </div>
                  {connectionState === 'error' && retryCount < 5 && (
                    <p className="text-[10px] text-slate-500 mt-2">
                      Auto-retrying... ({retryCount}/5)
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500">
            <ShieldAlert className="w-10 h-10 text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-400">
                {!isRobotOnline ? 'Camera Stream Offline' : 'No Host IP Available'}
              </p>
              <p className="text-xs text-slate-500 font-mono mt-1">
                {!isRobotOnline
                  ? 'Robot offline or video pipeline stopped'
                  : 'Robot host IP not yet received from backend'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
