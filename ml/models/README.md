# Predict IQ - Real-Data ML Model Artifacts & Architecture

This directory stores serialized models and metadata trained strictly on genuine industrial IoT telemetry and ground-truth maintenance logs.

---

## 1. Zero Synthetic Data Policy

Predict IQ implements a **Real-Data-First** predictive maintenance philosophy:
- **No Mock Predictions**: The system does not generate fake sensor readings or fabricate static failure probabilities (e.g. 87%).
- **No Artificial Training Sets**: Machine learning models are trained directly on real time-series data ingested through `POST /api/sensor-data`.
- **Verified Ground Truth**: Maintenance events logged in the maintenance registry provide real labels for failure classification and degradation tracking.

---

## 2. ML Training Workflow

```
ESP32 Real Sensors (Temp, Vib, Current, RPM)
           ↓
POST /api/sensor-data (with Data Quality Validation)
           ↓
SQLite Persistence (`sensor_readings` + `maintenance`)
           ↓
POST /api/train-model (Feature Extraction & Scikit-Learn Training)
           ↓
Trained Artifact (`ai/model/real_model.joblib`)
           ↓
Model Metadata & Validation Metrics (`ai/model/metadata.json`)
           ↓
SHAP Explainability & Dynamic RUL Calculation
```

---

## 3. Training Requirements & Data Collection

To train or retrain a model on real data:
1. Ensure at least **20 valid sensor readings** have been ingested from connected ESP32 nodes or manual logs.
2. Ensure maintenance actions / repair logs are recorded in the Maintenance registry.
3. Trigger training via REST API:
   ```bash
   curl -X POST http://localhost:8000/api/train-model
   ```
4. The system evaluates validation accuracy via Cross-Validation and serializes:
   - `real_model.joblib`: Trained `RandomForestClassifier` pipeline.
   - `metadata.json`: Model version, training timestamp, sample count, feature weights, and validation metrics.

---

## 4. How to Replace with an Enterprise Industrial Dataset

To train Predict IQ on public or proprietary datasets (e.g., **NASA Turbofan C-MAPSS**, **IMS Bearing Dataset**, or **SCADA CSV logs**):
1. Import historical CSV telemetry into the `sensor_readings` table.
2. Align sensor columns: `temperature`, `vibration`, `current`, `rpm`, `timestamp`, `machine_id`.
3. Execute `ai/training.py` or invoke `POST /api/train-model`.
4. The API and frontend automatically transition to **State 4 (Model Trained)** and **State 5 (Predictive Maintenance Active)**.
