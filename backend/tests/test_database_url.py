from app.config import normalize_database_url


def test_neon_url_drops_channel_binding_and_maps_sslmode() -> None:
    url = (
        "postgresql://user:pw@ep-example-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb"
        "?channel_binding=require&sslmode=require"
    )

    assert normalize_database_url(url) == (
        "postgresql+asyncpg://user:pw@ep-example-pooler.c-3.ap-southeast-1.aws.neon.tech"
        "/neondb?ssl=require"
    )


def test_asyncpg_url_without_query_is_unchanged() -> None:
    url = "postgresql+asyncpg://skinmatch:skinmatch_dev@localhost:5432/skinmatch"

    assert normalize_database_url(url) == url
