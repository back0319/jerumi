import json
from pathlib import Path

from app.main import app
from app.version import APP_VERSION


def test_openapi_snapshot_matches_fastapi_schema() -> None:
    snapshot_path = Path(__file__).resolve().parents[1] / "openapi.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))

    assert snapshot == app.openapi(), (
        "backend/openapi.json is stale; export it with "
        "PYTHONPATH=backend backend/.venv/bin/python "
        "backend/scripts/export_openapi.py backend/openapi.json"
    )


def test_app_version_matches_frontend_package() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    version_source = json.loads(
        (repository_root / "app-version.json").read_text(encoding="utf-8")
    )
    frontend_package = json.loads(
        (repository_root / "frontend" / "package.json").read_text(encoding="utf-8")
    )

    assert APP_VERSION == version_source["version"] == frontend_package["version"]
