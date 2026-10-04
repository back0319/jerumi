import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

ENDPOINT = "https://br-example.storage.c-3.ap-southeast-1.aws.neon.tech"


def storage_settings(**overrides):
    values = {
        "AWS_ENDPOINT_URL_S3": ENDPOINT,
        "AWS_ACCESS_KEY_ID": "nak_live_test",
        "AWS_SECRET_ACCESS_KEY": "nsk_live_test",
        "AWS_REGION": "ap-southeast-1",
        "STORAGE_BUCKET": "foundation-swatches",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def load_storage_module():
    boto3_stub = types.ModuleType("boto3")
    boto3_stub.client = lambda *_args, **_kwargs: object()
    botocore_stub = types.ModuleType("botocore")
    botocore_config_stub = types.ModuleType("botocore.config")
    botocore_config_stub.Config = lambda **_kwargs: object()

    config_stub = types.ModuleType("app.config")
    config_stub.settings = storage_settings()

    module_name = "_storage_config_under_test"
    module_path = BACKEND_ROOT / "app" / "services" / "storage.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)

    stubs = {
        "boto3": boto3_stub,
        "botocore": botocore_stub,
        "botocore.config": botocore_config_stub,
        "app.config": config_stub,
        module_name: module,
    }
    originals = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        spec.loader.exec_module(module)
    finally:
        for name, original in originals.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    return module


class StorageConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = load_storage_module()

    def test_storage_config_removes_bucket_bom_before_validation(self) -> None:
        self.storage.settings = storage_settings(
            AWS_ENDPOINT_URL_S3=f" {ENDPOINT}/ ",
            AWS_SECRET_ACCESS_KEY=" nsk_live_test ",
            STORAGE_BUCKET="﻿foundation-swatches",
        )

        config = self.storage._require_storage_config()

        self.assertEqual(config.endpoint_url, ENDPOINT)
        self.assertEqual(config.secret_access_key, "nsk_live_test")
        self.assertEqual(config.bucket, "foundation-swatches")

    def test_storage_config_still_rejects_invalid_bucket_names(self) -> None:
        self.storage.settings = storage_settings(STORAGE_BUCKET="Foundation_Swatches")

        with self.assertRaises(self.storage.StorageConfigError):
            self.storage._require_storage_config()

    def test_storage_config_requires_credentials(self) -> None:
        self.storage.settings = storage_settings(AWS_SECRET_ACCESS_KEY=None)

        with self.assertRaises(self.storage.StorageConfigError):
            self.storage._require_storage_config()

    def test_public_url_uses_path_style_bucket(self) -> None:
        self.assertEqual(
            self.storage._build_public_url("swatches/brand/shade 1.jpg"),
            f"{ENDPOINT}/foundation-swatches/swatches/brand/shade%201.jpg",
        )

    def test_resolve_public_asset_keeps_bucket_from_existing_url(self) -> None:
        self.storage.settings = storage_settings(STORAGE_BUCKET="new-foundation-swatches")

        asset = self.storage.resolve_public_asset(
            f"{ENDPOINT}/old-foundation-swatches/swatches/brand/shade%201.jpg"
        )

        self.assertIsNotNone(asset)
        assert asset is not None
        self.assertEqual(asset.bucket, "old-foundation-swatches")
        self.assertEqual(asset.object_path, "swatches/brand/shade 1.jpg")

    def test_resolve_public_asset_ignores_external_urls(self) -> None:
        self.assertIsNone(
            self.storage.resolve_public_asset(
                "https://cdn.example.test/foundation-swatches/shade.jpg"
            )
        )
        self.assertIsNone(
            self.storage.resolve_public_asset(
                "https://example.supabase.co/storage/v1/object/public/"
                "foundation-swatches/swatches/brand/shade.jpg"
            )
        )

    def test_upload_swatch_image_puts_object_and_returns_public_url(self) -> None:
        calls = []

        class S3Client:
            def put_object(self, **kwargs):
                calls.append(kwargs)

        self.storage.get_storage_client = lambda: S3Client()

        result = self.storage.upload_swatch_image(
            b"image-bytes",
            brand="Brand A",
            shade_name="21N Light",
            content_type="image/jpeg; charset=binary",
            original_filename="photo.jpg",
        )

        self.assertEqual(result.bucket, "foundation-swatches")
        self.assertTrue(result.object_path.startswith("swatches/brand-a/21n-light-"))
        self.assertEqual(
            result.public_url,
            f"{ENDPOINT}/foundation-swatches/{result.object_path}",
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["Bucket"], "foundation-swatches")
        self.assertEqual(calls[0]["Key"], result.object_path)
        self.assertEqual(calls[0]["Body"], b"image-bytes")
        self.assertEqual(calls[0]["ContentType"], "image/jpeg")

    def test_delete_public_asset_is_idempotent_and_uses_resolved_bucket(self) -> None:
        removed = []

        class S3Client:
            def delete_object(self, **kwargs):
                removed.append(kwargs)

        self.storage.get_storage_client = lambda: S3Client()

        deleted = self.storage.delete_public_asset(
            f"{ENDPOINT}/foundation-swatches/swatches/brand/shade.jpg"
        )

        self.assertTrue(deleted)
        self.assertEqual(
            removed,
            [{"Bucket": "foundation-swatches", "Key": "swatches/brand/shade.jpg"}],
        )


if __name__ == "__main__":
    unittest.main()
