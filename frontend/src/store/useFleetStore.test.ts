import { describe, it, expect, beforeEach } from 'vitest';
import { useFleetStore } from './useFleetStore';
import { RobotState } from '../types';

describe('useFleetStore', () => {
  beforeEach(() => {
    useFleetStore.setState({
      robots: {},
      missions: [],
      selectedRobotId: undefined,
      activeMissionId: undefined,
      selectedMapType: '2D',
      activeNavGoal: null,
      plannedPath: [],
      navStatus: 'IDLE',
      isConnected: false,
    });
  });

  it('should initialize with default state', () => {
    const state = useFleetStore.getState();
    expect(state.robots).toEqual({});
    expect(state.selectedMapType).toBe('2D');
    expect(state.navStatus).toBe('IDLE');
  });

  it('should add a robot correctly', () => {
    const mockRobot: RobotState = {
      id: 'rosorin',
      name: 'ROSOrin Ackermann',
      status: 'ONLINE',
      battery: 95,
      position: { x: 1.5, y: 2.0, theta: 0.5 },
      lastSeen: new Date(),
      diagnostics: [],
      is_connected: true,
    };

    useFleetStore.getState().addRobot(mockRobot);
    const robots = useFleetStore.getState().robots;
    expect(robots['rosorin']).toBeDefined();
    expect(robots['rosorin'].name).toBe('ROSOrin Ackermann');
    expect(robots['rosorin'].battery).toBe(95);
  });

  it('should update robot position and battery', () => {
    const mockRobot: RobotState = {
      id: 'anzym_green',
      name: 'AnZym Green Mecanum',
      status: 'ONLINE',
      battery: 80,
      position: { x: 0, y: 0, theta: 0 },
      lastSeen: new Date(),
      diagnostics: [],
      is_connected: true,
    };

    useFleetStore.getState().addRobot(mockRobot);
    useFleetStore.getState().updateRobotPosition('anzym_green', 3.2, 4.1, 1.57);
    useFleetStore.getState().updateRobotBattery('anzym_green', 75);

    const updated = useFleetStore.getState().robots['anzym_green'];
    expect(updated.position.x).toBe(3.2);
    expect(updated.position.y).toBe(4.1);
    expect(updated.position.theta).toBe(1.57);
    expect(updated.battery).toBe(75);
  });

  it('should handle navigation status updates and path setting', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    useFleetStore.getState().setPlannedPath(path);
    useFleetStore.getState().setNavStatus('NAVIGATING');

    expect(useFleetStore.getState().plannedPath).toEqual(path);
    expect(useFleetStore.getState().navStatus).toBe('NAVIGATING');
  });

  it('should toggle map type between 2D and 3D', () => {
    useFleetStore.getState().setSelectedMapType('3D');
    expect(useFleetStore.getState().selectedMapType).toBe('3D');

    useFleetStore.getState().setSelectedMapType('2D');
    expect(useFleetStore.getState().selectedMapType).toBe('2D');
  });
});
