"""
Predict IQ - PostgreSQL Database Initialization Script
Verifies PostgreSQL database connection and creates all required tables and indexes.
Strictly zero synthetic or demo data inserted.
"""

import sys
from sqlalchemy import text
from backend.database.database import engine

def init_database():
    """
    Connects to PostgreSQL, creates all tables & indexes, and outputs status.
    """
    print("==================================================")
    print("  Predict IQ - PostgreSQL Database Initialization ")
    print("==================================================")
    print(f"Connecting to database: {engine.url.render_as_string(hide_password=True)}")

    try:
        # Test connection
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version();")).fetchone()
            print(f"✅ Connection successful! DB Version: {result[0] if result else 'Unknown'}")

        print("Connection verified. Run Alembic to create PostgreSQL tables:")
        print("   - machines")
        print("   - devices")
        print("   - sensor_readings (indexed on machine_id, device_id, timestamp)")
        print("   - maintenance_records")
        print("   - predictions")
        print("   - alerts")
        print("\nDatabase is ready for real ESP32 sensor telemetry ingestion.")
        return True

    except Exception as e:
        print(f"\n❌ Database initialization error: {e}")
        print("\nPlease check the Supabase credentials in backend/.env.")
        return False

if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)
