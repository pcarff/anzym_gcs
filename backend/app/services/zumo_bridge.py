"""Zumo Micro-ROS GCS Bridge Service.

Bridges between ANZYM GCS and Pololu Zumo micro-ROS platform:
- Translates Twist (linear.x, angular.z) -> Packed Int32 (Steering << 16 | Throttle & 0xFFFF)
- Ingests /zt telemetry -> Battery percentage & diagnostic telemetry
"""

import asyncio
import logging
import math
import struct
import time
from typing import Optional, Callable

logger = logging.getLogger(__name__)

def pack_zumo_motor_cmd(throttle: float, steering: float) -> int:
    """
    Pack normalized throttle (-1.0 to 1.0) and steering (-1.0 to 1.0)
    into signed 32-bit integer expected by ZumoMicroROS_Basic:
    High 16 bits = Steering (-255 to 255)
    Low 16 bits = Throttle (-255 to 255)
    """
    th = int(max(-255, min(255, throttle * 255)))
    st = int(max(-255, min(255, steering * 255)))
    
    throttle_packed = th & 0xFFFF
    steering_packed = (st << 16) & 0xFFFF0000
    packed_data = steering_packed | throttle_packed
    
    # Handle signed 32-bit int representation
    if packed_data > 2147483647:
        packed_data -= 4294967296
    return int(packed_data)


def parse_zumo_battery(battery_mv: float) -> float:
    """
    Convert Zumo battery millivolts to percentage (4xAA NiMH/Alkaline: ~4500mV to ~6000mV).
    """
    if battery_mv <= 0:
        return 0.0
    volts = battery_mv / 1000.0
    if volts < 4.2:
        return 0.0
    pct = ((volts - 4.5) / (6.0 - 4.5)) * 100.0
    return max(0.0, min(100.0, round(pct, 1)))
