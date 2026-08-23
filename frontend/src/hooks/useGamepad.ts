import { useState, useEffect, useRef } from 'react';

export interface GamepadVelocity {
  linearX: number;
  linearY: number;
  angularZ: number;
}

export interface GamepadState {
  connected: boolean;
  name: string;
  velocity: GamepadVelocity;
  axes: number[];
  buttons: boolean[];
}

interface UseGamepadOptions {
  deadzone?: number;
  maxLinear?: number;
  maxAngular?: number;
  enabled?: boolean;
}

export function useGamepad(options: UseGamepadOptions = {}) {
  const {
    deadzone = 0.1,
    maxLinear = 0.5,
    maxAngular = 1.5,
    enabled = true,
  } = options;

  const [gamepadState, setGamepadState] = useState<GamepadState>({
    connected: false,
    name: '',
    velocity: { linearX: 0, linearY: 0, angularZ: 0 },
    axes: [],
    buttons: [],
  });

  const applyDeadzoneAndCurve = (value: number, cubic: boolean = false): number => {
    if (Math.abs(value) < deadzone) return 0;
    const sign = value > 0 ? 1 : -1;
    let normalized = (Math.abs(value) - deadzone) / (1.0 - deadzone);
    if (cubic) {
      normalized = Math.pow(normalized, 3);
    }
    return sign * normalized;
  };

  useEffect(() => {
    if (!enabled) {
      setGamepadState((prev) => ({
        ...prev,
        velocity: { linearX: 0, linearY: 0, angularZ: 0 },
      }));
      return;
    }

    const updateGamepadStatus = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let activeGp: Gamepad | null = null;

      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i]?.connected) {
          activeGp = gamepads[i];
          break;
        }
      }

      if (activeGp) {
        // Standard Gamepad Axis Mapping:
        // Axis 0: Left Stick X (strafe)
        // Axis 1: Left Stick Y (forward/backward - inverted)
        // Axis 2 / 3: Right Stick X (rotation/steering)
        const lx = applyDeadzoneAndCurve(-activeGp.axes[1] || 0, false); // Inverted so stick up = positive linear.x
        const ly = applyDeadzoneAndCurve(activeGp.axes[0] || 0, false);  // Strafe left/right
        const rawAz = -activeGp.axes[2] || -activeGp.axes[3] || 0;
        const az = applyDeadzoneAndCurve(rawAz, true); // Cubic smoothing for smooth rotation

        setGamepadState({
          connected: true,
          name: activeGp.id || 'Bluetooth Gamepad',
          velocity: {
            linearX: Number((lx * maxLinear).toFixed(2)),
            linearY: Number((-ly * maxLinear).toFixed(2)),
            angularZ: Number((az * maxAngular).toFixed(2)),
          },
          axes: Array.from(activeGp.axes),
          buttons: activeGp.buttons.map((b) => b.pressed),
        });
      } else {
        setGamepadState({
          connected: false,
          name: '',
          velocity: { linearX: 0, linearY: 0, angularZ: 0 },
          axes: [],
          buttons: [],
        });
      }
    };

    updateGamepadStatus();
    const pollInterval = setInterval(updateGamepadStatus, 20);

    return () => {
      clearInterval(pollInterval);
    };
  }, [enabled, deadzone, maxLinear, maxAngular]);

  return gamepadState;
}
