import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))


def load_storage_module():
    supabase_stub = types.ModuleType("supabase")
    supabase_stub.Client = object
    supabase_stub.create_client = lambda *_args, **_kwargs: object()

    config_stub = types.ModuleType("app.config")
    config_stub.settings = SimpleNamespace(
        SUPABASE_URL=None,
        SUPABASE_SERVICE_ROLE_KEY=None,
        SUPABASE_STORAGE_BUCKET=None,
    )

    module_name = "_storage_config_under_test"
    module_path = BACKEND_ROOT / "app" / "services" / "storage.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)

    original_supabase = sys.modules.get("supabase")
    original_config = sys.modules.get("app.config")
    original_test_module = sys.modules.get(module_name)

    sys.modules["supabase"] = supabase_stub
    sys.modules["app.config"] = config_stub
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if original_supabase is None:
            sys.modules.pop("supabase", None)
        else:
            sys.modules["supabase"] = original_supabase
        if original_config is None:
            sys.modules.pop("app.config", None)
        else:
            sys.modules["app.config"] = original_config
        if original_test_module is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original_test_module

    return module


class StorageConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = load_storage_module()

    def test_storage_config_removes_bucket_bom_before_validation(self) -> None:
        self.storage.settings = SimpleNamespace(
            SUPABASE_URL=" https://example.supabase.co/ ",
            SUPABASE_SERVICE_ROLE_KEY=" service-role-key ",
            SUPABASE_STORAGE_BUCKET="\ufefffoundation-swatches",
        )

        self.assertEqual(
            self.storage._require_storage_config(),
            (
                "https://example.supabase.co",
                "service-role-key",
                "foundation-swatches",
            ),
        )

    def test_storage_config_still_rejects_invalid_bucket_names(self) -> None:
        self.storage.settings = SimpleNamespace(
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY="service-role-key",
            SUPABASE_STORAGE_BUCKET="Foundation_Swatches",
        )

        with self.assertRaises(self.storage.StorageConfigError):
            self.storage._require_storage_config()


if __name__ == "__main__":
    unittest.main()
