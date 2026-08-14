import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Play, Pause, Trash2, ArrowDownCircle, Check, Copy, AlertCircle } from 'lucide-react';
import { useFleetStore } from '../store/useFleetStore';

interface TopicEchoConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRobotId?: string;
}

export const TopicEchoConsole: React.FC<TopicEchoConsoleProps> = ({
  isOpen,
  onClose,
  defaultRobotId = 'rosorin-01',
}) => {
  const [topicInput, setTopicInput] = useState<string>('/scan');
  const [activeTopic, setActiveTopic] = useState<string>('/scan');
  const [logs, setLogs] = useState<Array<{ timestamp: string; topic: string; data: any }>>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [msgCount, setMsgCount] = useState<number>(0);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const isConnected = useFleetStore((state) => state.isConnected);

  // Available topic suggestions for quick-click
  const suggestedTopics = [
    'ALL',
    '/scan',
    '/battery_state',
    '/ros_robot_controller/battery',
    '/teleop_mode_status',
    '/odom',
    '/depth_cam/rgb0/image_raw',
    '/tf',
    '/cmd_vel',
  ];

  // Subscribe and listen to WebSocket telemetry stream
  useEffect(() => {
    if (!isOpen || isPaused) return;

    const handleMessage = (message: any) => {
      try {
        const timestamp = new Date().toLocaleTimeString();

        const msgTopic = (
          message.topic ||
          message.data?.telemetry?.topic ||
          message.data?.topic ||
          message.data?.telemetry?.type ||
          message.type ||
          ''
        ).toLowerCase();

        const filterTopic = activeTopic.toLowerCase();

        const isMatch =
          filterTopic === 'all' ||
          filterTopic === '*' ||
          msgTopic === filterTopic ||
          (msgTopic && filterTopic.replace('/', '').includes(msgTopic.replace('/', ''))) ||
          (msgTopic && msgTopic.replace('/', '').includes(filterTopic.replace('/', '')));

        if (isMatch) {
          const logPayload = message.data?.telemetry || message.data || message;
          setLogs((prev) => [
            ...prev.slice(-150),
            { timestamp, topic: message.topic || message.data?.telemetry?.topic || activeTopic, data: logPayload },
          ]);
          setMsgCount((c) => c + 1);
        }
      } catch (err) {
        // Ignore parse errors
      }
    };

    const unsubscribe = useFleetStore.getState().subscribeTelemetry(handleMessage);
    return () => unsubscribe();
  }, [isOpen, activeTopic, isPaused]);

  // Auto-scroll terminal log to bottom
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (!isOpen) return null;

  const handleStartEcho = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!topicInput.trim()) return;
    setActiveTopic(topicInput.trim());
    setLogs([]);
    setMsgCount(0);
    setIsPaused(false);
  };

  const copyToClipboard = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] ${l.topic}\n${JSON.stringify(l.data, null, 2)}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[580px] h-[460px] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
      
      {/* Console Top Bar */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between cursor-move select-none">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <span>ROS2 Topic Echo Inspector</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400">
                {msgCount} msgs
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              Listening to topic: <span className="text-amber-400 font-semibold">{activeTopic}</span>
            </p>
          </div>
        </div>

        {/* Top Control Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2 py-1 text-[11px] font-mono rounded-lg border flex items-center space-x-1 transition-colors ${
              isPaused
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
            }`}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <button
            onClick={() => setLogs([])}
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
            title="Clear Console"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title="Close Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Topic Input Bar */}
      <form onSubmit={handleStartEcho} className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center space-x-2">
        <span className="text-xs font-mono text-emerald-400 font-bold">$ ros2 topic echo</span>
        <input
          type="text"
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
          placeholder="/scan"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow"
        >
          Echo Topic
        </button>
      </form>

      {/* Suggested Topic Tags */}
      <div className="px-4 py-1.5 bg-slate-950/60 border-b border-slate-800/60 flex items-center space-x-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider shrink-0">Quick Select:</span>
        {suggestedTopics.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTopicInput(t);
              setActiveTopic(t);
              setLogs([]);
              setMsgCount(0);
              setIsPaused(false);
            }}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors shrink-0 ${
              activeTopic === t
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Output Console Viewport */}
      <div
        ref={terminalRef}
        className="flex-1 p-3 bg-slate-950 font-mono text-[11px] overflow-y-auto space-y-2 select-text text-emerald-400/90"
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 space-y-2 py-8">
            <Terminal className="w-8 h-8 opacity-40" />
            <div>
              <p className="text-xs text-slate-400 font-sans font-medium">Topic Echo Console Idle</p>
              <p className="text-[10px] text-slate-600 font-mono mt-1">
                Listening for messages on topic <span className="text-amber-400">{activeTopic}</span>...
              </p>
            </div>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="border-b border-slate-900/80 pb-2">
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                <span className="text-amber-400/90 font-bold">--- [{log.timestamp}] topic: {log.topic} ---</span>
                <span>seq: {idx + 1}</span>
              </div>
              <pre className="text-slate-300 whitespace-pre-wrap break-all bg-slate-900/60 p-2 rounded border border-slate-800/50">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Console Footer */}
      <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <label className="flex items-center space-x-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-0"
          />
          <span>Auto-scroll terminal</span>
        </label>

        <button
          onClick={copyToClipboard}
          className="hover:text-slate-200 flex items-center space-x-1 text-slate-400 transition-colors"
        >
          <Copy className="w-3 h-3" />
          <span>Copy Logs</span>
        </button>
      </div>

    </div>
  );
};
