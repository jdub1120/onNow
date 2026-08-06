const util = require("./../core/utility");
const core = require("./../core/cache");

/**
 * @desc mediaCards base class for defining every card that is showed in the poster app
 * @returns nothing
 */
class MediaCard {
  constructor() {
    this.ID = null;
    this.DBID = "";
    this.mediaType = "";
    this.active = null;
    this.title = "";
    this.year = "";
    this.posterURL = "";
    /** Original poster image URL used before caching (for periodic cache refresh) */
    this.posterDownloadURL = "";
    /** Stable server item id for delete checks (Plex ratingKey, Jellyfin Id, Kodi movie/show/episode id) */
    this.posterApiItemId = "";
    /** Kodi: movie | show | episode */
    this.posterLibraryKind = "";
    /** Plex/Jellyfin/Emby/Kodi on-demand library display name (for cache stats) */
    this.posterLibraryLabel = "";
    /** True when this title comes from a library configured as 3D. */
    this.is3D = false;
    this.posterArtURL = "";
    /** Cached title logo / clearlogo (PNG under /imagecache/*-logo.png) when sync pulls it */
    this.posterLogoURL = "";
    this.posterAR = "";
    this.contentRating = "";
    this.ratingColour = "";
    this.rating = "";
    this.summary = "";
    this.tagLine = "";
    this.episodeName = "";
    this.runTime = "";
    this.pageCount = "";
    this.resCodec = "";
    this.studio = "";
    this.network = "";
    // Live sports matchup card (mediaType "sports") — populated only when a Now Playing title
    // is confirmed against a real, currently-scheduled game (see liveSportsLookup.js).
    this.sportsLeague = "";
    this.sportsAwayName = "";
    this.sportsAwayColor = "";
    this.sportsAwayLogo = "";
    this.sportsHomeName = "";
    this.sportsHomeColor = "";
    this.sportsHomeLogo = "";
    this.sportsIsLive = false;
    this.sportsGameStarted = false;
    this.sportsGameFinal = false;
    this.sportsAwayScore = "";
    this.sportsHomeScore = "";
    // Inning state — MLB only for now (see appletv.js).
    this.sportsInningHalf = ""; // "top" | "bottom"
    this.sportsInningOrdinal = ""; // e.g. "7th"
    this.sportsOuts = null; // 0-3
    this.sportsOnFirst = false;
    this.sportsOnSecond = false;
    this.sportsOnThird = false;
    this.audioCodec = "";
    this.playerDevice = "";
    this.playerIP = "";
    this.device = "";
    this.playerLocal = "";
    this.user = "";
    this.genre = [];
    this.cardType = null;
    this.progress = "";
    this.progressPercent = "";
    this.decision = "";
    // Drives the animated equalizer icon next to a music card's title (bars bounce while
    // playing, freeze when true). Providers that can distinguish playing vs. paused for their
    // now-playing session should set this; defaults to false (animating) for everything else.
    this.paused = false;
    this.theme = "";
    this.rendered = "";
    this.user ="";
    this.ip ="";
    this.triviaCategory = "";
    this.triviaType = "";
    this.triviaAnswer = "";
    this.triviaQuestion = "";
    this.triviaOptions = [];
    this.triviaDifficulty = "";
    this.runDuration = "";
    this.runProgress = "";
    this.linkUrl = "";
    this.youtubeKey = "";
    /** Comma-separated principal cast; shown when settings.showCast is true */
    this.cast = "";
    /** First two billed names for compact on-demand pills (optional; falls back to splitting cast) */
    this.actor1 = "";
    this.actor2 = "";
    /** Comma-separated directors; shown when settings.showDirectors is true */
    this.directors = "";
    /** Comma-separated authors; shown when settings.showAuthors is true */
    this.authors = "";
    /** Album artist / performer for music; shown when settings.showAlbumArtist is true */
    this.albumArtist = "";
    /** Optional portrait URLs for display-poster settings (cached under /imagecache/) */
    this.portraitActorURL = "";
    this.portraitActressURL = "";
    this.portraitDirectorURL = "";
    this.portraitAuthorURL = "";
    this.portraitArtistURL = "";
    this.featuredActorName = "";
    this.featuredActressName = "";
    this.featuredDirectorName = "";
    this.featuredAuthorName = "";
    this.featuredArtistName = "";
    this.featuredActorCredits = [];
    this.featuredActressCredits = [];
    this.featuredDirectorCredits = [];
    this.featuredAuthorCredits = [];
    this.featuredArtistCredits = [];
    /** Rich HTML for Ad card price/add-on badges in the footer strip */
    this.adPricingHtml = "";
  }

  /**
   * @desc renders the properties of the card into html, then sets this to the 'rendered' property
   * @returns nothing
   */
  async Render(options) {
    const {
      hasArt,
      baseUrl,
      hideTitle,
      hideFooter,
      showCast,
      showDirectors,
      showAuthors,
      showAlbumArtist,
      showMovieTagline = "true",
      displayPosterAlbum,
      displayPosterVideo,
      displayPosterBooks,
      displayPosterActor,
      displayPosterActress,
      displayPosterDirector,
      displayPosterAuthor,
      displayPosterArtist,
      showPillYear = "true",
      showPillGenre = "true",
      showPillContentRating = "true",
      showPillRating = "true",
      showPillRuntime = "true",
      showPillResolution = "true",
      showPillAudioCodec = "true",
      showPillNetwork = "true",
      showPillStudio = "true",
      showPillLibrary = "true",
      showPillEpisode = "true",
      showPill3D = "true",
      showPillEndTime = "true",
      showPillPageCount = "true",
      showPillLeadCast = "true",
      showPillUser = "true",
      showPillDevice = "true",
      showPillIP = "true",
      useRtRatingIcons = false,
    } = options || {};
    const isEnabled = (v) => {
      if (v === true) return true;
      const s = String(v == null ? "" : v).toLowerCase().trim();
      return s === "true" || s === "on" || s === "1" || s === "yes";
    };
    let hiddenTitle = "";
    let hiddenFooter = "";
    let hidden = "";
    let fullScreen = "";
    let pauseMessage = "";

    // set header/footer hidden values
    // Keep metadata footer visible for on-demand music/books (legacy) — movies/shows/episodes
    // respect hideTitle/hideFooter like any other on-demand card (previously they were
    // hard-excluded from ever hiding, which made the "Hide Footer" setting a no-op for the
    // most common on-demand content type).
    const isMusicCard = this.mediaType === "album" || this.mediaType === "track";
    // Apple Music-style caption shown just below the album art on music cards — title
    // semi-bold/white, artist regular/light gray, both centered. Positioned by Resize() in
    // posters.ejs (needs the artwork's actual rendered width/bottom edge, which is only known
    // client-side), so this just carries the escaped text; the CSS class handles font weight/color.
    let musicInfoHtml = "";
    // Apple Music-style dynamic background: a gradient built from the artwork's own dominant
    // color, instead of a blurred copy of the image. Falls back to null (posterArt's plain
    // blurred-image rendering) if extraction fails or the art isn't a locally cached file yet.
    let musicGradientColors = null;
    // "Living Room ATV" / "Game Room ATV" -> "Living Room" / "Game Room" — the "ATV"/"Apple
    // TV" suffix is redundant once it's phrased as "Playing in X"; falls back to the full
    // name if stripping it would leave nothing (e.g. a device literally just named "ATV").
    // Shared between music and sports captions (same markup/class both times).
    const rawDevice = String(this.device || "").trim();
    const strippedDevice = rawDevice.replace(/\s*(apple\s*tv|atv)\s*$/i, "").trim();
    const deviceLabel = strippedDevice || rawDevice;
    const devicePillHtml = deviceLabel
      ? `<div class="musicDevicePill"><span class="badge badge-pill badge-secondary">Playing in ` +
        util.escapeHtml(deviceLabel) +
        `</span></div>`
      : "";
    if (isMusicCard) {
      const musicTitle = util.escapeHtml(String(this.title || "").trim());
      const musicArtist = util.escapeHtml(String(this.albumArtist || "").trim());
      const eqIcon =
        `<span class="eqIcon` + (this.paused ? " paused" : "") + `"><span></span><span></span><span></span></span>`;
      musicInfoHtml =
        `<div class="musicInfo hidden" id="musicInfo` + this.ID + `">` +
        `<div class="musicTitle">` + eqIcon + `<span class="musicTitleText">` + musicTitle + `</span></div>` +
        (musicArtist ? `<div class="musicArtist">` + musicArtist + `</div>` : "") +
        devicePillHtml +
        `</div>`;

      const artSource = this.posterArtURL || this.posterURL;
      if (String(artSource || "").startsWith("/imagecache/")) {
        const artFileName = String(artSource).slice("/imagecache/".length);
        try {
          musicGradientColors = await core.ExtractMusicGradientColors(artFileName);
        } catch (e) {
          musicGradientColors = null;
        }
      }
    }
    // Live sports matchup card — two team logos + a split-color background built from each
    // team's real color, instead of a poster (there isn't one). See appletv.js/liveSportsLookup
    // for how this gets confirmed as an actual scheduled game before mediaType is set to this.
    const isSportsCard = this.mediaType === "sports";
    let sportsLogosHtml = "";
    let sportsInfoHtml = "";
    let sportsGradientColors = null;
    if (isSportsCard) {
      const awayName = util.escapeHtml(String(this.sportsAwayName || "").trim());
      const homeName = util.escapeHtml(String(this.sportsHomeName || "").trim());
      const network = util.escapeHtml(String(this.network || "").trim());
      sportsGradientColors = {
        away: String(this.sportsAwayColor || "#333333").trim(),
        home: String(this.sportsHomeColor || "#333333").trim(),
      };

      // "VS" before the game starts (a pre-game score is just a meaningless 0-0 placeholder);
      // once it's underway, show the actual score instead — refreshed every poll, but the
      // underlying scoreboard data itself only actually changes every few minutes (see
      // liveSportsLookup's SCOREBOARD_TTL_MS).
      const vsText = this.sportsGameStarted
        ? util.escapeHtml(String(this.sportsAwayScore || "0")) + " - " + util.escapeHtml(String(this.sportsHomeScore || "0"))
        : "VS";

      // ▲/▼ for top/bottom of the inning (rather than spelling it out) under the score, and a
      // base-runner diamond + outs dots above the score — MLB only for now. Once the game's
      // over, swap the inning row for "Final" (the last-known inning/half aren't meaningful
      // anymore) and drop the bases/outs entirely (they'd otherwise stay frozen at whatever the
      // last play was, which reads as broken once the post-game show is what's actually on).
      let sportsGameStateHtml = "";
      let sportsBasesHtml = "";
      if (this.sportsGameFinal) {
        sportsGameStateHtml =
          `<div class="sportsGameState hidden" id="sportsGameState` + this.ID + `">` +
          `<div class="sportsInningRow">Final</div>` +
          `</div>`;
      } else if (this.sportsInningOrdinal) {
        const arrow = this.sportsInningHalf === "bottom" ? "▼" : "▲";
        sportsGameStateHtml =
          `<div class="sportsGameState hidden" id="sportsGameState` + this.ID + `">` +
          `<div class="sportsInningRow">` + arrow + ` ` + util.escapeHtml(this.sportsInningOrdinal) + `</div>` +
          `</div>`;

        // Just the 3 actual bases — 2nd at top, 1st at right, 3rd at left, matching the
        // standard view from behind home plate. Filled when a runner's actually on that base.
        let outsDots = "";
        if (this.sportsOuts != null) {
          for (let i = 0; i < 3; i++) {
            outsDots += `<span class="sportsOutDot` + (i < this.sportsOuts ? " filled" : "") + `"></span>`;
          }
        }
        sportsBasesHtml =
          `<div class="sportsBases hidden" id="sportsBases` + this.ID + `">` +
          `<div class="sportsBasesDiamond">` +
          `<span class="sportsBase second` + (this.sportsOnSecond ? " filled" : "") + `"></span>` +
          `<span class="sportsBase first` + (this.sportsOnFirst ? " filled" : "") + `"></span>` +
          `<span class="sportsBase third` + (this.sportsOnThird ? " filled" : "") + `"></span>` +
          `</div>` +
          (outsDots ? `<div class="sportsOutsRow">` + outsDots + `</div>` : "") +
          `</div>`;
      }

      // Each logo is positioned independently by Resize() (left logo higher, right logo
      // lower, on a diagonal echoing the 45°-angle background gradient) rather than a
      // flexbox row, so they need their own ids instead of a shared row wrapper.
      sportsLogosHtml =
        `<div class="sportsLogo away hidden" id="sportsLogoAway` + this.ID + `">` +
        `<div class="sportsLogoImg" style="background-image:url('` + baseUrl + this.sportsAwayLogo + `')"></div>` +
        `</div>` +
        sportsBasesHtml +
        `<div class="sportsVs` + (this.sportsGameStarted ? " score" : "") + ` hidden" id="sportsVs` + this.ID + `">` + vsText + `</div>` +
        sportsGameStateHtml +
        `<div class="sportsLogo home hidden" id="sportsLogoHome` + this.ID + `">` +
        `<div class="sportsLogoImg" style="background-image:url('` + baseUrl + this.sportsHomeLogo + `')"></div>` +
        `</div>`;

      sportsInfoHtml =
        `<div class="sportsInfo hidden" id="sportsInfo` + this.ID + `">` +
        (this.sportsIsLive && !this.sportsGameFinal ? `<div class="sportsLiveBadge"><span class="sportsLiveDot"></span>LIVE</div>` : "") +
        `<div class="sportsMatchupTitle">` + awayName + ` at ` + homeName + `</div>` +
        (network ? `<div class="sportsNetwork">` + network + `</div>` : "") +
        devicePillHtml +
        `</div>`;
    }
    const isBookCard =
      this.mediaType === "ebook" || this.mediaType === "audiobook";
    const isVideoOnDemand =
      this.cardType[0] === "On-demand" &&
      (this.mediaType === "movie" ||
        this.mediaType === "episode" ||
        this.mediaType === "show");
    const keepMetaFooter = isMusicCard || isBookCard;
    // Now Playing (Plex, Jellyfin/Emby, Kodi, or Apple TV — all use "Now Screening" as their
    // cardType; "Playing" is a legacy type nothing actually assigns) shares the on-demand Hide
    // Title/Footer controls — there's no separate toggle for it, and users expect the same
    // footer behavior regardless of whether the poster came from on-demand rotation or
    // something actively playing.
    const respectsHideControls =
      this.cardType[0] == "On-demand" ||
      this.cardType[0] == "Playing" ||
      this.cardType[0] == "Now Screening";
    if (hideTitle == "true" && respectsHideControls && !keepMetaFooter) {
      hiddenTitle = "hidden";
    }
    if (hideFooter == "true" && respectsHideControls && !keepMetaFooter) {
      hiddenFooter = "hidden";
    }
    // Music and sports both have their own custom caption below the artwork/matchup now, so
    // the generic "NOW PLAYING" banner and the metadata pill row are redundant — hide both
    // unconditionally rather than tying them to the Hide Title/Footer settings.
    if (isMusicCard || isSportsCard) {
      hiddenTitle = "hidden";
      hiddenFooter = "hidden";
    }
    // Music/sports are excluded here even though both are now forced "hidden" above — their
    // layout is fully custom-positioned by Resize() in posters.ejs (artwork or logos + caption
    // grouped and centered), and .fullscreen's top/height use !important, which would silently
    // override those inline styles.
    if(hiddenTitle !== "" && hiddenFooter !== "" && !isMusicCard && !isSportsCard) fullScreen="fullscreen";
    if(this.cardType[0] == "Picture" || this.cardType == "Trivia Question" || this.cardType == "WebURL"){
      hiddenTitle="hidden";
      hiddenFooter="hidden";
      if(hasArt && this.posterArtURL !== ""){
        // if has art, then reduce poster by 6% to improve look
        fullScreen="fullscreenCustom";
      }
      else{
        // if no art, then likely portrait and so go full screen
        fullScreen="fullscreen";
      }
    }

    if (this.cardType[0] == "Ad") {
      if (hasArt == "true" && this.posterArtURL !== "") {
        fullScreen = "fullscreenCustom";
      } else {
        fullScreen = "fullscreen";
      }
    }

    if(this.cardType[0] == "Picture"){
      pauseMessage = `<div style="position: relative; z-index: 1;">
  <span id="overlay_text` + this.ID + `" style="position: fixed; bottom: 5px; z-index: 3;"></span>
  </div>`
    }


    // set to hide progress bar if not a playing type of card
    if (this.cardType[0] != "Now Screening" && this.cardType[0] != "Playing") hidden = "hidden";
    // Music polls at the same interval as movies/shows, but on a ~3-4 min track that interval
    // is a visible fraction of the runtime — the bar visibly jumps instead of reading as smooth
    // real-time progress the way it does on a much longer movie/episode timeline.
    if (isMusicCard) hidden = "hidden";
    // Live sports has no meaningful fixed-length runtime to show progress against (see the
    // provider-side note on totalTime), so there's nothing for this bar to represent.
    if (isSportsCard) hidden = "hidden";

    // get custom card title
    let cardCustomTitle = this.cardType[1] !== "" ? this.cardType[1] : this.cardType[0];
    if (this.cardType[0] == "Ad") {
      const t = String(this.title || "").trim();
      cardCustomTitle = t ? util.escapeHtml(t) : "Ad";
    }

    var decRemainingTime = this.runDuration - this.runProgress;
    var et = new Date();
    et.setMinutes(et.getMinutes()+decRemainingTime);
    //console.log(decRemainingTime);
    //console.log(et.toLocaleTimeString());
    var endTime = et.toLocaleTimeString("en-US", {hour12: true, hour: "numeric", minute: "2-digit"});

    this.triviaRender="";
    this.linkRender="";
    // if a trivia card, then prepare html

    if(this.cardType[0] == "Trivia Question"){
     
      let options = "<ol type='A' class='listOptions'>";
      this.triviaOptions.forEach(o => {
        if(o == this.triviaAnswer){
          options += "<li class='theAnswer'>" + o + "</li>";
        }
        else{
        options += "<li>" + o + "</li>";
        }
      });
      options += "</ol>";

      this.triviaRender = `
      <div id='quiz' class='quiz quizText'>
        <div id='question' class='question'>` + this.triviaQuestion + `</div>
        <div class='options'>` + options + `</div>
        <div class="countdown timer` + this.ID + `">
          <div class="time_left_txt` + this.ID + `">Time Left</div>
          <div class="time timer_sec` + this.ID + `"></div>
          <div class="time_line` + this.ID + `"></div>
        </div>
      </div>`;
    }

    if(this.cardType[0] == "WebURL"){
      hiddenFooter = "hidden";
      fullScreen="fullscreen";
      hiddenTitle="hidden";
      this.linkRender = `<embed type="text/html" src="` + this.linkUrl + `" width=100% height=100% style="border: none; overflow: hidden;>`
      //this.linkRender = `<iframe scrolling="no" src="` + this.linkUrl + `" width=100% height=100%  style="border: none; overflow: hidden;" >`;
//      console.log(this.linkRender);
    }


    // pill variables
    let contentRatingPill = "";
    let resCodecPill = "";
    let audioCodecPill = "";
    let runTimePill = "";
    let ratingPill = "";
    let networkPill = "";
    let studioPill = "";
    let ipPill = "";
    let userPill = "";
    let devicePill = "";
    let yearPill = "";
    let pagePill = "";
    let endTimePill = "";
    let threeDPill = "";
    let genrePill = "";
    let libraryPill = "";
    let episodePill = "";
    let leadCastPill1 = "";
    let leadCastPill2 = "";
    let castPill = "";
    let directorPill = "";
    let authorPill = "";
    let albumArtistPill = "";

    // toggle background art as per settings
    if(hasArt=="true") {
      // leave art if present
    }
    else if (!isMusicCard) {
      this.posterArtURL = "";
    }
    // Music always shows a blurred backdrop (Apple Music-style), regardless of the Show
    // Backdrop setting — most sources (e.g. Apple TV) have no separate backdrop image for a
    // track, only the square cover, so fall back to reusing the cover art itself rather than
    // leaving a plain black background.
    if (isMusicCard && !this.posterArtURL) {
      this.posterArtURL = this.posterURL;
    }

    let mainPosterURL = this.posterURL;
    if (
      !isEnabled(displayPosterAlbum) &&
      (this.mediaType === "album" || this.mediaType === "track")
    ) {
      mainPosterURL = "/images/no-poster-available.png";
    }
    if (
      !isEnabled(displayPosterVideo) &&
      (this.mediaType === "movie" ||
        this.mediaType === "episode" ||
        this.mediaType === "show")
    ) {
      mainPosterURL = "/images/no-poster-available.png";
    }
    if (
      !isEnabled(displayPosterBooks) &&
      (this.mediaType === "ebook" || this.mediaType === "audiobook")
    ) {
      mainPosterURL = "/images/no-cover-available.png";
    }
    if (!mainPosterURL || String(mainPosterURL).trim() === "") {
      if (this.mediaType === "ebook" || this.mediaType === "audiobook") {
        mainPosterURL = "/images/no-cover-available.png";
      } else {
        mainPosterURL = "/images/no-poster-available.png";
      }
    }
    const posterFallbackURL =
      this.mediaType === "ebook" || this.mediaType === "audiobook"
        ? "/images/no-cover-available.png"
        : "/images/no-poster-available.png";
    // Only stack the placeholder as a second background layer when we don't already have a
    // real image — otherwise it shows through as visible white letterboxing behind any image
    // whose aspect ratio doesn't fill the poster container (e.g. square album art, since
    // .poster uses background-size: contain).
    // Sports has no poster image at all — the box holds the two team logo divs (sportsLogosHtml)
    // as real content instead of a background-image, so the fallback placeholder must not show
    // through behind them.
    const posterBgLayers = isSportsCard
      ? "none"
      : mainPosterURL === posterFallbackURL
        ? `url('${baseUrl}${posterFallbackURL}')`
        : `url('${baseUrl}${mainPosterURL}')`;

    let displayedTagLine = this.tagLine;
    if (this.mediaType === "movie" && !isEnabled(showMovieTagline)) {
      displayedTagLine = "";
    }
    const castPosterEnabled =
      isEnabled(displayPosterActor) || isEnabled(displayPosterActress);
    const directorPosterEnabled = isEnabled(displayPosterDirector);
    const authorPosterEnabled = isEnabled(displayPosterAuthor);
    const artistPosterEnabled = isEnabled(displayPosterArtist);
    const isVideoCard =
      this.mediaType === "movie" ||
      this.mediaType === "episode" ||
      this.mediaType === "show";
    const allowFeaturedPeoplePoster =
      !isVideoCard || !isEnabled(displayPosterVideo);
    if (
      allowFeaturedPeoplePoster &&
      (castPosterEnabled ||
        directorPosterEnabled ||
        authorPosterEnabled ||
        artistPosterEnabled)
    ) {
      const canUseActress =
        this.portraitActressURL && String(this.portraitActressURL).trim() !== "";
      const canUseActor =
        this.portraitActorURL && String(this.portraitActorURL).trim() !== "";
      const canUseDirector =
        this.portraitDirectorURL &&
        String(this.portraitDirectorURL).trim() !== "";
      const canUseAuthor =
        this.portraitAuthorURL && String(this.portraitAuthorURL).trim() !== "";
      const canUseArtist =
        this.portraitArtistURL && String(this.portraitArtistURL).trim() !== "";
      let personName = "";
      let personCredits = [];
      let personPoster = "";

      if (artistPosterEnabled && canUseArtist) {
        personName = this.featuredArtistName || "";
        personCredits = Array.isArray(this.featuredArtistCredits)
          ? this.featuredArtistCredits
          : [];
        personPoster = this.portraitArtistURL;
      } else if (authorPosterEnabled && canUseAuthor) {
        personName = this.featuredAuthorName || "";
        personCredits = Array.isArray(this.featuredAuthorCredits)
          ? this.featuredAuthorCredits
          : [];
        personPoster = this.portraitAuthorURL;
      } else if (directorPosterEnabled && canUseDirector) {
        personName = this.featuredDirectorName || "";
        personCredits = Array.isArray(this.featuredDirectorCredits)
          ? this.featuredDirectorCredits
          : [];
        personPoster = this.portraitDirectorURL;
      } else if (isEnabled(displayPosterActress) && canUseActress) {
        personName = this.featuredActressName || "";
        personCredits = Array.isArray(this.featuredActressCredits)
          ? this.featuredActressCredits
          : [];
        personPoster = this.portraitActressURL;
      } else if (isEnabled(displayPosterActor) && canUseActor) {
        personName = this.featuredActorName || "";
        personCredits = Array.isArray(this.featuredActorCredits)
          ? this.featuredActorCredits
          : [];
        personPoster = this.portraitActorURL;
      } else if (canUseActor) {
        personName = this.featuredActorName || "";
        personCredits = Array.isArray(this.featuredActorCredits)
          ? this.featuredActorCredits
          : [];
        personPoster = this.portraitActorURL;
      } else if (canUseActress) {
        personName = this.featuredActressName || "";
        personCredits = Array.isArray(this.featuredActressCredits)
          ? this.featuredActressCredits
          : [];
        personPoster = this.portraitActressURL;
      }

      if (personPoster) {
        mainPosterURL = personPoster;
        if (personName) cardCustomTitle = util.escapeHtml(personName);
        if (personCredits.length > 0) {
          displayedTagLine = personCredits.slice(0, 5).join("  •  ");
        } else if (this.title) {
          displayedTagLine = String(this.title);
        }
      }
    }

    const isAdCard = this.cardType[0] == "Ad";

    const portraitStrip = (() => {
      const parts = [];
      const add = (on, url, cls) => {
        if (isEnabled(on) && url && String(url).trim() !== "") {
          parts.push(
            `<div class="cardPortrait ` +
              cls +
              `" style="background-image:url('` +
              baseUrl +
              util.escapeHtml(url) +
              `')"></div>`
          );
        }
      };
      add(displayPosterActor, this.portraitActorURL, "cardPortraitActor");
      add(displayPosterActress, this.portraitActressURL, "cardPortraitActress");
      add(displayPosterDirector, this.portraitDirectorURL, "cardPortraitDirector");
      add(displayPosterAuthor, this.portraitAuthorURL, "cardPortraitAuthor");
      add(displayPosterArtist, this.portraitArtistURL, "cardPortraitArtist");
      if (parts.length === 0) return "";
      return `<div class="cardPortraitStrip">` + parts.join("") + `</div>`;
    })();

    // include if value present
    if (isEnabled(showPillYear) && !(await util.isEmpty(this.year))) {
      yearPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.year +
        "</span>";
    }

    const genreStr = (() => {
      const g = this.genre;
      if (g == null) return "";
      if (Array.isArray(g)) {
        return g
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 4)
          .join(" · ");
      }
      const s = String(g).trim();
      if (!s) return "";
      return s
        .split(/[,|]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" · ");
    })();
    if (isEnabled(showPillGenre) && !(await util.isEmpty(genreStr))) {
      genrePill =
        "<span class='badge badge-pill badge-info'>" +
        util.escapeHtml(genreStr) +
        "</span>";
    }

    if (isEnabled(showPillLibrary) && !(await util.isEmpty(this.posterLibraryLabel))) {
      const is3dTitle =
        this.is3D === true || String(this.is3D || "").toLowerCase() === "true";
      const libTrim = String(this.posterLibraryLabel).trim();
      // On-demand 3D: only the "3D" badge, not the library (e.g. "3D Movies").
      // On-demand non-3D movie: hide generic library names like "Movies" / "Films" (no extra pill).
      const genericMovieLibraryPill =
        this.mediaType === "movie" &&
        /^(movies?|films?)$/i.test(libTrim);
      const suppressLibraryPill =
        (isVideoOnDemand && is3dTitle) ||
        (isVideoOnDemand && !is3dTitle && genericMovieLibraryPill);
      if (!suppressLibraryPill) {
        libraryPill =
          "<span class='badge badge-pill badge-dark'>" +
          util.escapeHtml(libTrim.slice(0, 48)) +
          "</span>";
      }
    }

    if (
      isEnabled(showPillEpisode) &&
      !(await util.isEmpty(this.episodeName)) &&
      this.mediaType === "episode"
    ) {
      episodePill =
        "<span class='badge badge-pill badge-secondary'>" +
        util.escapeHtml(this.episodeName) +
        "</span>";
    }

    if (isEnabled(showPill3D) && (this.is3D === true || String(this.is3D || "").toLowerCase() === "true")) {
      threeDPill = "<span class='badge badge-pill badge-dark'>3D</span>";
    }

    if (isEnabled(showPillContentRating) && !(await util.isEmpty(this.contentRating))) {
      const ratingColourClass = this.ratingColour || "badge-dark";
      const crLabel = util.escapeHtml(String(this.contentRating).trim());
      contentRatingPill =
        "<span class='badge badge-pill " +
        ratingColourClass +
        "'>" +
        crLabel +
        "</span>";
    }

    if (isEnabled(showPillIP) && !(await util.isEmpty(this.ip))) {
      ipPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.ip +
        "</span>";
    }

    if (isEnabled(showPillDevice) && !(await util.isEmpty(this.device))) {
      devicePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.device +
        "</span>";
    }

    if (isEnabled(showPillUser) && !(await util.isEmpty(this.user))) {
      userPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.user +
        "</span>";
    }

    if (isEnabled(showPillResolution) && !(await util.isEmpty(this.resCodec))) {
      let resBadge = "badge-dark";
      // if(this.resCodec.toLocaleLowerCase().includes('4k') && this.resCodec.toLocaleLowerCase().includes('main 10 hdr')){
      //   resBadge = "badge-primary super-res";
      // }
      resCodecPill =
        "<span class='badge badge-pill " + resBadge + "'> " +
        this.resCodec +
        "</span>";
    }

    if (isEnabled(showPillNetwork) && !(await util.isEmpty(this.network))) {
      networkPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.network +
        "</span>";
    }

    if (isEnabled(showPillStudio) && !(await util.isEmpty(this.studio))) {
      studioPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.studio +
        "</span>";
    }

    if (isEnabled(showPillAudioCodec) && !(await util.isEmpty(this.audioCodec))) {
      audioCodecPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.audioCodec +
        "</span>";
    }

    if (isEnabled(showPillPageCount) && !(await util.isEmpty(this.pageCount))) {
      pagePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.pageCount +
        " pages</span>";
    }

    if (isEnabled(showPillRuntime) && !(await util.isEmpty(this.runTime))) {
      runTimePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.runTime +
        "m</span>";
    }

    if (isEnabled(showPillRating) && !(await util.isEmpty(this.rating))) {
      if (isVideoOnDemand) {
        // Rotten Tomatoes' own audience icon is a popcorn bucket — only accurate when the
        // rating actually came from Plex's audienceRating (RT data). Jellyfin/Emby's
        // CommunityRating and Kodi's generic library rating aren't RT scores, so they get a
        // plain star instead of implying a Rotten Tomatoes source that isn't there.
        // Font Awesome glyphs (bundled webfont) rather than unicode emoji — kiosk/embedded
        // browsers (e.g. a bare Raspberry Pi display) frequently have no color emoji font
        // installed, which makes emoji characters render as nothing at all.
        const audienceIcon = isEnabled(useRtRatingIcons)
          ? "<i class='fal fa-popcorn'></i> "
          : "<i class='fal fa-star'></i> ";
        ratingPill =
          "<span class='badge badge-pill badge-secondary'>" + audienceIcon +
          util.escapeHtml(String(this.rating).trim()) +
          "</span>";
      } else {
        const criticIcon = isEnabled(useRtRatingIcons) ? "<i class='fal fa-certificate'></i> " : "";
        ratingPill =
          "<span class='badge badge-pill badge-dark'> " + criticIcon + this.rating + "</span>";
      }
    }

    if(isEnabled(showPillEndTime) && (this.cardType[0] == "Now Screening" || this.cardType[0] == "Playing")) {
      endTimePill =
        "<span class='badge badge-pill badge-dark'>End: " + endTime + "</span>";
    }

    if (isEnabled(showPillLeadCast) && isVideoOnDemand) {
      let n1 = String(this.actor1 || "").trim();
      let n2 = String(this.actor2 || "").trim();
      if (!n1 || !n2) {
        const parts = String(this.cast || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (!n1) n1 = parts[0] || "";
        if (!n2) n2 = parts[1] || "";
      }
      if (n1) {
        leadCastPill1 =
          "<span class='badge badge-pill badge-secondary'>" +
          util.escapeHtml(n1) +
          "</span>";
      }
      if (n2) {
        leadCastPill2 =
          "<span class='badge badge-pill badge-secondary'>" +
          util.escapeHtml(n2) +
          "</span>";
      }
    }

    if (
      showCast === "true" &&
      !(await util.isEmpty(this.cast)) &&
      !isVideoOnDemand
    ) {
      castPill =
        "<span class='badge badge-pill badge-secondary'>Cast: " +
        util.escapeHtml(this.cast) +
        "</span>";
    }

    if (showDirectors === "true" && !(await util.isEmpty(this.directors))) {
      directorPill =
        "<span class='badge badge-pill badge-secondary'>Director: " +
        util.escapeHtml(this.directors) +
        "</span>";
    }

    if (showAuthors === "true" && !(await util.isEmpty(this.authors))) {
      authorPill =
        "<span class='badge badge-pill badge-secondary'>Authors: " +
        util.escapeHtml(this.authors) +
        "</span>";
    }

    if (
      showAlbumArtist === "true" &&
      !(await util.isEmpty(this.albumArtist))
    ) {
      albumArtistPill =
        "<span class='badge badge-pill badge-secondary'>Artist: " +
        util.escapeHtml(this.albumArtist) +
        "</span>";
    }

    let tagDetailsHtml = "";
    if (isAdCard) {
      tagDetailsHtml = this.adPricingHtml || "";
    } else if (isVideoOnDemand) {
      tagDetailsHtml =
        contentRatingPill +
        ratingPill +
        studioPill +
        runTimePill +
        leadCastPill1 +
        leadCastPill2 +
        genrePill +
        yearPill +
        threeDPill +
        libraryPill +
        resCodecPill +
        networkPill +
        audioCodecPill +
        pagePill +
        userPill +
        devicePill +
        ipPill +
        episodePill +
        endTimePill +
        castPill +
        directorPill +
        authorPill +
        albumArtistPill;
    } else {
      tagDetailsHtml =
        contentRatingPill +
        resCodecPill +
        networkPill +
        studioPill +
        libraryPill +
        audioCodecPill +
        runTimePill +
        pagePill +
        ratingPill +
        userPill +
        devicePill +
        ipPill +
        yearPill +
        genrePill +
        threeDPill +
        episodePill +
        endTimePill +
        castPill +
        directorPill +
        authorPill +
        albumArtistPill;
    }

    // render data into html
    this.rendered =
      `
    <div class="carousel-item ` +
      this.active +
      ` w-100 h-100" id="` +
      this.ID +
      `">
      <audio id="audio` +
        this.ID +
        `">
        <source src="` +
        baseUrl + this.theme +
        `" type="audio/mpeg" preload="auto">
        Your browser does not support the audio element.
      </audio>
      <div class="myDiv">
      <div class="posterArt` + (
        isSportsCard ? " solidGradient" : (isMusicCard ? (musicGradientColors ? " solidGradient" : " musicBackdrop") : "")
      ) + `"` + (
        // Colors as data attributes so Resize() can rebuild this gradient once it knows the
        // logos' actual on-screen positions — the 40%/60% stops below are a reasonable-looking
        // first paint (tuned for a typical wide/landscape screen) but assume the logo/gap
        // positions line up with fixed percentages of the full viewport width, which breaks
        // on a display whose aspect ratio makes the centered logo group much narrower than
        // the screen (e.g. a tall/portrait TV) — the gap ends up somewhere else entirely.
        isSportsCard
          ? ` data-away-color="` + sportsGradientColors.away + `" data-home-color="` + sportsGradientColors.home + `"`
          : ""
      ) + ` style="background-image: ` + (
        isSportsCard
          ? `linear-gradient(135deg, ` + sportsGradientColors.away + ` 0%, ` + sportsGradientColors.away + ` 50%, ` + sportsGradientColors.home + ` 50%, ` + sportsGradientColors.home + ` 100%)`
          : musicGradientColors
          ? `radial-gradient(ellipse at ` + musicGradientColors.x + `% ` + musicGradientColors.y + `%, ` + musicGradientColors.primary + ` 0%, ` + musicGradientColors.secondary + ` 70%)`
          : `url('` + baseUrl + this.posterArtURL + `')`
      ) + `">
      </div>` + (
        // A second, oversized+blurred copy of the same hard-split background, so only the seam
        // itself looks soft while both far sides stay genuinely flat — see the CSS comment on
        // .posterArtSeamBlur for why it's oversized. Resize() keeps this in sync with the base
        // layer once it knows the logos' actual on-screen positions.
        isSportsCard
          ? `<div class="posterArtSeamBlur" id="posterArtSeamBlur` + this.ID + `" style="background-image: linear-gradient(135deg, ` + sportsGradientColors.away + ` 0%, ` + sportsGradientColors.away + ` 50%, ` + sportsGradientColors.home + ` 50%, ` + sportsGradientColors.home + ` 100%)"></div>`
          : ""
      ) + `
        <div class="banners">
          <div class="bannerBigText ` +
      this.cardType[0] +
      ` ` + hiddenTitle + 
      `">` +
      cardCustomTitle +
      `</div>
       </div>

      <div id="poster` +
      this.ID +
      `" class="poster` +
      " " + fullScreen +
      `" style="background-image: ` +
      posterBgLayers + `">` + portraitStrip + pauseMessage + sportsLogosHtml + `

      <div class="progress ` +
      hidden +
      `" id="progress` +
      this.ID + `">
          <div class="progress-bar ` +
      this.decision +
      `" role="progressbar" style="width: ` +
      this.progressPercent +
      `%"
            aria-valuenow="` +
      this.progress +
      `" aria-valuemin="0" aria-valuemax="` +
      this.runTime +
      `"></div>
        </div>
      <div class="hidden" id="poster` + this.ID + `AR">`+this.posterAR+`</div>` +
      this.triviaRender + this.linkRender +
      `</div>` +
      musicInfoHtml +
      sportsInfoHtml +
      `
      <div class="bottomBanner mx-auto transparent` +
      ` ` + hiddenFooter + 
      `" id="bottomBanner` +
      this.ID +
      `">
        <marquee direction="left" autostart="false" id="marquee`+ this.ID + `"><div class="tagLine" id="tagLine`+ this.ID + `">` +
      displayedTagLine +
      `</div></marquee>
        <div class="tagDetails">` +
      tagDetailsHtml +
      `</div>
      </div>
      </div>
    </div>`;
      return;
  }
}

module.exports = MediaCard;
