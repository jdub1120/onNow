const fs = require("fs");
const path = require("path");
const request = require("request");
const fsExtra = require("fs-extra");
const util = require("./utility");
const { IMAGE_CACHE_DIR, MP3_CACHE_DIR } = require("./appPaths");

// fileName -> {primary, secondary} | null — see Cache.ExtractMusicGradientColors
const musicGradientColorCache = new Map();

/**
 * @desc Cache class manages the downloaad, cleanup and random selection of mp3 and poster image assets. Methods are static.
 * @returns nothing
 */
class Cache {
  constructor() {
    return;
  }

  /**
   * @desc Downloads the poster image
   * @param {string} url - the full url to the picture file
   * @param {string} fileName - the filename to save the image file as
   * @returns nothing
   */
  /**
   * @param {object} [options] — e.g. `{ headers: { Authorization: "…" } }` for Jellyfin image endpoints
   */
  static async CacheImage(url, fileName, options) {
    const savePath = path.join(IMAGE_CACHE_DIR, fileName);
    const result = await this.download(url, savePath, options);
    return result;
  }

  /**
   * Re-download an image even if the file already exists (poster metadata refresh).
   * @param {string} url
   * @param {string} savePath absolute or relative path
   */
  static downloadImageForce(url, savePath, options) {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl || cleanUrl.includes("undefined") || cleanUrl.includes("null")) {
      return Promise.resolve(false);
    }
    const headers = options && options.headers;
    return new Promise((resolve, reject) => {
      try {
        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
      } catch (e) {
        /* ignore */
      }
      const ws = fs.createWriteStream(savePath, { autoClose: true });
      const req = headers ? request({ url: cleanUrl, headers }) : request(cleanUrl);
      req.on("error", (err) => {
        try {
          ws.destroy();
        } catch (e) {
          /* ignore */
        }
        reject(err);
      });
      req.pipe(ws);
      ws.on("error", (err) => reject(err));
      ws.on("finish", () => resolve(true));
    });
  }

  /**
   * @desc Downloads the tv mp3 file from tvthemes.plexapp.com
   * @param {string} fileName - the filename to download and save. this in the format of tvdbid.mp3
   * @returns nothing
   */
  static async CacheMP3(fileName) {
    const savePath = path.join(MP3_CACHE_DIR, fileName);
    const url = "http://tvthemes.plexapp.com/" + fileName;
    const result = await this.download(url, savePath, undefined);
    return result;
  }

  /**
   * @desc Downloads an mp3 from a URL (e.g. Plex theme URL or tvthemes.plexapp.com)
   * @param {string} url - the fully qualified URL for the media file
   * @param {string} fileName - the filename to download and save. this in the format of tvdbid.mp3
   * @returns nothing
   */
  static async CachePlexMP3(url, fileName) {
    const savePath = path.join(MP3_CACHE_DIR, fileName);
    //console.log(fileName, url);
    const result = await this.download(url, savePath, undefined);
    return result;
  }

  /**
   * @desc Download any asset, providing it does not already exist in the save location
   * @param {string} url - the full url to the asset
   * @param {string} savePath - the path to save the asset to
   * @param {object} [options] — optional `{ headers }` for authenticated image URLs
   * @returns {Promise<boolean>}
   */
  static download(url, savePath, options) {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl || cleanUrl.includes("undefined") || cleanUrl.includes("null")) {
      return Promise.resolve(false);
    }
    if (fs.existsSync(savePath)) {
      return Promise.resolve(true);
    }
    try {
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
    } catch (e) {
      /* ignore */
    }
    const headers = options && options.headers;
    return new Promise((resolve) => {
      const ws = fs.createWriteStream(savePath, { autoClose: true });
      const req = headers
        ? request({ url: cleanUrl, headers })
        : request(cleanUrl);
      req.on("error", (err) => {
        try {
          ws.destroy();
        } catch (e) {
          /* ignore */
        }
        if (err.code !== "EPERM") {
          console.log(
            "download failed for: ",
            url,
            err.message,
            err.code,
            err.errno
          );
        }
        resolve(false);
      });
      req.pipe(ws);
      ws.on("error", (err) => {
        if (err.code !== "EPERM") {
          console.log(
            "download failed for: ",
            url,
            err.message,
            err.code,
            err.errno
          );
        }
        resolve(false);
      });
      ws.on("finish", () => resolve(true));
    });
  }

  /**
   * ISO base media "ftyp" box brand sniff — true for HEIC/HEIF. tvOS's system Now Playing
   * artwork (read via pyatv's Companion protocol) is sometimes served in this format even
   * though callers save it with a .jpg name; Safari decodes HEIC natively so it looks fine
   * there, but Chrome/Firefox/Chromium (incl. kiosk devices like a Raspberry Pi) render
   * nothing at all for it.
   */
  static isHeic(buf) {
    if (!buf || buf.length < 12) return false;
    if (buf.toString("ascii", 4, 8) !== "ftyp") return false;
    const brand = buf.toString("ascii", 8, 12);
    return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand);
  }

  /**
   * If the cached file at fileName is actually HEIC/HEIF (regardless of its .jpg extension),
   * convert it to JPEG in place. No-ops (cheaply) for anything already in a browser-safe format.
   * @param {string} fileName - relative to IMAGE_CACHE_DIR, as passed to CacheImage
   * @returns {Promise<boolean>} true if a conversion happened
   */
  static async ConvertHeicIfNeeded(fileName) {
    const filePath = path.join(IMAGE_CACHE_DIR, fileName);
    try {
      const buf = await fsExtra.readFile(filePath);
      if (!Cache.isHeic(buf)) return false;
      const heicConvert = require("heic-convert");
      const jpegBuffer = await heicConvert({ buffer: buf, format: "JPEG", quality: 0.9 });
      await fsExtra.writeFile(filePath, jpegBuffer);
      return true;
    } catch (e) {
      console.log("ConvertHeicIfNeeded failed for " + fileName + ": " + e.message);
      return false;
    }
  }

  /**
   * Apple Music-style "dynamic background": rather than blurring the artwork itself, extract
   * a representative vibrant color from it and hand back a light/dark pair for a CSS gradient,
   * plus the on-image position that color actually came from (so the gradient's focal point
   * varies by artwork instead of every album fading toward the same fixed corner).
   * Memoized in-process by fileName — the same cached cover art is re-rendered on every poll of
   * a now-playing card, and decoding+scanning the image is too slow to repeat that often.
   * @param {string} fileName - relative to IMAGE_CACHE_DIR, as passed to CacheImage
   * @returns {Promise<{primary: string, secondary: string, x: number, y: number}|null>}
   */
  static async ExtractMusicGradientColors(fileName) {
    if (musicGradientColorCache.has(fileName)) {
      return musicGradientColorCache.get(fileName);
    }
    const filePath = path.join(IMAGE_CACHE_DIR, fileName);
    let result = null;
    try {
      const { Jimp } = require("jimp");
      const image = await Jimp.read(filePath);
      image.resize({ w: 32, h: 32 });
      const { data, width, height } = image.bitmap;

      // Quantize to 16 levels/channel (4 bits) so near-identical pixels group into the same
      // bucket, then pick the bucket that's both saturated and reasonably prevalent — this
      // favors a color that actually characterizes the artwork's mood over whichever single
      // pixel happens to be most saturated, or a near-black/near-white color that just
      // happens to cover the most pixels (letterboxing, plain backgrounds). Also tracks each
      // bucket's average (x, y) so the winning color's actual position in the artwork can
      // become the gradient's focal point, instead of a fixed spot every album fades toward.
      const buckets = new Map();
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const key = (r >> 4) + "," + (g >> 4) + "," + (b >> 4);
        const x = i % width;
        const y = Math.floor(i / width);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.r += r; bucket.g += g; bucket.b += b; bucket.x += x; bucket.y += y; bucket.count += 1;
        } else {
          buckets.set(key, { r, g, b, x, y, count: 1 });
        }
      }

      let best = null;
      let bestScore = -1;
      let fallback = null;
      let fallbackCount = -1;
      for (const bucket of buckets.values()) {
        const r = bucket.r / bucket.count;
        const g = bucket.g / bucket.count;
        const b = bucket.b / bucket.count;
        const x = bucket.x / bucket.count;
        const y = bucket.y / bucket.count;
        if (bucket.count > fallbackCount) {
          fallbackCount = bucket.count;
          fallback = { r, g, b, x, y };
        }
        const maxN = Math.max(r, g, b) / 255;
        const minN = Math.min(r, g, b) / 255;
        const lightness = (maxN + minN) / 2;
        if (lightness < 0.08 || lightness > 0.92) continue;
        const saturation = maxN === minN ? 0 : (maxN - minN) / (1 - Math.abs(2 * lightness - 1));
        const score = saturation * Math.sqrt(bucket.count);
        if (score > bestScore) {
          bestScore = score;
          best = { r, g, b, x, y };
        }
      }
      const chosen = best || fallback;
      if (chosen) {
        const primary = `rgb(${Math.round(chosen.r)}, ${Math.round(chosen.g)}, ${Math.round(chosen.b)})`;
        const secondary = `rgb(${Math.round(chosen.r * 0.28)}, ${Math.round(chosen.g * 0.28)}, ${Math.round(chosen.b * 0.28)})`;
        // Clamped to 15-85% so the focal point never sits exactly on an edge/corner, which
        // would make the gradient look lopsided or clipped rather than a soft glow.
        const x = Math.round(Math.min(85, Math.max(15, (chosen.x / width) * 100)));
        const y = Math.round(Math.min(85, Math.max(15, (chosen.y / height) * 100)));
        result = { primary, secondary, x, y };
      }
    } catch (e) {
      console.log("ExtractMusicGradientColors failed for " + fileName + ": " + e.message);
      result = null;
    }
    musicGradientColorCache.set(fileName, result);
    return result;
  }

  // not implemented yet!
  static async CheckFileSize(savePath) {
    let small = false;
    var stats = fs.statSync(savePath);
    var fileSizeInBytes = stats.size;
    // Convert the file size to megabytes (optional)
    var fileSizeInKbytes = fileSizeInBytes / 1024;

    if (fileSizeInKbytes <= 1) small = true;
    console.log(savePath + " - " + fileSizeInKbytes + "kb - " + small);
  }

  /**
   * @desc Deletes all files from the MP3Cache folder
   * @returns nothing
   */
  static async DeleteMP3Cache() {
    const directory = MP3_CACHE_DIR;
    try {
      fsExtra.emptyDirSync(directory);
    } catch (err) {
      if (err.code !== "EPERM") {
        console.log("Delete MP3 Cache-->" + err.code);
        throw err;
      }
    }
    console.log("✅ MP3 cache cleared");
  }

  /**
   * @desc Deletes all files from the imageCache folder
   * @returns nothing
   */
  static async DeleteImageCache() {
    const directory = IMAGE_CACHE_DIR;
    try {
      fsExtra.emptyDirSync(directory);
    } catch (err) {
      if (err.code !== "EPERM") {
        console.log("Delete Image Cache -->" + err.code);
        throw err;
      }
    }

    console.log("✅ Image cache cleared");
  }

  // /**
  //  * @desc Returns a single random mp3 filename from the randomthemese folder. (tries to make MP3 unique)
  //  * @param {array} cardArray - the card array that has been built thus far (needed to be able to check for duplicates)
  //  * @returns {string} fileName - a random filename
  //  */
  // static async GetRandomMP3(cardArray) {
  //   let directory = require("./appPaths").RANDOM_THEMES_DIR;
  //   // get all mp3 files from directory
  //   let fileArr = fs.readdirSync(directory);
  //   let mp3Files = fileArr.filter(function (elm) {
  //     return elm.match(/.*\.(mp3)/gi);
  //   });

  //   // calls random_items function to return a random item from an array
  //   let randomFile = await util.random_item(mp3Files);

  //   let tryCount = 0;

  //   // now try to get a unique file (try 5 times)
  //   while ((await this.themeUsed(cardArray, randomFile)) && tryCount < 5) {
  //     // try again if the MP3 has already been used
  //     tryCount++;
  //     randomFile = await util.random_item(mp3Files);
  //   }

  //   // return whatever MP3 we ended up selecting
  //   return randomFile;
  // }

  /**
   * @desc Returns a boolean if a theme is present in a card array
   * @param {array} cardArray - the card array that has been built thus far (needed to be able to check for duplicates)
   * @param {string} fileName - the filename to check for
   * @returns {boolean} - true if in array
   */
  static async themeUsed(cardArray, fileName) {
    let result = await cardArray.some(
      (card) => card.theme.includes(fileName) == true
    );
    //if(result) console.log('Dupe: '+ fileName, result);
    return result;
  }
}
module.exports = Cache;
