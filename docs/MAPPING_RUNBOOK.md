# AnZym Robot System: Standardized 2D/3D Mapping & Navigation Runbook

This runbook provides the operational instructions for generating, saving, and deploying SLAM maps on both the **ROSOrin (HiWonder Orin NX)** and **AnZym Green (ROSMaster X3 Plus)** AMR platforms.

---

## 1. Architectural & Configuration Matrix

| Parameter / Feature | **ROSMASTER X3 Plus (`anzym_green`)** | **ROSOrin (`anzym_rosorin`)** |
| :--- | :--- | :--- |
| **Chassis / Kinematics** | 4WD Mecanum (Holonomic: $v_x, v_y, \omega_z$) | 4WD Differential / Ackermann / Mecanum |
| **Primary LiDAR Topic** | `/scan` (YDLIDAR 2D) | `/scan_raw` / `/scan` (LD14P / LD19 / G4) |
| **Depth Camera** | Astra Pro Plus (`/camera/color/image_raw`) | Astra Pro / Orbbec (`/depth_cam/rgb0/image_raw`) |
| **Odometry Source** | STM32 Hardware Feedback (`get_motion_data`) | Dual: Wheel Encoders + EKF / Laser Odometry |
| **SLAM Mode** | Asynchronous `slam_toolbox` (Ceres Solver) | Synchronous / Asynchronous `slam_toolbox` |
| **Telemetry / Visualizer** | Foxglove Bridge (Port `8765`) + GCS (Port `8000`) | Foxglove Bridge (Port `8765`) + GCS (Port `8000`) |
| **Target Map Storage** | `/Workspaces/AnZym_Robot_System/maps/` | `/Workspaces/AnZym_Robot_System/maps/` |

---

## 2. Platform 1: AnZym Green (ROSMaster X3 Plus) Mapping

### Step 1: Launch Base Hardware and SLAM Session
On the Jetson Orin NX (SSH: `ssh x3` / `192.168.8.246`):
```bash
source /opt/ros/humble/setup.bash
source /home/jetson/workspaces/anzym_green/install/setup.bash

# Launch Bringup with SLAM enabled and autonomous Nav2 disabled
ros2 launch anzym_green_base bringup_launch.py slam:=true nav:=false
```

This activates:
- Microcontroller driver (`/dev/rosmaster` @ 115200 baud) publishing `/odom` and `/tf` (`odom -> base_footprint`).
- YDLIDAR 2D LiDAR driver publishing `/scan` at 20 Hz.
- `slam_toolbox` in asynchronous online mapping mode publishing `map -> odom` TF and `/map` OccupancyGrid.
- `foxglove_bridge` on port `8765` for 3D live telemetry streaming to the GCS.

### Step 2: Teleoperate & Perform Loop Closures
1. Open the GCS Dashboard (`http://localhost:5173` or Electron App).
2. Set control mode to **GCS Remote** with a Bluetooth/USB gamepad or use the local joystick `/joy_node`.
3. Drive at moderate speeds ($\le 0.20 \text{ m/s}$ linear, $\le 0.35 \text{ rad/s}$ angular).
4. Drive complete closed loops around all rooms, corridors, and obstacle perimeters.
5. Watch the Ceres solver perform loop closure adjustments when returning to previously visited areas.

### Step 3: Save the Finished Map
Once the environment is cleanly mapped without ghosting:
```bash
# Ensure target map directory exists
mkdir -p /home/jetson/workspaces/anzym_green/maps

# Option A: Standard ROS 2 Nav2 Occupancy Grid (.yaml + .pgm)
ros2 run nav2_map_server map_saver_cli -f /home/jetson/workspaces/anzym_green/maps/x3_warehouse_map --ros-args -p save_map_timeout:=10000

# Option B: Serialized SLAM Toolbox Pose Graph (.posegraph) for Lifelong / Localization mode
ros2 service call /slam_toolbox/save_map slam_toolbox/srv/SaveMap "{name: {data: '/home/jetson/workspaces/anzym_green/maps/x3_warehouse_graph'}}"
```

### Step 4: Run Autonomous Navigation with Saved Map
```bash
# Launch Nav2 with MPPI local planner and saved map
ros2 launch anzym_green_base bringup_launch.py slam:=false nav:=true
```

---

## 3. Platform 2: ROSOrin Mapping

### Step 1: Launch Base Hardware and SLAM Session
On the ROSOrin platform (SSH: `ssh rosorin` / `192.168.8.162`):
```bash
source /opt/ros/jazzy/setup.bash
source ~/anzym_robot_ws/install/setup.bash

# Launch Bringup and SLAM
ros2 launch bringup bringup.launch.py
```

This activates:
- `ros_robot_controller` and `odom_publisher` providing robot telemetry.
- LiDAR peripheral driver publishing `/scan` / `/scan_raw`.
- `foxglove_bridge` / `rosbridge` for telemetry visualization.

### Step 2: Live Monitoring on GCS / Foxglove
- Connect GCS or Foxglove Studio to `ws://192.168.8.162:8765`.
- Inspect `/scan`, `/tf`, `/odom`, and `/map`.
- Use the GCS Gamepad teleoperation mode to explore the environment.

### Step 3: Save the Finished Map
```bash
# Save standard Nav2 map files
mkdir -p ~/anzym_robot_ws/maps
ros2 run nav2_map_server map_saver_cli -f ~/anzym_robot_ws/maps/rosorin_map --ros-args -p save_map_timeout:=10000

# Save SLAM Toolbox graph
ros2 service call /slam_toolbox/save_map slam_toolbox/srv/SaveMap "{name: {data: '/home/pcarff/anzym_robot_ws/maps/rosorin_graph'}}"
```

### Step 4: Switch to Navigation Mode
```bash
ros2 launch bringup navigation.launch.py map:=rosorin_map
```

---

## 4. Troubleshooting & Best Practices

1. **Smeared Map or Rotational Drift**:
   - Cause: Wheel slip or uncalibrated IMU.
   - Fix: Ensure `driver_node.py` uses true measured speeds from registers, keep turning speeds below $0.35 \text{ rad/s}$.
2. **Transform Timeouts (`transform_timeout`)**:
   - Cause: Clock desynchronization between robot Jetson and GCS workstation.
   - Fix: Synchronize system clocks via NTP/Chrony: `sudo chronyd -q 'server pool.ntp.org iburst'`.
3. **LiDAR Range Artifacts**:
   - In `mapper_params_online_async.yaml`, set `max_laser_range: 12.0` and `minimum_time_interval: 0.1` to prevent buffer overflow.
