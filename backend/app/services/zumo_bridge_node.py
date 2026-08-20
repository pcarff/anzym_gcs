"""ANZYM Zumo Micro-ROS GCS Bridge Node.

This background node bridges GCS commands and Zumo micro-ROS:
1. Listens to Redis channel 'gcs:zumo:cmd_vel' and ROS2 topic /zumo/cmd_vel -> Packs into std_msgs/msg/Int32 and publishes to /cmd_vel (Best Effort QoS).
2. Subscribes to /zt (std_msgs/msg/Float32MultiArray) from Zumo -> Extracts battery mV, motor speeds, publishes /zumo/battery_state and sends live Redis telemetry updates.
"""

import sys
import math
import time
import json
import threading
import logging
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from geometry_msgs.msg import Twist
from std_msgs.msg import Int32, Float32MultiArray
from sensor_msgs.msg import BatteryState

try:
    import redis
    redis_client = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)
except Exception:
    redis_client = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zumo_gcs_bridge")


def pack_zumo_motor_cmd(throttle: float, steering: float) -> int:
    th = int(max(-255, min(255, throttle * 255.0)))
    st = int(max(-255, min(255, steering * 255.0)))
    
    throttle_packed = th & 0xFFFF
    steering_packed = (st & 0xFFFF) << 16
    packed_data = steering_packed | throttle_packed
    
    if packed_data > 2147483647:
        packed_data -= 4294967296
    return int(packed_data)


class ZumoGCSBridge(Node):
    def __init__(self):
        super().__init__('zumo_gcs_bridge')
        
        # Best effort QoS matching Zumo micro-ROS
        best_effort_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )
        
        # Zumo Publishers & Subscribers
        self.zumo_cmd_pub = self.create_publisher(Int32, 'cmd_vel', best_effort_qos)
        self.zumo_telemetry_sub = self.create_subscription(
            Float32MultiArray,
            'zt',
            self.on_zumo_telemetry,
            best_effort_qos
        )
        
        # GCS Twist Subscriber (ROS2 topic)
        self.gcs_twist_sub = self.create_subscription(
            Twist,
            '/zumo/cmd_vel',
            self.on_gcs_twist,
            10
        )
        
        # Standard ROS2 Battery Publisher
        self.battery_pub = self.create_publisher(BatteryState, '/zumo/battery_state', 10)
        
        # Watchdog & Slew Rate Smoothing
        self.target_throttle = 0.0
        self.target_steering = 0.0
        self.current_throttle = 0.0
        self.current_steering = 0.0
        self.slew_rate = 35.0  # smooth ramp
        self.last_cmd_time = time.time()
        
        # Start Redis subscriber thread
        if redis_client:
            self.redis_thread = threading.Thread(target=self._listen_redis_cmd, daemon=True)
            self.redis_thread.start()
            logger.info("Started Redis teleop listener on 'gcs:zumo:cmd_vel'")
        
        self.timer = self.create_timer(0.05, self.update_loop)  # 20 Hz
        logger.info("Zumo GCS Bridge initialized on Domain %s", self.get_namespace())

    def _listen_redis_cmd(self):
        try:
            pubsub = redis_client.pubsub()
            pubsub.subscribe('gcs:zumo:cmd_vel')
            for msg in pubsub.listen():
                if msg['type'] == 'message':
                    try:
                        data = json.loads(msg['data'])
                        lin = data.get('linear', {})
                        ang = data.get('angular', {})
                        self.target_throttle = float(lin.get('x', 0.0))
                        self.target_steering = float(ang.get('z', 0.0))
                        self.last_cmd_time = time.time()
                    except Exception as e:
                        logger.error("Error parsing redis twist: %s", e)
        except Exception as e:
            logger.error("Redis listener loop exited: %s", e)

    def on_gcs_twist(self, msg: Twist):
        self.last_cmd_time = time.time()
        self.target_throttle = float(msg.linear.x)
        self.target_steering = float(msg.angular.z)

    def on_zumo_telemetry(self, msg: Float32MultiArray):
        if not msg.data or len(msg.data) < 1:
            return
        battery_mv = msg.data[0]
        volts = battery_mv / 1000.0
        pct = max(0.0, min(100.0, ((volts - 4.5) / (6.0 - 4.5)) * 100.0))
        
        batt_msg = BatteryState()
        batt_msg.header.stamp = self.get_clock().now().to_msg()
        batt_msg.voltage = float(volts)
        batt_msg.percentage = float(pct / 100.0)
        batt_msg.present = True
        self.battery_pub.publish(batt_msg)

    def update_loop(self):
        # Watchdog: Stop if no command for 1.0s
        elapsed = time.time() - self.last_cmd_time
        if elapsed > 1.0:
            self.target_throttle = 0.0
            self.target_steering = 0.0
        
        # Slew rate smoothing for throttle
        target_th_255 = self.target_throttle * 255.0
        diff_th = target_th_255 - self.current_throttle
        if abs(diff_th) < self.slew_rate:
            self.current_throttle = target_th_255
        else:
            self.current_throttle += self.slew_rate if diff_th > 0 else -self.slew_rate
            
        # Slew rate smoothing for steering
        target_st_255 = self.target_steering * 255.0
        diff_st = target_st_255 - self.current_steering
        if abs(diff_st) < self.slew_rate:
            self.current_steering = target_st_255
        else:
            self.current_steering += self.slew_rate if diff_st > 0 else -self.slew_rate
            
        # Publish packed motor command
        packed = pack_zumo_motor_cmd(
            self.current_throttle / 255.0,
            self.current_steering / 255.0
        )
        msg_out = Int32()
        msg_out.data = packed
        self.zumo_cmd_pub.publish(msg_out)


def main(args=None):
    rclpy.init(args=args)
    bridge = ZumoGCSBridge()
    try:
        rclpy.spin(bridge)
    except KeyboardInterrupt:
        pass
    bridge.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
