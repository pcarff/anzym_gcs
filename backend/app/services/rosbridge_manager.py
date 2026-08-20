"""ROSbridge WebSocket manager - maintains connections to robot rosbridge instances."""

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field

import websockets
from websockets.client import WebSocketClientProtocol

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class RobotConnection:
    """Tracks a single robot's rosbridge connection state."""
    robot_id: str
    robot_name: str
    host: str
    port: int
    platform_type: str = "anzym_rosorin"
    websocket: Optional[WebSocketClientProtocol] = None
    is_connected: bool = False
    last_heartbeat: Optional[datetime] = None
    status: str = "OFFLINE"
    battery: float = 0.0
    teleop_mode: str = "LOCAL"
    subscribers: list = field(default_factory=list)
    _reconnect_task: Optional[asyncio.Task] = None


class ROSbridgeManager:
    """Manages WebSocket connections to multiple robot rosbridge instances."""

    def __init__(self):
        self._robots: Dict[str, RobotConnection] = {}
        self._message_handlers: Dict[str, Callable] = {}
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """Start the heartbeat monitor."""
        self._running = True
        self._heartbeat_task = asyncio.create_task(self._heartbeat_monitor())
        logger.info("ROSbridgeManager started")

    async def stop(self):
        """Stop all connections and the heartbeat monitor."""
        self._running = False
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self._disconnect_all()
        logger.info("ROSbridgeManager stopped")

    def register_robot(
        self,
        robot_id: str,
        robot_name: str,
        host: str,
        port: int,
        platform_type: str = "anzym_rosorin",
    ) -> RobotConnection:
        """Register a robot for connection management."""
        if robot_id in self._robots:
            logger.warning(f"Robot {robot_id} already registered, updating connection info")
            self._robots[robot_id].host = host
            self._robots[robot_id].port = port
            self._robots[robot_id].platform_type = platform_type
        else:
            self._robots[robot_id] = RobotConnection(
                robot_id=robot_id,
                robot_name=robot_name,
                host=host,
                port=port,
                platform_type=platform_type,
            )
        return self._robots[robot_id]

    def unregister_robot(self, robot_id: str):
        """Remove a robot from management."""
        if robot_id in self._robots:
            conn = self._robots.pop(robot_id)
            if conn._reconnect_task:
                conn._reconnect_task.cancel()
            if conn.websocket:
                asyncio.create_task(self._close_websocket(conn))
            logger.info(f"Robot {robot_id} unregistered")

    def register_message_handler(self, topic: str, handler: Callable):
        """Register a callback for messages on a specific topic."""
        self._message_handlers[topic] = handler

    async def connect(self, robot_id: str) -> bool:
        """Establish WebSocket connection to a robot's rosbridge."""
        if robot_id not in self._robots:
            logger.error(f"Robot {robot_id} not registered")
            return False

        conn = self._robots[robot_id]
        cur_task = asyncio.current_task()
        if conn._reconnect_task and conn._reconnect_task != cur_task and not conn._reconnect_task.done():
            conn._reconnect_task.cancel()
            conn._reconnect_task = None

        if conn.websocket:
            await self._close_websocket(conn)

        uri = f"ws://{conn.host}:{conn.port}"

        try:
            logger.info(f"Connecting to rosbridge at {uri} for robot {conn.robot_name}")
            conn.websocket = await websockets.connect(
                uri,
                max_size=settings.ROSBRIDGE_MAX_MESSAGE_SIZE,
                ping_interval=None,
                ping_timeout=None,
                open_timeout=10.0,
            )
            conn.is_connected = True
            conn.status = "ONLINE"
            conn.last_heartbeat = datetime.now(timezone.utc)

            # Subscribe to configured topics
            await self._subscribe_to_topics(conn)

            # Start message listener
            asyncio.create_task(self._listen_for_messages(conn))

            logger.info(f"Robot {conn.robot_name} connected successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to robot {conn.robot_name}: {e}")
            conn.is_connected = False
            conn.status = "OFFLINE"
            self._schedule_reconnect(robot_id)
            return False

    def _schedule_reconnect(self, robot_id: str):
        """Safely schedule a single reconnection task if one isn't already active."""
        if robot_id not in self._robots:
            return
        conn = self._robots[robot_id]
        if conn._reconnect_task and not conn._reconnect_task.done():
            return  # Reconnection task already running
        conn._reconnect_task = asyncio.create_task(self._reconnect(robot_id))

    async def _subscribe_to_topics(self, conn: RobotConnection):
        """Subscribe to allowed ROS topics and advertise command topics via rosbridge."""
        # Advertise /gcs/cmd_vel
        adv_msg = {
            "op": "advertise",
            "topic": "/gcs/cmd_vel",
            "type": "geometry_msgs/msg/Twist",
        }
        try:
            await conn.websocket.send(json.dumps(adv_msg))
            logger.debug(f"Advertised /gcs/cmd_vel for robot {conn.robot_name}")
        except Exception as e:
            logger.error(f"Failed to advertise /gcs/cmd_vel: {e}")

        for topic in settings.ALLOWED_TOPICS:
            throttle_rate = 0
            if hasattr(settings, "TOPIC_THROTTLE_RATES"):
                throttle_rate = settings.TOPIC_THROTTLE_RATES.get(topic, 0)

            msg = {
                "op": "subscribe",
                "id": f"sub_{topic}",
                "topic": topic,
                "throttle_rate": throttle_rate,
                "queue_length": 10,
            }
            if hasattr(settings, "TOPIC_TYPES") and topic in settings.TOPIC_TYPES:
                msg["type"] = settings.TOPIC_TYPES[topic]

            try:
                await conn.websocket.send(json.dumps(msg))
                conn.subscribers.append(topic)
                logger.debug(f"Subscribed to {topic} (type: {msg.get('type', 'auto')}, throttle: {throttle_rate}ms) for robot {conn.robot_name}")
            except Exception as e:
                logger.error(f"Failed to subscribe to {topic}: {e}")

    async def _listen_for_messages(self, conn: RobotConnection):
        """Listen for incoming messages from rosbridge."""
        try:
            async for message in conn.websocket:
                await self._process_message(conn, message)
        except websockets.exceptions.ConnectionClosed:
            logger.warning(f"Connection closed for robot {conn.robot_name}")
        except Exception as e:
            logger.error(f"Error listening to robot {conn.robot_name}: {e}")
        finally:
            conn.is_connected = False
            conn.status = "OFFLINE"
            self._schedule_reconnect(conn.robot_id)

    async def _process_message(self, conn: RobotConnection, raw_message: str):
        """Process a single rosbridge message."""
        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            return

        # Update heartbeat
        conn.last_heartbeat = datetime.now(timezone.utc)
        if conn.status == "OFFLINE":
            conn.status = "ONLINE"

        # Filter blocked topics
        topic = message.get("topic", "")
        if self._is_blocked_topic(topic):
            return

        msg_data = message.get("msg", {})
        if topic in ("/battery_state", "/ros_robot_controller/battery", "/zumo/battery_state"):
            if "percentage" in msg_data:
                conn.battery = round(msg_data.get("percentage", 0.0) * 100.0, 1)
            elif "data" in msg_data:
                mv = msg_data.get("data", 0)
                volts = mv / 1000.0
                if volts > 5.0:
                    pct = min(100.0, max(0.0, ((volts - 10.5) / (12.6 - 10.5)) * 100.0))
                elif volts > 4.0: # Zumo 4xAA battery range (4.5V - 6.0V)
                    pct = min(100.0, max(0.0, ((volts - 4.5) / (6.0 - 4.5)) * 100.0))
                else:
                    pct = 0.0
                conn.battery = round(pct, 1)
        elif topic == "/teleop_mode_status":
            conn.teleop_mode = msg_data.get("data", "LOCAL")

        # Route to registered handlers
        handler = self._message_handlers.get(topic)
        if handler:
            try:
                res = handler(conn.robot_id, message)
                if asyncio.iscoroutine(res) or hasattr(res, "__await__"):
                    await res
            except Exception as e:
                logger.error(f"Error in handler for {topic}: {e}")

    def _is_blocked_topic(self, topic: str) -> bool:
        """Check if a topic matches blocked patterns."""
        topic_lower = topic.lower()
        return any(pattern in topic_lower for pattern in settings.BLOCKED_PATTERNS)

    async def _heartbeat_monitor(self):
        """Periodically check robot heartbeats and mark offline robots."""
        while self._running:
            try:
                await asyncio.sleep(settings.HEARTBEAT_CHECK_INTERVAL)
                now = datetime.now(timezone.utc)
                timeout = timedelta(seconds=settings.HEARTBEAT_TIMEOUT_SECONDS)

                import time
                for robot_id, conn in self._robots.items():
                    if conn.websocket is not None:
                        if conn.is_connected:
                            ws_state = getattr(conn.websocket, "state", None)
                            is_closed = (
                                ws_state == websockets.protocol.State.CLOSED
                                if ws_state is not None
                                else not getattr(conn.websocket, "open", True)
                            )
                            if is_closed or (conn.last_heartbeat and (now - conn.last_heartbeat > timeout)):
                                logger.warning(
                                    f"Robot {conn.robot_name} connection lost or timed out "
                                    f"(last heartbeat: {conn.last_heartbeat})"
                                )
                                conn.is_connected = False
                                conn.status = "OFFLINE"
                                await self._close_websocket(conn)
                                self._schedule_reconnect(robot_id)
                    else:
                        # For non-websocket robots (e.g. Zumo micro-ROS over UDP)
                        try:
                            import subprocess, re
                            res = subprocess.run(['docker', 'logs', '--tail', '10', 'anzym-zumo-microros'], capture_output=True, text=True, timeout=1.0)
                            lines = (res.stdout + res.stderr).splitlines()
                            last_ts = None
                            for line in reversed(lines):
                                m = re.search(r'\[([0-9]+\.[0-9]+)\].*UDPv4AgentLinux.*recv_message', line)
                                if m:
                                    last_ts = float(m.group(1))
                                    break
                            
                            if last_ts is not None and (time.time() - last_ts < 3.5):
                                conn.last_heartbeat = datetime.fromtimestamp(last_ts, tz=timezone.utc)
                                conn.is_connected = True
                                conn.status = "ONLINE"
                                if conn.battery <= 0:
                                    conn.battery = 85.0
                            else:
                                conn.is_connected = False
                                conn.status = "OFFLINE"
                        except Exception:
                            conn.is_connected = False
                            conn.status = "OFFLINE"

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat monitor: {e}")

    async def _reconnect(self, robot_id: str, delay: int = 5):
        """Attempt to reconnect a robot continuously while backend is running."""
        attempt = 1
        while self._running:
            await asyncio.sleep(delay)
            if robot_id not in self._robots:
                return
            conn = self._robots[robot_id]
            if conn.is_connected:
                return
            logger.info(f"Reconnection attempt {attempt} for robot {conn.robot_name} ({robot_id})")
            success = await self.connect(robot_id)
            if success:
                logger.info(f"Robot {robot_id} reconnected successfully")
                return
            attempt += 1

    def _get_conn(self, robot_id: str) -> Optional[RobotConnection]:
        """Get active robot connection by ID, name, or fallback."""
        if robot_id in self._robots:
            return self._robots[robot_id]
        for key, conn in self._robots.items():
            if key.lower() == robot_id.lower() or conn.robot_name.lower() == robot_id.lower() or "orin" in key.lower():
                return conn
        if self._robots:
            return list(self._robots.values())[0]
        return None

    async def send_message(self, robot_id: str, message: dict) -> bool:
        """Send a message (publish/service call/action) to a robot."""
        conn = self._get_conn(robot_id)
        if not conn or not conn.is_connected or not conn.websocket:
            logger.error(f"Cannot send message to robot {robot_id}: not connected")
            return False

        try:
            await conn.websocket.send(json.dumps(message))
            return True
        except Exception as e:
            logger.error(f"Failed to send message to robot {robot_id}: {e}")
            conn.is_connected = False
            return False

    async def publish(self, robot_id: str, topic: str, data: dict, msg_type: Optional[str] = None) -> bool:
        """Publish a message to a ROS topic."""
        msg = {
            "op": "publish",
            "topic": topic,
            "msg": data,
        }
        if msg_type:
            msg["type"] = msg_type
        return await self.send_message(robot_id, msg)

    async def call_service(self, robot_id: str, service: str, args: dict) -> Optional[dict]:
        """Call a ROS service."""
        conn = self._get_conn(robot_id)
        if not conn or not conn.is_connected:
            return None

        msg = {
            "op": "call_service",
            "id": f"srv_{service}_{id(self)}",
            "service": service,
            "args": args,
        }
        success = await self.send_message(robot_id, msg)
        return {"success": success} if success else None

    async def _close_websocket(self, conn: RobotConnection):
        """Close a robot's WebSocket connection."""
        if conn.websocket:
            try:
                await conn.websocket.close()
            except Exception:
                pass
            conn.websocket = None
            conn.is_connected = False

    async def _disconnect_all(self):
        """Disconnect all robot connections."""
        for conn in self._robots.values():
            await self._close_websocket(conn)
            if conn._reconnect_task:
                conn._reconnect_task.cancel()

    @property
    def active_robots(self) -> Dict[str, RobotConnection]:
        """Return all robot connections."""
        return self._robots.copy()