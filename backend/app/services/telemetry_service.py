"""Telemetry processing service - parses, batches, and stores robot telemetry."""

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Callable

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)


class TelemetryBatch:
    """Accumulates telemetry points and flushes periodically."""

    def __init__(self, max_size: int = 100, flush_interval: float = 1.0):
        self.max_size = max_size
        self.flush_interval = flush_interval
        self._batch: List[dict] = []
        self._last_flush: float = 0
        self._lock = asyncio.Lock()

    def add(self, point: dict):
        self._batch.append(point)

    @property
    def is_ready(self) -> bool:
        return len(self._batch) >= self.max_size

    def is_timeout(self, now: float) -> bool:
        return (now - self._last_flush) >= self.flush_interval and len(self._batch) > 0

    def flush(self) -> List[dict]:
        batch = self._batch.copy()
        self._batch.clear()
        self._last_flush = asyncio.get_event_loop().time()
        return batch


class TelemetryService:
    """Processes telemetry from robots, writes to Redis and InfluxDB."""

    def __init__(self, redis_client: aioredis.Redis):
        self._redis = redis_client
        self._batches: Dict[str, TelemetryBatch] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._callbacks: List[Callable] = []

    def register_callback(self, callback: Callable):
        """Register a callback for real-time telemetry points."""
        self._callbacks.append(callback)

    async def start(self):
        """Start the periodic flush task."""
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        logger.info("TelemetryService started")

    async def stop(self):
        """Stop flushing and flush remaining data."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._flush_all()
        logger.info("TelemetryService stopped")

    async def ingest(self, robot_id: str, topic: str, message: dict):
        """Ingest a telemetry message from a robot."""
        # Get or create batch for this robot
        if robot_id not in self._batches:
            self._batches[robot_id] = TelemetryBatch()

        # Parse based on topic
        telemetry_point = self._parse_message(robot_id, topic, message)
        if not telemetry_point:
            return

        self._batches[robot_id].add(telemetry_point)

        # Publish to Redis for real-time frontend updates
        await self._publish_to_redis(robot_id, telemetry_point)

        # Trigger registered in-memory callbacks (direct WebSocket broadcast)
        for cb in self._callbacks:
            try:
                res = cb(robot_id, telemetry_point)
                if asyncio.iscoroutine(res) or hasattr(res, "__await__"):
                    await res
            except Exception as e:
                logger.error(f"Error in telemetry callback: {e}")

    def _parse_message(self, robot_id: str, topic: str, message: dict) -> Optional[dict]:
        """Parse a raw rosbridge message into a telemetry point."""
        timestamp = datetime.now(timezone.utc).isoformat()
        msg_data = message.get("msg", message)

        if topic in ("/battery_state", "/ros_robot_controller/battery"):
            if "percentage" in msg_data:
                percentage = msg_data.get("percentage", 0.0)
                voltage = msg_data.get("voltage", 0.0)
            else:
                # std_msgs/UInt16 in millivolts (e.g. 11500 -> 11.5V)
                mv = msg_data.get("data", 0)
                voltage = mv / 1000.0
                if voltage > 5.0:
                    percentage = min(100.0, max(0.0, ((voltage - 10.5) / (12.6 - 10.5)) * 100.0))
                else:
                    percentage = 0.0

            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "battery",
                "battery": round(percentage, 1),
                "value": round(percentage, 1),
                "voltage": round(voltage, 2),
            }

        elif topic == "/diagnostics":
            status_list = msg_data.get("status", [])
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "diagnostics",
                "levels": {
                    s.get("name", "unknown"): s.get("level", 0)
                    for s in status_list
                },
                "values": {
                    s.get("name", "unknown"): {
                        kv["key"]: kv["value"]
                        for kv in s.get("values", [])
                    }
                    for s in status_list
                },
            }

        elif topic in ("/tf", "/tf_static"):
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "tf",
                "topic": topic,
                "transforms": msg_data.get("transforms", []),
                "data": msg_data,
            }

        elif topic == "/odom":
            pose_obj = msg_data.get("pose", {}).get("pose", {})
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "odom",
                "topic": "/odom",
                "position": pose_obj.get("position", {}),
                "orientation": pose_obj.get("orientation", {}),
                "data": msg_data,
            }

        elif topic == "/teleop_mode_status":
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "teleop_mode_status",
                "topic": "/teleop_mode_status",
                "mode": msg_data.get("data", "LOCAL"),
                "data": msg_data,
            }

        elif topic in ("/nav_msgs/Path", "/amcl_pose"):
            pose = msg_data.get("pose", {})
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "pose",
                "topic": topic,
                "position": pose.get("position", {}),
                "orientation": pose.get("orientation", {}),
                "data": msg_data,
            }

        elif topic == "/scan":
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "scan",
                "topic": "/scan",
                "scan": {
                    "ranges": msg_data.get("ranges", []),
                    "angle_min": msg_data.get("angle_min", -3.14159),
                    "angle_max": msg_data.get("angle_max", 3.14159),
                    "angle_increment": msg_data.get("angle_increment", 0.01745),
                    "range_min": msg_data.get("range_min", 0.1),
                    "range_max": msg_data.get("range_max", 30.0),
                },
                "data": msg_data,
            }

        elif topic == "/vehicle/baseline_status":
            # Custom gcs_interfaces/msg/VehicleBaselineStatus from robot TelemetryPublisher
            battery_data = msg_data.get("battery", {})
            network_data = msg_data.get("network", {})
            voltage = battery_data.get("voltage", 0.0)
            remaining = battery_data.get("remaining_percent", 0.0)
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "baseline_status",
                "topic": "/vehicle/baseline_status",
                "battery": round(remaining, 1),
                "value": round(remaining, 1),
                "voltage": round(voltage, 2),
                "current": battery_data.get("current", 0.0),
                "cell_temperature": battery_data.get("cell_temperature", 0.0),
                "health_flags": battery_data.get("health_flags", 0),
                "network": {
                    "rssi": network_data.get("rssi", 0),
                    "packet_loss_rate": network_data.get("packet_loss_rate", 0.0),
                    "bytes_sent": network_data.get("bytes_sent", 0),
                    "bytes_received": network_data.get("bytes_received", 0),
                    "jitter": network_data.get("jitter", 0.0),
                },
                "drone_id": msg_data.get("drone_id", 0),
                "vehicle_type": msg_data.get("vehicle_type", "unknown"),
                "flight_mode": msg_data.get("flight_mode", 0),
                "safety_flags": msg_data.get("safety_flags", 0),
                "rtk_locked": msg_data.get("rtk_locked", False),
                "data": msg_data,
            }

        # Generic telemetry for all other topics
        return {
            "robot_id": robot_id,
            "timestamp": timestamp,
            "type": topic.lstrip("/").replace("/", "_"),
            "topic": topic,
            "data": msg_data,
        }

    async def _publish_to_redis(self, robot_id: str, telemetry: dict):
        """Publish telemetry to Redis channels for real-time updates."""
        payload = json.dumps(telemetry)
        try:
            # Per-robot channel for targeted subscriptions
            await self._redis.publish(f"robot:{robot_id}:telemetry", payload)
            # Global channel so the WebSocket fleet listener receives all telemetry
            await self._redis.publish(settings.REDIS_REALTIME_CHANNEL, payload)
            # Also keep last value
            await self._redis.set(
                f"robot:{robot_id}:last_telemetry",
                payload,
                ex=settings.REDIS_TTL,
            )
        except Exception as e:
            logger.error(f"Failed to publish to Redis: {e}")

    async def _flush_loop(self):
        """Periodically flush all batches."""
        while self._running:
            try:
                await asyncio.sleep(0.5)
                await self._flush_all()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in flush loop: {e}")

    async def _flush_all(self):
        """Flush all robot batches to InfluxDB."""
        for robot_id in list(self._batches.keys()):
            batch = self._batches[robot_id]
            points = batch.flush()
            if points:
                await self._write_to_influx(robot_id, points)

    async def _write_to_influx(self, robot_id: str, points: List[dict]):
        """Write telemetry points to InfluxDB."""
        # TODO: Implement actual InfluxDB write using influxdb-client
        # For now, log the points
        logger.debug(f"Would write {len(points)} points to InfluxDB for robot {robot_id}")

    async def get_last_telemetry(self, robot_id: str) -> Optional[dict]:
        """Get the last telemetry point for a robot from Redis."""
        try:
            data = await self._redis.get(f"robot:{robot_id}:last_telemetry")
            return json.loads(data) if data else None
        except Exception as e:
            logger.error(f"Failed to get telemetry from Redis: {e}")
            return None