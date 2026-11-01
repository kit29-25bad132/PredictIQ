"""
Tests for Machine Simulation Configuration API and Schemas.

Covers request validation, response schemas, and the operator-session
authentication required on every mutation endpoint (POST, PUT, reset).
All tests run against in-memory SQLite - no persistent/production data.
"""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine
from backend.app.main import app
from backend.app.schemas.simulation import (
    SimulationConfigBase,
    SimulationConfigUpdate,
    SimulationConfigResponse,
)

OPERATOR_TEST_SECRET = "unit-test-operator-secret-123"


def _set_operator_secret(value: str) -> None:
    """Patch the cached Settings instance operator_session_secret.

    get_settings() is lru_cache'd and auth.py reads the live instance on
    every request, so patching it here enables real session-token
    verification inside tests without touching environment files.
    """
    get_settings().operator_session_secret = value


def _operator_cookie(token: str | None = None) -> dict:
    """Build the HttpOnly session cookie the browser would send."""
    if token is None:
        token = auth_module.create_operator_session_token(3600, OPERATOR_TEST_SECRET)
    return {auth_module.SESSION_COOKIE_NAME: f"{auth_module.SESSION_SIGNED_PREFIX}{token}"}


def _valid_config_payload() -> dict:
    return {
        "motor_powered": True,
        "simulation_mode": "cycling",
        "update_interval_ms": 1000,
        "temp_min": 30.0,
        "temp_max": 35.0,
        "temp_target": 32.5,
        "temp_step": 0.2,
        "temp_warning": 80.0,
        "temp_critical": 95.0,
        "current_min": 2.0,
        "current_max": 8.0,
        "current_step": 0.2,
        "current_target": 5.0,
        "current_warning": 10.0,
        "current_critical": 12.0,
        "rpm_target": 1800.0,
        "rpm_min": 0.0,
        "rpm_max": 3000.0,
        "rpm_step": 100.0,
        "rpm_rated": 1800.0,
        "rpm_warning": 1200.0,
        "rpm_critical": 900.0,
        "vib_min": 0.02,
        "vib_max": 3.0,
        "vib_step": 0.08,
        "vib_target": 0.6,
        "vib_warning": 4.5,
        "vib_critical": 7.1,
    }


@pytest.fixture
def client_with_db():
    """In-memory SQLite test client for fast, deterministic unit/integration testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Pre-seed test machine
    db = TestingSessionLocal()
    machine = Machine(
        machine_id="MOTOR-001",
        name="Digital Twin Induction Motor",
        type="Induction Motor",
        location="Bay 1",
        status="Healthy",
        rated_rpm=1500.0,
        rated_current=2.0,
        max_temp=60.0,
    )
    db.add(machine)
    db.commit()
    db.close()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_simulation_config_validation_rules():
    """Verify bounds and threshold validation logic in Pydantic schema."""
    # Valid payload
    valid_data = {
        "motor_powered": True,
        "simulation_mode": "cycling",
        "update_interval_ms": 1000,
        "temp_min": 22.0,
        "temp_max": 25.0,
        "temp_target": 23.5,
        "temp_step": 0.1,
        "temp_warning": 75.0,
        "temp_critical": 90.0,
        "current_min": 1.0,
        "current_max": 10.0,
        "current_step": 0.1,
        "current_target": 4.5,
        "current_warning": 12.0,
        "current_critical": 15.0,
        "rpm_target": 1450.0,
        "rpm_min": 0.0,
        "rpm_max": 3000.0,
        "rpm_step": 50.0,
        "rpm_rated": 1500.0,
        "rpm_warning": 1050.0,
        "rpm_critical": 750.0,
        "vib_min": 0.01,
        "vib_max": 2.5,
        "vib_step": 0.05,
        "vib_target": 0.45,
        "vib_warning": 4.5,
        "vib_critical": 7.1,
    }
    schema = SimulationConfigBase(**valid_data)
    assert schema.temp_min == 22.0
    assert schema.simulation_mode == "cycling"

    # Inverted temp bounds (min >= max)
    invalid_temp = dict(valid_data, temp_min=50.0, temp_max=30.0)
    with pytest.raises(ValidationError):
        SimulationConfigBase(**invalid_temp)

    # Inverted temp thresholds (warning >= critical)
    invalid_threshold = dict(valid_data, temp_warning=95.0, temp_critical=90.0)
    with pytest.raises(ValidationError):
        SimulationConfigBase(**invalid_threshold)

    # Inverted current bounds (min >= max)
    invalid_current = dict(valid_data, current_min=15.0, current_max=10.0)
    with pytest.raises(ValidationError):
        SimulationConfigBase(**invalid_current)

    # Inverted rpm bounds
    invalid_rpm = dict(valid_data, rpm_min=2000.0, rpm_max=1000.0)
    with pytest.raises(ValidationError):
        SimulationConfigBase(**invalid_rpm)

    # Inverted vibration thresholds
    invalid_vib = dict(valid_data, vib_warning=8.0, vib_critical=6.0)
    with pytest.raises(ValidationError):
        SimulationConfigBase(**invalid_vib)


def test_simulation_config_mutations_require_operator_session(client_with_db):
    """Every simulation-config mutation (POST, PUT, reset) must be operator-gated.

    Anonymous, forged, expired, and wrong-secret sessions are rejected; a valid
    operator session is accepted and request validation still applies.
    """
    client = client_with_db
    _set_operator_secret(OPERATOR_TEST_SECRET)
    payload = _valid_config_payload()
    mutations = [
        ("post", "/api/machines/MOTOR-001/simulation-config", payload),
        ("put", "/api/machines/MOTOR-001/simulation-config", payload),
        ("post", "/api/machines/MOTOR-001/simulation-config/reset", None),
    ]

    forged = _operator_cookie("9999999999.deadbeef")
    expired = _operator_cookie(
        auth_module.create_operator_session_token(-60, OPERATOR_TEST_SECRET)
    )
    wrong_secret = _operator_cookie(
        auth_module.create_operator_session_token(3600, "some-other-secret")
    )

    try:
        for method, url, body in mutations:
            send = getattr(client, method)
            kwargs = {"json": body} if body is not None else {}

            anon = send(url, **kwargs)
            assert anon.status_code == 401, f"{method.upper()} {url}: {anon.text}"

            for label, cookies in (
                ("forged", forged),
                ("expired", expired),
                ("wrong-secret", wrong_secret),
            ):
                rejected = send(url, cookies=cookies, **kwargs)
                assert rejected.status_code == 401, (
                    f"{method.upper()} {url} with {label} session: {rejected.status_code}"
                )

        # A valid operator session is accepted on PUT.
        put_res = client.put(
            "/api/machines/MOTOR-001/simulation-config",
            json=dict(payload, temp_target=33.0),
            cookies=_operator_cookie(),
        )
        assert put_res.status_code == 200
        assert put_res.json()["temp_target"] == 33.0

        # Request validation still runs for authenticated callers.
        invalid = client.put(
            "/api/machines/MOTOR-001/simulation-config",
            json=dict(payload, temp_min=50.0, temp_max=30.0),
            cookies=_operator_cookie(),
        )
        assert invalid.status_code == 422

        # Public GET remains readable without credentials.
        assert client.get("/api/machines/MOTOR-001/simulation-config").status_code == 200

        # Fail closed when operator session authentication is not configured.
        _set_operator_secret("")
        unconfigured = client.post(
            "/api/machines/MOTOR-001/simulation-config", json=payload
        )
        assert unconfigured.status_code == 503
    finally:
        _set_operator_secret("")


def test_simulation_config_api_endpoints(client_with_db):
    """Verify GET, POST, and Reset endpoints (mutations require a valid operator session)."""
    client = client_with_db
    _set_operator_secret(OPERATOR_TEST_SECRET)
    try:
        # 1. Fetch simulation config for test machine MOTOR-001 (auto-created default)
        #    GET stays public: no credentials needed.
        get_res = client.get("/api/machines/MOTOR-001/simulation-config")
        assert get_res.status_code == 200
        data = get_res.json()
        assert "temp_min" in data
        assert "simulation_mode" in data
        assert data["machine_id"] == "MOTOR-001"

        # 2. Update simulation config as an authenticated operator
        new_config = _valid_config_payload()
        post_res = client.post(
            "/api/machines/MOTOR-001/simulation-config",
            json=new_config,
            cookies=_operator_cookie(),
        )
        assert post_res.status_code == 200
        saved = post_res.json()
        assert saved["temp_min"] == 30.0
        assert saved["temp_max"] == 35.0
        assert saved["simulation_mode"] == "increasing" or saved["simulation_mode"] == "cycling"
        assert saved["rpm_target"] == 1800.0

        # 3. Verify subsequent GET returns the persisted settings
        get_after = client.get("/api/machines/MOTOR-001/simulation-config")
        assert get_after.status_code == 200
        assert get_after.json()["temp_min"] == 30.0
        assert get_after.json()["rpm_target"] == 1800.0

        # 4. Reset to defaults (authenticated)
        reset_res = client.post(
            "/api/machines/MOTOR-001/simulation-config/reset",
            cookies=_operator_cookie(),
        )
        assert reset_res.status_code == 200
        reset_data = reset_res.json()
        assert reset_data["temp_min"] == 22.0
        assert reset_data["temp_max"] >= 45.0
        assert reset_data["rpm_target"] == 1450.0
    finally:
        _set_operator_secret("")
