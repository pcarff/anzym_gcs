"""ANZYM Zumo Micro-ROS GCS Bridge Node.

This background node bridges GCS commands and Zumo micro-ROS:
1. Subscribes to /zumo/cmd_vel (geometry_msgs/msg/Twist) -> Packs into std_msgs/msg/Int32 and publishes to /cmd_vel (Best Effort QoS).
2. Subscribes to /zt (std_msgs/msg/Float32MultiArray) from Zumo -> Extracts battery mV, motor speeds, publishes /zumo/battery_state and sends live Redis telemetry updates.
"""

import sys
import math
import time
import json
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
    steering_packed = (st << 16) & 0xFFFF0000
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
        
        # GCS Twist Subscriber
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
        self.slew_rate = 30.0  # smooth ramp
        self.last_cmd_time = self.get_clock().now()
        
        self.timer = self.create_timer(0.05, self.update_loop)  # 20 Hz
        logger.info("Zumo GCS Bridge initialized on Domain %s", self.get_namespace())

    def on_gcs_twist(self, msg: Twist):
        self.last_cmd_time = self.get_clock().now()
        # Invert linear.x / angular.z as appropriate for skid steer
        self.target_throttle = float(msg.linear.x)
        self.target_steering = float(msg.angular.z)

    def on_zumo_telemetry(self, msg: Float32MultiArray):
        if not msg.data or len(msg.data) < 1:
            return
        battery_mv = msg.data[0]
        volts = battery_mv / 1000.0
        
        # Percentage calculation for 4xAA NiMH/Alkaline (4.5V empty, 6.0V full)
        pct = max(0.0, min(100.0, ((volts - 4.5) / (6.0 - 4.5)) * 100.0))
        
        batt_msg = BatteryState()
        batt_msg.header.stamp = self.get_clock().now().to_msg()
        batt_msg.voltage = float(volts)
        batt_msg.percentage = float(pct / 100.0)
        batt_msg.present = True
        self.battery_pub.publish(batt_msg)

        # Update Redis real-time state for GCS
        if redis_client:
            try:
                now_ts = time.time()
                redis_client.set("robot:zumo-01:heartbeat", now_ts)
                redis_client.set("robot:zumo-01:battery", round(pct, 1))
                redis_client.publish("gcs:realtime:telemetry", json.dumps({
                    "robot_id": "zumo-01",
                    "telemetry": {
                        "battery": round(pct, 1),
                        "voltage": round(volts, 2),
                    }
                }))
            except Exception as e:
                logger.debug("Redis publish error: %s", e)

    def update_loop(self):
        # Watchdog: Stop if no command for 1.0s
        elapsed = (self.get_clock().now() - self.last_cmd_time).nanoseconds / 1e9
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
