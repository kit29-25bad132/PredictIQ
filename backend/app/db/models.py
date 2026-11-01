"""
Predict IQ - SQLAlchemy PostgreSQL ORM Models

Multi-tenant foundation (Phase 2):
- ``organizations`` and ``organization_memberships``
- ``organization_id`` on all eight tenant-owned business tables

Integrity model
---------------
PostgreSQL is the authority for tenant consistency. Migration
``009_organizations_and_tenancy`` adds composite foreign keys such as
``(organization_id, machine_id) -> machines(organization_id, machine_id)`` so a
child row can never reference a machine in another organization.

Those composite foreign keys are deliberately NOT declared in this metadata:
a second FK from ``sensor_readings``/``devices``/etc. to ``machines`` would
make SQLAlchemy relationship resolution ambiguous (``AmbiguousForeignKeysError``)
for the existing ``Machine.devices`` / ``Machine.sensor_readings`` /
``Device.sensor_readings`` relationships. The single-column relationships stay
unambiguous, and the database enforces the cross-tenant rules.

Transitional default (removed in Phase 3)
-----------------------------------------
``organization_id`` defaults to ``LEGACY_ORGANIZATION_ID`` so every existing
write path (ESP32 ingestion, operator writes, simulation config creation, the
prediction pipeline) keeps working before the API derives an organization from
a verified membership. Phase 3 will remove this default and require an explicit
organization context. No user is granted legacy membership automatically.

Schema drift note
-----------------
``simulation_configs`` was historically created only by
``Base.metadata.create_all`` at application startup; it is now also owned by
Alembic via revision ``008_simulation_configs_schema_parity``.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import relationship

from backend.app.db.database import Base

# ============================================================================
# TENANCY CONSTANTS
# ============================================================================

# Fixed, documented UUID for the organization that owns all pre-tenancy data.
# Mirrored by migration 009 (idempotent insert on slug 'legacy').
LEGACY_ORGANIZATION_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
LEGACY_ORGANIZATION_SLUG = "legacy"
LEGACY_ORGANIZATION_NAME = "Legacy Organization"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================================
# 0. ORGANIZATIONS (tenant root)
# ============================================================================
class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    slug = Column(String(80), nullable=False)
    status = Column(String(20), default="active", nullable=False)  # active, suspended, archived
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    memberships = relationship(
        "OrganizationMembership",
        back_populates="organization",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("slug", name="uq_organizations_slug"),
        CheckConstraint(
            "status IN ('active', 'suspended', 'archived')",
            name="ck_organizations_status",
        ),
    )


# ============================================================================
# 0b. ORGANIZATION MEMBERSHIPS (Supabase sub -> organization + role)
# ============================================================================
class OrganizationMembership(Base):
    __tablename__ = "organization_memberships"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Supabase auth.users.id (JWT "sub"). Deliberately NOT a database foreign
    # key: the auth schema is provider-managed and must stay decoupled.
    user_id = Column(Uuid(as_uuid=True), nullable=False)
    role = Column(String(20), nullable=False)  # owner, admin, member
    status = Column(String(20), default="active", nullable=False)  # active, invited, suspended, removed
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    organization = relationship("Organization", back_populates="memberships")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "user_id", name="uq_organization_memberships_org_user"
        ),
        Index("ix_organization_memberships_user_status", "user_id", "status"),
        Index("ix_organization_memberships_org_role", "organization_id", "role"),
        CheckConstraint(
            "role IN ('owner', 'admin', 'member')",
            name="ck_organization_memberships_role",
        ),
        CheckConstraint(
            "status IN ('active', 'invited', 'suspended', 'removed')",
            name="ck_organization_memberships_status",
        ),
    )


# ============================================================================
# 1. MACHINES TABLE
# ============================================================================
class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Transitional default: see module docstring (removed in Phase 3).
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(100), nullable=False)
    location = Column(String(150), nullable=False)
    status = Column(String(50), default="Healthy", nullable=False)  # Healthy, Warning, Critical, Maintenance
    rated_rpm = Column(Float, nullable=True)
    rated_current = Column(Float, nullable=True)
    max_temp = Column(Float, nullable=True)
    max_vibration = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationships (1 machine -> many associated records)
    devices = relationship("Device", back_populates="machine", cascade="all, delete-orphan")
    sensor_readings = relationship("SensorReading", back_populates="machine", cascade="all, delete-orphan")
    maintenance_records = relationship("MaintenanceRecord", back_populates="machine", cascade="all, delete-orphan")
    predictions = relationship("Prediction", back_populates="machine", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="machine", cascade="all, delete-orphan")
    feedback_records = relationship("FeedbackRecord", back_populates="machine", cascade="all, delete-orphan")
    simulation_config = relationship("MachineSimulationConfig", back_populates="machine", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "machine_id", name="uq_machines_organization_machine"
        ),
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
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    device_id = Column(String(100), unique=True, index=True, nullable=False)
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    device_type = Column(String(100), default="ESP32", nullable=False)
    firmware_version = Column(String(50), default="v1.0.0", nullable=False)
    status = Column(String(50), default="OFFLINE", nullable=False)  # CONNECTED, OFFLINE
    last_seen = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(30), nullable=False, default="REAL_HARDWARE")
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationships
    machine = relationship("Machine", back_populates="devices")
    sensor_readings = relationship("SensorReading", back_populates="device", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "device_id", name="uq_devices_organization_device"
        ),
        CheckConstraint("status IN ('ONLINE', 'OFFLINE')", name="ck_devices_status"),
        CheckConstraint("source IN ('WOKWI', 'REAL_HARDWARE')", name="ck_devices_source"),
    )


# ============================================================================
# 3. SENSOR READINGS TABLE (Real IoT Telemetry)
# ============================================================================
class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    device_id = Column(
        String(100),
        ForeignKey("devices.device_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    timestamp = Column(DateTime(timezone=True), default=_utcnow, index=True, nullable=False)

    temperature = Column(Float, nullable=True)
    vibration = Column(Float, nullable=True)
    current = Column(Float, nullable=True)
    rpm = Column(Float, nullable=True)
    source = Column(String(30), nullable=False)

    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

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
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    component = Column(String(100), nullable=False)
    failure_type = Column(String(100), nullable=True)
    issue_description = Column(Text, nullable=False)
    maintenance_action = Column(Text, nullable=False)
    technician = Column(String(100), nullable=False)
    status = Column(String(50), default="Scheduled", nullable=False)  # Completed, In Progress, Scheduled
    failure_date = Column(DateTime(timezone=True), nullable=True)
    maintenance_date = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationship
    machine = relationship("Machine", back_populates="maintenance_records")

    __table_args__ = (
        # Referenced by the organization-aware feedback foreign key.
        UniqueConstraint(
            "organization_id", "id", name="uq_maintenance_records_organization_id"
        ),
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
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    timestamp = Column(DateTime(timezone=True), default=_utcnow, index=True, nullable=False)

    failure_probability = Column(Float, nullable=False)
    component = Column(String(100), nullable=False)
    remaining_life_days = Column(Integer, nullable=True)
    confidence = Column(Float, nullable=True)

    explanation = Column(Text, nullable=True)
    recommended_action = Column(Text, nullable=True)
    model_version = Column(String(100), nullable=True)
    is_prototype = Column(Boolean, nullable=False, default=True)
    explanation_data = Column(Text, nullable=True)
    input_hash = Column(String(64), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationship
    machine = relationship("Machine", back_populates="predictions")

    __table_args__ = (
        Index("ix_predictions_machine_timestamp", "machine_id", "timestamp"),
        UniqueConstraint(
            "organization_id", "id", name="uq_predictions_organization_id"
        ),
        UniqueConstraint("machine_id", "model_version", "input_hash",
                         name="uq_predictions_idempotency"),
    )


# ============================================================================
# 6. ALERTS TABLE
# ============================================================================
class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    alert_type = Column(String(100), nullable=False)
    severity = Column(String(50), default="Warning", nullable=False)  # Critical, Warning, Info
    message = Column(Text, nullable=False)
    status = Column(String(50), default="ACTIVE", nullable=False)  # ACTIVE, ACKNOWLEDGED, RESOLVED
    created_at = Column(DateTime(timezone=True), default=_utcnow, index=True, nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship
    machine = relationship("Machine", back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_machine_created", "machine_id", "created_at"),
        UniqueConstraint("organization_id", "id", name="uq_alerts_organization_id"),
        CheckConstraint("severity IN ('Critical', 'Warning', 'Info')", name="ck_alerts_severity"),
        CheckConstraint("status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')", name="ck_alerts_status"),
    )


# ============================================================================
# 7. FEEDBACK / GROUND-TRUTH RECORDS TABLE (Technician-Observed Outcomes)
# ============================================================================
class FeedbackRecord(Base):
    __tablename__ = "feedback_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    prediction_id = Column(
        Integer,
        ForeignKey("predictions.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    alert_id = Column(
        Integer,
        ForeignKey("alerts.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    maintenance_record_id = Column(
        Integer,
        ForeignKey("maintenance_records.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    observed_condition = Column(Text, nullable=False)
    actual_fault = Column(String(200), nullable=True)
    root_cause = Column(Text, nullable=True)
    symptoms = Column(Text, nullable=True)
    action_taken = Column(Text, nullable=True)
    parts_replaced = Column(Text, nullable=True)
    severity = Column(String(50), nullable=False)  # Critical, Warning, Info
    outcome = Column(String(50), nullable=False)  # Confirmed, Not Confirmed, Cancelled
    technician_notes = Column(Text, nullable=True)
    prediction_correct = Column(Boolean, nullable=True)
    feedback_source = Column(String(30), nullable=False, default="MANUAL", server_default="MANUAL")  # MANUAL, INSPECTION
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationship
    machine = relationship("Machine", back_populates="feedback_records")

    __table_args__ = (
        CheckConstraint("severity IN ('Critical', 'Warning', 'Info')", name="ck_feedback_records_severity"),
        CheckConstraint("outcome IN ('Confirmed', 'Not Confirmed', 'Cancelled')", name="ck_feedback_records_outcome"),
        CheckConstraint("feedback_source IN ('MANUAL', 'INSPECTION')", name="ck_feedback_records_source"),
    )


# ============================================================================
# 8. MACHINE SIMULATION CONFIGURATION TABLE (Dynamic Digital Twin Settings)
# ============================================================================
class MachineSimulationConfig(Base):
    __tablename__ = "simulation_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        default=LEGACY_ORGANIZATION_ID,
        nullable=False,
        index=True,
    )
    machine_id = Column(
        String(50),
        ForeignKey("machines.machine_id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )

    # Motor power switch & global simulation mode
    motor_powered = Column(Boolean, default=True, nullable=False)
    simulation_mode = Column(String(50), default="cycling", nullable=False)  # cycling, increasing, decreasing, harmonic, bearing_fault, random_walk
    update_interval_ms = Column(Integer, default=1000, nullable=False)

    # 1. Temperature parameters (°C)
    temp_min = Column(Float, default=22.0, nullable=False)
    temp_max = Column(Float, default=45.0, nullable=False)
    temp_target = Column(Float, default=32.0, nullable=False)
    temp_step = Column(Float, default=0.2, nullable=False)
    temp_warning = Column(Float, default=45.0, nullable=False)
    temp_critical = Column(Float, default=60.0, nullable=False)

    # 2. Motor Current parameters (A)
    current_min = Column(Float, default=0.2, nullable=False)
    current_max = Column(Float, default=3.0, nullable=False)
    current_target = Column(Float, default=1.2, nullable=False)
    current_step = Column(Float, default=0.1, nullable=False)
    current_warning = Column(Float, default=2.0, nullable=False)
    current_critical = Column(Float, default=3.0, nullable=False)

    # 3. RPM parameters (RPM)
    rpm_min = Column(Float, default=0.0, nullable=False)
    rpm_max = Column(Float, default=1800.0, nullable=False)
    rpm_target = Column(Float, default=1450.0, nullable=False)
    rpm_step = Column(Float, default=50.0, nullable=False)
    rpm_rated = Column(Float, default=1500.0, nullable=False)
    rpm_warning = Column(Float, default=1050.0, nullable=False)
    rpm_critical = Column(Float, default=750.0, nullable=False)

    # 4. Vibration parameters (m/s² RMS)
    vib_min = Column(Float, default=0.1, nullable=False)
    vib_max = Column(Float, default=5.0, nullable=False)
    vib_target = Column(Float, default=0.8, nullable=False)
    vib_step = Column(Float, default=0.05, nullable=False)
    vib_warning = Column(Float, default=1.5, nullable=False)
    vib_critical = Column(Float, default=3.0, nullable=False)

    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationship back to Machine
    machine = relationship("Machine", back_populates="simulation_config")
