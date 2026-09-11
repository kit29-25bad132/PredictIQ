"""
Predict IQ - SQLAlchemy PostgreSQL ORM Models
Defines production relational schemas for machines, IoT devices, real sensor readings,
maintenance records, ML predictions, and alerts.
"""

from sqlalchemy import CheckConstraint, Column, Integer, Float, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from backend.app.db.database import Base

# ============================================================================
# 1. MACHINES TABLE
# ============================================================================
class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(100), nullable=False)
    location = Column(String(150), nullable=False)
    status = Column(String(50), default="Healthy", nullable=False)  # Healthy, Warning, Critical, Maintenance
    rated_rpm = Column(Float, nullable=True)
    rated_current = Column(Float, nullable=True)
    max_temp = Column(Float, nullable=True)
    max_vibration = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships (1 machine -> many associated records)
    devices = relationship("Device", back_populates="machine", cascade="all, delete-orphan")
    sensor_readings = relationship("SensorReading", back_populates="machine", cascade="all, delete-orphan")
    maintenance_records = relationship("MaintenanceRecord", back_populates="machine", cascade="all, delete-orphan")
    predictions = relationship("Prediction", back_populates="machine", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="machine", cascade="all, delete-orphan")
    __table_args__ = (
        CheckConstraint(
            "status IN ('Healthy', 'Warning', 'Critical', 'Maintenance')",
            name="ck_machines_status",
        ),
    )

# ============================================================================
# 2. DEVICES TABLE (ESP32 IoT Nodes)
# ============================================================================
class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(100), unique=True, index=True, nullable=False)
    machine_id = Column(String(50), ForeignKey("machines.machine_id", ondelete="CASCADE"), index=True, nullable=False)
    device_type = Column(String(100), default="ESP32", nullable=False)
    firmware_version = Column(String(50), default="v1.0.0", nullable=False)
    status = Column(String(50), default="OFFLINE", nullable=False)  # CONNECTED, OFFLINE
    last_seen = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(30), nullable=False, default="REAL_HARDWARE")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    machine = relationship("Machine", back_populates="devices")
    sensor_readings = relationship("SensorReading", back_populates="device", cascade="all, delete-orphan")
    __table_args__ = (
        CheckConstraint("status IN ('ONLINE', 'OFFLINE')", name="ck_devices_status"),
        CheckConstraint("source IN ('WOKWI', 'REAL_HARDWARE')", name="ck_devices_source"),
    )

# ============================================================================
# 3. SENSOR READINGS TABLE (Real IoT Telemetry)
# ============================================================================
class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(50), ForeignKey("machines.machine_id", ondelete="CASCADE"), index=True, nullable=False)
    device_id = Column(String(100), ForeignKey("devices.device_id", ondelete="CASCADE"), index=True, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True, nullable=False)
    
    temperature = Column(Float, nullable=True)
    vibration = Column(Float, nullable=True)
    current = Column(Float, nullable=True)
    rpm = Column(Float, nullable=True)
    source = Column(String(30), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    machine = relationship("Machine", back_populates="sensor_readings")
    device = relationship("Device", back_populates="sensor_readings")

    # High-performance composite indexes for large historical telemetry queries
    __table_args__ = (
        Index("ix_sensor_readings_machine_timestamp", "machine_id", "timestamp"),
        Index("ix_sensor_readings_device_timestamp", "device_id", "timestamp"),
        CheckConstraint("source IN ('WOKWI', 'REAL_HARDWARE')", name="ck_sensor_readings_source"),
    )

# ============================================================================
# 4. MAINTENANCE RECORDS TABLE (Ground-Truth Failure Events & Work Orders)
# ============================================================================
class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(50), ForeignKey("machines.machine_id", ondelete="CASCADE"), index=True, nullable=False)
    component = Column(String(100), nullable=False)
    failure_type = Column(String(100), nullable=True)
    issue_description = Column(Text, nullable=False)
    maintenance_action = Column(Text, nullable=False)
    technician = Column(String(100), nullable=False)
    status = Column(String(50), default="Scheduled", nullable=False)  # Completed, In Progress, Scheduled
    failure_date = Column(DateTime(timezone=True), nullable=True)
    maintenance_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationship
    machine = relationship("Machine", back_populates="maintenance_records")
    __table_args__ = (
        CheckConstraint(
            "status IN ('Completed', 'In Progress', 'Scheduled')",
            name="ck_maintenance_records_status",
        ),
    )

# ============================================================================
# 5. PREDICTIONS TABLE (Verified AI Model Inference)
# ============================================================================
class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(50), ForeignKey("machines.machine_id", ondelete="CASCADE"), index=True, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True, nullable=False)
    
    failure_probability = Column(Float, nullable=False)
    component = Column(String(100), nullable=False)
    remaining_life_days = Column(Integer, nullable=False)
    confidence = Column(Float, nullable=False)
    
    explanation = Column(Text, nullable=True)
    recommended_action = Column(Text, nullable=True)
    model_version = Column(String(100), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationship
    machine = relationship("Machine", back_populates="predictions")

    __table_args__ = (
        Index("ix_predictions_machine_timestamp", "machine_id", "timestamp"),
    )

# ============================================================================
# 6. ALERTS TABLE
# ============================================================================
class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(50), ForeignKey("machines.machine_id", ondelete="CASCADE"), index=True, nullable=False)
    alert_type = Column(String(100), nullable=False)
    severity = Column(String(50), default="Warning", nullable=False)  # Critical, Warning, Info
    message = Column(Text, nullable=False)
    status = Column(String(50), default="ACTIVE", nullable=False)  # ACTIVE, ACKNOWLEDGED, RESOLVED
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True, nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship
    machine = relationship("Machine", back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_machine_created", "machine_id", "created_at"),
        CheckConstraint("severity IN ('Critical', 'Warning', 'Info')", name="ck_alerts_severity"),
        CheckConstraint("status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')", name="ck_alerts_status"),
    )
