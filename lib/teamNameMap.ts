/**
 * football-data.org team name → canonical 48-team name.
 *
 * The canonical names are the quirky strings in the seeded `matches` table
 * (e.g. "Bosnia/Herzeg.", "Rep. of Korea", "IR Iran", "Curaçao"); every
 * advancer and actual result must match one of them *exactly* or it's rejected
 * (lib/parseWorkbook.ts, app/api/admin/advancers/route.ts).
 *
 * This map only lists the **exceptions** where the API name differs from the
 * canonical name. When the API name already equals a canonical name (Spain,
 * Brazil, …) no entry is needed — `resolveCanonical` falls back to identity.
 *
 * IMPORTANT: verify this against the live fixture with `scripts/checkTeamMap.ts`
 * before relying on it — the API's spelling can vary by season.
 */
export const TEAM_NAME_MAP: Record<string, string> = {
  "Bosnia and Herzegovina": "Bosnia/Herzeg.",
  "Bosnia & Herzegovina": "Bosnia/Herzeg.",
  "Bosnia-Herzegovina": "Bosnia/Herzeg.",
  "Cabo Verde": "Cape Verde",
  "Cape Verde Islands": "Cape Verde",
  Curacao: "Curaçao",
  Czechia: "Czech Rep.",
  "Czech Republic": "Czech Rep.",
  "Congo DR": "DR Congo",
  "Democratic Republic of the Congo": "DR Congo",
  Iran: "IR Iran",
  "Côte d'Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "South Korea": "Rep. of Korea",
  "Korea Republic": "Rep. of Korea",
  "Republic of Korea": "Rep. of Korea",
  Türkiye: "Turkey",
  Turkiye: "Turkey",
  "United States": "USA",
};

/**
 * Resolve an API team name to a canonical name, or null if it can't be matched.
 * Tries the exception map first, then identity against the canonical set.
 */
export function resolveCanonical(
  apiName: string | null,
  canonical: Set<string>,
): string | null {
  if (!apiName) return null;
  const mapped = TEAM_NAME_MAP[apiName];
  if (mapped) return canonical.has(mapped) ? mapped : null;
  return canonical.has(apiName) ? apiName : null;
}
