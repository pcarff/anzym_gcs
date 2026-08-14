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
  foxglovePort = 9090,
  layoutPreset = 'amr_3d_monitoring',
  robotName = 'rosorin-01',
}) => {
  const [copied, setCopied] = useState(false);
  const foxgloveWsUrl = `ws://${robotHost}:${foxglovePort}`;
  const layoutUrl = 'http://localhost:8000/api/foxglove-lidar-layout.json';
  const foxgloveAppUrl = `foxglove://open?ds=rosbridge-websocket&ds.url=${encodeURIComponent(foxgloveWsUrl)}&layoutUrl=${encodeURIComponent(layoutUrl)}`;
  const foxgloveStudioWebUrl = `https://studio.foxglove.dev/?ds=rosbridge-websocket&ds.url=${encodeURIComponent(foxgloveWsUrl)}&layoutUrl=${encodeURIComponent(layoutUrl)}`;

  const handleLaunchDesktopApp = () => {
    window.location.href = foxgloveAppUrl;
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(foxgloveWsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full min-h-[440px]">
      {/* Header Bar */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span>Foxglove Studio Visualizer</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
                {foxgloveWsUrl}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Integrated 3D PointClouds, TF trees, URDF, and Robot Diagnostics
            </p>
          </div>
        </div>
      </div>

      {/* Launcher & Connection Hub Content */}
      <div className="relative flex-1 bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:20px_20px] opacity-25" />

        <div className="relative z-10 max-w-xl w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center space-y-5">
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-2xl text-purple-400 shadow-inner">
            <Cpu className="w-10 h-10" />
          </div>

          <div>
            <h4 className="text-lg font-bold text-slate-100 flex items-center justify-center gap-2">
              <span>Foxglove Studio 3D Hub</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Installed
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Stream live 3D LiDAR point clouds, TF frames, and robot odometry using the native Foxglove desktop application on your workstation.
            </p>
          </div>

          {/* Connection Specs Box */}
          <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-left font-mono text-xs text-slate-300 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">WEBSOCKET URL:</span>
              <div className="flex items-center space-x-1.5">
                <span className="text-purple-300 font-semibold">{foxgloveWsUrl}</span>
                <button
                  onClick={handleCopyUrl}
                  className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Copy WebSocket URL"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">TARGET ROBOT:</span>
              <span className="text-blue-400 font-semibold">{robotName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">3D TOPICS STREAMING:</span>
              <span className="text-emerald-400 font-semibold">/scan, /tf, /tf_static, /odom</span>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-1">
            <a
              href={foxgloveAppUrl}
              className="w-full sm:flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-purple-600/25 transition-all flex items-center justify-center space-x-2"
            >
              <MonitorPlay className="w-4 h-4" />
              <span>Launch Foxglove Desktop App</span>
            </a>

            <a
              href="http://localhost:8000/api/foxglove-lidar-layout.json"
              download="foxglove_lidar_layout.json"
              className="w-full sm:flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center space-x-2"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Download 3D LiDAR Layout</span>
            </a>

            <a
              href={foxgloveStudioWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center space-x-2"
            >
              <span>Open Web Studio Tab</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
