const axios = require("axios");
const mediaCard = require("./../cards/MediaCard");
const { CardTypeEnum } = require("./../cards/CardType");
const core = require("./../core/cache");
const tmdbBackdropFallback = require("./../core/tmdbBackdropFallback");
const util = require("./../core/utility");
const appleTvDevices = require("./../core/appleTvDevices");
const liveSportsLookup = require("./../core/liveSportsLookup");

const ACTIVE_DEVICE_STATES = ["Playing", "Seeking", "Loading"];

// tvOS's system-wide "Now Playing" info (what pyatv reads via the Companion protocol) is not
// reliably cleared by every app when playback is backed out of — some apps only clear it once
// something else takes over Now Playing, leaving a stale "Paused" session indistinguishable
// from a real, recent pause. So Paused is shown, but only for a bounded grace window per
// device — a real pause keeps the card up (with the equalizer icon frozen, see MediaCard's
// `paused` field); a stale one still clears itself out within a minute either way, rather than
// sitting there indefinitely. Tracking lives in memory (module-level, since AppleTvProvider is
// reconstructed fresh every poll) so it resets on restart — worst case that just means one
// extra minute of a stale card after a restart, not the unbounded staleness a plain "always
// show Paused" approach would have.
const PAUSED_GRACE_MS = 60000;
const pausedSince = new Map(); // device identifier -> { since: number, contentKey: string }

/**
 * Apple's own titles often carry a trailing edition/cut annotation (e.g. "Furious 7
 * (Extended Edition)") that doesn't match TMDB's canonical title and returns zero
 * search results — strip it before searching.
 */
function stripEditionSuffix(title) {
  return String(title || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** 7 -> "7th", 1 -> "1st", 2 -> "2nd", 3 -> "3rd" (handles 11th/12th/13th correctly too). */
function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  switch (n % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

/** Matches EmbyJellyfinBase.ratingColour / posterMetadataDb's content-rating pill coloring. */
function ratingColourForContentRating(contentRating) {
  const cr = String(contentRating || "NR").toLowerCase();
  switch (cr) {
    case "nr":
    case "unrated":
      return "badge-dark";
    case "g":
    case "tv-g":
    case "tv-y":
      return "badge-success";
    case "pg":
    case "tv-pg":
    case "tv-y7":
      return "badge-info";
    case "pg-13":
    case "tv-14":
      return "badge-warning";
    case "tv-ma":
    case "r":
    case "nc-17":
      return "badge-danger";
    default:
      return "badge-dark";
  }
}

/**
 * Additive "now playing" source for Apple TV set-top boxes, fed by the pyatv sidecar
 * (classes/core/appleTvSidecar.js). Not registered in mediaServerFactory's exclusive
 * switch — this runs alongside whichever Plex/Jellyfin/Emby/Kodi provider is configured.
 */
class AppleTvProvider {
  constructor({ sidecarBaseUrl, tmdbApiKey }) {
    this.sidecarBaseUrl = sidecarBaseUrl;
    this.tmdbApiKey = tmdbApiKey;
  }

  async GetNowScreening(hideUser, filterDevices) {
    const nsCards = [];

    let devicesState;
    try {
      const res = await axios.get(this.sidecarBaseUrl + "/now-playing", { timeout: 8000 });
      devicesState = (res.data && res.data.devices) || [];
    } catch (err) {
      const now = new Date();
      console.log(now.toLocaleString() + " *Now Scrn. - Apple TV: " + err);
      return nsCards;
    }

    // Update per-device reachability shown on the settings page — independent of whether
    // the device is actively playing anything right now.
    for (const dev of devicesState) {
      appleTvDevices.markDeviceSeen(dev.identifier, !!dev.reachable).catch(() => {});
    }

    const deviceFilter = (filterDevices || "")
      .toLowerCase()
      .replace(/, /g, ",")
      .replace(/ ,/g, ",")
      .replace(/,+$/, "")
      .split(",")
      .filter(Boolean);

    // Drop pause tracking for devices no longer in this poll's response (disconnected, etc.)
    // so the map doesn't grow unbounded as devices come and go over time.
    const currentIdentifiers = new Set(devicesState.map((d) => d.identifier));
    for (const key of pausedSince.keys()) {
      if (!currentIdentifiers.has(key)) pausedSince.delete(key);
    }

    for (const dev of devicesState) {
      if (!dev.reachable || !dev.state) continue;
      const state = dev.state;

      let isPaused = false;
      if (state.deviceState === "Paused") {
        const contentKey = String(state.title || "") + "|" + String(state.seriesName || "");
        const existing = pausedSince.get(dev.identifier);
        if (!existing || existing.contentKey !== contentKey) {
          pausedSince.set(dev.identifier, { since: Date.now(), contentKey });
        }
        if (Date.now() - pausedSince.get(dev.identifier).since > PAUSED_GRACE_MS) continue;
        isPaused = true;
      } else if (ACTIVE_DEVICE_STATES.includes(state.deviceState)) {
        pausedSince.delete(dev.identifier);
      } else {
        continue;
      }
      if (!state.title && !state.seriesName) continue;

      if (deviceFilter.length > 0 && deviceFilter[0] !== "" && !deviceFilter.includes((dev.name || "").toLowerCase())) {
        continue;
      }

      const medCard = new mediaCard();
      medCard.cardType = CardTypeEnum.NowScreening;
      medCard.posterLibraryKind = "appletv";
      medCard.paused = isPaused;

      let isSportsCard = false;
      const isEpisode = state.seasonNumber != null || state.episodeNumber != null;
      if (isEpisode) {
        medCard.title = state.seriesName || state.title || "";
        medCard.episodeName = state.seriesName ? state.title || "" : "";
        medCard.mediaType = "episode";
        const sn = state.seasonNumber != null ? state.seasonNumber : "?";
        const en = state.episodeNumber != null ? state.episodeNumber : "?";
        medCard.tagLine =
          medCard.title + ", S" + sn + "E" + en + (medCard.episodeName ? " — '" + medCard.episodeName + "'" : "");
        medCard.posterAR = 1.5;
      } else if (state.mediaType === "Music") {
        medCard.title = state.title || "";
        medCard.albumArtist = state.artist || "";
        medCard.mediaType = "track";
        medCard.posterAR = 1;
      } else {
        // Live TV apps (YouTube TV, ESPN, MLB, etc.) also show ordinary movies/shows/other live
        // events, so this only checks for a sporting event specifically — matching a title like
        // "Team A at Team B" against a real, currently-scheduled game on ESPN's public
        // scoreboards — rather than assuming anything from these apps is sports. Anything that
        // doesn't match a real game today (including a false-positive title match, e.g. a movie
        // literally named "X vs Y") falls straight through to the normal movie handling below.
        let matchup = null;
        try {
          matchup = await liveSportsLookup.fetchMatchupInfo(state.title);
        } catch (e) {
          matchup = null;
        }
        if (matchup) {
          isSportsCard = true;
          medCard.mediaType = "sports";
          medCard.title = matchup.away.shortDisplayName + " at " + matchup.home.shortDisplayName;
          medCard.network = state.artist || "";
          medCard.sportsLeague = matchup.league;
          medCard.sportsAwayName = matchup.away.shortDisplayName || matchup.away.displayName;
          medCard.sportsAwayColor = matchup.away.color || "#333333";
          medCard.sportsHomeName = matchup.home.shortDisplayName || matchup.home.displayName;
          medCard.sportsHomeColor = matchup.home.color || "#333333";
          medCard.sportsIsLive = !!matchup.isLive;
          // Only a live-scoreboard match carries a real score/game state — a replay match
          // (isLive false) has neither, so the card just keeps showing "VS".
          medCard.sportsGameStarted = matchup.isLive && matchup.gameState !== "pre";
          medCard.sportsAwayScore = matchup.isLive ? String(matchup.away.score || "0") : "";
          medCard.sportsHomeScore = matchup.isLive ? String(matchup.home.score || "0") : "";
          // Inning/outs are baseball-specific — other sports have their own equivalents
          // (quarter/period, etc.) that aren't wired up yet, so this only fires for MLB.
          if (matchup.isLive && medCard.sportsGameStarted && matchup.league === "mlb") {
            medCard.sportsInningHalf = matchup.inningHalf || "top";
            medCard.sportsInningOrdinal = matchup.inningNumber != null ? ordinal(matchup.inningNumber) : "";
            medCard.sportsOuts = matchup.outs != null ? matchup.outs : null;
            medCard.sportsOnFirst = !!matchup.onFirst;
            medCard.sportsOnSecond = !!matchup.onSecond;
            medCard.sportsOnThird = !!matchup.onThird;
          }
          // Distinctive value (no other content uses it) so the client's Resize() can
          // recognize a sports card and switch to the wide two-logo layout, the same way
          // ar === 1 already signals square album art.
          medCard.posterAR = 0.5;
          await this.resolveSportsArt(medCard, dev, matchup);
        } else {
          medCard.title = state.title || "";
          medCard.mediaType = "movie";
          medCard.posterAR = 1.5;
        }
      }

      medCard.playerLocal = true;
      medCard.playerIP = dev.address || "";
      if (hideUser !== "true") {
        medCard.device = dev.name || "Apple TV";
        medCard.playerDevice = dev.name || "Apple TV";
      }

      if (!isSportsCard) {
        // Live sports has no meaningful fixed-length runtime (a broadcast's reported
        // "totalTime" can be many hours — the DVR/stream buffer window, not the game length) —
        // so the usual progress bar / end-time estimate is skipped entirely for it.
        const totalSec = state.totalTime || 0;
        const posSec = state.position || 0;
        medCard.runTime = Math.round(totalSec / 60);
        medCard.progress = Math.round(posSec / 60);
        medCard.progressPercent = totalSec > 0 ? Math.round((posSec / totalSec) * 100) : 0;
        // Minutes rounded to 2 decimal places (matches plex.js's round(ms/600)/100 convention) —
        // MediaCard's end-time estimate does `runDuration - runProgress` and adds the result as
        // minutes to "now", so these must be actual minutes, not minutes-rounded-then-divided-by-100.
        medCard.runDuration = Math.round((totalSec / 60) * 100) / 100;
        medCard.runProgress = Math.round((posSec / 60) * 100) / 100;

        await this.resolvePoster(medCard, dev, state, isEpisode);
        await this.resolveRating(medCard, state, isEpisode);
      }

      nsCards.push(medCard);
    }

    return nsCards;
  }

  /** Downloads/caches both teams' logos so the sports matchup card has local, stable image URLs. */
  async resolveSportsArt(medCard, dev, matchup) {
    const safeId = String(dev.identifier || "").replace(/[^a-zA-Z0-9]/g, "");
    const safeAway = String(matchup.away.abbreviation || matchup.away.shortDisplayName || "away")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const safeHome = String(matchup.home.abbreviation || matchup.home.shortDisplayName || "home")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const awayFile = `appletv-sports-${safeId}-${matchup.league}-${safeAway}.png`;
    const homeFile = `appletv-sports-${safeId}-${matchup.league}-${safeHome}.png`;
    try {
      if (matchup.away.logo) {
        await core.CacheImage(matchup.away.logo, awayFile);
        medCard.sportsAwayLogo = "/imagecache/" + awayFile;
      }
      if (matchup.home.logo) {
        await core.CacheImage(matchup.home.logo, homeFile);
        medCard.sportsHomeLogo = "/imagecache/" + homeFile;
      }
    } catch (e) {
      /* card still renders with team names/colors even without logos */
    }
  }

  async resolvePoster(medCard, dev, state, isEpisode) {
    const safeId = String(dev.identifier || "").replace(/[^a-zA-Z0-9]/g, "");
    const cleanTitle = stripEditionSuffix(medCard.title);
    // Keyed on the (cleaned) title rather than pyatv's own state.hash — the device's hash is
    // tied to its internal playback session and isn't guaranteed stable for the same content
    // across polls, which would otherwise repeatedly generate new cache files/URLs.
    const safeTitleKey = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) || "untitled";
    const posterFile = `appletv-tmdb-${safeId}-${safeTitleKey}.jpg`;
    const backdropFile = `appletv-backdrop-${safeId}-${safeTitleKey}.jpg`;
    const tileFile = `appletv-tile-${safeId}-${safeTitleKey}.jpg`;
    const mt = isEpisode ? "episode" : medCard.mediaType;
    // Disambiguates same-titled movies (e.g. "Ghostbusters" 1984 vs the 2016 reboot) — Apple TV's
    // metadata carries no TMDB/IMDb id, but the runtime being played is a strong fingerprint.
    // Not applied to episodes: a single episode's runtime doesn't reliably fingerprint a whole show.
    const runtimeMinutes = isEpisode ? undefined : Math.round((state.totalTime || 0) / 60);

    // Prefer a proper high-res TMDB poster (poster_path) over pyatv's artwork — the
    // latter is the tvOS "Now Playing" tile art (horizontal, low-res), not a movie poster.
    await tmdbBackdropFallback.cacheTmdbPosterIfNeeded({
      tmdbApiKey: this.tmdbApiKey,
      posterOk: false,
      mediaType: mt,
      title: cleanTitle,
      runtimeMinutes,
      posterFileName: posterFile,
      medCard,
      cacheImage: (url, fn) => core.CacheImage(url, fn),
    });

    // Blurred backdrop fill shown behind the (portrait) poster on landscape displays —
    // without this, the pillarboxed space around the poster is plain black.
    await tmdbBackdropFallback.cacheTmdbBannerIfNeeded({
      tmdbApiKey: this.tmdbApiKey,
      pullBackground: true,
      serverBannerOk: false,
      mediaType: mt,
      title: cleanTitle,
      runtimeMinutes,
      bannerFileName: backdropFile,
      medCard,
      cacheImage: (url, fn) => core.CacheImage(url, fn),
    });

    if (!medCard.posterURL && state.hasArtwork) {
      try {
        const artworkUrl = `${this.sidecarBaseUrl}/artwork/${encodeURIComponent(dev.identifier)}`;
        await core.CacheImage(artworkUrl, tileFile);
        // tvOS's system Now Playing artwork is sometimes served as HEIC despite the .jpg name —
        // see Cache.ConvertHeicIfNeeded for why that renders blank outside Safari.
        await core.ConvertHeicIfNeeded(tileFile);
        medCard.posterURL = "/imagecache/" + tileFile;
      } catch (e) {
        /* no poster available from either source */
      }
    }
  }

  async resolveRating(medCard, state, isEpisode) {
    const runtimeMinutes = isEpisode ? undefined : Math.round((state.totalTime || 0) / 60);
    const ctx = {
      apiKey: this.tmdbApiKey,
      mediaType: isEpisode ? "episode" : medCard.mediaType,
      title: stripEditionSuffix(medCard.title),
      runtimeMinutes,
    };
    try {
      const rating = await tmdbBackdropFallback.resolveTmdbRating(ctx);
      if (rating) medCard.rating = rating;
    } catch (e) {
      /* optional */
    }
    try {
      const contentRating = await tmdbBackdropFallback.resolveTmdbContentRating(ctx);
      if (contentRating) {
        medCard.contentRating = contentRating;
        medCard.ratingColour = ratingColourForContentRating(contentRating);
      }
    } catch (e) {
      /* optional */
    }
  }
}

module.exports = AppleTvProvider;
