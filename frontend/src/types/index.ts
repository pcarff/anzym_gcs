/** Type definitions for the GCS Frontend */

export type RobotStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'ERROR' | 'IDLE';

export interface DiagnosticStatus {
  level: number;
  name: string;
  message: string;
  values?: { key: string; value: string }[];
}

export interface RobotState {
  id: string;
  name: string;
  status: RobotStatus;
  battery: number;
  position: { x: number; y: number; theta: number };
  lastSeen: Date;
  diagnostics: DiagnosticStatus[];
  is_connected: boolean;
  teleopMode?: 'LOCAL' | 'GCS_REMOTE';
  platform_type?: string;
  template_id?: string;
  enabled_plugins?: string[];
  scan?: {
    ranges: number[];
    angle_min: number;
    angle_max: number;
    angle_increment: number;
    range_min?: number;
    range_max?: number;
  };
}

export interface Mission {
  id: number;
  robot_id: string;
  name: string;
  waypoints: Waypoint[];
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  created_at: string;
  completed_at?: string;
}

export interface Waypoint {
  x: number;
  y: number;
  theta?: number;
}

export interface FleetState {
  robots: Record<string, RobotState>;
  activeMissionId?: number;
  selectedRobotId?: string;
}

export interface WebSocketMessage {
  type: 'robot_state' | 'fleet_update' | 'telemetry' | 'mission_update';
  data: any;
}

export interface GoalPayload {
  frame_id: string;
  x: number;
  y: number;
  theta: number;
}

export interface EStopPayload {
  enabled: boolean;
}