const axios = require("axios");

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_W1280 = "https://image.tmdb.org/t/p/w1280";

/** In-process cache to limit duplicate TMDB calls during large syncs. */
const backdropUrlCache = new Map();

function cacheGet(key) {
  return backdropUrlCache.has(key) ? backdropUrlCache.get(key) : undefined;
}

function cacheSet(key, val) {
  if (backdropUrlCache.size > 6000) backdropUrlCache.clear();
  backdropUrlCache.set(key, val);
}

async function fetchJson(url, params) {
  const r = await axios.get(url, { params, timeout: 20000 });
  return r.data;
}

function backdropPathToUrl(p) {
  if (!p || typeof p !== "string") return null;
  return TMDB_IMG_W1280 + p;
}

/**
 * Parse Plex agent guids (md.guid and md.Guid[]) for TMDB / IMDb / TVDB ids.
 * @param {object} md Plex metadata object
 */
function collectPlexExternalIds(md) {
  const out = {};
  const list = [];
  if (md && md.Guid && Array.isArray(md.Guid)) {
    for (const g of md.Guid) {
      const id = g && (g.id || g.Id);
      if (id) list.push(String(id));
    }
  }
  if (md && md.guid) list.push(String(md.guid));
  for (const s of list) {
    const str = String(s || "");
    let m = str.match(/themoviedb:\/\/(\d+)/i);
    if (m) out.tmdbId = parseInt(m[1], 10);
    m = str.match(/imdb:\/\/(tt\d+)/i);
    if (m) out.imdbId = m[1];
    m = str.match(/imdb:\/\/(\d+)/i);
    if (m && !out.imdbId) out.imdbId = "tt" + m[1];
    m = str.match(/tvdb:\/\/(\d+)/i);
    if (m) out.tvdbId = m[1];
  }
  return out;
}

/**
 * Jellyfin / Emby ProviderIds.
 * @param {object} md Item from API
 */
function collectJellyfinProviderIds(md) {
  if (!md) return {};
  const p = md.ProviderIds || md.providerIds || {};
  const tRaw =
    p.Tmdb ||
    p.TMDB ||
    p.tmdb ||
    p.TmdbId ||
    p.TmdbID ||
    "";
  const tmdbId =
    tRaw !== "" && tRaw != null ? parseInt(String(tRaw).replace(/\D/g, ""), 10) : NaN;
  const imdbRaw = p.Imdb || p.IMDB || p.imdb || "";
  const tvdbRaw = p.Tvdb || p.TVDB || p.tvdb || "";
  return {
    tmdbId: !isNaN(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
    imdbId: imdbRaw ? String(imdbRaw).trim() : undefined,
    tvdbId: tvdbRaw != null && tvdbRaw !== "" ? String(tvdbRaw).trim() : undefined,
  };
}

/**
 * Kodi movie / TV show item (imdbnumber, uniqueid map).
 * @param {object} md
 */
function collectKodiExternalIds(md) {
  if (!md) return {};
  const out = {};
  if (md.imdbnumber) {
    const im = String(md.imdbnumber).trim();
    out.imdbId = im.startsWith("tt") ? im : "tt" + im.replace(/^tt?/i, "");
  }
  const u = md.uniqueid;
  if (u && typeof u === "object") {
    if (u.tmdb && !out.tmdbId) {
      const t = parseInt(String(u.tmdb), 10);
      if (!isNaN(t) && t > 0) out.tmdbId = t;
    }
    if (u.imdb) out.imdbId = String(u.imdb).trim();
    if (u.tvdb) out.tvdbId = String(u.tvdb).trim();
  }
  return out;
}

async function getDetailsBackdrop(apiKey, tmdbNumericId, isTv, imageField = "backdrop_path") {
  const key = `${isTv ? "tv" : "m"}:${tmdbNumericId}:${imageField}`;
  const cached = cacheGet(key);
  // Only short-circuit on a cached *success* — a cached null (previous lookup found nothing)
  // must not stick forever, since a title can legitimately not be on TMDB yet, or the first
  // attempt could've hit a transient API error; either way it deserves a retry on the next
  // poll rather than being permanently poisoned for the life of the process.
  if (cached) return cached;
  const path = isTv ? `/tv/${tmdbNumericId}` : `/movie/${tmdbNumericId}`;
  try {
    const d = await fetchJson(`${TMDB_BASE}${path}`, { api_key: apiKey });
    const url = backdropPathToUrl(d[imageField]);
    cacheSet(key, url);
    return url;
  } catch (e) {
    cacheSet(key, null);
    return null;
  }
}

async function findByImdb(apiKey, imdbId, imageField = "backdrop_path") {
  const raw = String(imdbId || "").trim();
  if (!raw) return null;
  const tt = raw.startsWith("tt") ? raw : "tt" + raw.replace(/^tt?/i, "");
  const cacheKey = `find:imdb:${tt}:${imageField}`;
  const cached = cacheGet(cacheKey);
  // Only short-circuit on a cached *success* — a cached null (previous lookup found nothing)
  // must not stick forever, since a title can legitimately not be on TMDB yet, or the first
  // attempt could've hit a transient API error; either way it deserves a retry on the next
  // poll rather than being permanently poisoned for the life of the process.
  if (cached) return cached;
  try {
    const d = await fetchJson(
      `${TMDB_BASE}/find/${encodeURIComponent(tt)}`,
      {
        api_key: apiKey,
        external_source: "imdb_id",
      }
    );
    const mv = d.movie_results && d.movie_results[0];
    const tv = d.tv_results && d.tv_results[0];
    let url = mv && backdropPathToUrl(mv[imageField]);
    if (!url && tv) url = backdropPathToUrl(tv[imageField]);
    cacheSet(cacheKey, url || null);
    return url || null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function findByTvdb(apiKey, tvdbId, imageField = "backdrop_path") {
  const id = String(tvdbId || "").trim();
  if (!id) return null;
  const cacheKey = `find:tvdb:${id}:${imageField}`;
  const cached = cacheGet(cacheKey);
  // Only short-circuit on a cached *success* — a cached null (previous lookup found nothing)
  // must not stick forever, since a title can legitimately not be on TMDB yet, or the first
  // attempt could've hit a transient API error; either way it deserves a retry on the next
  // poll rather than being permanently poisoned for the life of the process.
  if (cached) return cached;
  try {
    const d = await fetchJson(`${TMDB_BASE}/find/${encodeURIComponent(id)}`, {
      api_key: apiKey,
      external_source: "tvdb_id",
    });
    const tv = d.tv_results && d.tv_results[0];
    const url = tv && backdropPathToUrl(tv[imageField]);
    cacheSet(cacheKey, url || null);
    return url || null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function searchByTitle(apiKey, title, yearStr, isTv, imageField = "backdrop_path", runtimeMinutes) {
  const q = String(title || "").trim();
  if (!q) return null;
  const cacheKey = `search:${isTv ? "tv" : "mv"}:${q}|${yearStr || ""}:${imageField}:${runtimeMinutes || ""}`;
  const cached = cacheGet(cacheKey);
  // Only short-circuit on a cached *success* — a cached null (previous lookup found nothing)
  // must not stick forever, since a title can legitimately not be on TMDB yet, or the first
  // attempt could've hit a transient API error; either way it deserves a retry on the next
  // poll rather than being permanently poisoned for the life of the process.
  if (cached) return cached;
  const path = isTv ? "/search/tv" : "/search/movie";
  const params = {
    api_key: apiKey,
    query: q,
    include_adult: false,
    page: 1,
  };
  const y = parseInt(String(yearStr || "").slice(0, 4), 10);
  if (!isNaN(y) && y > 1800) {
    if (isTv) params.first_air_date_year = y;
    else params.year = y;
  }
  try {
    const d = await fetchJson(`${TMDB_BASE}${path}`, params);
    const results = (d && d.results) || [];

    // Same-titled movies (e.g. "Ghostbusters" 1984 vs the 2016 reboot) are otherwise
    // resolved to whichever TMDB ranks first (usually the most popular/recent) — when we
    // know the actual runtime being played, prefer whichever candidate's runtime matches.
    if (!isTv && runtimeMinutes && results.length > 1) {
      let best = null;
      let bestDiff = Infinity;
      for (const item of results.slice(0, 5)) {
        if (!item.id) continue;
        try {
          const details = await fetchJson(`${TMDB_BASE}/movie/${item.id}`, { api_key: apiKey });
          if (details.runtime && details.runtime > 0) {
            const diff = Math.abs(details.runtime - runtimeMinutes);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = details;
            }
          }
        } catch (e) {
          /* skip this candidate */
        }
      }
      if (best && bestDiff <= 5) {
        const u = backdropPathToUrl(best[imageField]);
        if (u) {
          cacheSet(cacheKey, u);
          return u;
        }
      }
    }

    for (const item of results.slice(0, 6)) {
      const u = backdropPathToUrl(item[imageField]);
      if (u) {
        cacheSet(cacheKey, u);
        return u;
      }
    }
    const first = results[0];
    if (first && first.id) {
      const u = await getDetailsBackdrop(apiKey, first.id, isTv, imageField);
      cacheSet(cacheKey, u || null);
      return u;
    }
    cacheSet(cacheKey, null);
    return null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

/**
 * Resolve a TMDB image URL for movies or TV using ids or title search.
 * Skips music-only types. Defaults to the backdrop (wide) image; pass
 * `imageField: "poster_path"` for the vertical poster instead.
 *
 * @param {{ apiKey: string, mediaType: string, title?: string, year?: string|number, tmdbId?: number, imdbId?: string, tvdbId?: string|number, imageField?: string }} ctx
 * @returns {Promise<string|null>} HTTPS image URL or null
 */
async function resolveTmdbBackdropImageUrl(ctx) {
  const apiKey = String(ctx.apiKey || "").trim();
  if (!apiKey) return null;
  const mt = String(ctx.mediaType || "").toLowerCase();
  if (mt === "album" || mt === "track" || mt === "artist") return null;
  const isTv = mt === "show" || mt === "series" || mt === "episode";
  const imageField = ctx.imageField || "backdrop_path";

  const tmdbRaw = ctx.tmdbId;
  const tmdbNum =
    tmdbRaw != null && tmdbRaw !== ""
      ? parseInt(String(tmdbRaw).replace(/\D/g, ""), 10)
      : NaN;
  if (!isNaN(tmdbNum) && tmdbNum > 0) {
    const u = await getDetailsBackdrop(apiKey, tmdbNum, isTv, imageField);
    if (u) return u;
  }

  if (ctx.imdbId) {
    const u = await findByImdb(apiKey, ctx.imdbId, imageField);
    if (u) return u;
  }

  if (isTv && ctx.tvdbId) {
    const u = await findByTvdb(apiKey, ctx.tvdbId, imageField);
    if (u) return u;
  }

  const year =
    ctx.year != null && ctx.year !== ""
      ? String(ctx.year).slice(0, 4)
      : "";
  const primary = await searchByTitle(apiKey, ctx.title, year, isTv, imageField, ctx.runtimeMinutes);
  if (primary) return primary;
  // Apple TV's mediaType guess (movie vs. show) rests entirely on whether pyatv reports
  // season/episode numbers — some apps only report a flat title with no episodic metadata,
  // misclassifying an actual TV series as a movie (or vice versa). Retry as the opposite type
  // before giving up, rather than trusting a guess that has no real signal behind it here.
  return searchByTitle(apiKey, ctx.title, year, !isTv, imageField, ctx.runtimeMinutes);
}

/**
 * When the media server did not supply a banner, fetch a TMDB backdrop into imagecache.
 *
 * @param {{ tmdbApiKey: string, pullBackground: boolean, serverBannerOk: boolean, mediaType: string, title?: string, year?: string|number, tmdbId?: number, imdbId?: string, tvdbId?: string|number, bannerFileName: string, medCard: object, cacheImage: function }} p
 */
async function cacheTmdbBannerIfNeeded(p) {
  const key = String(p.tmdbApiKey || process.env.TMDB_API_KEY || "").trim();
  if (!p.pullBackground || !key || p.serverBannerOk) return;
  const mt = String(p.mediaType || "").toLowerCase();
  if (mt === "album") return;
  const bn = String(p.bannerFileName || "").trim();
  if (!bn || bn.includes("..") || /[\\/]/.test(bn)) return;

  const url = await resolveTmdbBackdropImageUrl({
    apiKey: key,
    mediaType: mt,
    title: p.title,
    year: p.year,
    tmdbId: p.tmdbId,
    imdbId: p.imdbId,
    tvdbId: p.tvdbId,
    runtimeMinutes: p.runtimeMinutes,
  });
  if (!url) return;
  try {
    await p.cacheImage(url, bn);
    if (!p.medCard.posterArtURL) {
      p.medCard.posterArtURL = "/imagecache/" + bn;
    }
  } catch (e) {
    /* optional */
  }
}

/**
 * Apple TV poster fallback — same shape as cacheTmdbBannerIfNeeded, but targets
 * medCard.posterURL (vertical poster art) via poster_path instead of the
 * backdrop/background art. No tmdbId/imdbId/tvdbId is expected here — Apple TV's
 * MRP now-playing metadata carries no external ids, so this always resolves via
 * title search.
 *
 * @param {{ tmdbApiKey: string, posterOk: boolean, mediaType: string, title?: string, year?: string|number, posterFileName: string, medCard: object, cacheImage: function }} p
 */
async function cacheTmdbPosterIfNeeded(p) {
  const key = String(p.tmdbApiKey || process.env.TMDB_API_KEY || "").trim();
  if (!key || p.posterOk) return;
  const mt = String(p.mediaType || "").toLowerCase();
  if (mt === "album" || mt === "track" || mt === "artist") return;
  const fn = String(p.posterFileName || "").trim();
  if (!fn || fn.includes("..") || /[\\/]/.test(fn)) return;

  const url = await resolveTmdbBackdropImageUrl({
    apiKey: key,
    mediaType: mt,
    title: p.title,
    year: p.year,
    imageField: "poster_path",
    runtimeMinutes: p.runtimeMinutes,
  });
  if (!url) {
    console.log(
      new Date().toLocaleString() +
        " *TMDB poster: no match for title=" + JSON.stringify(p.title) +
        " mediaType=" + mt
    );
    return;
  }
  console.log(
    new Date().toLocaleString() +
      " *TMDB poster: found " + url + " for title=" + JSON.stringify(p.title)
  );
  try {
    const ok = await p.cacheImage(url, fn);
    if (ok === false) {
      console.log(
        new Date().toLocaleString() +
          " *TMDB poster: download reported failure for " + url + " -> " + fn
      );
    }
    if (!p.medCard.posterURL) {
      p.medCard.posterURL = "/imagecache/" + fn;
    }
  } catch (e) {
    console.log(
      new Date().toLocaleString() +
        " *TMDB poster: cacheImage threw for " + url + " -> " + fn + ": " +
        (e && e.message ? e.message : e)
    );
  }
}

/**
 * Resolve a TMDB rating (vote_average, 0-10 scale) as a "NN%" string, using the same
 * title/runtime matching as the poster/backdrop resolvers (for Apple TV, which has no
 * TMDB id of its own to look up directly).
 *
 * @param {{ apiKey: string, mediaType: string, title?: string, year?: string|number, runtimeMinutes?: number }} ctx
 * @returns {Promise<string|null>}
 */
async function attemptTmdbRating(apiKey, title, year, runtimeMinutes, isTv) {
  const cacheKey = `rating:${isTv ? "tv" : "mv"}:${title}|${year || ""}:${runtimeMinutes || ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const path = isTv ? "/search/tv" : "/search/movie";
  const params = { api_key: apiKey, query: title, include_adult: false, page: 1 };
  const y = parseInt(String(year || "").slice(0, 4), 10);
  if (!isNaN(y) && y > 1800) {
    if (isTv) params.first_air_date_year = y;
    else params.year = y;
  }

  try {
    const d = await fetchJson(`${TMDB_BASE}${path}`, params);
    const results = (d && d.results) || [];
    let best = results[0];

    if (!isTv && runtimeMinutes && results.length > 1) {
      let bestDiff = Infinity;
      for (const item of results.slice(0, 5)) {
        if (!item.id) continue;
        try {
          const details = await fetchJson(`${TMDB_BASE}/movie/${item.id}`, { api_key: apiKey });
          if (details.runtime && details.runtime > 0) {
            const diff = Math.abs(details.runtime - runtimeMinutes);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = details;
            }
          }
        } catch (e) {
          /* skip this candidate */
        }
      }
    }

    const voteAverage = best && typeof best.vote_average === "number" ? best.vote_average : null;
    const rating = voteAverage && voteAverage > 0 ? Math.round(voteAverage * 10) + "%" : null;
    cacheSet(cacheKey, rating);
    return rating;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function resolveTmdbRating(ctx) {
  const apiKey = String(ctx.apiKey || "").trim();
  if (!apiKey) return null;
  const mt = String(ctx.mediaType || "").toLowerCase();
  if (mt === "album" || mt === "track" || mt === "artist") return null;
  const isTv = mt === "show" || mt === "series" || mt === "episode";
  const q = String(ctx.title || "").trim();
  if (!q) return null;

  const primary = await attemptTmdbRating(apiKey, q, ctx.year, ctx.runtimeMinutes, isTv);
  if (primary) return primary;
  // Apple TV's mediaType guess rests entirely on whether pyatv reports season/episode
  // numbers, which some apps omit even for genuine TV content — retry as the opposite type
  // before giving up (see resolveTmdbBackdropImageUrl for the same reasoning).
  return attemptTmdbRating(apiKey, q, ctx.year, ctx.runtimeMinutes, !isTv);
}

/**
 * Resolve a US content rating (movie MPAA certification like "PG-13", or TV rating like
 * "TV-14") from TMDB — same title/runtime matching as the other Apple TV resolvers, since
 * pyatv exposes no certification field of its own.
 *
 * @param {{ apiKey: string, mediaType: string, title?: string, year?: string|number, runtimeMinutes?: number }} ctx
 * @returns {Promise<string|null>}
 */
async function resolveTmdbContentRating(ctx) {
  const apiKey = String(ctx.apiKey || "").trim();
  if (!apiKey) return null;
  const mt = String(ctx.mediaType || "").toLowerCase();
  if (mt === "album" || mt === "track" || mt === "artist") return null;
  const isTv = mt === "show" || mt === "series" || mt === "episode";
  const q = String(ctx.title || "").trim();
  if (!q) return null;

  const primary = await attemptTmdbContentRating(apiKey, q, ctx.year, ctx.runtimeMinutes, isTv);
  if (primary) return primary;
  // Apple TV's mediaType guess rests entirely on whether pyatv reports season/episode
  // numbers, which some apps omit even for genuine TV content — retry as the opposite type
  // before giving up (see resolveTmdbBackdropImageUrl for the same reasoning).
  return attemptTmdbContentRating(apiKey, q, ctx.year, ctx.runtimeMinutes, !isTv);
}

async function attemptTmdbContentRating(apiKey, q, year, runtimeMinutes, isTv) {
  const cacheKey = `contentRating:${isTv ? "tv" : "mv"}:${q}|${year || ""}:${runtimeMinutes || ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const searchPath = isTv ? "/search/tv" : "/search/movie";
  const params = { api_key: apiKey, query: q, include_adult: false, page: 1 };
  const y = parseInt(String(year || "").slice(0, 4), 10);
  if (!isNaN(y) && y > 1800) {
    if (isTv) params.first_air_date_year = y;
    else params.year = y;
  }

  try {
    const d = await fetchJson(`${TMDB_BASE}${searchPath}`, params);
    const results = (d && d.results) || [];
    let best = results[0];

    if (!isTv && runtimeMinutes && results.length > 1) {
      let bestDiff = Infinity;
      for (const item of results.slice(0, 5)) {
        if (!item.id) continue;
        try {
          const details = await fetchJson(`${TMDB_BASE}/movie/${item.id}`, { api_key: apiKey });
          if (details.runtime && details.runtime > 0) {
            const diff = Math.abs(details.runtime - runtimeMinutes);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = details;
            }
          }
        } catch (e) {
          /* skip this candidate */
        }
      }
    }

    if (!best || !best.id) {
      cacheSet(cacheKey, null);
      return null;
    }

    let certification = null;
    if (isTv) {
      const cr = await fetchJson(`${TMDB_BASE}/tv/${best.id}/content_ratings`, { api_key: apiKey });
      const us = ((cr && cr.results) || []).find((r) => r.iso_3166_1 === "US");
      certification = (us && String(us.rating || "").trim()) || null;
    } else {
      const rd = await fetchJson(`${TMDB_BASE}/movie/${best.id}/release_dates`, { api_key: apiKey });
      const us = ((rd && rd.results) || []).find((r) => r.iso_3166_1 === "US");
      const dates = (us && us.release_dates) || [];
      const withCert = dates.find((r) => r.certification && String(r.certification).trim());
      certification = (withCert && String(withCert.certification).trim()) || null;
    }

    cacheSet(cacheKey, certification || null);
    return certification || null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

module.exports = {
  collectPlexExternalIds,
  collectJellyfinProviderIds,
  collectKodiExternalIds,
  resolveTmdbBackdropImageUrl,
  cacheTmdbBannerIfNeeded,
  cacheTmdbPosterIfNeeded,
  resolveTmdbRating,
  resolveTmdbContentRating,
};
