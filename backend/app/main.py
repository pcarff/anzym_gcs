"""FastAPI application - Main entry point with REST API and WebSocket endpoints."""

import asyncio
import json
import logging
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
from app.db import create_redis_client

logger = logging.getLogger(__name__)

# Global service instances
rosbridge_manager: Optional[ROSbridgeManager] = None
telemetry_service: Optional[TelemetryService] = None
redis_client = None


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

    # Register telemetry handlers
    for topic in settings.ALLOWED_TOPICS:
        rosbridge_manager.register_message_handler(
            topic,
            lambda robot_id, msg, t=topic: telemetry_service.ingest(robot_id, t, msg)
        )

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


class RobotRegisterResponse(BaseModel):
    robot_id: str
    status: str


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
                    "z": first_goal.get("theta", 0.0),
                    "w": 1.0,
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
                    "z": 0.0,
                    "w": 1.0,
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

    conn = rosbridge_manager.active_robots.get(robot_id)
    if not conn or not conn.is_connected:
        raise HTTPException(status_code=404, detail="Robot not found or not connected")

    # Update backend connection teleop mode state
    conn.teleop_mode = request.mode

    # Call /set_teleop_mode ROS service on robot (std_srvs/SetBool: data=True for GCS_REMOTE, data=False for LOCAL)
    res = await rosbridge_manager.call_service(
        robot_id,
        "/set_teleop_mode",
        {"data": True if request.mode == "GCS_REMOTE" else False},
    )

    return {
        "robot_id": robot_id,
        "mode": request.mode,
        "success": res.get("success", False) if res else False,
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
    await websocket.accept()

    try:
        # Send initial robot states
        if rosbridge_manager:
            for robot_id, conn in rosbridge_manager.active_robots.items():
                await websocket.send_json({
                    "type": "robot_state",
                    "data": {
                        "id": conn.robot_id,
                        "name": conn.robot_name,
                        "status": conn.status,
                        "is_connected": conn.is_connected,
                        "battery": conn.battery,
                        "teleop_mode": conn.teleop_mode,
                    },
                })

        async def read_incoming():
            try:
                while True:
                    raw_data = await websocket.receive_text()
                    msg_data = json.loads(raw_data)
                    if msg_data.get("type") == "teleop_cmd" and rosbridge_manager:
                        target_robot_id = msg_data.get("robot_id")
                        if target_robot_id:
                            twist_msg = {
                                "linear": msg_data.get("linear", {"x": 0.0, "y": 0.0, "z": 0.0}),
                                "angular": msg_data.get("angular", {"x": 0.0, "y": 0.0, "z": 0.0}),
                            }
                            await rosbridge_manager.publish(target_robot_id, "/gcs/cmd_vel", twist_msg, "geometry_msgs/msg/Twist")
            except Exception:
                pass

        async def send_periodic():
            try:
                while True:
                    await asyncio.sleep(1.0)
                    if rosbridge_manager:
                        states = []
                        for robot_id, conn in rosbridge_manager.active_robots.items():
                            states.append({
                                "id": conn.robot_id,
                                "status": conn.status,
                                "is_connected": conn.is_connected,
                                "battery": conn.battery,
                                "teleop_mode": conn.teleop_mode,
                            })

                        await websocket.send_json({
                            "type": "fleet_update",
                            "data": {"robots": states},
                        })
            except Exception:
                pass

        read_task = asyncio.create_task(read_incoming())
        periodic_task = asyncio.create_task(send_periodic())
        done, pending = await asyncio.wait(
            [read_task, periodic_task], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()

    except WebSocketDisconnect:
        logger.info("Frontend WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


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