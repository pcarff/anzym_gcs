"""SQLAlchemy ORM models for GCS database."""

from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, relationship
import uuid
from datetime import datetime, timezone


class Base(DeclarativeBase):
    pass


class Robot(Base):
    __tablename__ = "robots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    serial_number = Column(String(100), unique=True)
    status = Column(String(20), default="OFFLINE")  # ONLINE, OFFLINE, BUSY, ERROR
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    current_mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id"), nullable=True)
    platform_type = Column(String(50), nullable=True, default="anzym_rosorin")
    template_id = Column(String(50), nullable=True, default="anzym_rosorin")
    enabled_plugins = Column(JSON, nullable=True, default=list)
    capabilities = Column(JSON, nullable=True, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    missions = relationship("Mission", foreign_keys="[Mission.robot_id]", back_populates="robot")
    current_mission = relationship("Mission", foreign_keys="[Robot.current_mission_id]")
    map_assets = relationship("MapAsset", back_populates="robot")


class Mission(Base):
    __tablename__ = "missions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    robot_id = Column(UUID(as_uuid=True), ForeignKey("robots.id"), nullable=False)
    name = Column(String(200))
    waypoints = Column(JSON, nullable=False)  # List of {x, y, theta} coordinates
    status = Column(String(20), default="PENDING")  # PENDING, ACTIVE, COMPLETED, FAILED, CANCELLED
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)

    # Relationships
    robot = relationship("Robot", foreign_keys="[Mission.robot_id]", back_populates="missions")
    mission_logs = relationship("MissionLog", back_populates="mission")


class MissionLog(Base):
    __tablename__ = "mission_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id"), nullable=False)
    level = Column(String(10), default="INFO")  # INFO, WARN, ERROR
    message = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    mission = relationship("Mission", back_populates="mission_logs")


class MapAsset(Base):
    __tablename__ = "map_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    robot_id = Column(UUID(as_uuid=True), ForeignKey("robots.id"), nullable=False)
    map_type = Column(String(10), nullable=False)  # "2D" or "3D"
    s3_key = Column(String(500), nullable=False)
    map_name = Column(String(200))
    resolution = Column(Float)  # meters per pixel for 2D maps
    uploaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    robot = relationship("Robot", back_populates="map_assets")