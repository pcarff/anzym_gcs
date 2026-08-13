"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List
import os


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "GCS Backend"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    ALLOWED_ORIGINS: List[str] = ["*"]

    # ROSbridge
    ROSBRIDGE_DEFAULT_PORT: int = 9090
    ROSBRIDGE_MAX_MESSAGE_SIZE: int = 1_048_576  # 1 MB
    ROSBRIDGE_FRAGMENT_TIMEOUT: int = 30

    # Heartbeat
    HEARTBEAT_TIMEOUT_SECONDS: int = 10
    HEARTBEAT_CHECK_INTERVAL: int = 2  # seconds between checks

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str | None = None
    REDIS_TTL: int = 86400
    REDIS_REALTIME_CHANNEL: str = "gcs:realtime"
    REDIS_MISSION_CHANNEL: str = "gcs:missions"

    # PostgreSQL
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "gcs_db"
    POSTGRES_USER: str = "gcs_user"
    POSTGRES_PASSWORD: str = "gcs_password"
    DATABASE_URL: str | None = None

    @property
    def database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # InfluxDB
    INFLUXDB_URL: str = "http://localhost:8086"
    INFLUXDB_TOKEN: str = "gcs-token"
    INFLUXDB_ORG: str = "gcs"
    INFLUXDB_BUCKET: str = "telemetry"
    INFLUXDB_BATCH_SIZE: int = 50
    INFLUXDB_BATCH_INTERVAL: float = 1.0  # seconds

    # MinIO
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "gcs-maps"
    MINIO_SECURE: bool = False

    # Allowed ROS topics for rosbridge filtering
    ALLOWED_TOPICS: List[str] = [
        "/battery_state",
        "/ros_robot_controller/battery",
        "/teleop_mode_status",
        "/diagnostics",
        "/tf",
        "/tf_static",
        "/nav_msgs/Path",
        "/geometry_msgs/PoseStamped",
        "/amcl_pose",
        "/cmd_vel",
        "/gcs/cmd_vel",
        "/odom",
    ]

    TOPIC_TYPES: dict = {
        "/ros_robot_controller/battery": "std_msgs/msg/UInt16",
        "/battery_state": "sensor_msgs/msg/BatteryState",
        "/teleop_mode_status": "std_msgs/msg/String",
        "/odom": "nav_msgs/msg/Odometry",
        "/cmd_vel": "geometry_msgs/msg/Twist",
        "/gcs/cmd_vel": "geometry_msgs/msg/Twist",
    }

    # Blocked topic patterns
    BLOCKED_PATTERNS: List[str] = [
        "camera",
        "image",
        "points",
        "depth",
        "compressed",
        "theora",
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Singleton settings instance
settings = Settings()