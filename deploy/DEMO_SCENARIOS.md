# PredictIQ Demo Scenarios (Phase 8)

This document details the six locked demo scenarios from `docs/V1-MIGRATION-PLAN.md` (§4, Phase 8).

**Important:** Demo scenarios must pass **without manually editing database records**.
Use the API and UI to drive all state changes.

---

## Scenario 1: Normal Operation

### Purpose
Verify the basic telemetry pipeline works end-to-end: device → ingest → storage → dashboard.

### Starting State
- Application stack deployed and running (frontend + backend + database)
- No machines registered in the system
- No devices registered
- No sensor readings in database

### Preconditions
- `POST /api/sensor-data` endpoint accessible
- Machine and device registration endpoints accessible
- Dashboard UI accessible

### Actions

#### Step 1: Register a Machine
```bash
curl -X POST http://localhost:8000/api/machines \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "name": "Main Drive Motor",
    "type": "Centrifugal Pump",
    "location": "Bay 3",
    "status": "Healthy",
    "specifications": {
      "ratedRPM": 1450,
      "ratedCurrent": 10.0,
      "maxTemp": 75.0,
      "maxVibration": 4.5
    }
  }'
```

**Expected Result:**
- HTTP 201 Created
- Machine returned with `machine_id: "MOTOR-001"`
- Machine persisted in PostgreSQL `machines` table

#### Step 2: Register a Device
```bash
curl -X POST http://localhost:8000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "device_type": "ESP32",
    "firmware_version": "1.0.0"
  }'
```

**Expected Result:**
- HTTP 201 Created
- Device returned with `device_id: "PIQ-ESP32-001"`
- Device status: "OFFLINE" (no heartbeat yet)
- Device linked to MOTOR-001

#### Step 3: Send Normal Telemetry
```bash
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-15T10:00:00Z",
    "temperature": 45.2,
    "vibration": 2.1,
    "current": 8.5,
    "rpm": 1440,
    "source": "WOKWI"
  }'
```

**Expected Result:**
- HTTP 201 Created
- `success: true`
- Reading ID returned
- Device status updated to "ONLINE"
- Health engine evaluates: all metrics NORMAL
- Machine status remains "Healthy"
- No alerts created

#### Step 4: Verify via Dashboard
- Open frontend at `http://localhost:3000`
- Navigate to Machines page
- Verify MOTOR-001 appears with:
  - Status: Healthy
  - Latest reading showing temperature ~45°C, vibration ~2.1 mm/s, etc.
  - Device listed as ONLINE

### Expected Backend State After Scenario
- 1 machine in `machines` table
- 1 device in `devices` table
- 1+ sensor readings in `sensor_readings` table
- Machine status: "Healthy"
- Device status: "ONLINE"
- Zero alerts in `alerts` table

### Expected Frontend State After Scenario
- Dashboard shows MOTOR-001
- Live monitoring shows recent telemetry
- No alerts displayed
- Machine card shows healthy status

### Verification Method
```bash
# Check machine exists
curl http://localhost:8000/api/machines/MOTOR-001

# Check device status
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status

# Check recent readings
curl http://localhost:8000/api/sensor-data?limit=5

# Verify no alerts
curl http://localhost:8000/api/alerts
# Expected: []

# Check health
curl http://localhost:8000/api/health
# Expected: {"status": "ok", ...}

# Check readiness
curl http://localhost:8000/api/ready
# Expected: {"status": "ready", ...}
```

### Pass Criteria
- All API calls return expected status codes
- No alerts generated for normal readings
- Dashboard displays real values (no placeholders)
- Machine status reflects healthy state

---

## Scenario 2: Degradation Detection

### Purpose
Verify the health engine detects degrading conditions and creates appropriate alerts.

### Starting State
- From Scenario 1: MOTOR-001 registered, device connected, normal telemetry flowing
- Machine in "Healthy" state
- No active alerts

### Preconditions
- Machine has specifications (rated_rpm, max_temp, max_vibration, rated_current)
- Device is ONLINE
- Health engine active on telemetry ingest

### Actions

#### Step 1: Send Elevated Temperature Reading
```bash
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-15T10:05:00Z",
    "temperature": 85.0,
    "vibration": 2.5,
    "current": 9.0,
    "rpm": 1445,
    "source": "WOKWI"
  }'
```

**Analysis:**
- Temperature 85°C vs max_temp 75°C → ratio 1.13 → WARNING threshold
- Vibration 2.5 vs max_vibration 4.5 → ratio 0.56 → NORMAL
- Current 9.0 vs rated_current 10.0 → ratio 0.9 → NORMAL
- Overall state: WARNING

**Expected Result:**
- HTTP 201 Created
- Machine status changes to "Warning"
- One ACTIVE alert created:
  - `alert_type: "TEMPERATURE_HIGH"`
  - `severity: "Warning"`
  - `status: "ACTIVE"`

#### Step 2: Send More Elevated Readings (Deduplication Test)
```bash
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-15T10:06:00Z",
    "temperature": 88.0,
    "vibration": 2.8,
    "current": 9.2,
    "rpm": 1448,
    "source": "WOKWI"
  }'
```

**Expected Result:**
- HTTP 201 Created
- Machine status remains "Warning"
- **No new alert created** (deduplication within cooldown window)
- Same TEMPERATURE_HIGH alert remains ACTIVE

#### Step 3: Verify Alert Lifecycle
```bash
# List alerts
curl http://localhost:8000/api/alerts

# Acknowledge alert
curl -X POST http://localhost:8000/api/alerts/1/acknowledge

# Check alert status
curl http://localhost:8000/api/alerts/1
# Expected: status "ACKNOWLEDGED"
```

### Expected Backend State After Scenario
- Machine status: "Warning"
- 1 ACTIVE or ACKNOWLEDGED alert (TEMPERATURE_HIGH)
- No duplicate alerts from repeated readings
- Alert lifecycle endpoints functional

### Expected Frontend State After Scenario
- Machine card shows "Warning" status
- Alert panel shows TEMPERATURE_HIGH alert
- Alert can be acknowledged from UI

### Verification Method
```bash
# Check machine status
curl http://localhost:8000/api/machines/MOTOR-001
# Expected: status "Warning"

# Check active alerts
curl "http://localhost:8000/api/alerts?status_filter=ACTIVE"
# Expected: 1 alert with alert_type TEMPERATURE_HIGH

# Check alert count (should be 1, not 2+)
curl http://localhost:8000/api/alerts | python -c "import sys,json; print(len(json.load(sys.stdin)))"
# Expected: 1 (deduplication working)
```

### Pass Criteria
- Machine status changes from Healthy → Warning based on telemetry
- Alert created for the degraded condition
- Deduplication prevents alert spam (1 alert per condition window)
- Alert lifecycle (acknowledge/resolve) works via API

---

## Scenario 3: Critical/Failure Escalation

### Purpose
Verify the system escalates from warning to critical and generates predictions.

### Starting State
- From Scenario 2: MOTOR-001 in Warning state
- Active TEMPERATURE_HIGH alert (may be acknowledged)
- Device still sending telemetry

### Preconditions
- Machine in Warning state
- Device ONLINE
- All four sensor channels functional

### Actions

#### Step 1: Send Critical Readings
```bash
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-15T10:10:00Z",
    "temperature": 110.0,
    "vibration": 7.5,
    "current": 14.0,
    "rpm": 1750,
    "source": "WOKWI"
  }'
```

**Analysis:**
- Temperature 110°C vs max_temp 75°C → ratio 1.47 → CRITICAL
- Vibration 7.5 vs max_vibration 4.5 → ratio 1.67 → CRITICAL
- Current 14.0 vs rated_current 10.0 → ratio 1.4 → CRITICAL
- RPM 1750 vs rated_rpm 1450 → deviation 20.7% → CRITICAL
- Overall state: CRITICAL

**Expected Result:**
- HTTP 201 Created
- Machine status escalates to "Critical"
- New CRITICAL alerts created:
  - TEMPERATURE_HIGH (Critical)
  - VIBRATION_HIGH (Critical)
  - CURRENT_HIGH (Critical)
  - RPM_DEVIATION (Critical)

#### Step 2: Trigger a Prediction
```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "temperature": 110.0,
    "vibration": 7.5,
    "current": 14.0,
    "rpm": 1750
  }'
```

**Expected Result:**
- HTTP 201 Created
- Prediction returned with:
  - `failure_probability`: high value (e.g., 0.85+)
  - `component`: "Bearing" or similar
  - `is_prototype: true` (honest labeling)
  - `explanation`: text explaining factors
  - `contributing_factors`: structured list
  - `model_version: "physics-rule-v1"`
- **No fabricated RUL** (remaining_life_days is null/absent)
- **No invented confidence** (confidence is null/absent or explicitly prototype)

#### Step 3: Verify Prediction via Machine Endpoint
```bash
curl http://localhost:8000/api/machines/MOTOR-001/prediction
```

**Expected Result:**
- Returns the persisted prediction
- `prediction_available: true`
- Same values as created above

### Expected Backend State After Scenario
- Machine status: "Critical"
- Multiple CRITICAL alerts (one per violated metric)
- Prediction persisted in `predictions` table
- Prediction has `is_prototype: true`
- No RUL value fabricated
- No invented confidence value

### Expected Frontend State After Scenario
- Machine card shows "Critical" status (red/alert styling)
- Multiple alerts visible
- Prediction card shows:
  - Failure probability
  - Component
  - Explanation
  - Prototype labeling
- **No "150 Days" or fabricated RUL displayed**
- **No fabricated confidence percentage displayed**

### Verification Method
```bash
# Verify critical status
curl http://localhost:8000/api/machines/MOTOR-001
# Expected: status "Critical"

# Check all alerts
curl http://localhost:8000/api/alerts
# Expected: multiple alerts, some CRITICAL severity

# Check prediction
curl http://localhost:8000/api/machines/MOTOR-001/prediction
# Expected: prediction with is_prototype true, no RUL

# Verify no RUL in response
curl http://localhost:8000/api/machines/MOTOR-001/prediction | python -c "import sys,json; d=json.load(sys.stdin); print('RUL present:', 'remaining_life_days' in d and d.get('remaining_life_days') is not None)"
# Expected: RUL present: False
```

### Pass Criteria
- Machine status escalates to Critical
- Appropriate CRITICAL alerts created
- Prediction generated with honest prototype labeling
- No fabricated RUL or confidence values
- Frontend shows real prediction data

---

## Scenario 4: Offline Device Detection

### Purpose
Verify the system detects when a device goes offline and updates status accordingly.

### Starting State
- From Scenario 3: Device PIQ-ESP32-001 ONLINE, sending telemetry
- Machine MOTOR-001 in Critical state
- Device last_seen within timeout window

### Preconditions
- Device timeout configured (default: 60 seconds)
- Device has been sending telemetry recently

### Actions

#### Step 1: Verify Device is Currently Online
```bash
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status
```

**Expected Result:**
- `status: "ONLINE"`
- `last_seen`: recent timestamp

#### Step 2: Stop Sending Telemetry
- Do not send any more sensor-data POSTs
- Wait for device timeout period (60 seconds default)

#### Step 3: Check Device Status After Timeout
```bash
# Wait 60+ seconds, then check
sleep 65
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status
```

**Expected Result:**
- `status: "OFFLINE"`
- `last_seen`: timestamp from before the wait
- Device still exists in database (not deleted)

#### Step 4: Verify Data Collection Status
```bash
curl http://localhost:8000/api/data-status
```

**Expected Result:**
- `sensor_status: "OFFLINE"` (no active devices)
- `data_collection: "WAITING"`
- `active_devices_count: 0`
- `total_readings`: count of stored readings (unchanged)

#### Step 5: Send Heartbeat to Bring Device Back Online
```bash
curl -X POST http://localhost:8000/api/devices/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "source": "WOKWI",
    "timestamp": "2026-01-15T10:20:00Z"
  }'
```

**Expected Result:**
- HTTP 200 OK
- Device status back to "ONLINE"
- `last_seen` updated

### Expected Backend State After Scenario
- Device status transitions ONLINE → OFFLINE → ONLINE
- Machine remains in database with last known status
- No data loss (readings preserved)

### Expected Frontend State After Scenario
- Device status indicator shows OFFLINE after timeout
- Dashboard shows "Waiting for data" or similar
- After heartbeat, device shows ONLINE again

### Verification Method
```bash
# Check device status transitions
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status
# Before wait: ONLINE
# After wait: OFFLINE
# After heartbeat: ONLINE

# Check data status reflects offline state
curl http://localhost:8000/api/data-status
# Expected: sensor_status OFFLINE, data_collection WAITING when no active devices
```

### Pass Criteria
- Device status correctly computed from last_seen
- Offline detection works within timeout window
- Device not deleted when offline (only status changes)
- Heartbeat restores ONLINE status
- Frontend reflects status changes

---

## Scenario 5: Maintenance + Feedback Loop

### Purpose
Verify the complete feedback/ground-truth loop: alert → inspection → maintenance → feedback → prediction-vs-reality.

### Starting State
- From Scenario 3: MOTOR-001 in Critical state
- Active CRITICAL alerts
- Prediction generated for the machine
- Device may be offline or online

### Preconditions
- Machine MOTOR-001 exists
- At least one prediction exists for the machine
- At least one alert exists for the machine
- All feedback API endpoints accessible

### Actions

#### Step 1: Create a Maintenance Record
```bash
curl -X POST http://localhost:8000/api/maintenance \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "component": "Drive-end Bearing",
    "failure_type": "Spalling",
    "issue_description": "Excessive vibration and elevated bearing temperature",
    "maintenance_action": "Replaced drive-end spherical roller bearing and seal",
    "technician": "David Zhang",
    "status": "Completed",
    "failure_date": "2026-01-15T09:00:00Z",
    "maintenance_date": "2026-01-15T14:00:00Z"
  }'
```

**Expected Result:**
- HTTP 201 Created
- Maintenance record ID returned (e.g., `id: 1`)
- Record linked to MOTOR-001

#### Step 2: Create Feedback / Ground-Truth Record
```bash
curl -X POST http://localhost:8000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "prediction_id": 1,
    "alert_id": 1,
    "maintenance_record_id": 1,
    "observed_condition": "Bearing noise, elevated temperature, high vibration",
    "actual_fault": "Bearing spalling",
    "root_cause": "Insufficient lubrication leading to fatigue spalling",
    "symptoms": "High vibration (7.5 mm/s), high temperature (110°C), bearing noise",
    "action_taken": "Replaced drive-end bearing and seal, cleaned housing",
    "parts_replaced": "Drive-end spherical roller bearing (6205-2RS), labyrinth seal",
    "severity": "Critical",
    "outcome": "Confirmed",
    "technician_notes": "Bearing showed clear spalling pattern on raceway. Lubrication audit recommended.",
    "prediction_correct": true,
    "feedback_source": "INSPECTION"
  }'
```

**Expected Result:**
- HTTP 201 Created
- Feedback record ID returned
- All links stored:
  - `prediction_id: 1` (linked to prediction)
  - `alert_id: 1` (linked to originating alert)
  - `maintenance_record_id: 1` (linked to work order)
- `prediction_correct: true` stored
- `outcome: "Confirmed"` stored

#### Step 3: Verify Feedback Integrity
```bash
# Get feedback record
curl http://localhost:8000/api/feedback/1

# Check all fields present
curl http://localhost:8000/api/feedback/1 | python -m json.tool
```

**Expected Result:**
- All feedback fields populated
- Links to prediction, alert, maintenance verified
- Machine isolation enforced (feedback belongs to MOTOR-001)

#### Step 4: Check Prediction-vs-Reality Evaluation
```bash
curl http://localhost:8000/api/model-evaluation
```

**Expected Result:**
- `evaluated: true` (if prediction_correct verdict exists)
- `correct_count: 1`
- `incorrect_count: 0`
- `prototype_accuracy: 1.0` (1 correct of 1 verdict)
- Ground truth count includes the new feedback record

#### Step 5: Verify via Frontend
- Navigate to Maintenance page
- Verify maintenance record appears
- Navigate to feedback section (if available in UI)
- Verify feedback form captures all fields
- Check prediction-vs-reality view shows comparison

### Expected Backend State After Scenario
- Maintenance record in `maintenance_records` table
- Feedback record in `feedback_records` table with:
  - All 15+ fields populated
  - Links to prediction, alert, maintenance
  - prediction_correct stored
- Ground truth available for future ML training
- Evaluation reflects the new verdict

### Expected Frontend State After Scenario
- Maintenance record visible
- Feedback captured via form
- Prediction-vs-reality comparison shows:
  - Prediction: (e.g., "Bearing", 0.85 probability)
  - Actual: "Bearing spalling"
  - Match: Yes (prediction_correct: true)

### Verification Method
```bash
# Verify feedback stored correctly
curl http://localhost:8000/api/feedback | python -c "
import sys, json
feedback = json.load(sys.stdin)
assert len(feedback) >= 1
f = feedback[0]
assert f['machine_id'] == 'MOTOR-001'
assert f['prediction_correct'] == True
assert f['outcome'] == 'Confirmed'
assert f['actual_fault'] == 'Bearing spalling'
print('Feedback record verified')
"

# Verify evaluation reflects ground truth
curl http://localhost:8000/api/model-evaluation | python -c "
import sys, json
eval_data = json.load(sys.stdin)
assert eval_data['ground_truth_count'] >= 1
assert eval_data['evaluated_count'] >= 1
print(f'Evaluation: {eval_data[\"correct_count\"]}/{eval_data[\"evaluated_count\"]} correct')
"
```

### Pass Criteria
- Maintenance record created with all required fields
- Feedback record created with full field set (15+ fields)
- Links to prediction, alert, maintenance all valid
- Machine isolation enforced
- prediction_correct stored and used in evaluation
- Evaluation endpoint reflects new ground truth
- No manual database edits required

---

## Scenario 6: Real Hardware Device (Optional)

### Purpose
Verify real ESP32-S3 hardware can send telemetry that the backend accepts with `source: "REAL_HARDWARE"`.

### Starting State
- Application stack deployed and running
- Real ESP32-S3 device with sensors configured (Phase 7 complete)
- Device connected to network with route to backend

### Preconditions
- Phase 7 firmware deployed to ESP32-S3
- Sensors configured and reading actual values
- Device network access to backend URL
- Backend configured to accept REAL_HARDWARE source

### Actions

#### Step 1: Configure Device Firmware
- Set backend URL in device config to deployment URL
- Example: `http://predictiq.example.com` or `http://192.168.1.100:8000`
- Ensure `SENSOR_SOURCE` is set to `"REAL_HARDWARE"` (not "WOKWI")

#### Step 2: Device Sends Telemetry
- Device automatically sends telemetry at configured interval
- Payload includes:
  - `device_id`: unique device identifier
  - `machine_id`: linked machine
  - `timestamp`: current time
  - `temperature`: from actual temperature sensor
  - `vibration`: from actual vibration sensor (mm/s RMS)
  - `current`: from actual current sensor (A)
  - `rpm`: from actual RPM sensor
  - `source`: "REAL_HARDWARE"

#### Step 3: Verify Ingestion
```bash
# Check device registered with REAL_HARDWARE source
curl http://localhost:8000/api/devices

# Check recent readings have REAL_HARDWARE source
curl http://localhost:8000/api/sensor-data?limit=10 | python -c "
import sys, json
readings = json.load(sys.stdin)
for r in readings:
    print(f\"{r['timestamp']}: source={r['source']}, temp={r['temperature']}°C, vib={r['vibration']} mm/s\")
"
```

**Expected Result:**
- Device appears in devices list
- `source: "REAL_HARDWARE"` on all readings
- Temperature, vibration, current, RPM within valid bounds
- Readings accepted (HTTP 201)

#### Step 4: Verify Health Engine Works Same as Wokwi
- Health engine evaluates REAL_HARDWARE readings identically to WOKWI
- Machine status updates based on actual sensor values
- Alerts created if thresholds exceeded

### Expected Backend State After Scenario
- Device registered with `source: "REAL_HARDWARE"`
- Sensor readings stored with REAL_HARDWARE source
- Health evaluation works identically regardless of source
- No difference in backend behavior

### Expected Frontend State After Scenario
- Device shows as REAL_HARDWARE source
- Telemetry displayed same as any other source
- Dashboard doesn't distinguish between simulation and real hardware

### Verification Method
```bash
# Verify REAL_HARDWARE source is recorded
curl http://localhost:8000/api/sensor-data?limit=5 | python -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    assert r['source'] == 'REAL_HARDWARE', f\"Wrong source: {r['source']}\"
print('All readings have REAL_HARDWARE source')
"

# Verify health evaluation works
curl http://localhost:8000/api/machines/MOTOR-001
# Status should reflect actual sensor values
```

### Pass Criteria
- Device sends telemetry with REAL_HARDWARE source
- Backend accepts and stores readings
- Health engine evaluates real sensor data
- No backend differences based on source
- Frontend displays real hardware data

### Notes
- This scenario requires actual Phase 7 hardware implementation
- If hardware is not available, this scenario is documented but not executable
- The backend treats REAL_HARDWARE and WOKWI identically after ingestion
- The source field is for provenance tracking, not behavior differentiation

---

## Demo Execution Checklist

Before running demos:

- [ ] Stack deployed: `docker compose -f deploy/docker-compose.yml up --build -d`
- [ ] All services healthy: `docker compose ps`
- [ ] Backend ready: `curl http://localhost:8000/api/ready`
- [ ] Frontend accessible: open `http://localhost:3000`
- [ ] .env configured with appropriate values
- [ ] Database migrations applied (check logs)

During demos:

- [ ] Use API or UI — no direct database edits
- [ ] Verify each step's expected result before proceeding
- [ ] Document any deviations from expected behavior

After demos:

- [ ] All scenarios completed or documented as blocked
- [ ] Screenshots/recordings captured (for demo evidence)
- [ ] Any issues noted for follow-up

---

## Troubleshooting Demo Scenarios

### Scenario 1 Fails: Machine Registration

**Symptom:** POST /api/machines returns 400 or 500
**Check:**
- Database is running: `docker compose ps database`
- Backend is healthy: `curl http://localhost:8000/api/ready`
- Request body is valid JSON
- machine_id doesn't already exist

### Scenario 2 Fails: No Alert Created

**Symptom:** Sending elevated telemetry doesn't create alert
**Check:**
- Machine has specifications set (max_temp, max_vibration, etc.)
- Reading exceeds threshold (ratio >= 1.0 for WARNING)
- Check alert cooldown hasn't suppressed it
- Check logs: `docker compose logs backend | grep -i alert`

### Scenario 3 Fails: No Prediction

**Symptom:** POST /api/predict returns error or missing fields
**Check:**
- Machine exists
- All four sensor values provided (temperature, vibration, current, rpm)
- Values within valid bounds
- Check prediction response has is_prototype: true
- Verify no RUL or confidence in response

### Scenario 4 Fails: Device Stays ONLINE

**Symptom:** Device status doesn't change to OFFLINE
**Check:**
- Device timeout setting (default 60s)
- Actually waited long enough
- Check device last_seen timestamp
- No heartbeat sent during wait period

### Scenario 5 Fails: Feedback Not Linked

**Symptom:** Feedback created but links missing or invalid
**Check:**
- prediction_id references existing prediction for same machine
- alert_id references existing alert for same machine
- maintenance_record_id references existing maintenance for same machine
- Machine isolation enforced (can't link to other machine's records)

---

## Demo Evidence Collection

For each scenario, collect:

1. **API requests and responses** (curl commands + output)
2. **Database state** (select queries showing resulting rows)
3. **Frontend screenshots** (dashboard, machine details, alerts, etc.)
4. **Logs** (backend logs showing health evaluation, alert creation)

Store evidence in a demo-run directory (not committed to repo if it contains sensitive data).
