/**
 * Maps canonical World Cup team names to their flag emojis.
 * Falling back to a soccer ball emoji for unknown teams.
 */
const TEAM_FLAGS: Record<string, string> = {
  // North America
  "United States": "🇺🇸",
  "USA": "🇺🇸",
  "Mexico": "🇲🇽",
  "Canada": "🇨🇦",
  "Honduras": "🇭🇳",
  "Costa Rica": "🇨🇷",
  "Panama": "🇵🇦",
  "Jamaica": "🇯🇲",
  "Curaçao": "🇨🇼",

  // South America
  "Argentina": "🇦🇷",
  "Brazil": "🇧🇷",
  "Uruguay": "🇺🇾",
  "Colombia": "🇨🇴",
  "Ecuador": "🇪🇨",
  "Peru": "🇵🇪",
  "Chile": "🇨🇱",
  "Venezuela": "🇻🇪",
  "Paraguay": "🇵🇾",

  // Europe
  "Spain": "🇪🇸",
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "France": "🇫🇷",
  "Germany": "🇩🇪",
  "Italy": "🇮🇹",
  "Portugal": "🇵🇹",
  "Netherlands": "🇳🇱",
  "Croatia": "🇭🇷",
  "Belgium": "🇧🇪",
  "Switzerland": "🇨🇭",
  "Denmark": "🇩🇰",
  "Poland": "🇵🇱",
  "Serbia": "🇷🇸",
  "Ukraine": "🇺🇦",
  "Austria": "🇦🇹",
  "Turkey": "🇹🇷",
  "Sweden": "🇸🇪",
  "Norway": "🇳🇴",
  "Czech Rep.": "🇨🇿",
  "Czechia": "🇨🇿",
  "Bosnia/Herzeg.": "🇧🇦",
  "Scotland": "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",

  // Africa
  "Morocco": "🇲🇦",
  "Senegal": "🇸🇳",
  "Tunisia": "🇹🇳",
  "Cameroon": "🇨🇲",
  "Ghana": "🇬🇭",
  "Algeria": "🇩🇿",
  "Egypt": "🇪🇬",
  "Nigeria": "🇳🇬",
  "South Africa": "🇿🇦",
  "Cape Verde": "🇨🇻",
  "DR Congo": "🇨🇩",
  "Ivory Coast": "🇨🇮",

  // Asia / Oceania
  "Japan": "🇯🇵",
  "Rep. of Korea": "🇰🇷",
  "South Korea": "🇰🇷",
  "Australia": "🇦🇺",
  "Iran": "🇮🇷",
  "IR Iran": "🇮🇷",
  "Saudi Arabia": "🇸🇦",
  "New Zealand": "🇳🇿",
  "Qatar": "🇶🇦",
  "Haiti": "🇭🇹",
  "Iraq": "🇮🇶",
  "Jordan": "🇯🇴",
  "Uzbekistan": "🇺🇿",
};

/** Get the flag emoji for a team name. Defaults to a soccer ball. */
export function getTeamFlag(teamName: string): string {
  if (!teamName) return "⚽";
  const normalized = teamName.trim();
  return TEAM_FLAGS[normalized] || "⚽";
}
