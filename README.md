# ANZYM Ground Control System (GCS)

An enterprise multi-robot fleet management, spatial mapping, teleoperation, and diagnostics dashboard built for ROS2 mobile robots.

![ANZYM GCS Banner](docs/architecture.md)

---

## Key Features

- **Multi-Robot Fleet Monitoring**: Live status tracking (`ONLINE`, `BUSY`, `OFFLINE`), battery telemetry, odometry position, and zero-latency heartbeat monitoring.
- **Zero-Latency Teleoperation**: Dual-mode Joystick teleoperation (Local Direct vs. GCS Remote over WebSocket) with an integrated 3.0s heartbeat safety watchdog.
- **Interactive LiDAR & Spatial Mapping**: 2D LaserScan visualization canvas with mouse wheel zoom (40% to 500%), click-and-drag pan, and navigation waypoint targeting.
- **Foxglove Studio 3D Integration**: 1-click launcher for host desktop Foxglove Studio (`foxglove://` deep links) with standard `rosbridge-websocket` protocol support (`ws://192.168.8.162:9090`) and pre-configured 3D LiDAR layouts (`/api/foxglove-lidar-layout.json`).
- **Live Topic Echo Inspector**: Real-time ROS2 message inspector for `/scan`, `/odom`, `/tf`, `/tf_static`, `/battery_state`, `/cmd_vel`, and custom topics.
- **Template & Plugin Architecture**: Template-driven platform instantiation system for Jetson Orin AMRs, Micro-AMRs, and custom ROS2 platforms.

---

## Quick Start (Docker Compose)

The fastest way to launch the complete GCS stack (Backend, Frontend, PostgreSQL database, Redis message broker) is using Docker Compose:

### 1. Start Services
```bash
docker compose up --build -d
```

### 2. Access Web Interface
Open your browser and navigate to:
- **GCS Frontend**: [http://localhost:5174](http://localhost:5174)
- **FastAPI Backend API**: [http://localhost:8000](http://localhost:8000)
- **FastAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

### 3. Check System Logs
```bash
docker compose logs -f backend
```

---

## Local Development Setup

If you prefer running services directly on your workstation:

### Backend Setup (Python / FastAPI)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start backend dev server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Setup (React / Vite / TailwindCSS)
```bash
cd frontend
npm install

# Start Vite dev server
npm run dev
```

---

## Robot Platform Configuration & Templates

The GCS automatically registers default robots on boot (`rosorin-01` at `192.168.8.162:9090`).

You can instantiate new platforms using pre-built templates via the UI or API:

```http
POST /api/robots/from-template
Content-Type: application/json

{
  "robot_id": "rosorin-01",
  "name": "RosOrin-Alpha",
  "template_id": "anzym_rosorin",
  "host": "192.168.8.162",
  "port": 9090
}
```

For detailed instructions on authoring custom robot platform templates and plugins, see [docs/TEMPLATES.md](docs/TEMPLATES.md).

---

## Teleoperation Modes

- **LOCAL DIRECT**: Local joystick hardware connected directly to the robot's onboard controller handles motion commands.
- **GCS REMOTE**: GCS streams velocity commands (`/gcs/cmd_vel`) at 20Hz over rosbridge. The onboard `teleop_mode_switcher` node validates the 3.0s heartbeat watchdog before forwarding commands to `/controller/cmd_vel`.

---

## Foxglove Studio 3D Visualization

1. In the Mapping panel, click **`Foxglove Studio 3D`**.
2. Click **`Launch Foxglove Desktop App`** to trigger the workstation's native Foxglove Studio via `foxglove://` deep link protocol.
3. Click **`Download 3D LiDAR Layout`** to download `foxglove_lidar_layout.json` and import it in Foxglove Studio (`Layout` -> `Import from file...`).
4. Ensure the connection is set to `ws://192.168.8.162:9090` using the **Rosbridge (ROS 1/2)** driver.

---

## System Architecture

```text
+-------------------------------------------------------+
|                 GCS React Frontend                    |
|       (Dashboard, MapCanvas, Topic Inspector)         |
+---------------------------+---------------------------+
                            | WebSocket / HTTP
+---------------------------v---------------------------+
|                  FastAPI Backend                      |
|       (ROSbridgeManager, TelemetryService)            |
+-------------+-----------------------------+-----------+
              |                             |
      +-------v-------+             +-------v-------+
      |  PostgreSQL   |             |     Redis     |
      +---------------+             +---------------+
              |                             |
              +-------------+---------------+
                            | WebSocket (JSON)
+---------------------------v---------------------------+
|               ROS2 Jetson Robot (rosorin)             |
|   (rosbridge_server:9090, rosapi, teleop_switcher)    |
+-------------------------------------------------------+
```

For in-depth architecture details, see [docs/architecture.md](docs/architecture.md).
