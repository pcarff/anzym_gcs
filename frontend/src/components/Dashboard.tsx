/** Fleet Dashboard - Main view showing robot cards, map, diagnostics, teleop control, and robot registration */

import { useState, useEffect, useRef } from 'react';
import { useFleetStore } from '../store/useFleetStore';
import { MapCanvas } from './MapCanvas';
import { Waypoint } from '../types';
import { useGamepad } from '../hooks/useGamepad';

export function Dashboard() {
  const robots = useFleetStore((state) => state.robots);
  const selectedRobotId = useFleetStore((state) => state.selectedRobotId);
  const setSelectedRobotId = useFleetStore((state) => state.setSelectedRobotId);
  const missions = useFleetStore((state) => state.missions);
  const addMission = useFleetStore((state) => state.addMission);
  const isConnected = useFleetStore((state) => state.isConnected);
  const setTeleopMode = useFleetStore((state) => state.setTeleopMode);
  const sendTwistCommand = useFleetStore((state) => state.sendTwistCommand);

  // Registration Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regRobotId, setRegRobotId] = useState('orin_01');
  const [regRobotName, setRegRobotName] = useState('AnZym Orin 1');
  const [regHost, setRegHost] = useState('192.168.8.162');
  const [regPort, setRegPort] = useState(9090);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const selectedRobot = selectedRobotId ? robots[selectedRobotId] : null;
  const isRemoteTeleopActive = selectedRobot?.teleopMode === 'GCS_REMOTE';

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
    }, 100); // 10 Hz streaming rate keeps robot watchdog alive

    return () => clearInterval(interval);
  }, [isRemoteTeleopActive, selectedRobotId, sendTwistCommand]);

  // Auto-select first robot if none selected
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError(null);

    try {
      const res = await fetch('/api/robots/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robot_id: regRobotId,
          robot_name: regRobotName,
          host: regHost,
          port: regPort,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to register robot');
      }

      const data = await res.json();
      setShowRegisterModal(false);

      const newRobot = {
        id: data.robot_id || regRobotId,
        name: regRobotName,
        status: (data.status || 'ONLINE') as any,
        teleopMode: 'LOCAL' as const,
        battery: 100,
        position: { x: 0, y: 0, theta: 0 },
        lastSeen: new Date(),
        diagnostics: [],
        is_connected: true,
      };
      useFleetStore.getState().addRobot(newRobot);
      setSelectedRobotId(data.robot_id || regRobotId);
    } catch (err: any) {
      setRegError(err.message || 'Connection error');
    } finally {
      setRegSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">ANZYM Ground Control System</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowRegisterModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-semibold flex items-center gap-1"
            >
              + Register Robot
            </button>
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm">{isConnected ? 'Server Connected' : 'Server Disconnected'}</span>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar - Robot List */}
        <aside className="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto">
          <div className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Fleet Overview</h2>
              <span className="text-xs text-gray-400">{robotList.length} Robots</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-green-900 bg-opacity-50 p-2 rounded text-center">
                <div className="text-2xl font-bold">{onlineCount}</div>
                <div className="text-xs text-gray-400">Online</div>
              </div>
              <div className="bg-yellow-900 bg-opacity-50 p-2 rounded text-center">
                <div className="text-2xl font-bold">{busyCount}</div>
                <div className="text-xs text-gray-400">Busy</div>
              </div>
              <div className="bg-red-900 bg-opacity-50 p-2 rounded text-center">
                <div className="text-2xl font-bold">{errorCount}</div>
                <div className="text-xs text-gray-400">Error</div>
              </div>
            </div>

            {/* Robot Cards */}
            {robotList.map((robot) => (
              <div
                key={robot.id}
                onClick={() => setSelectedRobotId(robot.id)}
                className={`p-3 mb-2 rounded cursor-pointer border ${
                  selectedRobotId === robot.id
                    ? 'border-blue-500 bg-blue-900 bg-opacity-30'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold">{robot.name || robot.id}</span>
                  <StatusBadge status={robot.status} />
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  Battery: {robot.battery}% | Pos: ({robot.position.x.toFixed(1)}, {robot.position.y.toFixed(1)})
                </div>
                <div className="text-xs text-blue-400 mt-1">
                  Control: {robot.teleopMode === 'GCS_REMOTE' ? 'GCS Joystick' : 'Local Direct'}
                </div>
              </div>
            ))}

            {robotList.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8 border border-dashed border-gray-700 rounded">
                No robots connected yet.
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="block mx-auto mt-2 text-blue-400 hover:text-blue-300 text-xs font-semibold"
                >
                  + Add Robot IP to Fleet
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content - Map */}
        <main className="flex-1 p-4">
          <MapCanvas onCoordinateClick={handleCoordinateClick} />
        </main>

        {/* Right Panel - Diagnostics & Joystick Controls */}
        <aside className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Robot Control & Diagnostics</h2>
            {selectedRobot ? (
              <div>
                <div className="mb-4 bg-gray-700 p-3 rounded">
                  <h3 className="font-semibold text-blue-400 text-lg">
                    {selectedRobot.name || selectedRobot.id}
                  </h3>
                  <div className="text-xs text-gray-300 mt-1">
                    Status: <span className="font-medium text-green-400">{selectedRobot.status}</span>
                  </div>
                </div>

                {/* Teleop Control Mode Card */}
                <div className="bg-gray-700 p-3 rounded mb-4">
                  <h4 className="font-semibold text-sm mb-2 text-yellow-400">Joystick Command Source</h4>
                  <div className="flex items-center justify-between bg-gray-800 p-2 rounded mb-3">
                    <span className="text-xs font-mono">
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'GCS REMOTE' : 'LOCAL DIRECT'}
                    </span>
                    <button
                      onClick={toggleTeleopMode}
                      className={`px-3 py-1 text-xs rounded font-bold transition-colors ${
                        selectedRobot.teleopMode === 'GCS_REMOTE'
                          ? 'bg-purple-600 hover:bg-purple-700 text-white'
                          : 'bg-gray-600 hover:bg-gray-500 text-gray-200'
                      }`}
                    >
                      {selectedRobot.teleopMode === 'GCS_REMOTE' ? 'Switch to Local' : 'Switch to GCS Joystick'}
                    </button>
                  </div>

                  {/* Bluetooth Gamepad Status */}
                  {selectedRobot.teleopMode === 'GCS_REMOTE' && (
                    <div className="border border-gray-600 p-2 rounded bg-gray-900 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span>Bluetooth Controller:</span>
                        <span className={gamepad.connected ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                          {gamepad.connected ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </div>
                      {gamepad.connected ? (
                        <div className="text-gray-400 font-mono space-y-1 mt-2">
                          <div>Device: {gamepad.name.slice(0, 24)}...</div>
                          <div>Linear X: {gamepad.velocity.linearX} m/s</div>
                          <div>Linear Y: {gamepad.velocity.linearY} m/s</div>
                          <div>Angular Z: {gamepad.velocity.angularZ} rad/s</div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-xs mt-1">
                          Press any button on your Bluetooth controller to pair with browser.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Diagnostics List */}
                <h4 className="font-semibold text-sm mb-2">Diagnostics</h4>
                <div className="space-y-2 mb-6">
                  {selectedRobot.diagnostics.map((diag, idx) => (
                    <div key={idx} className="bg-gray-700 p-2 rounded text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium">{diag.name}</span>
                        <LevelIndicator level={diag.level} />
                      </div>
                      <div className="text-gray-400 text-xs mt-1">{diag.message}</div>
                    </div>
                  ))}
                  {selectedRobot.diagnostics.length === 0 && (
                    <div className="text-gray-500 text-sm">No diagnostic data available</div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-2">
                  <button
                    onClick={() => sendEStop(selectedRobot.id)}
                    className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded font-semibold text-sm"
                  >
                    Emergency Stop
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Select a robot to view controls</div>
            )}
          </div>
        </aside>
      </div>

      {/* Register Robot Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Register Robot with GCS</h3>
            {regError && <div className="bg-red-900 bg-opacity-50 text-red-200 text-xs p-2 rounded mb-4">{regError}</div>}
            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-gray-300 mb-1">Robot ID</label>
                <input
                  type="text"
                  value={regRobotId}
                  onChange={(e) => setRegRobotId(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-1">Robot Name</label>
                <input
                  type="text"
                  value={regRobotName}
                  onChange={(e) => setRegRobotName(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-1">Robot Host IP / Hostname</label>
                <input
                  type="text"
                  value={regHost}
                  onChange={(e) => setRegHost(e.target.value)}
                  placeholder="e.g. 192.168.8.162 or rosorin"
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-1">ROSbridge Port</label>
                <input
                  type="number"
                  value={regPort}
                  onChange={(e) => setRegPort(Number(e.target.value))}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={regSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
                >
                  {regSubmitting ? 'Connecting...' : 'Connect Robot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ONLINE: 'bg-green-500',
    OFFLINE: 'bg-gray-500',
    BUSY: 'bg-yellow-500',
    ERROR: 'bg-red-500',
    IDLE: 'bg-blue-500',
  };

  return (
    <span className={`${colors[status] || 'bg-gray-500'} text-xs px-2 py-1 rounded text-white`}>
      {status}
    </span>
  );
}

function LevelIndicator({ level }: { level: number }) {
  const labels = ['OK', 'Warn', 'Error', 'Stale'];
  const colors = ['text-green-400', 'text-yellow-400', 'text-red-400', 'text-gray-400'];

  return <span className={colors[level] || 'text-gray-400'}>{labels[level] || 'Unknown'}</span>;
}

async function sendEStop(robotId: string) {
  try {
    await fetch(`/api/robots/${robotId}/e-stop`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to send e-stop:', error);
  }
}