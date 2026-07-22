import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))


class FakeFoundation:
    def __init__(self, **kwargs):
        self.id = 0
        for key, value in kwargs.items():
            setattr(self, key, value)


class FakeStorageCleanupJob:
    def __init__(self, **kwargs):
        self.id = 0
        self.attempts = 0
        self.last_error = None
        self.completed_at = None
        for key, value in kwargs.items():
            setattr(self, key, value)


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class FakeAPIRouter:
    def __init__(self, *args, **kwargs):
        pass

    def post(self, *args, **kwargs):
        return lambda func: func

    def get(self, *args, **kwargs):
        return lambda func: func

    def put(self, *args, **kwargs):
        return lambda func: func

    def delete(self, *args, **kwargs):
        return lambda func: func


def build_fastapi_stub():
    fastapi_stub = types.ModuleType("fastapi")
    fastapi_stub.APIRouter = FakeAPIRouter
    fastapi_stub.Depends = lambda value=None: value
    fastapi_stub.File = lambda value=None: value
    fastapi_stub.Form = lambda value=None: value
    fastapi_stub.HTTPException = FakeHTTPException
    fastapi_stub.UploadFile = object
    return fastapi_stub


def load_foundations_module():
    module_name = "_foundations_fast_path_under_test"
    module_path = BACKEND_ROOT / "app" / "routers" / "foundations.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None

    database_stub = types.ModuleType("app.database")
    database_stub.get_db = lambda: None

    models_stub = types.ModuleType("app.models")
    models_stub.__path__ = []
    foundation_stub = types.ModuleType("app.models.foundation")
    foundation_stub.Foundation = FakeFoundation
    storage_cleanup_stub = types.ModuleType("app.models.storage_cleanup")
    storage_cleanup_stub.StorageCleanupJob = FakeStorageCleanupJob

    auth_stub = types.ModuleType("app.routers.auth")
    auth_stub.get_current_admin = lambda: "admin"

    module = importlib.util.module_from_spec(spec)
    originals = {
        name: sys.modules.get(name)
        for name in (
            module_name,
            "app.database",
            "app.models",
            "app.models.foundation",
            "app.models.storage_cleanup",
            "app.routers.auth",
            "fastapi",
        )
    }

    sys.modules[module_name] = module
    sys.modules["app.database"] = database_stub
    sys.modules["app.models"] = models_stub
    sys.modules["app.models.foundation"] = foundation_stub
    sys.modules["app.models.storage_cleanup"] = storage_cleanup_stub
    sys.modules["app.routers.auth"] = auth_stub
    sys.modules["fastapi"] = build_fastapi_stub()
    try:
        spec.loader.exec_module(module)
    finally:
        for name, original in originals.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    return module


class FakeUploadFile:
    content_type = "image/jpeg"
    filename = "original.jpg"

    async def read(self) -> bytes:
        return b"jpeg-bytes"


class FakeStorageService:
    class StorageConfigError(RuntimeError):
        pass

    class StorageOperationError(RuntimeError):
        pass

    def __init__(self, *, delete_fails: bool = False):
        self.uploaded_image_bytes = None
        self.delete_fails = delete_fails
        self.deleted_assets = []

    def upload_swatch_image(self, **kwargs):
        self.uploaded_image_bytes = kwargs["image_bytes"]
        return SimpleNamespace(
            bucket="foundation-swatches",
            object_path="swatches/brand/shade.jpg",
            public_url="https://example.test/swatch.jpg",
        )

    def delete_object(self, bucket, object_path):
        self.deleted_assets.append((bucket, object_path))
        if self.delete_fails:
            raise self.StorageOperationError("storage unavailable")

    def resolve_public_asset(self, public_url):
        if public_url.startswith("https://example.test/"):
            return SimpleNamespace(
                bucket="foundation-swatches",
                object_path="swatches/brand/shade.jpg",
            )
        return None


class FakeDb:
    def __init__(
        self,
        *,
        commit_failures: int = 0,
        fail_on_commit_numbers=None,
        selected=None,
    ):
        self.added = None
        self.added_values = []
        self.committed = False
        self.commit_count = 0
        self.commit_failures = commit_failures
        self.fail_on_commit_numbers = set(fail_on_commit_numbers or [])
        self.rollback_count = 0
        self.deleted = None
        self.selected = selected

    def add(self, value):
        self.added = value
        self.added_values.append(value)

    async def commit(self):
        self.commit_count += 1
        if self.commit_failures > 0:
            self.commit_failures -= 1
            raise RuntimeError("database unavailable")
        if self.commit_count in self.fail_on_commit_numbers:
            raise RuntimeError("database unavailable")
        self.committed = True

    async def rollback(self):
        self.rollback_count += 1

    async def refresh(self, value):
        value.id = 123

    async def delete(self, value):
        self.deleted = value

    async def execute(self, _query):
        return SimpleNamespace(scalar_one_or_none=lambda: self.selected)


class FoundationPhotoSaveFastPathTests(unittest.TestCase):
    def test_parse_analysis_result_accepts_cached_swatch_values(self) -> None:
        module = load_foundations_module()

        result = module._parse_analysis_result(
            '{"L_value":70.1,"a_value":5.2,"b_value":13.3,'
            '"hex_color":"#c8a891","undertone":null}'
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.hex_color, "#c8a891")
        self.assertIsNone(result.undertone)

    def test_save_from_photo_uses_cached_analysis_without_reextracting(self) -> None:
        module = load_foundations_module()
        storage_service = FakeStorageService()
        db = FakeDb()

        def fail_if_called():
            raise AssertionError("swatch extraction should not run on cached save")

        module.get_swatch_extraction_service = fail_if_called
        module.get_storage_service = lambda: storage_service

        created = asyncio.run(
            module.create_foundation_from_photo(
                image=FakeUploadFile(),
                brand="Brand",
                product_name="Product",
                shade_name="Shade",
                shade_code="",
                checker_patches=None,
                analysis_result=(
                    '{"L_value":70.1,"a_value":5.2,"b_value":13.3,'
                    '"hex_color":"#c8a891","undertone":"WARM"}'
                ),
                _admin="admin",
                db=db,
            )
        )

        self.assertTrue(db.committed)
        self.assertIs(created, db.added)
        self.assertEqual(created.id, 123)
        self.assertEqual(created.L_value, 70.1)
        self.assertEqual(created.a_value, 5.2)
        self.assertEqual(created.b_value, 13.3)
        self.assertEqual(created.swatch_image_url, "https://example.test/swatch.jpg")
        self.assertIsNone(created.undertone)
        self.assertEqual(storage_service.uploaded_image_bytes, b"jpeg-bytes")

    def test_save_from_photo_deletes_uploaded_object_when_db_commit_fails(self) -> None:
        module = load_foundations_module()
        storage_service = FakeStorageService()
        db = FakeDb(commit_failures=1)
        module.get_storage_service = lambda: storage_service

        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            asyncio.run(
                module.create_foundation_from_photo(
                    image=FakeUploadFile(),
                    brand="Brand",
                    product_name="Product",
                    shade_name="Shade",
                    shade_code="",
                    checker_patches=None,
                    analysis_result=(
                        '{"L_value":70.1,"a_value":5.2,"b_value":13.3,'
                        '"hex_color":"#c8a891","undertone":null}'
                    ),
                    _admin="admin",
                    db=db,
                )
            )

        self.assertEqual(db.rollback_count, 1)
        self.assertEqual(
            storage_service.deleted_assets,
            [("foundation-swatches", "swatches/brand/shade.jpg")],
        )
        self.assertEqual(len(db.added_values), 1)

    def test_save_from_photo_queues_cleanup_when_compensation_fails(self) -> None:
        module = load_foundations_module()
        storage_service = FakeStorageService(delete_fails=True)
        db = FakeDb(commit_failures=1)
        module.get_storage_service = lambda: storage_service

        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            asyncio.run(
                module.create_foundation_from_photo(
                    image=FakeUploadFile(),
                    brand="Brand",
                    product_name="Product",
                    shade_name="Shade",
                    shade_code="",
                    checker_patches=None,
                    analysis_result=(
                        '{"L_value":70.1,"a_value":5.2,"b_value":13.3,'
                        '"hex_color":"#c8a891","undertone":null}'
                    ),
                    _admin="admin",
                    db=db,
                )
            )

        self.assertEqual(len(db.added_values), 2)
        cleanup_job = db.added_values[-1]
        self.assertIsInstance(cleanup_job, FakeStorageCleanupJob)
        self.assertEqual(cleanup_job.reason, "create-rollback")
        self.assertTrue(db.committed)

    def test_delete_commits_db_before_storage_and_leaves_retry_job_pending(self) -> None:
        module = load_foundations_module()
        foundation = FakeFoundation(
            id=123,
            swatch_image_url="https://example.test/swatch.jpg",
        )
        storage_service = FakeStorageService(delete_fails=True)
        db = FakeDb(selected=foundation)
        module.get_storage_service = lambda: storage_service

        class FakeQuery:
            def where(self, *_args):
                return self

        module.select = lambda *_args: FakeQuery()
        FakeFoundation.id = object()

        result = asyncio.run(
            module.delete_foundation(
                foundation_id=123,
                _admin="admin",
                db=db,
            )
        )

        self.assertIs(db.deleted, foundation)
        self.assertEqual(result, {"ok": True, "storage_cleanup": "pending"})
        cleanup_job = db.added_values[-1]
        self.assertEqual(cleanup_job.attempts, 1)
        self.assertIsNone(cleanup_job.completed_at)
        self.assertIn("storage unavailable", cleanup_job.last_error)

    def test_delete_does_not_touch_storage_when_db_commit_fails(self) -> None:
        module = load_foundations_module()
        foundation = FakeFoundation(
            id=123,
            swatch_image_url="https://example.test/swatch.jpg",
        )
        storage_service = FakeStorageService()
        db = FakeDb(commit_failures=1, selected=foundation)
        module.get_storage_service = lambda: storage_service

        class FakeQuery:
            def where(self, *_args):
                return self

        module.select = lambda *_args: FakeQuery()
        FakeFoundation.id = object()

        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            asyncio.run(
                module.delete_foundation(
                    foundation_id=123,
                    _admin="admin",
                    db=db,
                )
            )

        self.assertEqual(db.rollback_count, 1)
        self.assertEqual(storage_service.deleted_assets, [])

    def test_delete_remains_successful_when_cleanup_status_commit_fails(self) -> None:
        module = load_foundations_module()
        foundation = FakeFoundation(
            id=123,
            swatch_image_url="https://example.test/swatch.jpg",
        )
        storage_service = FakeStorageService()
        db = FakeDb(fail_on_commit_numbers={2}, selected=foundation)
        module.get_storage_service = lambda: storage_service

        class FakeQuery:
            def where(self, *_args):
                return self

        module.select = lambda *_args: FakeQuery()
        FakeFoundation.id = object()

        result = asyncio.run(
            module.delete_foundation(
                foundation_id=123,
                _admin="admin",
                db=db,
            )
        )

        self.assertEqual(result, {"ok": True, "storage_cleanup": "pending"})
        self.assertEqual(
            storage_service.deleted_assets,
            [("foundation-swatches", "swatches/brand/shade.jpg")],
        )
        self.assertEqual(db.rollback_count, 1)


if __name__ == "__main__":
    unittest.main()
