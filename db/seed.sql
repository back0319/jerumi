insert into public.foundations (
    brand,
    product_name,
    shade_code,
    shade_name,
    "L_value",
    "a_value",
    "b_value",
    hex_color,
    undertone,
    swatch_image_url
)
values
    ('Preview Brand', 'Safety Base', '19N', 'Preview Porcelain', 76.2, 7.1, 13.5, '#d9b9a6', null, null),
    ('Preview Brand', 'Safety Base', '21N', 'Preview Light Beige', 69.4, 8.6, 15.9, '#c7a18e', null, null),
    ('Preview Brand', 'Safety Base', '23W', 'Preview Warm Sand', 63.0, 10.2, 20.4, '#b88e72', null, null)
on conflict do nothing;
