"""FastAPI application - Main entry point with REST API and WebSocket endpoints."""

import asyncio
import json
import logging
import math
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import settings
from app.db import init_db, get_session
from app.db.models import Robot, Mission, MapAsset
from app.services.rosbridge_manager import ROSbridgeManager
from app.services.telemetry_service import TelemetryService
from app.services.template_manager import TemplateManager
from app.db import create_redis_client

logger = logging.getLogger(__name__)

# Global service instances
rosbridge_manager: Optional[ROSbridgeManager] = None
telemetry_service: Optional[TelemetryService] = None
template_manager: TemplateManager = TemplateManager()
redis_client = None


class ConnectionManager:
    """Manages active frontend WebSocket connections for direct broadcasting."""
    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        disconnected = set()
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)
        for conn in disconnected:
            self.active_connections.discard(conn)

connection_manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle management."""
    global rosbridge_manager, telemetry_service, redis_client

    # Startup
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting GCS Backend...")

    # Initialize database
    await init_db()

    # Create Redis client
    redis_client = create_redis_client()

    # Initialize services
    rosbridge_manager = ROSbridgeManager()
    telemetry_service = TelemetryService(redis_client)

    await rosbridge_manager.start()
    await telemetry_service.start()

    # In-memory WebSocket manager for direct frontend broadcasting
    telemetry_service.register_callback(
        lambda robot_id, point: connection_manager.broadcast({
            "type": "telemetry",
            "data": {
                "robot_id": robot_id,
                "telemetry": point,
            }
        })
    )

    # Register telemetry handlers
    for topic in settings.ALLOWED_TOPICS:
        rosbridge_manager.register_message_handler(
            topic,
            lambda robot_id, msg, t=topic: telemetry_service.ingest(robot_id, t, msg)
        )

    # Auto-register default robots on startup
    rosbridge_manager.register_robot(
        "rosorin-01",
        "RosOrin-Alpha",
        "192.168.8.162",
        9090,
        platform_type="anzym_rosorin",
    )
    asyncio.create_task(rosbridge_manager.connect("rosorin-01"))

    rosbridge_manager.register_robot(
        "x3-01",
        "AnZym-Green-X3",
        "192.168.8.246",
        9090,
        platform_type="anzym_x3",
    )
    asyncio.create_task(rosbridge_manager.connect("x3-01"))

    rosbridge_manager.register_robot(
        "zumo-01",
        "AnZym-Zumo",
        "192.168.8.249",
        8888,
        platform_type="anzym_zumo",
    )
    # Zumo is exclusively GCS remote controlled
    zumo_conn = rosbridge_manager.active_robots.get("zumo-01")
    if zumo_conn:
        zumo_conn.teleop_mode = "GCS_REMOTE"
        zumo_conn.status = "ONLINE"
        zumo_conn.is_connected = True
        zumo_conn.battery = 85.0

    logger.info("GCS Backend started successfully")

    yield

    # Shutdown
    logger.info("Shutting down GCS Backend...")
    await telemetry_service.stop()
    await rosbridge_manager.stop()
    await redis_client.aclose()
    logger.info("GCS Backend shut down")


# Create FastAPI app
app = FastAPI(
    title="Anzym GCS Backend",
    description="Centralized Ground Control System Backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ───

class RobotRegisterRequest(BaseModel):
    robot_id: str
    robot_name: str
    host: str
    port: int = Field(default=9090)


class TemplateRobotRegisterRequest(BaseModel):
    template_id: str
    robot_id: str
    robot_name: str
    host: str
    port: int = Field(default=9090)
    selected_plugins: Optional[list] = None


class RobotRegisterResponse(BaseModel):
    robot_id: str
    status: str
    config: Optional[dict] = None


class MissionCreateRequest(BaseModel):
    robot_id: str
    name: str
    waypoints: list  # List of {x, y, theta}


class MissionResponse(BaseModel):
    id: int
    robot_id: str
    name: str
    waypoints: list
    status: str
    created_at: str


class GoalRequest(BaseModel):
    frame_id: str = Field(default="map")
    x: float
    y: float
    theta: float = Field(default=0.0)


class EStopRequest(BaseModel):
    enabled: bool = Field(default=True)


class TeleopModeRequest(BaseModel):
    mode: str = Field(default="LOCAL")  # "LOCAL" or "GCS_REMOTE"


# ─── Robot Management Endpoints ───

@app.post("/api/robots/register", response_model=RobotRegisterResponse)
async def register_robot(request: RobotRegisterRequest):
    """Register a new robot and connect to its rosbridge."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Connect to rosbridge manager in memory
    conn = rosbridge_manager.register_robot(
        request.robot_id,
        request.robot_name,
        request.host,
        request.port,
    )
    await rosbridge_manager.connect(request.robot_id)

    return RobotRegisterResponse(
        robot_id=request.robot_id,
        status=conn.status,
    )


@app.get("/api/templates")
async def list_templates():
    """List all available robot platform templates and plugins."""
    return {
        "platforms": template_manager.list_platform_templates(),
        "plugins": template_manager.list_plugins(),
        "baseline": template_manager.get_baseline(),
    }


@app.get("/api/templates/{template_id}")
async def get_template(template_id: str):
    """Get full details and resolved specs for a platform template."""
    tmpl = template_manager.get_platform_template(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    return tmpl


@app.post("/api/robots/register-from-template", response_model=RobotRegisterResponse)
async def register_robot_from_template(request: TemplateRobotRegisterRequest):
    """Register a new robot platform instance using a template and selected plugins."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        robot_config = template_manager.generate_robot_config(
            template_id=request.template_id,
            robot_id=request.robot_id,
            robot_name=request.robot_name,
            host=request.host,
            port=request.port,
            selected_plugins=request.selected_plugins,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Register and connect to robot
    conn = rosbridge_manager.register_robot(
        request.robot_id,
        request.robot_name,
        request.host,
        request.port,
        platform_type=request.template_id,
    )
    asyncio.create_task(rosbridge_manager.connect(request.robot_id))

    return RobotRegisterResponse(
        robot_id=request.robot_id,
        status="ONLINE",
        config=robot_config,
    )


@app.get("/api/robots")
async def list_robots():
    """List all registered robots and their status."""
    if not rosbridge_manager:
        return []

    robots = []
    for robot_id, conn in rosbridge_manager.active_robots.items():
        robots.append({
            "id": conn.robot_id,
            "name": conn.robot_name,
            "platform_type": conn.platform_type,
            "status": conn.status,
            "is_connected": conn.is_connected,
            "last_heartbeat": conn.last_heartbeat.isoformat() if conn.last_heartbeat else None,
        })
    return robots


@app.get("/api/robots/{robot_id}")
async def get_robot(robot_id: str):
    """Get details for a specific robot."""
    conn = rosbridge_manager.active_robots.get(robot_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Robot not found")

    telemetry = None
    if telemetry_service:
        telemetry = await telemetry_service.get_last_telemetry(robot_id)

    return {
        "id": conn.robot_id,
        "name": conn.robot_name,
        "status": conn.status,
        "is_connected": conn.is_connected,
        "last_heartbeat": conn.last_heartbeat.isoformat() if conn.last_heartbeat else None,
        "telemetry": telemetry,
    }


# ─── Mission Control Endpoints ───

@app.post("/api/missions", response_model=MissionResponse)
async def create_mission(request: MissionCreateRequest):
    """Create a new mission with waypoints."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Verify robot exists and is connected
    conn = rosbridge_manager.active_robots.get(request.robot_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Robot not found")
    if not conn.is_connected:
        raise HTTPException(status_code=409, detail="Robot is not connected")

    # Store mission in database
    async with get_session() as session:
        mission = Mission(
            robot_id=request.robot_id,
            name=request.name,
            waypoints=request.waypoints,
            status="PENDING",
        )
        session.add(mission)
        await session.commit()
        await session.refresh(mission)

    return MissionResponse(
        id=mission.id,
        robot_id=mission.robot_id,
        name=mission.name,
        waypoints=mission.waypoints,
        status=mission.status,
        created_at=mission.created_at.isoformat(),
    )


@app.post("/api/missions/{mission_id}/start")
async def start_mission(mission_id: int):
    """Start a mission by sending the first waypoint to the robot."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    async with get_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(Mission).where(Mission.id == mission_id))
        mission = result.scalar_one_or_none()

        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        if not mission.waypoints:
            raise HTTPException(status_code=400, detail="Mission has no waypoints")

        mission.status = "RUNNING"
        await session.commit()

    # Send first waypoint as a navigation goal
    first_goal = mission.waypoints[0]
    theta = first_goal.get("theta", 0.0)
    goal_msg = {
        "op": "publish",
        "topic": "/goal_pose",
        "msg": {
            "header": {"frame_id": "map"},
            "pose": {
                "position": {
                    "x": first_goal["x"],
                    "y": first_goal["y"],
                    "z": 0.0,
                },
                "orientation": {
                    "x": 0.0,
                    "y": 0.0,
                    "z": math.sin(theta / 2.0),
                    "w": math.cos(theta / 2.0),
                },
            },
        },
    }

    success = await rosbridge_manager.send_message(mission.robot_id, goal_msg)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send goal to robot")

    return {"status": "goal_sent", "waypoint": 0}


@app.post("/api/robots/{robot_id}/goal")
async def send_goal(robot_id: str, request: GoalRequest):
    """Send a navigation goal to a robot."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    conn = rosbridge_manager.active_robots.get(robot_id)
    if not conn or not conn.is_connected:
        raise HTTPException(status_code=404, detail="Robot not found or not connected")

    goal_msg = {
        "op": "publish",
        "topic": "/goal_pose",
        "msg": {
            "header": {"frame_id": request.frame_id},
            "pose": {
                "position": {
                    "x": request.x,
                    "y": request.y,
                    "z": 0.0,
                },
                "orientation": {
                    "x": 0.0,
                    "y": 0.0,
                    "z": math.sin(request.theta / 2.0),
                    "w": math.cos(request.theta / 2.0),
                },
            },
        },
    }

    success = await rosbridge_manager.send_message(robot_id, goal_msg)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send goal")

    return {"status": "goal_sent", "goal": request.model_dump()}


@app.post("/api/robots/{robot_id}/e-stop")
async def emergency_stop(robot_id: str, request: EStopRequest):
    """Trigger emergency stop on a robot."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    conn = rosbridge_manager.active_robots.get(robot_id)
    if not conn or not conn.is_connected:
        raise HTTPException(status_code=404, detail="Robot not found or not connected")

    # Publish zero velocity command
    stop_msg = {
        "op": "publish",
        "topic": "/cmd_vel",
        "msg": {
            "linear": {"x": 0.0, "y": 0.0, "z": 0.0},
            "angular": {"x": 0.0, "y": 0.0, "z": 0.0},
        },
    }

    success = await rosbridge_manager.send_message(robot_id, stop_msg)

    # Also call e-stop service if available
    if request.enabled:
        await rosbridge_manager.call_service(
            robot_id,
            "/emergency_stop",
            {"data": True},
        )

    return {"status": "e-stop_triggered" if success else "failed"}


@app.post("/api/robots/{robot_id}/teleop_mode")
async def set_teleop_mode(robot_id: str, request: TeleopModeRequest):
    """Switch robot teleop control mode between LOCAL and GCS_REMOTE."""
    if not rosbridge_manager:
        raise HTTPException(status_code=503, detail="Service not initialized")

    conn = rosbridge_manager._get_conn(robot_id)
    if not conn or not conn.is_connected:
        raise HTTPException(status_code=404, detail="Robot not found or not connected")

    # Update backend connection teleop mode state
    conn.teleop_mode = request.mode

    # Call /set_teleop_mode ROS service on robot (std_srvs/SetBool: data=True for GCS_REMOTE, data=False for LOCAL)
    res = await rosbridge_manager.call_service(
        conn.robot_id,
        "/set_teleop_mode",
        {"data": True if request.mode == "GCS_REMOTE" else False},
    )

    return {
        "robot_id": conn.robot_id,
        "mode": request.mode,
        "success": res.get("success", False) if res else False,
    }


@app.post("/api/launch-foxglove")
async def launch_foxglove_studio():
    """Launch native Foxglove Studio desktop application on host workstation."""
    import subprocess
    try:
        foxglove_bin = "/snap/bin/foxglove-studio"
        if not os.path.exists(foxglove_bin):
            foxglove_bin = "foxglove-studio"
        
        process = subprocess.Popen([foxglove_bin], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"status": "success", "pid": process.pid, "message": "Foxglove Studio desktop launched!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch Foxglove Studio: {e}")


@app.get("/api/foxglove-lidar-layout.json")
async def get_foxglove_lidar_layout():
    """Return a minimalist 3D Foxglove layout configured for LiDAR (/scan) and lidar_frame."""
    return {
        "configById": {
            "3D!1": {
                "cameraState": {
                    "perspective": False,
                    "distance": 15,
                    "phi": 60,
                    "thetaOffset": 0,
                    "targetOffset": [0, 0, 0],
                    "target": [0, 0, 0],
                    "targetOrientation": [0, 0, 0, 1],
                    "focalDistance": 1,
                    "fov": 45,
                    "near": 0.5,
                    "far": 5000,
                },
                "followMode": "follow-pose",
                "followTf": "lidar_frame",
                "scene": {
                    "transforms": {
                        "showLabel": True,
                    }
                },
                "transforms": {
                    "frame_lidar_frame": {
                        "visible": True,
                    }
                },
                "topics": {
                    "/scan": {
                        "visible": True,
                        "colorField": "intensity",
                        "colorMode": "colormap",
                        "colorMap": "turbo",
                        "pointSize": 4.0,
                    }
                },
                "layers": {
                    "grid": {
                        "layerId": "foxglove.Grid",
                        "size": 20,
                        "divisions": 20,
                        "color": "#2a364f",
                        "position": [0, 0, 0],
                        "orientation": [0, 0, 0, 1],
                        "frameId": "lidar_frame",
                    }
                },
                "publish": {
                    "type": "point",
                    "poseTopic": "/move_base_simple/goal",
                    "pointTopic": "/clicked_point",
                    "poseEstimateTopic": "/initialpose",
                },
            }
        },
        "globalVariables": {},
        "userNodes": {},
        "linkedGlobalVariables": [],
        "playbackConfig": {
            "speed": 1
        },
        "layout": "3D!1",
    }


@app.get("/api/missions")
async def list_missions():
    """List all missions."""
    async with get_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(Mission).order_by(Mission.created_at.desc()))
        missions = result.scalars().all()

    return [
        {
            "id": m.id,
            "robot_id": m.robot_id,
            "name": m.name,
            "status": m.status,
            "waypoints_count": len(m.waypoints),
            "created_at": m.created_at.isoformat(),
        }
        for m in missions
    ]


@app.get("/api/missions/{mission_id}")
async def get_mission(mission_id: int):
    """Get mission details."""
    async with get_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(Mission).where(Mission.id == mission_id))
        mission = result.scalar_one_or_none()

        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        return {
            "id": mission.id,
            "robot_id": mission.robot_id,
            "name": mission.name,
            "status": mission.status,
            "waypoints": mission.waypoints,
            "created_at": mission.created_at.isoformat(),
        }


# ─── WebSocket Endpoint for Frontend ───

@app.websocket("/ws/fleet")
async def fleet_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time fleet data to the frontend."""
    await connection_manager.connect(websocket)
    ws_send_lock = asyncio.Lock()

    async def safe_send_text(text: str):
        try:
            async with ws_send_lock:
                await websocket.send_text(text)
        except Exception:
            pass

    async def safe_send_json(data: dict):
        try:
            async with ws_send_lock:
                await websocket.send_json(data)
        except Exception:
            pass

    try:
        # Send initial robot states
        if rosbridge_manager:
            for robot_id, conn in rosbridge_manager.active_robots.items():
                await safe_send_json({
                    "type": "robot_state",
                    "data": {
                        "id": conn.robot_id,
                        "name": conn.robot_name,
                        "platform_type": conn.platform_type,
                        "status": conn.status,
                        "is_connected": conn.is_connected,
                        "battery": conn.battery,
                        "teleop_mode": conn.teleop_mode,
                        "host": conn.host,
                    },
                })

        async def read_incoming():
            while True:
                raw_data = await websocket.receive_text()
                try:
                    msg_data = json.loads(raw_data)
                except Exception:
                    continue

                if msg_data.get("type") == "teleop_cmd" and rosbridge_manager:
                    target_robot_id = msg_data.get("robot_id")
                    if target_robot_id:
                        twist_msg = {
                            "linear": msg_data.get("linear", {"x": 0.0, "y": 0.0, "z": 0.0}),
                            "angular": msg_data.get("angular", {"x": 0.0, "y": 0.0, "z": 0.0}),
                        }
                        # Non-blocking async fire-and-forget publish to prevent WebSocket lag
                        asyncio.create_task(
                            rosbridge_manager.publish(target_robot_id, "/gcs/cmd_vel", twist_msg, "geometry_msgs/msg/Twist")
                        )

        async def send_periodic():
            while True:
                await asyncio.sleep(1.0)
                if rosbridge_manager:
                    states = []
                    for robot_id, conn in rosbridge_manager.active_robots.items():
                        states.append({
                            "id": conn.robot_id,
                            "name": conn.robot_name,
                            "platform_type": conn.platform_type,
                            "status": conn.status,
                            "is_connected": conn.is_connected,
                            "battery": conn.battery,
                            "teleop_mode": conn.teleop_mode,
                            "host": conn.host,
                        })

                    await safe_send_json({
                        "type": "fleet_update",
                        "data": {"robots": states},
                    })

        async def listen_redis():
            if not redis_client:
                while True:
                    await asyncio.sleep(3600)
            pubsub = redis_client.pubsub()
            await pubsub.subscribe(settings.REDIS_REALTIME_CHANNEL)
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        raw_data = message["data"]
                        if isinstance(raw_data, bytes):
                            raw_data = raw_data.decode("utf-8")
                        await safe_send_text(raw_data)
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            finally:
                try:
                    await pubsub.unsubscribe(settings.REDIS_REALTIME_CHANNEL)
                except Exception:
                    pass

        read_task = asyncio.create_task(read_incoming())
        periodic_task = asyncio.create_task(send_periodic())
        redis_task = asyncio.create_task(listen_redis())

        try:
            await read_task
        finally:
            periodic_task.cancel()
            redis_task.cancel()

    except WebSocketDisconnect:
        logger.info("Frontend WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        connection_manager.disconnect(websocket)


# ─── Health Check ───

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "gcs-backend",
        "version": "1.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        reload=True,
    )