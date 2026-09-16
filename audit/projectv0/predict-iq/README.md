# Predict IQ staging

Predict IQ connects Wokwi ESP32 sensor data to FastAPI, Supabase PostgreSQL, and the existing dashboard. The database starts empty. The system does not generate demo telemetry, random values, fake predictions, RUL, confidence, health, or anomaly scores.

## Environment

Copy `.env.example` to `.env` and set `DATABASE_URL` to the Supabase PostgreSQL connection string. Keep database credentials and Supabase secret/service-role keys server-side. Set `VITE_API_URL` to the FastAPI origin used by the browser.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
alembic upgrade head
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

In another terminal:

```powershell
npm install
$env:VITE_API_URL = "http://localhost:8000"
npm run dev
```

The SQL equivalent is in `supabase/schema.sql`. It creates tables and indexes only; it has no inserts.

## API contract

- `GET /api/health` checks FastAPI and PostgreSQL.
- `POST /api/sensor-data` stores validated readings with `source` equal to `WOKWI` or `REAL_HARDWARE` and returns `{ "success": true, "id": ... }`.
- `POST /api/devices/heartbeat` stores `last_seen`, `status`, firmware, and source.
- `GET /api/machines/{machine_id}/latest` returns the newest real reading.
- `GET /api/machines/{machine_id}/history?limit=100` returns chronological real readings.
- Device status is `ONLINE` when its heartbeat is within `DEVICE_TIMEOUT_SECONDS`, otherwise `OFFLINE`.

## Wokwi to FastAPI

Wokwi cannot reach `localhost`. Expose the FastAPI port with a public HTTPS tunnel or deploy FastAPI to a reachable staging host. For example, with a tunnel tool that provides an HTTPS forwarding URL:

```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# In a second terminal, start your tunnel and copy its HTTPS forwarding URL.
```

Set that URL, without a trailing `/api`, in `wokwi/src/config.h`:

```cpp
#define API_BASE_URL "https://your-reachable-fastapi-host.example.com"
```

Do not put PostgreSQL credentials or Supabase keys in Wokwi or frontend files. Wokwi uses `Wokwi-GUEST`, reads DS18B20, MPU6050, analog current, and pulse RPM, sends `source: "WOKWI"`, prints actual HTTP statuses, and sends heartbeat requests every 30 seconds.

## Required verification order

1. `python backend/test_db.py` confirms Supabase PostgreSQL connectivity.
2. `alembic upgrade head` creates the six tables and indexes.
3. Open `/docs` and call `GET /api/health`.
4. Call `POST /api/sensor-data` with a real Wokwi-shaped payload.
5. Verify the inserted row in Supabase `sensor_readings`.
6. Call `POST /api/devices/heartbeat` and verify `devices.last_seen`, `status`, and `source`.
7. Run Wokwi and confirm its serial monitor shows actual `HTTP Status` values.
8. Confirm the Wokwi request and row in Supabase.
9. Call the latest and history GET endpoints.
10. Open the dashboard and confirm its 4-second polling shows the same real values.

The system must not be called LIVE until steps 7 and 8 show an actual Wokwi HTTP request and an actual Supabase row. With this code change alone, it is not being reported as LIVE.

## AI behavior

The dashboard displays AI prediction values as unavailable until a validated real-data ML model exists. Wokwi data is tagged as simulation data and is not used for ML training.
