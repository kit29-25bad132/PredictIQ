"""Initial PostgreSQL schema for Predict IQ

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-08-31 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Create machines table
    op.create_table(
        'machines',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('location', sa.String(length=150), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='Healthy', nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('machine_id')
    )
    op.create_index(op.f('ix_machines_machine_id'), 'machines', ['machine_id'], unique=True)

    # 2. Create devices table (ESP32 Nodes)
    op.create_table(
        'devices',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('device_id', sa.String(length=100), nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('device_type', sa.String(length=100), server_default='ESP32', nullable=False),
        sa.Column('firmware_version', sa.String(length=50), server_default='v1.0.0', nullable=False),
        sa.Column('status', sa.String(length=50), server_default='OFFLINE', nullable=False),
        sa.Column('last_seen', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['machine_id'], ['machines.machine_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('device_id')
    )
    op.create_index(op.f('ix_devices_device_id'), 'devices', ['device_id'], unique=True)
    op.create_index(op.f('ix_devices_machine_id'), 'devices', ['machine_id'], unique=False)

    # 3. Create sensor_readings table
    op.create_table(
        'sensor_readings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('device_id', sa.String(length=100), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('temperature', sa.Float(), nullable=False),
        sa.Column('vibration', sa.Float(), nullable=False),
        sa.Column('current', sa.Float(), nullable=False),
        sa.Column('rpm', sa.Float(), nullable=False),
        sa.Column('source', sa.String(length=30), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['devices.device_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['machine_id'], ['machines.machine_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sensor_readings_timestamp'), 'sensor_readings', ['timestamp'], unique=False)
    op.create_index(op.f('ix_sensor_readings_machine_id'), 'sensor_readings', ['machine_id'], unique=False)
    op.create_index(op.f('ix_sensor_readings_device_id'), 'sensor_readings', ['device_id'], unique=False)
    op.create_index('ix_sensor_readings_machine_timestamp', 'sensor_readings', ['machine_id', 'timestamp'], unique=False)
    op.create_index('ix_sensor_readings_device_timestamp', 'sensor_readings', ['device_id', 'timestamp'], unique=False)

    # 4. Create maintenance_records table
    op.create_table(
        'maintenance_records',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('component', sa.String(length=100), nullable=False),
        sa.Column('failure_type', sa.String(length=100), nullable=True),
        sa.Column('issue_description', sa.Text(), nullable=False),
        sa.Column('maintenance_action', sa.Text(), nullable=False),
        sa.Column('technician', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='Scheduled', nullable=False),
        sa.Column('failure_date', sa.DateTime(), nullable=True),
        sa.Column('maintenance_date', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['machine_id'], ['machines.machine_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_maintenance_records_machine_id'), 'maintenance_records', ['machine_id'], unique=False)

    # 5. Create predictions table
    op.create_table(
        'predictions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('failure_probability', sa.Float(), nullable=False),
        sa.Column('component', sa.String(length=100), nullable=False),
        sa.Column('remaining_life_days', sa.Integer(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('recommended_action', sa.Text(), nullable=True),
        sa.Column('model_version', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['machine_id'], ['machines.machine_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_predictions_timestamp'), 'predictions', ['timestamp'], unique=False)
    op.create_index(op.f('ix_predictions_machine_id'), 'predictions', ['machine_id'], unique=False)
    op.create_index('ix_predictions_machine_timestamp', 'predictions', ['machine_id', 'timestamp'], unique=False)

    # 6. Create alerts table
    op.create_table(
        'alerts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('machine_id', sa.String(length=50), nullable=False),
        sa.Column('alert_type', sa.String(length=100), nullable=False),
        sa.Column('severity', sa.String(length=50), server_default='Warning', nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='ACTIVE', nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['machine_id'], ['machines.machine_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alerts_machine_id'), 'alerts', ['machine_id'], unique=False)
    op.create_index(op.f('ix_alerts_created_at'), 'alerts', ['created_at'], unique=False)
    op.create_index('ix_alerts_machine_created', 'alerts', ['machine_id', 'created_at'], unique=False)

def downgrade() -> None:
    op.drop_table('alerts')
    op.drop_table('predictions')
    op.drop_table('maintenance_records')
    op.drop_table('sensor_readings')
    op.drop_table('devices')
    op.drop_table('machines')
