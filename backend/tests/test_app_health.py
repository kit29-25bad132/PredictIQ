from fastapi.testclient import TestClient

from backend.app.main import app


def test_root_and_health() -> None:
    client = TestClient(app)
    assert client.get('/').status_code == 200
    assert client.get('/api/health').status_code == 200
