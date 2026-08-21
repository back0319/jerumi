import asyncio
import json
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers import cron


def _decode(response) -> dict[str, bool]:
    return json.loads(response.body)


def test_keepalive_route_reads_authorization_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", "expected-secret")
    query = AsyncMock()
    monkeypatch.setattr(cron, "_query_foundation_id", query)

    with TestClient(app) as client:
        response = client.get(
            "/cron/supabase-keepalive",
            headers={"Authorization": "Bearer expected-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    query.assert_awaited_once_with()


def test_keepalive_rejects_request_when_secret_is_not_configured(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", None)
    query = AsyncMock()
    monkeypatch.setattr(cron, "_query_foundation_id", query)

    response = asyncio.run(cron.supabase_keepalive("Bearer ignored"))

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert _decode(response) == {"ok": False}
    query.assert_not_awaited()


def test_keepalive_rejects_invalid_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", "expected-secret")
    query = AsyncMock()
    monkeypatch.setattr(cron, "_query_foundation_id", query)

    response = asyncio.run(cron.supabase_keepalive("Bearer wrong-secret"))

    assert response.status_code == 401
    assert _decode(response) == {"ok": False}
    query.assert_not_awaited()


def test_keepalive_queries_database_with_valid_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", "expected-secret")
    query = AsyncMock()
    monkeypatch.setattr(cron, "_query_foundation_id", query)

    response = asyncio.run(cron.supabase_keepalive("Bearer expected-secret"))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert _decode(response) == {"ok": True}
    query.assert_awaited_once_with()


def test_keepalive_returns_service_unavailable_on_database_error(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", "expected-secret")
    query = AsyncMock(side_effect=RuntimeError("database unavailable"))
    monkeypatch.setattr(cron, "_query_foundation_id", query)

    response = asyncio.run(cron.supabase_keepalive("Bearer expected-secret"))

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert _decode(response) == {"ok": False}
