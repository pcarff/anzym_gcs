import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, RefreshCw, ShieldAlert, Zap, Radio } from 'lucide-react';

interface WebRTCPlayerProps {
  robotId?: string;
  robotName?: string;
  robotHost?: string;
  streamUrl?: string;
  topic?: string;
  platformType?: string;
  isRobotOnline?: boolean;
  videoPort?: number;
  webrtcPort?: number;
}

export const WebRTCPlayer: React.FC<WebRTCPlayerProps> = ({
  robotId = 'robot-1',
  robotName = 'rosorin-01',
  robotHost = '192.168.8.162',
  streamUrl,
  topic = '/depth_cam/rgb0/image_raw',
  platformType = 'anzym_rosorin',
  isRobotOnline = true,
  videoPort = 8080,
  webrtcPort = 8889,
}) => {
  const [streamMode, setStreamMode] = useState<'webrtc' | 'mjpeg'>('webrtc');
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  const [retryCount, setRetryCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveHost = robotHost || (robotId.includes('192') ? robotId : (robotId.includes('x3') || platformType === 'anzym_x3_plus' || platformType === 'anzym_x3' ? '192.168.8.246' : '192.168.8.162'));
  const whepUrl = `http://${effectiveHost}:${webrtcPort}/robot_cam/whep`;
  const mjpegUrl = `http://${effectiveHost}:${videoPort}/stream?topic=${encodeURIComponent(topic)}`;

  // Clean up existing WebRTC connection
  const stopWebRTC = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Connect via WebRTC (WHEP Protocol)
  const startWebRTC = useCallback(async () => {
    stopWebRTC();
    if (!effectiveHost || !isRobotOnline) {
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');
    const startTime = performance.now();

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
        bundlePolicy: 'max-bundle',
      });
      peerConnectionRef.current = pc;

      // Request video track from robot
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
          setConnectionState('connected');
          setLatencyMs(Math.round(performance.now() - startTime));
          setRetryCount(0);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setConnectionState('connected');
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setConnectionState('error');
        }
      };

      // Create local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for complete ICE gathering before posting offer
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkIce = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', checkIce);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', checkIce);
          // Timeout after 800ms to avoid long delays
          setTimeout(resolve, 800);
        }
      });

      // Post SDP offer to MediaMTX WHEP endpoint
      const response = await fetch(whepUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
        },
        body: pc.localDescription?.sdp || offer.sdp,
      });

      if (!response.ok) {
        throw new Error(`WHEP HTTP ${response.status}`);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: answerSdp,
      }));
    } catch (err) {
      console.warn('[WebRTC] WHEP connection failed, falling back to MJPEG if needed:', err);
      setConnectionState('error');
    }
  }, [effectiveHost, isRobotOnline, whepUrl, stopWebRTC]);

  // Handle stream mode & reconnects
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!isRobotOnline) {
      setConnectionState('disconnected');
      stopWebRTC();
      return;
    }

    if (streamMode === 'webrtc') {
      startWebRTC();
    } else {
      stopWebRTC();
      setConnectionState('connected');
    }

    return () => {
      stopWebRTC();
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [streamMode, isRobotOnline, effectiveHost, retryCount, startWebRTC, stopWebRTC]);

  const handleReconnect = () => {
    setRetryCount((c) => c + 1);
    if (streamMode === 'webrtc') {
      startWebRTC();
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
      {/* Stream Header */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>{robotName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                {platformType}
              </span>
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>{topic}</span>
              {latencyMs !== null && streamMode === 'webrtc' && (
                <span className="text-[10px] text-emerald-400 font-sans">
                  ({latencyMs}ms latency)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Protocol Selector & Status */}
        <div className="flex items-center space-x-2.5">
          {/* WebRTC vs MJPEG Toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-0.5 flex text-xs font-mono">
            <button
              onClick={() => setStreamMode('webrtc')}
              className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                streamMode === 'webrtc'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Fast WebRTC H.264 Protocol"
            >
              <Zap className="w-3 h-3" />
              <span>WebRTC</span>
            </button>
            <button
              onClick={() => setStreamMode('mjpeg')}
              className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                streamMode === 'mjpeg'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="HTTP MJPEG Fallback Stream"
            >
              <Radio className="w-3 h-3" />
              <span>MJPEG</span>
            </button>
          </div>

          {/* Connection Status Badge */}
          <div className={`flex items-center space-x-1.5 text-xs px-2.5 py-1 rounded-md font-medium border ${
            connectionState === 'connected'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : connectionState === 'connecting'
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : connectionState === 'error'
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              connectionState === 'connected' ? 'bg-emerald-400 animate-pulse'
              : connectionState === 'connecting' ? 'bg-amber-400 animate-ping'
              : connectionState === 'error' ? 'bg-rose-400'
              : 'bg-slate-500'
            }`} />
            <span>{connectionState === 'connected' ? 'LIVE' : connectionState.toUpperCase()}</span>
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

      {/* Video Viewport */}
      <div className="relative flex-1 bg-black flex items-center justify-center min-h-[220px] overflow-hidden">
        {isRobotOnline ? (
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Mode 1: Fast WebRTC H.264 Video */}
            {streamMode === 'webrtc' && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain max-h-[400px] ${
                  connectionState === 'connected' ? 'block' : 'hidden'
                }`}
              />
            )}

            {/* Mode 2: MJPEG HTTP Video Fallback */}
            {streamMode === 'mjpeg' && (
              <img
                src={mjpegUrl}
                alt="Robot Camera Stream"
                className="w-full h-full object-contain max-h-[400px]"
              />
            )}

            {/* Connecting / Error Fallback Overlay */}
            {connectionState !== 'connected' && streamMode === 'webrtc' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90 space-y-3">
                <div className={`p-3 border rounded-full ${
                  connectionState === 'error'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                }`}>
                  <Video className="w-8 h-8 opacity-60" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    {connectionState === 'error' ? 'WebRTC Stream Offline' : 'Negotiating WebRTC Connection...'}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {connectionState === 'error' ? (
                      <>MediaMTX WebRTC server at <span className="font-mono text-amber-300">{effectiveHost}:{webrtcPort}</span> is unreachable.</>
                    ) : (
                      <>Connecting via WHEP H.264 to <span className="font-mono text-amber-300">{effectiveHost}:{webrtcPort}</span>...</>
                    )}
                  </p>
                </div>
                {connectionState === 'error' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStreamMode('mjpeg')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow"
                    >
                      Switch to MJPEG Mode
                    </button>
                    <button
                      onClick={handleReconnect}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700"
                    >
                      Retry WebRTC
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500">
            <ShieldAlert className="w-10 h-10 text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-400">Camera Stream Offline</p>
              <p className="text-xs text-slate-500 font-mono mt-1">Robot is offline</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
