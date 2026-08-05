const axios = require("axios");
const fs = require("fs");
const path = require("path");

const settingsPath = path.join(__dirname, "..", "config/settings.json");
const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

const useHttps = s.plexHTTPS === true || s.plexHTTPS === "true";
const PLEX_BASE = (useHttps ? "https" : "http") + "://" + s.plexIP + ":" + s.plexPort;
const PLEX_TOKEN = s.plexToken;
const TMDB_KEY = s.tmdbApiKey;
const TMDB_BASE = "https://api.themoviedb.org/3";

const MOVIE_SECTIONS = ["1", "4"]; // "Movies", "4K & Blu-Ray Movies"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function plexGet(pathAndQuery, params) {
  const res = await axios.get(PLEX_BASE + pathAndQuery, {
    headers: { "X-Plex-Token": PLEX_TOKEN, Accept: "application/json" },
    params,
  });
  return res.data.MediaContainer;
}

async function listSectionItems(sectionKey) {
  const size = 200;
  let start = 0;
  let all = [];
  while (true) {
    const mc = await plexGet("/library/sections/" + sectionKey + "/all", {
      "X-Plex-Container-Start": start,
      "X-Plex-Container-Size": size,
    });
    const items = mc.Metadata || [];
    all = all.concat(items);
    if (items.length < size) break;
    start += size;
  }
  return all;
}

async function getTmdbIdFromPlex(ratingKey) {
  const mc = await plexGet("/library/metadata/" + ratingKey);
  const item = mc.Metadata[0];
  const guids = item.Guid || [];
  for (const g of guids) {
    const m = /^tmdb:\/\/(\d+)/.exec(g.id || "");
    if (m) return m[1];
  }
  return null;
}

async function searchTmdbId(title, year) {
  const res = await axios.get(TMDB_BASE + "/search/movie", {
    params: { api_key: TMDB_KEY, query: title, year: year || undefined, include_adult: false },
  });
  const results = res.data.results || [];
  return results.length > 0 ? String(results[0].id) : null;
}

async function bestTmdbPosterUrl(tmdbId) {
  const res = await axios.get(TMDB_BASE + "/movie/" + tmdbId + "/images", {
    params: { api_key: TMDB_KEY, include_image_language: "en,null" },
  });
  const posters = res.data.posters || [];
  if (posters.length === 0) return null;
  return "https://image.tmdb.org/t/p/original" + posters[0].file_path;
}

async function setPlexPoster(ratingKey, posterUrl) {
  await axios.post(PLEX_BASE + "/library/metadata/" + ratingKey + "/posters", null, {
    headers: { "X-Plex-Token": PLEX_TOKEN },
    params: { url: posterUrl },
  });
}

const LIMIT = process.env.POSTER_FIX_LIMIT ? parseInt(process.env.POSTER_FIX_LIMIT, 10) : null;

async function main() {
  const summary = { updated: 0, noTmdbMatch: 0, noPoster: 0, errors: 0, total: 0 };
  const errorDetails = [];

  for (const sectionKey of MOVIE_SECTIONS) {
    let items = await listSectionItems(sectionKey);
    if (LIMIT) items = items.slice(0, LIMIT);
    console.log("=== Section " + sectionKey + ": " + items.length + " movies ===");
    for (const item of items) {
      summary.total++;
      const label = item.title + (item.year ? " (" + item.year + ")" : "") + " [" + item.ratingKey + "]";
      try {
        let tmdbId = await getTmdbIdFromPlex(item.ratingKey);
        if (!tmdbId) {
          tmdbId = await searchTmdbId(item.title, item.year);
        }
        if (!tmdbId) {
          console.log("SKIP (no TMDB match): " + label);
          summary.noTmdbMatch++;
          continue;
        }
        const posterUrl = await bestTmdbPosterUrl(tmdbId);
        if (!posterUrl) {
          console.log("SKIP (no TMDB poster available): " + label);
          summary.noPoster++;
          continue;
        }
        await setPlexPoster(item.ratingKey, posterUrl);
        console.log("UPDATED: " + label + " -> " + posterUrl);
        summary.updated++;
      } catch (e) {
        const msg = e.response ? e.response.status + " " + JSON.stringify(e.response.data).slice(0, 200) : e.message;
        console.log("ERROR: " + label + " -> " + msg);
        summary.errors++;
        errorDetails.push({ label, msg });
      }
      await sleep(150);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  if (errorDetails.length > 0) {
    console.log("\n=== ERRORS ===");
    errorDetails.forEach((e) => console.log(e.label + ": " + e.msg));
  }
  fs.writeFileSync(
    path.join(__dirname, "plex_poster_fix_summary.json"),
    JSON.stringify({ summary, errorDetails }, null, 2)
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
