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
    <div className="fixed bottom-6 right-6 z-50 w-[580px] h-[460px] bg-[#121017] border-2 border-[#5c4728] rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
      
      {/* Console Top Bar */}
      <div className="px-4 py-2.5 bg-[#17141f] border-b border-[#4a3d2e] flex items-center justify-between cursor-move select-none">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-brass-500/20 border border-brass-400/50 rounded-lg text-gold-400 shadow-brass-sm">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-serif font-bold text-gold-400 flex items-center gap-2 tracking-wide">
              <span>Telegraph & Topic Echo Inspector</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#251e16] border border-brass-700/50 text-brass-300">
                {msgCount} telegrams
              </span>
            </h3>
            <p className="text-[10px] text-steampunk-parchment-muted font-mono">
              Listening to feed: <span className="text-copper-400 font-bold">{activeTopic}</span>
            </p>
          </div>
        </div>

        {/* Top Control Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border flex items-center space-x-1 transition-all ${
              isPaused
                ? 'bg-[#281b0e] text-[#f59e0b] border-[#f59e0b]/50 shadow-amber-tube/30'
                : 'bg-[#0f2420] text-[#2ec4b6] border-[#2ec4b6]/50 shadow-jade-tube/30'
            }`}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <button
            onClick={() => setLogs([])}
            className="p-1.5 text-brass-400 hover:text-[#ef4444] hover:bg-[#260e0e] rounded-lg transition-colors border border-transparent hover:border-[#ef4444]/40"
            title="Clear Console"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-brass-400 hover:text-gold-300 hover:bg-[#251e16] rounded-lg transition-colors border border-transparent hover:border-brass-600/50"
            title="Close Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Topic Input Bar */}
      <form onSubmit={handleStartEcho} className="px-4 py-2 bg-[#16131c] border-b border-[#3c3227] flex items-center space-x-2">
        <span className="text-xs font-mono text-gold-400 font-bold">$ ros2 topic echo</span>
        <input
          type="text"
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
          placeholder="/scan"
          className="flex-1 bg-[#0a090d] border border-[#4a3d2e] rounded-lg px-2.5 py-1 text-xs font-mono text-[#f4ecd8] focus:outline-none focus:border-brass-400 shadow-gauge-inset"
        />
        <button
          type="submit"
          className="steampunk-btn-brass px-3 py-1 text-xs font-serif font-bold rounded-lg shadow"
        >
          Echo Topic
        </button>
      </form>

      {/* Suggested Topic Tags */}
      <div className="px-4 py-1.5 bg-[#0e0c12] border-b border-[#382f25] flex items-center space-x-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-brass-500 font-serif uppercase tracking-wider shrink-0">Select Channel:</span>
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
                ? 'bg-[#281b0e] text-gold-300 border-brass-500 font-bold shadow-brass-sm'
                : 'bg-[#18151f] text-steampunk-parchment-muted border-[#3c3227] hover:border-brass-600 hover:text-gold-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Output Console Viewport */}
      <div
        ref={terminalRef}
        className="flex-1 p-3.5 bg-[#08070a] font-mono text-[11px] overflow-y-auto space-y-2 select-text text-amber-400 shadow-gauge-inset"
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#6e5329] space-y-2 py-8">
            <Terminal className="w-8 h-8 opacity-40 text-brass-500" />
            <div>
              <p className="text-xs text-steampunk-parchment font-serif font-bold">Telegraph Line Silent</p>
              <p className="text-[10px] text-steampunk-parchment-muted font-mono mt-1">
                Listening for transmissions on channel <span className="text-gold-400 font-bold">{activeTopic}</span>...
              </p>
            </div>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="border-b border-[#251e18] pb-2">
              <div className="flex items-center justify-between text-[10px] text-[#8e8271] mb-1 font-mono">
                <span className="text-copper-400 font-bold">--- [{log.timestamp}] topic: {log.topic} ---</span>
                <span>seq: {idx + 1}</span>
              </div>
              <pre className="text-[#f4ecd8] whitespace-pre-wrap break-all bg-[#121017] p-2.5 rounded border border-[#3c3227] shadow-inner">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Console Footer */}
      <div className="px-4 py-2 bg-[#16131c] border-t border-[#3c3227] flex items-center justify-between text-[10px] font-mono text-steampunk-parchment-muted">
        <label className="flex items-center space-x-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-[#4a3d2e] bg-[#0a090d] text-brass-500 focus:ring-0"
          />
          <span className="font-serif">Auto-scroll paper tape</span>
        </label>

        <button
          onClick={copyToClipboard}
          className="hover:text-gold-300 flex items-center space-x-1 text-brass-400 transition-colors font-serif"
        >
          <Copy className="w-3 h-3" />
          <span>Copy Transcript</span>
        </button>
      </div>

    </div>
  );
};
