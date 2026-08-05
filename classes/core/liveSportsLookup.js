const axios = require("axios");

// ESPN's public (unofficial, no API key needed) scoreboard/team endpoints. Scoreboard covers
// today's scheduled/live/final games; the team list covers every team in the league regardless
// of whether they're playing today (needed for replays/classic games/condensed games, which
// aren't on today's scoreboard at all). Both include team colors and logo URLs — exactly what
// a "matchup poster" needs, with no auth and no rate-limit key management.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const LEAGUES = [
  { sport: "football", league: "nfl" },
  { sport: "football", league: "college-football" },
  { sport: "baseball", league: "mlb" },
  { sport: "basketball", league: "nba" },
  { sport: "basketball", league: "mens-college-basketball" },
  { sport: "hockey", league: "nhl" },
  { sport: "soccer", league: "usa.1" }, // MLS
];

// key -> { events/teams, expiresAt } — refetched periodically rather than on every Apple TV poll
// (which can run every few seconds). Team lists change far less often than a day's scoreboard,
// so they get a much longer TTL. The scoreboard itself (scores, game state) is only ever
// re-fetched while a matching sports card is actually being shown — this isn't background
// polling of every league all the time — so a short TTL here is a "score changed" -> screen
// latency tradeoff, not an ongoing cost when nobody's watching a game.
const scoreboardCache = new Map();
const teamListCache = new Map();
const SCOREBOARD_TTL_MS = 20 * 1000;
const TEAM_LIST_TTL_MS = 24 * 60 * 60 * 1000;

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Some broadcast apps use the team's official league abbreviation rather than ESPN's — e.g. the
// MLB app reports the White Sox as "CWS" (MLB's own code) where ESPN's API uses "CHW". Small,
// known set of mismatches, not a general abbreviation scheme difference.
const ABBREV_ALIASES = {
  cws: "chw", // Chicago White Sox
  az: "ari", // Arizona Diamondbacks
  oak: "ath", // Athletics (formerly Oakland)
};

/**
 * "Georgia Tech at NC State" -> ["Georgia Tech", "NC State"], or null if it doesn't look like
 * a matchup at all. Deliberately loose — a false positive here just fails to match a real team
 * in fetchMatchupInfo() and falls through to normal movie/show handling, so there's no real cost
 * to over-matching at this stage (e.g. a movie titled "X vs Y" just won't match real teams).
 */
function splitMatchupTitle(title) {
  const t = String(title || "").trim();
  const m = /^(.+?)\s+(?:at|@|vs\.?|versus)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  if (!a || !b) return null;
  return [a, b];
}

async function fetchScoreboard(sport, league) {
  const key = sport + "/" + league;
  const cached = scoreboardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.events;
  let events = [];
  try {
    const res = await axios.get(ESPN_BASE + "/" + sport + "/" + league + "/scoreboard", {
      timeout: 8000,
    });
    events = (res.data && res.data.events) || [];
  } catch (e) {
    events = cached ? cached.events : []; // keep serving stale data through a transient outage
  }
  scoreboardCache.set(key, { events, expiresAt: Date.now() + SCOREBOARD_TTL_MS });
  return events;
}

async function fetchTeamList(sport, league) {
  const key = sport + "/" + league;
  const cached = teamListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.teams;
  let teams = [];
  try {
    const res = await axios.get(ESPN_BASE + "/" + sport + "/" + league + "/teams", {
      params: { limit: 1000 },
      timeout: 8000,
    });
    const leagues = (res.data && res.data.sports && res.data.sports[0] && res.data.sports[0].leagues) || [];
    const rawTeams = (leagues[0] && leagues[0].teams) || [];
    teams = rawTeams.map((t) => teamFromRaw(t.team));
  } catch (e) {
    teams = cached ? cached.teams : [];
  }
  teamListCache.set(key, { teams, expiresAt: Date.now() + TEAM_LIST_TTL_MS });
  return teams;
}

/**
 * ESPN also publishes a "primary_logo_white" guid-based asset per team, which in principle is
 * exactly what we'd want on a colored background — but spot-checking it directly turned up
 * teams whose "white logo" is actually a completely different team's mark (Arizona Cardinals
 * pointed at the Philadelphia Eagles' logo; Miami Hurricanes pointed at Mercyhurst University).
 * That's not an edge case worth working around — it's a data integrity problem in ESPN's own
 * response, so this deliberately does NOT use it. The "dark" variant is a different, reliable
 * system though — same predictable /i/teamlogos/{league}/500-dark/{abbrev}.png path as the
 * already-trusted default logos (not a random guid), and it's specifically meant for exactly
 * this use case (a colored/dark background) — confirmed correct across multiple leagues/teams.
 */
function pickLogo(team) {
  const logos = Array.isArray(team.logos) ? team.logos : [];
  const dark = logos.find((l) => Array.isArray(l.rel) && l.rel.includes("dark") && !l.rel.includes("scoreboard"));
  if (dark) return dark.href;
  return team.logo || (logos[0] && logos[0].href) || "";
}

function teamFromRaw(team) {
  team = team || {};
  return {
    id: team.id != null ? String(team.id) : "",
    displayName: team.displayName || "",
    shortDisplayName: team.shortDisplayName || "",
    name: team.name || "",
    location: team.location || "",
    abbreviation: team.abbreviation || "",
    color: team.color ? "#" + team.color : "",
    alternateColor: team.alternateColor ? "#" + team.alternateColor : "",
    logo: pickLogo(team),
  };
}

function teamFromCompetitor(competitor) {
  const t = teamFromRaw(competitor.team);
  t.score = competitor.score || "";
  t.homeAway = competitor.homeAway || "";
  return t;
}

/**
 * Scored by field, not just "found it somewhere" — a team's city (location) is shared across
 * every league that has a franchise there (Denver Broncos/Nuggets/Rockies/Avalanche all match
 * "Denver"), so a location-only hit is weighted far below an actual identity match (mascot,
 * short display name, or abbreviation — "Lakers", "LAL"). Without this, a basketball team named
 * only by its city could out-rank the real team in an entirely different sport that happens to
 * share that city, if that other league were merely checked first.
 */
function teamMatchScore(candidate, team) {
  const c = normalize(candidate);
  if (!c) return 0;
  const aliasedC = ABBREV_ALIASES[c] || c;
  const identityFields = [team.displayName, team.shortDisplayName, team.name, team.abbreviation];
  let best = 0;
  for (const f of identityFields) {
    const n = normalize(f);
    if (!n) continue;
    if (n === c || n === aliasedC) return 3; // exact identity match — can't do better than this
    if (n.includes(c) || c.includes(n)) best = Math.max(best, 2);
  }
  const loc = normalize(team.location);
  if (loc) {
    if (loc === c) best = Math.max(best, 1);
    else if (loc.includes(c) || c.includes(loc)) best = Math.max(best, 0.5);
  }
  return best;
}

function bestTeamMatch(candidate, teams) {
  let best = null;
  let bestScore = 0;
  for (const team of teams) {
    const score = teamMatchScore(candidate, team);
    if (score > bestScore) {
      bestScore = score;
      best = team;
      if (score === 3) break;
    }
  }
  return bestScore > 0 ? { team: best, score: bestScore } : null;
}

/**
 * Checks today's scoreboard for a live/scheduled/just-finished game matching both names —
 * searches every league and keeps the single best-scoring match rather than stopping at the
 * first league that matches at all, so e.g. a basketball game doesn't get resolved against NFL
 * teams just because football is checked first (see teamMatchScore for why that's a real risk).
 */
async function matchFromScoreboard(nameA, nameB) {
  let best = null;
  let bestSport = "";
  for (const { sport, league } of LEAGUES) {
    const events = await fetchScoreboard(sport, league);
    for (const event of events) {
      const competition = event.competitions && event.competitions[0];
      if (!competition || !Array.isArray(competition.competitors)) continue;
      const teams = competition.competitors.map(teamFromCompetitor);
      if (teams.length !== 2) continue;
      const [t0, t1] = teams;

      const direct = Math.min(teamMatchScore(nameA, t0), teamMatchScore(nameB, t1));
      const swapped = Math.min(teamMatchScore(nameA, t1), teamMatchScore(nameB, t0));
      const score = Math.max(direct, swapped);
      if (score <= 0) continue;

      if (!best || score > best.score) {
        const home = teams.find((t) => t.homeAway === "home") || t1;
        const away = teams.find((t) => t.homeAway === "away") || t0;
        // "pre" = not started yet (scores are meaningless placeholders at this point), "in" /
        // "post" = started or finished — either way there's a real score worth showing.
        const statusType = event.status && event.status.type;
        const gameState = (statusType && statusType.state) || "pre";
        // period = inning number; "Top"/"Bottom" isn't broken out as its own field, so it's
        // read off the detail text ESPN already formats for display (e.g. "Top 7th"). Baseball
        // (inning/outs) only — other sports have their own period/clock equivalents that aren't
        // wired up yet (appletv.js scopes all of this to league === "mlb").
        const inningNumber = (event.status && event.status.period) || null;
        const inningHalf = /^top/i.test((statusType && statusType.detail) || "") ? "top" : "bottom";
        const situation = competition.situation || {};
        const outs = typeof situation.outs === "number" ? situation.outs : null;
        const onFirst = !!situation.onFirst;
        const onSecond = !!situation.onSecond;
        const onThird = !!situation.onThird;
        best = {
          score, league, eventName: event.name || nameA + " vs " + nameB, home, away,
          isLive: true, gameState, inningNumber, inningHalf, outs, onFirst, onSecond, onThird,
        };
        bestSport = sport;
      }
    }
  }
  // The scoreboard endpoint only exposes a single plain logo per team (no "dark" variant) —
  // cross-reference the matched teams against that league's (cached) team list by id to pick
  // up pickLogo()'s preferred dark logo for the teams that actually matched.
  if (best) {
    const teams = await fetchTeamList(bestSport, best.league);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const awayFull = byId.get(best.away.id);
    const homeFull = byId.get(best.home.id);
    if (awayFull && awayFull.logo) best.away.logo = awayFull.logo;
    if (homeFull && homeFull.logo) best.home.logo = homeFull.logo;
  }
  return best;
}

/**
 * Checks whether both names are simply real teams in the same league, regardless of whether
 * they're playing today — covers replays, classic/condensed games, etc. that won't be on any
 * current scoreboard. Searches every league and keeps the best-scoring pair, for the same
 * cross-league-ambiguity reason as matchFromScoreboard. No home/away distinction available here
 * (no real scheduled game), so nameA/nameB order is kept as away/home purely for layout.
 */
async function matchFromTeamLists(nameA, nameB) {
  let best = null;
  for (const { sport, league } of LEAGUES) {
    const teams = await fetchTeamList(sport, league);
    if (teams.length === 0) continue;
    const away = bestTeamMatch(nameA, teams);
    const home = bestTeamMatch(nameB, teams);
    if (!away || !home || away.team === home.team) continue;
    const score = Math.min(away.score, home.score);
    if (!best || score > best.score) {
      best = { score, league, eventName: nameA + " vs " + nameB, home: home.team, away: away.team, isLive: false };
    }
  }
  return best;
}

/**
 * Given a raw Now Playing title, checks whether it matches a real game — live/today first (most
 * accurate data), falling back to "are both sides simply real teams" for replays/classic games.
 * Returns null if nothing matches, meaning the caller should treat this as ordinary movie/show
 * content.
 * @returns {Promise<{league: string, eventName: string, home: object, away: object, isLive: boolean}|null>}
 */
async function fetchMatchupInfo(title) {
  const parts = splitMatchupTitle(title);
  if (!parts) return null;
  const [nameA, nameB] = parts;

  const live = await matchFromScoreboard(nameA, nameB);
  if (live) return live;
  return matchFromTeamLists(nameA, nameB);
}

module.exports = { fetchMatchupInfo, splitMatchupTitle };
