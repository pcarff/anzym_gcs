# ANZYM Ground Control System (GCS)

An enterprise multi-robot fleet management, spatial mapping, teleoperation, and diagnostics dashboard built for ROS2 mobile robots.

![ANZYM GCS Banner](docs/architecture.md)

---

## Key Features

- **Multi-Robot Fleet Monitoring**: Live status tracking (`ONLINE`, `BUSY`, `OFFLINE`), battery telemetry, odometry position, and zero-latency heartbeat monitoring.
- **Custom Vehicle Telemetry**: Native support for `gcs_interfaces/msg/VehicleBaselineStatus` — battery health, link quality (RSSI, jitter, packet loss), flight modes, safety flags, and RTK lock status.
- **Zero-Latency Teleoperation**: Dual-mode Joystick teleoperation (Local Direct vs. GCS Remote over WebSocket) with an integrated 3.0s heartbeat safety watchdog.
- **Interactive LiDAR & Spatial Mapping**: 2D LaserScan visualization canvas with mouse wheel zoom (40% to 500%), click-and-drag pan, and navigation waypoint targeting.
- **Foxglove Studio 3D Integration**: 1-click launcher for host desktop Foxglove Studio (`foxglove://` deep links) with standard `rosbridge-websocket` protocol support (`ws://192.168.8.162:9090`) and pre-configured 3D LiDAR layouts (`/api/foxglove-lidar-layout.json`).
- **Live Video Streaming**: MJPEG camera streams from the robot's `web_video_server` (port 8080), with auto-retry and real connection state tracking.
- **Live Topic Echo Inspector**: Real-time ROS2 message inspector for `/scan`, `/odom`, `/tf`, `/tf_static`, `/battery_state`, `/vehicle/baseline_status`, `/cmd_vel`, and custom topics.
- **Template & Plugin Architecture**: Template-driven platform instantiation system for Jetson Orin AMRs, Micro-AMRs, and custom ROS2 platforms.

---

## Quick Start

The recommended approach runs **infrastructure** (PostgreSQL, Redis, InfluxDB, MinIO) in Docker while running the **backend and frontend natively** on the host. This avoids Docker bridge network isolation issues when the backend needs to reach robots on the LAN.

### 1. Start Infrastructure Services
```bash
docker compose up -d postgres redis influxdb minio
```

### 2. Start Backend (native)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Start Frontend (native)
```bash
cd frontend
npm install
npm run dev
```

### 4. Access Web Interface
Open your browser and navigate to:
- **GCS Frontend**: [http://localhost:5173](http://localhost:5173)
- **FastAPI Backend API**: [http://localhost:8000](http://localhost:8000)
- **FastAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

### 5. Check System Logs & Status
```bash
# Check service status
./start_gcs.sh --status

# Backend logs appear in logs/backend.log
# Frontend logs appear in logs/frontend.log
# Infrastructure logs:
docker compose logs -f redis postgres
```

### 6. Stop / Shutdown GCS
```bash
./shutdown_gcs.sh
# or: ./stop_gcs.sh
```

> **Note:** You can also run the full stack in Docker with `docker compose up --build -d`, but the backend container must be able to reach the robot's IP (e.g., `192.168.8.162`) which requires `network_mode: host` or custom Docker networking.

---

## Full Docker Compose (Alternative)

If you prefer running everything in Docker:

```bash
docker compose up --build -d
```

> **Warning:** The default `docker-compose.yml` uses a bridge network. The backend container won't be able to reach robots on the LAN (e.g., `192.168.8.162`) unless you add `network_mode: host` to the backend service or configure routing.


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
+---+----------+----------+-----------+----------+-----+
    |          |          |           |          |
+---v---+ +----v----+ +---v---+ +----v----+ +---v---+
|Postgres| | Redis   | |InfluxDB| | MinIO  | |       |
|  (SQL) | |(Pub/Sub)| | (TSDB) | |  (S3)  | |       |
+--------+ +---------+ +--------+ +--------+ |       |
                                              |       |
              WebSocket (rosbridge JSON)      |       |
+---------------------------------------------v-------+
|               ROS2 Jetson Robot (rosorin)             |
|   rosbridge:9090  web_video_server:8080               |
|   /vehicle/baseline_status  /scan  /odom  /tf         |
+-------------------------------------------------------+
```

For in-depth architecture details, see [docs/architecture.md](docs/architecture.md).
