const holidaysDb = require("./holidaysDb");

/**
 * Shared holiday-rule matching/date logic. Used both by index.js (to boost matching cards
 * already in a card set — home poster carousel + /now-showing feed) and by the on-demand
 * selection code (utility.js, posterMetadataDb.js) to prioritize holiday-matching titles
 * into the pool before randomly filling the rest.
 */

let holidaysDbInitPromise = null;
async function ensureHolidaysDbReady() {
  if (!holidaysDbInitPromise) {
    holidaysDbInitPromise = holidaysDb.initHolidaysDb().catch((e) => {
      holidaysDbInitPromise = null;
      throw e;
    });
  }
  await holidaysDbInitPromise;
}

function normalizeHolidayMonthDay(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const mo = parseInt(m[1], 10);
    const da = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return String(mo).padStart(2, "0") + "-" + String(da).padStart(2, "0");
    }
  }
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const mo = parseInt(ymd[2], 10);
    const da = parseInt(ymd[3], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return String(mo).padStart(2, "0") + "-" + String(da).padStart(2, "0");
    }
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "";
  return (
    String(dt.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getDate()).padStart(2, "0")
  );
}

function normalizeHolidayInt(raw, min, max, fallback) {
  const n = parseInt(String(raw == null ? "" : raw).trim(), 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeHolidayMode(raw) {
  return String(raw || "").trim().toLowerCase() === "dynamic"
    ? "dynamic"
    : "fixed";
}

function normalizeHolidayMatchMode(raw) {
  return String(raw || "").trim().toLowerCase() === "and" ? "and" : "or";
}

function normalizeHolidayPlotKeywords(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function computeNthWeekdayOfMonth(year, monthOneBased, weekday, nth) {
  if (!Number.isFinite(year)) return null;
  const month = Math.max(1, Math.min(12, monthOneBased));
  const wd = Math.max(0, Math.min(6, weekday));
  const nthNorm = String(nth || "").toLowerCase() === "last" ? "last" : String(nth);
  if (nthNorm === "last") {
    const last = new Date(year, month, 0);
    const d = new Date(last.getTime());
    while (d.getDay() !== wd) d.setDate(d.getDate() - 1);
    return d;
  }
  const n = normalizeHolidayInt(nthNorm, 1, 5, 1);
  const first = new Date(year, month - 1, 1);
  const delta = (wd - first.getDay() + 7) % 7;
  const day = 1 + delta + (n - 1) * 7;
  const candidate = new Date(year, month - 1, day);
  if (candidate.getMonth() !== month - 1) return null;
  return candidate;
}

function readHolidayRulesFromSettings() {
  let parsed = [];
  try {
    parsed = holidaysDb.listRules();
  } catch (e) {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((r) => {
      const mode = normalizeHolidayMode(r && r.mode);
      const tag = String((r && r.tag) || "").trim().toLowerCase();
      const titleKeywords = normalizeHolidayPlotKeywords(r && r.titleKeywords);
      const plotKeywords = normalizeHolidayPlotKeywords(r && r.plotKeywords);
      const matchMode = normalizeHolidayMatchMode(r && r.matchMode);
      if (mode === "dynamic") {
        const month = normalizeHolidayInt(r && r.month, 1, 12, 11);
        const weekday = normalizeHolidayInt(r && r.weekday, 0, 6, 4);
        const nthRaw = String((r && r.nth) || "").trim().toLowerCase();
        const nth =
          nthRaw === "last"
            ? "last"
            : String(normalizeHolidayInt(nthRaw || "1", 1, 5, 1));
        const spanDays = normalizeHolidayInt(r && r.spanDays, 0, 31, 0);
        return {
          mode,
          month,
          weekday,
          nth,
          spanDays,
          tag,
          titleKeywords,
          plotKeywords,
          matchMode,
        };
      }
      const start = normalizeHolidayMonthDay(r && r.start);
      const end = normalizeHolidayMonthDay(r && r.end);
      return {
        mode: "fixed",
        start,
        end,
        tag,
        titleKeywords,
        plotKeywords,
        matchMode,
      };
    })
    .filter((r) => {
      if (
        !r.tag &&
        (!Array.isArray(r.titleKeywords) || r.titleKeywords.length === 0) &&
        (!Array.isArray(r.plotKeywords) || r.plotKeywords.length === 0)
      )
        return false;
      if (r.mode === "dynamic") return true;
      return !!(r.start && r.end);
    });
}

function monthDayInHolidayRange(todayMd, startMd, endMd) {
  if (!todayMd || !startMd || !endMd) return false;
  if (startMd <= endMd) return todayMd >= startMd && todayMd <= endMd;
  return todayMd >= startMd || todayMd <= endMd;
}

function activeHolidayRulesForToday() {
  const now = new Date();
  const todayMd =
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  const active = [];
  for (const rule of readHolidayRulesFromSettings()) {
    if (rule.mode === "dynamic") {
      const base = computeNthWeekdayOfMonth(
        now.getFullYear(),
        rule.month,
        rule.weekday,
        rule.nth
      );
      if (!base) continue;
      const end = new Date(base.getTime());
      end.setDate(end.getDate() + (rule.spanDays || 0));
      const startMd =
        String(base.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(base.getDate()).padStart(2, "0");
      const endMd =
        String(end.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(end.getDate()).padStart(2, "0");
      if (monthDayInHolidayRange(todayMd, startMd, endMd)) {
        active.push(rule);
      }
      continue;
    }
    if (monthDayInHolidayRange(todayMd, rule.start, rule.end)) {
      active.push(rule);
    }
  }
  return active;
}

function ruleTextMatch(rule, tagHay, titleHay, plotHay) {
  if (!rule) return false;
  const needsTag = !!rule.tag;
  const needsTitle =
    Array.isArray(rule.titleKeywords) && rule.titleKeywords.length > 0;
  const needsPlot =
    Array.isArray(rule.plotKeywords) && rule.plotKeywords.length > 0;
  if (!needsTag && !needsTitle && !needsPlot) return false;
  // Only criteria the rule actually configures participate in the AND/OR combination below.
  // An unconfigured criterion must drop out entirely — not silently count as "true" — or a
  // rule with only e.g. a tag set would auto-satisfy every OR check via its unused title/plot
  // slots and match every single card regardless of the tag.
  const applicable = [];
  if (needsTag) applicable.push(String(tagHay || "").includes(rule.tag));
  if (needsTitle) {
    applicable.push(
      rule.titleKeywords.some((kw) => String(titleHay || "").includes(kw))
    );
  }
  if (needsPlot) {
    applicable.push(
      rule.plotKeywords.some((kw) => String(plotHay || "").includes(kw))
    );
  }
  return rule.matchMode === "and"
    ? applicable.every(Boolean)
    : applicable.some(Boolean);
}

/** MediaCard-shaped object (home poster carousel / live on-demand cards). */
function cardMatchesHolidayRule(card, rule) {
  if (!card || !rule) return false;
  const genreText = Array.isArray(card.genre)
    ? card.genre.join(" ")
    : String(card.genre || "");
  const tagHay = (
    String(card.title || "") +
    " " +
    String(card.tagLine || "") +
    " " +
    String(card.summary || "") +
    " " +
    String(card.studio || "") +
    " " +
    String(card.cast || "") +
    " " +
    String(card.directors || "") +
    " " +
    String(card.authors || "") +
    " " +
    String(card.albumArtist || "") +
    " " +
    String(card.tags || "") +
    " " +
    genreText
  )
    .toLowerCase()
    .trim();
  const titleHay = (
    String(card.title || "") + " " + String(card.tagLine || "")
  )
    .toLowerCase()
    .trim();
  const plotHay = (
    String(card.summary || "") + " " + String(card.plot || "")
  )
    .toLowerCase()
    .trim();
  return ruleTextMatch(rule, tagHay, titleHay, plotHay);
}

/** now_showing_movies row shape. */
function nowShowingRowMatchesHolidayRule(row, rule) {
  if (!row || !rule) return false;
  const tagHay = (
    String(row.title || "") +
    " " +
    String(row.genres || "") +
    " " +
    String(row.topCast || "") +
    " " +
    String(row.studio || "")
  )
    .toLowerCase()
    .trim();
  const titleHay = String(row.title || "").toLowerCase().trim();
  const plotHay = String(row.overview || "").toLowerCase().trim();
  return ruleTextMatch(rule, tagHay, titleHay, plotHay);
}

/** poster_entries row shape (posterMetadataDb's cached-poster-library pool). */
function posterEntryMatchesHolidayRule(row, rule) {
  if (!row || !rule) return false;
  const tagHay = (
    String(row.title || "") +
    " " +
    String(row.genres || "") +
    " " +
    String(row.topCast || "") +
    " " +
    String(row.studio || "") +
    " " +
    String(row.tagsText || "")
  )
    .toLowerCase()
    .trim();
  const titleHay = (
    String(row.title || "") + " " + String(row.tagLine || "")
  )
    .toLowerCase()
    .trim();
  const plotHay = (
    String(row.summary || "") + " " + String(row.plot || "")
  )
    .toLowerCase()
    .trim();
  return ruleTextMatch(rule, tagHay, titleHay, plotHay);
}

function boostCardsByHolidayRules(cards, activeRules) {
  if (!Array.isArray(cards) || !cards.length) return cards;
  if (!Array.isArray(activeRules) || activeRules.length === 0) return cards;
  const HOLIDAY_BOOST_COPIES = 4;
  const boost = [];
  for (const card of cards) {
    let matches = false;
    for (const rule of activeRules) {
      if (cardMatchesHolidayRule(card, rule)) {
        matches = true;
        break;
      }
    }
    if (matches) boost.push(card);
  }
  if (!boost.length) return cards;
  const out = cards.slice();
  for (let i = 0; i < HOLIDAY_BOOST_COPIES; i++) out.push(...boost);
  return out;
}

function boostNowShowingRowsByHolidayRules(rows, activeRules) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  if (!Array.isArray(activeRules) || activeRules.length === 0) return rows;
  const HOLIDAY_BOOST_COPIES = 4;
  const boost = [];
  for (const row of rows) {
    let matches = false;
    for (const rule of activeRules) {
      if (nowShowingRowMatchesHolidayRule(row, rule)) {
        matches = true;
        break;
      }
    }
    if (matches) boost.push({ ...row });
  }
  if (!boost.length) return rows;
  const out = rows.slice();
  for (let i = 0; i < HOLIDAY_BOOST_COPIES; i++) out.push(...boost);
  return out;
}

module.exports = {
  ensureHolidaysDbReady,
  activeHolidayRulesForToday,
  cardMatchesHolidayRule,
  nowShowingRowMatchesHolidayRule,
  posterEntryMatchesHolidayRule,
  boostCardsByHolidayRules,
  boostNowShowingRowsByHolidayRules,
  normalizeHolidayMonthDay,
  normalizeHolidayInt,
  normalizeHolidayMode,
  normalizeHolidayMatchMode,
  normalizeHolidayPlotKeywords,
};
