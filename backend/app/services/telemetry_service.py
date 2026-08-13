"""Telemetry processing service - parses, batches, and stores robot telemetry."""

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any

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

    @property
    def is_timeout(self, now: float) -> bool:
        return (now - self._last_flush) >= self.flush_interval and self._batch

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

        elif topic == "/tf":
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "pose",
                "transform": msg_data,
            }

        elif topic in ("/nav_msgs/Path", "/amcl_pose"):
            pose = msg_data.get("pose", {})
            return {
                "robot_id": robot_id,
                "timestamp": timestamp,
                "type": "pose",
                "position": pose.get("position", {}),
                "orientation": pose.get("orientation", {}),
            }

        # Generic telemetry
        return {
            "robot_id": robot_id,
            "timestamp": timestamp,
            "type": "generic",
            "topic": topic,
            "data": msg_data,
        }

    async def _publish_to_redis(self, robot_id: str, telemetry: dict):
        """Publish telemetry to Redis channel for real-time updates."""
        channel = f"robot:{robot_id}:telemetry"
        payload = json.dumps(telemetry)
        try:
            await self._redis.publish(channel, payload)
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