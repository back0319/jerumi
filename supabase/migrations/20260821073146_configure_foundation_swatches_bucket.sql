insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'foundation-swatches',
    'foundation-swatches',
    true,
    20971520,
    array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif'
    ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets allow unauthenticated reads only. Upload and cleanup stay on
-- the trusted FastAPI service-role path, so no storage.objects write policy is
-- granted to anon or authenticated clients.
