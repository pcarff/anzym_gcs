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
    maxLinear: 0.5,
    maxAngular: 1.5,
  });

  const gamepadRef = useRef(gamepad);
  useEffect(() => {
    gamepadRef.current = gamepad;
  }, [gamepad]);

  // Stream gamepad velocity commands to robot when GCS Remote mode is active (10Hz heartbeat)
  useEffect(() => {
    if (!isRemoteTeleopActive || !selectedRobotId) return;

    const interval = setInterval(() => {
      const gp = gamepadRef.current;
      const linearX = gp.connected ? gp.velocity.linearX : 0;
      const linearY = gp.connected ? gp.velocity.linearY : 0;
      const angularZ = gp.connected ? gp.velocity.angularZ : 0;
      sendTwistCommand(selectedRobotId, linearX, linearY, angularZ);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">
                ANZYM Ground Control System (GCS)
              </h1>
              <p className="text-xs text-slate-400">
                Multi-Robot Platform Fleet Operations & Teleoperation
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowTopicConsole(!showTopicConsole)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all border ${
                showTopicConsole
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title="Open Live ROS2 Topic Inspector & Echo Console"
            >
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>Topic Echo Inspector</span>
            </button>

            <button
              onClick={() => setShowTemplateModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Add Platform Template</span>
            </button>

            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-xs text-slate-300 font-mono">
                {isConnected ? 'GCS backend online' : 'Backend offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Robot Fleet List */}
        <aside className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Active Fleet
              </h2>
              <span className="text-xs text-slate-400 font-mono">{robotList.length} Registered</span>
            </div>

            {/* Fleet Status Counts */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl text-center">
                <div className="text-lg font-bold text-emerald-400">{onlineCount}</div>
                <div className="text-[10px] text-emerald-400/80 font-medium">ONLINE</div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl text-center">
                <div className="text-lg font-bold text-amber-400">{busyCount}</div>
                <div className="text-[10px] text-amber-400/80 font-medium">BUSY</div>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl text-center">
                <div className="text-lg font-bold text-rose-400">{errorCount}</div>
                <div className="text-[10px] text-rose-400/80 font-medium">ERROR</div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {robotList.map((robot) => (
              <div
                key={robot.id}
                onClick={() => setSelectedRobotId(robot.id)}
                className={`p-3 rounded-xl cursor-pointer border transition-all relative group ${
                  selectedRobotId === robot.id
                    ? 'border-blue-500 bg-blue-900/20 shadow-md'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm text-slate-200">{robot.name || robot.id}</span>
                  <div className="flex items-center space-x-1.5">
                    <StatusBadge status={robot.status} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRobot(robot);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-all"
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
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition-all"
                        title="Remove Robot from Fleet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1">
                  <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                    {robot.platform_type || 'anzym_rosorin'}
                  </span>
                  <span>BAT: {robot.battery}%</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono">
                  Pos: ({robot.position.x.toFixed(1)}, {robot.position.y.toFixed(1)})
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-slate-800">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-semibold rounded-xl border border-slate-700 transition-colors flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Platform Template</span>
            </button>
          </div>
        </aside>

        {/* Center Main - Map & WebRTC Video Feed Grid */}
        <main className="flex-1 p-4 overflow-y-auto bg-slate-950 flex flex-col space-y-4">
          
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
        <aside className="w-80 bg-slate-900 border-l border-slate-800 overflow-y-auto flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Control & Diagnostics
            </h2>
          </div>

          <div className="p-4 space-y-4 flex-1">
            {selectedRobot ? (
              <>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-blue-400 text-base">
                      {selectedRobot.name || selectedRobot.id}
                    </h3>
                    <button
                      onClick={() => setEditingRobot(selectedRobot)}
                      className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-colors"
                      title="Edit IP address & configuration"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Edit IP / Port</span>
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                    <span>Status: <span className="text-emerald-400 font-medium">{selectedRobot.status}</span></span>
                    <span className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                      {selectedRobot.platform_type || 'anzym_rosorin'}
                    </span>
                  </div>
                </div>

                {/* Joystick Control Mode Card */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <h4 className="font-semibold text-xs mb-2 text-amber-400 uppercase tracking-wider">
                    Joystick Command Source
                  </h4>
                  <div className="flex items-center justify-between bg-slate-900 p-2 rounded-lg mb-3 border border-slate-800">
                    <span className="text-xs font-mono text-slate-300">
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'GCS REMOTE' : 'LOCAL DIRECT'}
                    </span>
                    <button
                      onClick={toggleTeleopMode}
                      disabled={selectedRobot.status !== 'ONLINE'}
                      className={`px-3 py-1 text-xs rounded-lg font-bold transition-colors ${
                        selectedRobot.status !== 'ONLINE'
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : selectedRobot.teleopMode === 'GCS_REMOTE'
                          ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'Disable Joystick' : 'Enable Joystick'}
                    </button>
                  </div>

                  {/* Bluetooth Controller Status */}
                  {selectedRobot.teleopMode === 'GCS_REMOTE' && (
                    <div className="border border-slate-800 p-3 rounded-lg bg-slate-900/60 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-400">Bluetooth Controller:</span>
                        <span className={gamepad.connected ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {gamepad.connected ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </div>
                      {gamepad.connected ? (
                        <div className="text-slate-400 font-mono space-y-1 mt-2 text-[11px]">
                          <div>Linear X: {gamepad.velocity.linearX} m/s</div>
                          <div>Angular Z: {gamepad.velocity.angularZ} rad/s</div>
                        </div>
                      ) : (
                        <div className="text-slate-400 text-[11px] mt-1">
                          Press any button on controller to connect.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Diagnostics List */}
                <div>
                  <h4 className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2">
                    Diagnostics & System Health
                  </h4>
                  <div className="space-y-2">
                    {selectedRobot.diagnostics.map((diag, idx) => (
                      <div key={idx} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-slate-200">{diag.name}</span>
                          <LevelIndicator level={diag.level} />
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">{diag.message}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Emergency Stop Button */}
                <button
                  onClick={() => sendEStop(selectedRobot.id)}
                  className="w-full bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-colors shadow-lg shadow-rose-600/20"
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>EMERGENCY STOP (E-STOP)</span>
                </button>
              </>
            ) : (
              <div className="text-slate-500 text-xs text-center py-8">Select a robot to view diagnostics</div>
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
    ONLINE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    OFFLINE: 'bg-slate-800 text-slate-400 border-slate-700',
    BUSY: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    ERROR: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  };

  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md border font-semibold ${colors[status] || 'bg-slate-800 text-slate-400'}`}>
      {status}
    </span>
  );
}

function LevelIndicator({ level }: { level: number }) {
  const labels = ['OK', 'WARN', 'ERROR', 'STALE'];
  const colors = ['text-emerald-400', 'text-amber-400', 'text-rose-400', 'text-slate-400'];

  return <span className={`text-[10px] font-bold font-mono ${colors[level] || 'text-slate-400'}`}>{labels[level] || 'OK'}</span>;
}

async function sendEStop(robotId: string) {
  try {
    await fetch(`/api/robots/${robotId}/e-stop`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to send e-stop:', error);
  }
}