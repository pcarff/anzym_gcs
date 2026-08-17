/** Zustand store for fleet state management with WebSocket integration */

import { create } from 'zustand';
import { RobotState, RobotStatus, FleetState, Mission } from '../types';

let globalWs: WebSocket | null = null;

interface FleetStore extends FleetState {
  missions: Mission[];
  selectedMapType: '2D' | '3D';

  // Actions
  setRobots: (robots: Record<string, RobotState>) => void;
  updateRobot: (robotId: string, updates: Partial<RobotState>) => void;
  addRobot: (robot: RobotState) => void;
  removeRobot: (robotId: string) => void;
  updateRobotStatus: (robotId: string, status: RobotStatus) => void;
  updateRobotPosition: (robotId: string, x: number, y: number, theta?: number) => void;
  updateRobotBattery: (robotId: string, battery: number) => void;
  updateRobotDiagnostics: (robotId: string, diagnostics: any[]) => void;
  updateRobotScan: (robotId: string, scan: any) => void;

  setSelectedRobotId: (robotId?: string) => void;
  setActiveMissionId: (missionId?: number) => void;

  setMissions: (missions: Mission[]) => void;
  addMission: (mission: Mission) => void;
  updateMission: (missionId: number, updates: Partial<Mission>) => void;

  setSelectedMapType: (type: '2D' | '3D') => void;

  setTeleopMode: (robotId: string, mode: 'LOCAL' | 'GCS_REMOTE') => Promise<void>;
  sendTwistCommand: (robotId: string, linearX: number, linearY: number, angularZ: number) => void;

  subscribeTelemetry: (cb: (msg: any) => void) => () => void;

  // WebSocket connection
  connectWebSocket: (url: string) => void;
  disconnectWebSocket: () => void;
  isConnected: boolean;
}

const telemetryListeners = new Set<(msg: any) => void>();

export const useFleetStore = create<FleetStore>((set, get) => ({
  // Initial state
  robots: {},
  activeMissionId: undefined,
  selectedRobotId: undefined,
  subscribeTelemetry: (cb) => {
    telemetryListeners.add(cb);
    return () => telemetryListeners.delete(cb);
  },
  missions: [],
  selectedMapType: '2D',
  isConnected: false,

  // Robot actions
  setRobots: (robots) => set({ robots }),

  updateRobot: (robotId, updates) =>
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: { ...state.robots[robotId], ...updates, lastSeen: new Date() },
      },
    })),

  addRobot: (robot) =>
    set((state) => ({
      robots: { ...state.robots, [robot.id]: robot },
    })),

  removeRobot: (robotId) =>
    set((state) => {
      const newRobots = { ...state.robots };
      delete newRobots[robotId];
      return { robots: newRobots };
    }),

  updateRobotStatus: (robotId, status) =>
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: {
          ...state.robots[robotId],
          status,
          lastSeen: new Date(),
        },
      },
    })),

  updateRobotPosition: (robotId, x, y, theta = 0) =>
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: {
          ...state.robots[robotId],
          position: { x, y, theta },
          lastSeen: new Date(),
        },
      },
    })),

  updateRobotBattery: (robotId, battery) =>
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: {
          ...state.robots[robotId],
          battery,
          lastSeen: new Date(),
        },
      },
    })),

  updateRobotDiagnostics: (robotId, diagnostics) =>
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: {
          ...state.robots[robotId],
          diagnostics,
          lastSeen: new Date(),
        },
      },
    })),

  updateRobotScan: (robotId: string, scan: any) =>
    set((state) => {
      const targetId = state.robots[robotId]
        ? robotId
        : Object.keys(state.robots).find(
            (id) =>
              id.toLowerCase() === robotId.toLowerCase() ||
              state.robots[id].name === robotId ||
              state.robots[id].name.toLowerCase().includes('orin')
          ) || Object.keys(state.robots)[0];

      if (!targetId || !state.robots[targetId]) return state;

      return {
        robots: {
          ...state.robots,
          [targetId]: {
            ...state.robots[targetId],
            scan,
            lastSeen: new Date(),
          },
        },
      };
    }),

  // Selection actions
  setSelectedRobotId: (selectedRobotId) => set({ selectedRobotId }),
  setActiveMissionId: (activeMissionId) => set({ activeMissionId }),

  // Mission actions
  setMissions: (missions) => set({ missions }),
  addMission: (mission) =>
    set((state) => ({
      missions: [...state.missions, mission],
    })),
  updateMission: (missionId, updates) =>
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId ? { ...m, ...updates } : m
      ),
    })),

  // Map type
  setSelectedMapType: (selectedMapType) => set({ selectedMapType }),

  setTeleopMode: async (robotId, mode) => {
    // Set mode immediately in local store so React effects trigger without delay
    set((state) => ({
      robots: {
        ...state.robots,
        [robotId]: {
          ...state.robots[robotId],
          teleopMode: mode,
        },
      },
    }));

    try {
      const response = await fetch(`http://localhost:8000/api/robots/${robotId}/teleop_mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error('Failed to set teleop mode');
    } catch (error) {
      console.error('[FleetStore] Failed to update teleop mode:', error);
    }
  },

  sendTwistCommand: (robotId, linearX, linearY, angularZ) => {
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'teleop_cmd',
        robot_id: robotId,
        linear: { x: linearX, y: linearY, z: 0 },
        angular: { x: 0, y: 0, z: angularZ },
      };
      globalWs.send(JSON.stringify(payload));
    }
  },

  // WebSocket connection
  connectWebSocket: (url) => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    const MAX_RECONNECT_DELAY = 30000;
    let reconnectDelay = 1000;

    const connect = () => {
      try {
        globalWs = new WebSocket(url);
        (window as any).__gcs_ws = globalWs;

        globalWs.onopen = () => {
          console.log('[FleetStore] WebSocket connected');
          set({ isConnected: true });
          reconnectDelay = 1000;
        };

        globalWs.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message, get());
          } catch (error) {
            console.error('[FleetStore] Failed to parse message:', error);
          }
        };

        globalWs.onerror = (error) => {
          console.error('[FleetStore] WebSocket error:', error);
        };

        globalWs.onclose = () => {
          console.log('[FleetStore] WebSocket disconnected');
          set({ isConnected: false });
          scheduleReconnect();
        };
      } catch (error) {
        console.error('[FleetStore] Failed to connect WebSocket:', error);
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      reconnectTimeout = setTimeout(() => {
        console.log(`[FleetStore] Reconnecting in ${reconnectDelay}ms...`);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay);
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        globalWs.close();
      }
    };
  },

  disconnectWebSocket: () => {
    set({ isConnected: false });
  },
}));

/** Handle incoming WebSocket messages */
function handleWebSocketMessage(message: any, store: FleetStore) {
  telemetryListeners.forEach((cb) => {
    try {
      cb(message);
    } catch (err) {
      // Ignore listener error
    }
  });

  switch (message.type) {
    case 'robot_state': {
      const data = message.data;
      const robot: RobotState = {
        id: data.id,
        name: data.name,
        status: data.status || 'OFFLINE',
        battery: data.battery ?? 0,
        position: data.position ?? { x: 0, y: 0, theta: 0 },
        lastSeen: new Date(),
        diagnostics: data.diagnostics ?? [],
        is_connected: data.is_connected ?? false,
        teleopMode: data.teleop_mode || 'LOCAL',
        host: data.host,
      };
      store.addRobot(robot);
      break;
    }

    case 'fleet_update': {
      const robots = message.data.robots || [];
      const updatedRobots: Record<string, RobotState> = { ...store.robots };

      robots.forEach((r: any) => {
        if (updatedRobots[r.id]) {
          const currentScan = updatedRobots[r.id].scan;
          updatedRobots[r.id] = {
            ...updatedRobots[r.id],
            status: r.status || updatedRobots[r.id].status,
            is_connected: r.is_connected ?? updatedRobots[r.id].is_connected,
            teleopMode: r.teleop_mode || updatedRobots[r.id].teleopMode || 'LOCAL',
            battery: r.battery ?? updatedRobots[r.id].battery,
            host: r.host || updatedRobots[r.id].host,
            scan: currentScan,
          };
        }
      });

      store.setRobots(updatedRobots);
      break;
    }

    case 'telemetry': {
      const { robot_id, telemetry } = message.data;
      const batteryVal = telemetry.battery ?? telemetry.value;
      if (batteryVal !== undefined) {
        store.updateRobotBattery(robot_id, batteryVal);
      }
      if (telemetry.position) {
        store.updateRobotPosition(
          robot_id,
          telemetry.position.x,
          telemetry.position.y,
          telemetry.position.theta
        );
      }
      if (telemetry.diagnostics) {
        store.updateRobotDiagnostics(robot_id, telemetry.diagnostics);
      }
      if (telemetry.scan) {
        store.updateRobotScan(robot_id, telemetry.scan);
      }
      break;
    }

    case 'mission_update': {
      const { mission_id, ...updates } = message.data;
      store.updateMission(mission_id, updates);
      break;
    }

    default:
      console.warn('[FleetStore] Unknown message type:', message.type);
  }
}