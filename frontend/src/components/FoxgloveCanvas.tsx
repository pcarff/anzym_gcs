import React, { useState } from 'react';
import { ExternalLink, Cpu, Sparkles, MonitorPlay, CheckCircle2, Copy, Download } from 'lucide-react';

interface FoxgloveCanvasProps {
  robotHost?: string;
  foxglovePort?: number;
  layoutPreset?: string;
  robotName?: string;
}

export const FoxgloveCanvas: React.FC<FoxgloveCanvasProps> = ({
  robotHost = '192.168.8.162',
  foxglovePort = 8765,
  layoutPreset = 'amr_3d_monitoring',
  robotName = 'rosorin-01',
}) => {
  const [copied, setCopied] = useState(false);
  const foxgloveWsUrl = `ws://${robotHost}:${foxglovePort}`;
  const layoutUrl = 'http://localhost:8000/api/foxglove-lidar-layout.json';
  const foxgloveAppUrl = `foxglove://open?ds=foxglove-websocket&ds.url=${encodeURIComponent(foxgloveWsUrl)}&layoutUrl=${encodeURIComponent(layoutUrl)}`;
  const foxgloveStudioWebUrl = `https://studio.foxglove.dev/?ds=foxglove-websocket&ds.url=${encodeURIComponent(foxgloveWsUrl)}&layoutUrl=${encodeURIComponent(layoutUrl)}`;

  const handleLaunchDesktopApp = () => {
    window.location.href = foxgloveAppUrl;
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(foxgloveWsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#121017] border border-[#4a3d2e] rounded-xl overflow-hidden shadow-2xl flex flex-col h-full min-h-[440px]">
      {/* Header Bar */}
      <div className="px-4 py-3 bg-[#16131c] border-b border-[#3c3227] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-gradient-to-br from-brass-500/20 to-copper-500/20 border border-brass-400/50 rounded-lg text-gold-400 shadow-brass-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-gold-400 flex items-center gap-2">
              <span>Foxglove Studio 3D Visualizer</span>
              <span className="text-xs px-2 py-0.5 rounded border border-copper-700/50 bg-[#251e16] text-copper-300 font-mono">
                {foxgloveWsUrl}
              </span>
            </h3>
            <p className="text-xs text-steampunk-parchment-muted font-mono">
              Integrated 3D PointClouds, TF trees, URDF, and Robot Diagnostics
            </p>
          </div>
        </div>
      </div>

      {/* Launcher & Connection Hub Content */}
      <div className="relative flex-1 bg-[#09080c] flex flex-col items-center justify-center p-6">
        <div className="absolute inset-0 bg-[radial-gradient(#3c3227_1px,transparent_1px)] [background-size:24px_24px] opacity-30" />

        <div className="relative z-10 max-w-xl w-full bg-[#181420]/95 backdrop-blur-xl border-2 border-[#5c4728] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.9)] p-6 flex flex-col items-center text-center space-y-5">
          <div className="p-3.5 bg-gradient-to-br from-brass-500/20 via-copper-500/20 to-transparent border border-brass-400/50 rounded-2xl text-gold-400 shadow-brass-sm">
            <Cpu className="w-10 h-10" />
          </div>

          <div>
            <h4 className="text-lg font-serif font-bold text-gold-400 flex items-center justify-center gap-2 tracking-wide">
              <span>Foxglove Studio 3D Avionics Hub</span>
              <span className="text-xs px-2 py-0.5 rounded border border-[#2ec4b6]/40 bg-[#0f2420] text-[#2ec4b6] font-mono">
                Calibrated
              </span>
            </h4>
            <p className="text-xs text-steampunk-parchment-muted mt-1.5 max-w-md font-mono">
              Stream live 3D LiDAR point clouds, TF frames, and robot odometry using the native Foxglove desktop application on your workstation.
            </p>
          </div>

          {/* Connection Specs Box */}
          <div className="w-full bg-[#0a090d] border border-[#382f25] rounded-xl p-3.5 text-left font-mono text-xs text-[#f4ecd8] space-y-2 shadow-gauge-inset">
            <div className="flex justify-between items-center">
              <span className="text-steampunk-parchment-muted">WEBSOCKET URL:</span>
              <div className="flex items-center space-x-1.5">
                <span className="text-gold-300 font-semibold">{foxgloveWsUrl}</span>
                <button
                  onClick={handleCopyUrl}
                  className="p-1 text-brass-400 hover:text-gold-300 transition-colors"
                  title="Copy WebSocket URL"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#2ec4b6]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-steampunk-parchment-muted">TARGET ROBOT:</span>
              <span className="text-copper-400 font-semibold">{robotName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-steampunk-parchment-muted">3D TOPICS STREAMING:</span>
              <span className="text-[#2ec4b6] font-semibold">/scan, /tf, /tf_static, /odom</span>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-1">
            <a
              href={foxgloveAppUrl}
              className="steampunk-btn-brass w-full sm:flex-1 py-3 px-4 text-xs font-serif font-bold rounded-xl shadow-brass-sm transition-all flex items-center justify-center space-x-2"
            >
              <MonitorPlay className="w-4 h-4" />
              <span>Launch Desktop App</span>
            </a>

            <a
              href="http://localhost:8000/api/foxglove-lidar-layout.json"
              download="foxglove_lidar_layout.json"
              className="steampunk-btn-copper w-full sm:flex-1 py-3 px-4 text-xs font-serif font-bold rounded-xl shadow-copper-sm transition-all flex items-center justify-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Download 3D Layout</span>
            </a>

            <a
              href={foxgloveStudioWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:flex-1 py-3 px-4 bg-[#1c1822] hover:bg-[#262030] text-gold-300 border border-[#5c4728] text-xs font-serif font-bold rounded-xl transition-all flex items-center justify-center space-x-2"
            >
              <span>Web Studio Tab</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
