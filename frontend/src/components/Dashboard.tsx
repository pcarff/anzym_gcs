/** Fleet Dashboard - Main view showing robot cards, map, diagnostics, teleop control, WebRTC video stream, and template onboarding */

import { useState, useEffect, useRef } from 'react';
import { useFleetStore } from '../store/useFleetStore';
import { MapCanvas } from './MapCanvas';
import { WebRTCPlayer } from './WebRTCPlayer';
import { AddRobotModal } from './AddRobotModal';
import { EditRobotModal } from './EditRobotModal';
import { TopicEchoConsole } from './TopicEchoConsole';
import { Waypoint, RobotState } from '../types';
import { useGamepad } from '../hooks/useGamepad';
import { Bot, Video, Plus, ShieldAlert, Cpu, Trash2, Edit3, Settings, Terminal } from 'lucide-react';

export function Dashboard() {
  const robots = useFleetStore((state) => state.robots);
  const selectedRobotId = useFleetStore((state) => state.selectedRobotId);
  const setSelectedRobotId = useFleetStore((state) => state.setSelectedRobotId);
  const missions = useFleetStore((state) => state.missions);
  const addMission = useFleetStore((state) => state.addMission);
  const isConnected = useFleetStore((state) => state.isConnected);
  const setTeleopMode = useFleetStore((state) => state.setTeleopMode);
  const sendTwistCommand = useFleetStore((state) => state.sendTwistCommand);

  // Modal & Console State
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingRobot, setEditingRobot] = useState<RobotState | null>(null);
  const [showTopicConsole, setShowTopicConsole] = useState(false);

  const selectedRobot = selectedRobotId ? robots[selectedRobotId] : null;
  const isRemoteTeleopActive = selectedRobot?.teleopMode === 'GCS_REMOTE';

  const handleEditSaveSuccess = (updatedData: any) => {
    useFleetStore.getState().updateRobot(updatedData.id, updatedData);
  };

  // Gamepad hook
  const gamepad = useGamepad({
    enabled: isRemoteTeleopActive,
    deadzone: 0.12,
    maxLinear: 0.5,
    maxAngular: 0.85,
  });

  const gamepadRef = useRef(gamepad);
  useEffect(() => {
    gamepadRef.current = gamepad;
  }, [gamepad]);

  // Stream gamepad velocity commands to robot when GCS Remote mode is active
  useEffect(() => {
    if (!isRemoteTeleopActive || !selectedRobotId) return;

    let wasMoving = false;
    let stopCount = 0;

    const interval = setInterval(() => {
      const gp = gamepadRef.current;
      const linearX = gp.connected ? gp.velocity.linearX : 0;
      const linearY = gp.connected ? gp.velocity.linearY : 0;
      const angularZ = gp.connected ? gp.velocity.angularZ : 0;
      const isMoving = Math.abs(linearX) > 0.01 || Math.abs(linearY) > 0.01 || Math.abs(angularZ) > 0.01;

      if (isMoving) {
        wasMoving = true;
        stopCount = 0;
        sendTwistCommand(selectedRobotId, linearX, linearY, angularZ);
      } else if (wasMoving && stopCount < 3) {
        stopCount++;
        sendTwistCommand(selectedRobotId, 0, 0, 0);
        if (stopCount >= 3) {
          wasMoving = false;
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isRemoteTeleopActive, selectedRobotId, sendTwistCommand]);

  // Auto-select first available real robot
  useEffect(() => {
    if (!selectedRobotId && Object.keys(robots).length > 0) {
      setSelectedRobotId(Object.keys(robots)[0]);
    }
  }, [robots, selectedRobotId, setSelectedRobotId]);

  const robotList = Object.values(robots);
  const onlineCount = robotList.filter((r) => r.status === 'ONLINE').length;
  const busyCount = robotList.filter((r) => r.status === 'BUSY').length;
  const errorCount = robotList.filter((r) => r.status === 'ERROR').length;

  const handleCoordinateClick = (x: number, y: number) => {
    if (!selectedRobotId) return;

    const newMission = {
      id: Date.now(),
      robot_id: selectedRobotId,
      name: `Mission ${missions.length + 1}`,
      waypoints: [{ x, y, theta: 0 }] as Waypoint[],
      status: 'PENDING' as const,
      created_at: new Date().toISOString(),
    };

    addMission(newMission);
  };

  const toggleTeleopMode = () => {
    if (!selectedRobotId || !selectedRobot) return;
    const newMode = selectedRobot.teleopMode === 'GCS_REMOTE' ? 'LOCAL' : 'GCS_REMOTE';
    setTeleopMode(selectedRobotId, newMode);
  };

  const handleRegisterSuccess = (robotConfig: any) => {
    const newRobot = {
      id: robotConfig.robot_id,
      name: robotConfig.robot_name || robotConfig.robot_id,
      platform_type: robotConfig.platform_type || 'anzym_rosorin',
      status: (robotConfig.status || 'ONLINE') as any,
      teleopMode: 'LOCAL' as const,
      battery: 100,
      position: { x: 0, y: 0, theta: 0 },
      lastSeen: new Date(),
      diagnostics: [
        { level: 0, name: 'Baseline System', message: 'Heartbeat ping healthy' },
      ],
      is_connected: true,
    };
    useFleetStore.getState().addRobot(newRobot);
    setSelectedRobotId(robotConfig.robot_id);
  };

  return (
    <div className="min-h-screen bg-[#0c0b0e] text-[#f4ecd8] font-sans flex flex-col selection:bg-brass-500/30 selection:text-gold-300">
      {/* Top Header */}
      <header className="bg-gradient-to-r from-[#14121a] via-[#1c1824] to-[#14121a] border-b border-[#5c4728] px-6 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.8)] relative z-20">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 bg-gradient-to-br from-brass-500/20 via-copper-500/20 to-transparent border border-brass-400/50 rounded-xl text-gold-400 shadow-brass-sm">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-serif font-bold text-gold-400 tracking-wide flex items-center gap-2.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                <span>MILO / ANZYM Ground Control Station</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded border border-brass-600/70 bg-[#251c12] text-brass-300 shadow-inner">
                  STEAMPUNK
                </span>
              </h1>
              <p className="text-xs text-steampunk-parchment-muted font-mono tracking-tight">
                Autonomous Fleet Operations & Teleoperation Instrumentation
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowTopicConsole(!showTopicConsole)}
              className={`px-3.5 py-2 rounded-xl text-xs font-mono font-semibold flex items-center space-x-2 transition-all border ${
                showTopicConsole
                  ? 'bg-[#2a2214] text-gold-300 border-brass-400 shadow-brass-sm'
                  : 'bg-[#1a1622] hover:bg-[#251f30] text-steampunk-parchment-muted hover:text-gold-300 border-[#4a3d2e]'
              }`}
              title="Open Live ROS2 Topic Inspector & Echo Console"
            >
              <Terminal className="w-4 h-4 text-brass-400" />
              <span>Topic Echo Inspector</span>
            </button>

            <button
              onClick={() => setShowTemplateModal(true)}
              className="steampunk-btn-brass px-4 py-2 rounded-xl text-xs font-serif font-bold flex items-center space-x-2 transition-all"
            >
              <Plus className="w-4 h-4 text-steampunk-dark" />
              <span>Add Platform Template</span>
            </button>

            <div className="flex items-center space-x-2.5 bg-[#09080c] px-3.5 py-1.5 rounded-lg border border-[#4a3d2e] shadow-gauge-inset">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  isConnected
                    ? 'bg-[#2ec4b6] shadow-[0_0_8px_#2ec4b6] animate-pulse'
                    : 'bg-[#ef4444] shadow-[0_0_8px_#ef4444]'
                }`}
              />
              <span
                className={`text-xs font-mono font-medium ${
                  isConnected ? 'text-[#2ec4b6]' : 'text-[#ef4444]'
                }`}
              >
                {isConnected ? 'GCS Backend Online' : 'Backend Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Robot Fleet List */}
        <aside className="w-80 bg-[#121017] border-r border-[#3c3227] flex flex-col shadow-2xl relative z-10">
          <div className="p-4 border-b border-[#3c3227] bg-[#16131c]">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-serif font-bold text-gold-400 uppercase tracking-widest flex items-center gap-1.5">
                <span className="steampunk-rivet" />
                <span>Active Fleet Roster</span>
              </h2>
              <span className="text-[10px] text-steampunk-parchment-muted font-mono bg-[#0c0b0e] px-2 py-0.5 rounded border border-[#3c3227]">
                {robotList.length} Units
              </span>
            </div>

            {/* Fleet Status Counts */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#0e1d19] border border-[#2ec4b6]/40 p-2 rounded-xl text-center shadow-gauge-inset">
                <div className="text-lg font-mono font-bold text-[#2ec4b6]">{onlineCount}</div>
                <div className="text-[10px] text-[#2ec4b6]/80 font-serif font-semibold tracking-wider">ONLINE</div>
              </div>
              <div className="bg-[#241a0d] border border-[#f59e0b]/40 p-2 rounded-xl text-center shadow-gauge-inset">
                <div className="text-lg font-mono font-bold text-[#f59e0b]">{busyCount}</div>
                <div className="text-[10px] text-[#f59e0b]/80 font-serif font-semibold tracking-wider">BUSY</div>
              </div>
              <div className="bg-[#260e0e] border border-[#ef4444]/40 p-2 rounded-xl text-center shadow-gauge-inset">
                <div className="text-lg font-mono font-bold text-[#ef4444]">{errorCount}</div>
                <div className="text-[10px] text-[#ef4444]/80 font-serif font-semibold tracking-wider">ERROR</div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {robotList.map((robot) => (
              <div
                key={robot.id}
                onClick={() => setSelectedRobotId(robot.id)}
                className={`p-3 rounded-xl cursor-pointer border transition-all relative group ${
                  selectedRobotId === robot.id
                    ? 'border-brass-400 bg-gradient-to-r from-[#2d2215] via-[#221b16] to-[#18141f] shadow-brass-sm ring-1 ring-brass-400/50'
                    : 'border-[#382f25] bg-[#16131c]/80 hover:border-brass-600/60 hover:bg-[#1c1824]'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-serif font-bold text-sm text-[#f4ecd8] tracking-wide">
                    {robot.name || robot.id}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <StatusBadge status={robot.status} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRobot(robot);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-brass-400 hover:text-gold-300 hover:bg-[#251e16] rounded border border-transparent hover:border-brass-600/50 transition-all"
                      title="Edit Robot Settings (IP/Port)"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {robotList.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          useFleetStore.getState().removeRobot(robot.id);
                          if (selectedRobotId === robot.id) {
                            const remaining = Object.keys(robots).filter((id) => id !== robot.id);
                            setSelectedRobotId(remaining[0]);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#8e8271] hover:text-[#ef4444] hover:bg-[#260e0e] rounded border border-transparent hover:border-[#ef4444]/40 transition-all"
                        title="Remove Robot from Fleet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 text-xs text-steampunk-parchment-muted mt-1.5">
                  <span className="font-mono bg-[#251e16] text-brass-300 border border-brass-700/50 px-1.5 py-0.5 rounded text-[10px]">
                    {robot.platform_type || 'anzym_rosorin'}
                  </span>
                  <span className="font-mono text-copper-400 font-semibold">BAT: {robot.battery}%</span>
                </div>
                <div className="text-[11px] text-[#9c8e76] mt-1 font-mono">
                  Pos: ({robot.position.x.toFixed(1)}, {robot.position.y.toFixed(1)})
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-[#3c3227] bg-[#16131c]">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="steampunk-btn-copper w-full py-2.5 rounded-xl text-xs font-serif font-bold transition-all flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Platform Template</span>
            </button>
          </div>
        </aside>

        {/* Center Main - Map & WebRTC Video Feed Grid */}
        <main className="flex-1 p-4 overflow-y-auto bg-[#0c0b0e] flex flex-col space-y-4">
          
          {/* Top Section: Map Canvas with Native/Foxglove toggle */}
          <div className="flex-1 min-h-[440px]">
            <MapCanvas
              onCoordinateClick={handleCoordinateClick}
              selectedRobotHost={selectedRobot?.host || (selectedRobot?.id === 'x3-01' ? '192.168.8.246' : '192.168.8.162')}
            />
          </div>

          {/* Bottom Section: WebRTC Live Camera Feed Panel */}
          <div className="h-72">
            <WebRTCPlayer
              robotId={selectedRobot?.id}
              robotName={selectedRobot?.name}
              robotHost={selectedRobot?.host}
              platformType={selectedRobot?.platform_type || 'anzym_x3'}
              isRobotOnline={Boolean(selectedRobot && selectedRobot.status === 'ONLINE')}
              topic={
                selectedRobot?.platform_type === 'anzym_zumo'
                  ? '/zumo/camera/image_raw'
                  : (selectedRobot?.platform_type === 'anzym_x3' || selectedRobot?.platform_type === 'anzym_x3_plus')
                  ? '/camera/color/image_raw'
                  : '/depth_cam/rgb0/image_raw'
              }
            />
          </div>
        </main>

        {/* Right Sidebar - Robot Diagnostics & Gamepad Teleop */}
        <aside className="w-80 bg-[#121017] border-l border-[#3c3227] overflow-y-auto flex flex-col shadow-2xl relative z-10">
          <div className="p-4 border-b border-[#3c3227] bg-[#16131c]">
            <h2 className="text-xs font-serif font-bold text-gold-400 uppercase tracking-widest flex items-center gap-1.5">
              <span className="steampunk-rivet" />
              <span>Control & Diagnostics</span>
            </h2>
          </div>

          <div className="p-4 space-y-4 flex-1">
            {selectedRobot ? (
              <>
                <div className="bg-[#16131c] p-3 rounded-xl border border-[#4a3d2e] shadow-gauge-inset">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif font-bold text-gold-400 text-base">
                      {selectedRobot.name || selectedRobot.id}
                    </h3>
                    <button
                      onClick={() => setEditingRobot(selectedRobot)}
                      className="px-2 py-1 bg-[#241c12] hover:bg-[#312517] text-brass-300 border border-brass-600/50 rounded-lg text-xs font-mono flex items-center space-x-1 transition-colors"
                      title="Edit IP address & configuration"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Config</span>
                    </button>
                  </div>
                  <div className="text-xs text-steampunk-parchment-muted mt-2 flex items-center justify-between">
                    <span>Status: <span className="text-[#2ec4b6] font-semibold">{selectedRobot.status}</span></span>
                    <span className="font-mono text-[10px] bg-[#251e16] border border-brass-700/50 px-1.5 py-0.5 rounded text-brass-300">
                      {selectedRobot.platform_type || 'anzym_rosorin'}
                    </span>
                  </div>
                </div>

                {/* Joystick Control Mode Card */}
                <div className="bg-[#16131c] p-3 rounded-xl border border-[#4a3d2e]">
                  <h4 className="font-serif font-bold text-xs mb-2 text-copper-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="steampunk-rivet" />
                    <span>Telegraph & Teleoperation</span>
                  </h4>
                  <div className="flex items-center justify-between bg-[#0a090d] p-2.5 rounded-lg mb-3 border border-[#382f25] shadow-gauge-inset">
                    <span className="text-xs font-mono text-brass-300 font-semibold">
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'GCS REMOTE' : 'LOCAL DIRECT'}
                    </span>
                    <button
                      onClick={toggleTeleopMode}
                      disabled={selectedRobot.status !== 'ONLINE'}
                      className={`px-3 py-1 text-xs rounded-lg font-serif font-bold transition-all border ${
                        selectedRobot.status !== 'ONLINE'
                          ? 'bg-[#1c1822] text-[#6d6255] border-[#382f25] cursor-not-allowed'
                          : selectedRobot.teleopMode === 'GCS_REMOTE'
                          ? 'steampunk-btn-brass'
                          : 'bg-[#231e2c] hover:bg-[#2d2737] text-brass-300 border-[#5c4728]'
                      }`}
                    >
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'Disengage Lever' : 'Engage Lever'}
                    </button>
                  </div>

                  {/* Bluetooth Controller Status */}
                  {selectedRobot.teleopMode === 'GCS_REMOTE' && (
                    <div className="border border-[#382f25] p-3 rounded-lg bg-[#0a090d] text-xs shadow-gauge-inset">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-steampunk-parchment-muted font-serif">Controller Link:</span>
                        <span className={gamepad.connected ? 'text-[#2ec4b6] font-mono font-bold' : 'text-[#ef4444] font-mono font-bold'}>
                          {gamepad.connected ? 'CONNECTED' : 'STANDBY'}
                        </span>
                      </div>
                      {gamepad.connected ? (
                        <div className="text-brass-300 font-mono space-y-1 mt-2 text-[11px]">
                          <div>Throttle X: {gamepad.velocity.linearX} m/s</div>
                          <div>Rudder Z: {gamepad.velocity.angularZ} rad/s</div>
                        </div>
                      ) : (
                        <div className="text-[#8e8271] text-[11px] mt-1 italic font-serif">
                          Actuate any lever or button on controller to bind.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Diagnostics List */}
                <div>
                  <h4 className="font-serif font-bold text-xs text-steampunk-parchment-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <span className="steampunk-rivet" />
                    <span>Diagnostics & Vessel Health</span>
                  </h4>
                  <div className="space-y-2">
                    {selectedRobot.diagnostics.map((diag, idx) => (
                      <div key={idx} className="bg-[#16131c] p-2.5 rounded-lg border border-[#382f25] text-xs shadow-gauge-inset">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-[#f4ecd8] font-serif">{diag.name}</span>
                          <LevelIndicator level={diag.level} />
                        </div>
                        <div className="text-steampunk-parchment-muted text-[11px] mt-0.5 font-mono">{diag.message}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Emergency Stop Button */}
                <button
                  onClick={() => sendEStop(selectedRobot.id)}
                  className="w-full bg-gradient-to-r from-[#6b1414] via-[#8c1d1d] to-[#6b1414] hover:from-[#8c1d1d] hover:to-[#a32222] border-2 border-[#cb6d51] text-[#fff5f5] py-3 rounded-xl font-serif font-extrabold text-xs flex items-center justify-center space-x-2 transition-all shadow-[0_0_20px_rgba(203,109,81,0.4)] active:scale-[0.98]"
                >
                  <ShieldAlert className="w-4 h-4 text-copper-300" />
                  <span>EMERGENCY VALVE (E-STOP)</span>
                </button>
              </>
            ) : (
              <div className="text-steampunk-parchment-muted text-xs text-center py-8 font-serif italic">
                Select an automaton to inspect gauges
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Robot Platform Template Modal */}
      <AddRobotModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onRegisterSuccess={handleRegisterSuccess}
      />

      {/* Edit Robot Configuration Modal */}
      <EditRobotModal
        isOpen={!!editingRobot}
        robot={editingRobot}
        onClose={() => setEditingRobot(null)}
        onSaveSuccess={handleEditSaveSuccess}
      />

      {/* Live ROS2 Topic Inspector & Echo Console */}
      <TopicEchoConsole
        isOpen={showTopicConsole}
        onClose={() => setShowTopicConsole(false)}
        defaultRobotId={selectedRobotId}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ONLINE: 'bg-[#0f2420] text-[#2ec4b6] border-[#2ec4b6]/50 shadow-[0_0_8px_rgba(46,196,182,0.25)]',
    OFFLINE: 'bg-[#18151f] text-[#8e8271] border-[#382f25]',
    BUSY: 'bg-[#281b0e] text-[#f59e0b] border-[#f59e0b]/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]',
    ERROR: 'bg-[#291010] text-[#ef4444] border-[#ef4444]/50 shadow-[0_0_8px_rgba(239,68,68,0.25)]',
  };

  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold tracking-wider ${colors[status] || 'bg-[#18151f] text-[#8e8271]'}`}>
      {status}
    </span>
  );
}

function LevelIndicator({ level }: { level: number }) {
  const labels = ['NOMINAL', 'WARN', 'CRITICAL', 'STALE'];
  const colors = ['text-[#2ec4b6]', 'text-[#f59e0b]', 'text-[#ef4444]', 'text-[#8e8271]'];

  return <span className={`text-[10px] font-bold font-mono tracking-wider ${colors[level] || 'text-[#8e8271]'}`}>{labels[level] || 'NOMINAL'}</span>;
}

async function sendEStop(robotId: string) {
  try {
    await fetch(`/api/robots/${robotId}/e-stop`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to send e-stop:', error);
  }
}