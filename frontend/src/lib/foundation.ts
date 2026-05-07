type ShadeLike = {
  shade_name: string;
  shade_code?: string | null;
};

/**
 * Brands use either color names ("Vanilla 1.5") or shade codes ("21호") or
 * both. The schema keeps shade_name and shade_code separate for legacy data,
 * but new entries put the combined label into shade_name. This merges the
 * two for display so old and new rows render consistently.
 */
export function displayShade(item: ShadeLike): string {
  const name = item.shade_name ?? "";
  const code = (item.shade_code ?? "").trim();
  if (!code || name.includes(code)) return name;
  return `${name} / ${code}`;
}
