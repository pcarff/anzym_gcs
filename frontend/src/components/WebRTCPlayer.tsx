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
  const [streamMode, setStreamMode] = useState<'webrtc' | 'mjpeg'>(
    platformType === 'anzym_rosorin' ? 'mjpeg' : 'webrtc'
  );
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
          setStreamMode('mjpeg');
          setConnectionState('connected');
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
      console.warn('[WebRTC] WHEP connection failed, falling back to MJPEG:', err);
      setStreamMode('mjpeg');
      setConnectionState('connected');
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
    <div className="bg-[#131118] border border-[#4a3d2e] rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
      {/* Stream Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-[#16131c] via-[#1f1a27] to-[#16131c] border-b border-[#4a3d2e] flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-gradient-to-br from-brass-500/20 to-copper-500/20 border border-brass-500/40 rounded-lg text-gold-400 shadow-brass-sm">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-gold-400 flex items-center gap-2">
              <span>{robotName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded border border-brass-700/50 bg-[#251e16] text-brass-300 font-mono">
                {platformType}
              </span>
            </h3>
            <div className="flex items-center gap-2 text-xs text-steampunk-parchment-muted font-mono">
              <span>{topic}</span>
              {latencyMs !== null && streamMode === 'webrtc' && (
                <span className="text-[10px] text-[#2ec4b6] font-mono font-semibold">
                  ({latencyMs}ms latency)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Protocol Selector & Status */}
        <div className="flex items-center space-x-2.5">
          {/* WebRTC vs MJPEG Toggle */}
          <div className="bg-[#0a090d] border border-[#382f25] rounded-lg p-0.5 flex text-xs font-mono shadow-gauge-inset">
            <button
              onClick={() => setStreamMode('webrtc')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-all ${
                streamMode === 'webrtc'
                  ? 'steampunk-btn-brass'
                  : 'text-steampunk-parchment-muted hover:text-gold-300'
              }`}
              title="Fast WebRTC H.264 Protocol"
            >
              <Zap className="w-3 h-3" />
              <span>WebRTC</span>
            </button>
            <button
              onClick={() => setStreamMode('mjpeg')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-all ${
                streamMode === 'mjpeg'
                  ? 'steampunk-btn-copper'
                  : 'text-steampunk-parchment-muted hover:text-gold-300'
              }`}
              title="HTTP MJPEG Fallback Stream"
            >
              <Radio className="w-3 h-3" />
              <span>MJPEG</span>
            </button>
          </div>

          {/* Connection Status Badge */}
          <div className={`flex items-center space-x-1.5 text-xs px-2.5 py-1 rounded-md font-mono font-bold border ${
            connectionState === 'connected'
              ? 'bg-[#0f2420] text-[#2ec4b6] border-[#2ec4b6]/50 shadow-[0_0_8px_rgba(46,196,182,0.25)]'
              : connectionState === 'connecting'
              ? 'bg-[#281b0e] text-[#f59e0b] border-[#f59e0b]/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
              : connectionState === 'error'
              ? 'bg-[#291010] text-[#ef4444] border-[#ef4444]/50 shadow-[0_0_8px_rgba(239,68,68,0.25)]'
              : 'bg-[#18151f] text-[#8e8271] border-[#382f25]'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              connectionState === 'connected' ? 'bg-[#2ec4b6] shadow-[0_0_6px_#2ec4b6] animate-pulse'
              : connectionState === 'connecting' ? 'bg-[#f59e0b] shadow-[0_0_6px_#f59e0b] animate-ping'
              : connectionState === 'error' ? 'bg-[#ef4444] shadow-[0_0_6px_#ef4444]'
              : 'bg-[#8e8271]'
            }`} />
            <span>{connectionState === 'connected' ? 'LIVE' : connectionState.toUpperCase()}</span>
          </div>

          <button
            onClick={handleReconnect}
            className="p-1.5 hover:bg-[#251e2c] rounded-lg text-brass-300 hover:text-gold-300 transition-colors"
            title="Reconnect Stream"
          >
            <RefreshCw className={`w-4 h-4 ${connectionState === 'connecting' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Video Viewport */}
      <div className="relative flex-1 bg-[#070609] flex items-center justify-center min-h-[220px] overflow-hidden border-t border-[#26201a]">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0c0b0e]/95 space-y-3">
                <div className={`p-3 border rounded-full ${
                  connectionState === 'error'
                    ? 'bg-[#291010] border-[#ef4444]/40 text-[#ef4444]'
                    : 'bg-[#281b0e] border-[#f59e0b]/40 text-[#f59e0b]'
                }`}>
                  <Video className="w-8 h-8 opacity-75" />
                </div>
                <div>
                  <h4 className="text-sm font-serif font-bold text-gold-400">
                    {connectionState === 'error' ? 'Optical Transmission Offline' : 'Calibrating WebRTC Signal...'}
                  </h4>
                  <p className="text-xs text-steampunk-parchment-muted mt-1 max-w-sm font-mono">
                    {connectionState === 'error' ? (
                      <>MediaMTX relay node at <span className="font-mono text-gold-300 font-bold">{effectiveHost}:{webrtcPort}</span> is unreachable.</>
                    ) : (
                      <>Connecting via WHEP H.264 protocol to <span className="font-mono text-gold-300 font-bold">{effectiveHost}:{webrtcPort}</span>...</>
                    )}
                  </p>
                </div>
                {connectionState === 'error' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStreamMode('mjpeg')}
                      className="steampunk-btn-copper px-3 py-1.5 text-xs font-serif font-bold rounded-lg"
                    >
                      Switch to MJPEG Mode
                    </button>
                    <button
                      onClick={handleReconnect}
                      className="steampunk-btn-brass px-3 py-1.5 text-xs font-serif font-bold rounded-lg"
                    >
                      Retry WebRTC Link
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 text-[#8e8271]">
            <ShieldAlert className="w-10 h-10 text-[#6e5329]" />
            <div>
              <p className="text-sm font-serif font-bold text-gold-400">Optical Sensor Offline</p>
              <p className="text-xs text-steampunk-parchment-muted font-mono mt-1">Automaton is offline</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

