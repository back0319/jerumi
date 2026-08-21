import json
from pathlib import Path


_VERSION_FILES = (
    Path(__file__).resolve().parents[2] / "app-version.json",
    Path(__file__).resolve().parents[1] / "app-version.json",
)
_OPENAPI_FILES = (
    Path(__file__).resolve().parents[1] / "openapi.json",
)


def load_app_version() -> str:
    version_file = next((path for path in _VERSION_FILES if path.is_file()), None)
    if version_file is not None:
        try:
            payload = json.loads(version_file.read_text(encoding="utf-8"))
            version = str(payload["version"]).strip()
        except (OSError, KeyError, TypeError, ValueError) as exc:
            raise RuntimeError(
                f"Could not load application version from {version_file}"
            ) from exc
    else:
        openapi_file = next(
            (path for path in _OPENAPI_FILES if path.is_file()),
            None,
        )
        if openapi_file is None:
            raise RuntimeError("Could not find application version metadata")
        try:
            payload = json.loads(openapi_file.read_text(encoding="utf-8"))
            version = str(payload["info"]["version"]).strip()
        except (OSError, KeyError, TypeError, ValueError) as exc:
            raise RuntimeError(
                f"Could not load application version from {openapi_file}"
            ) from exc

    if not version:
        raise RuntimeError("Application version must not be empty")
    return version


APP_VERSION = load_app_version()
