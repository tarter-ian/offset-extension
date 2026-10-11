// Counting script: YouTube watch time, last 30 days.
// Reads the person's YouTube history from Google My Activity, which records when
// each video was started, how long it is and how much of it was watched. Only
// counts and dates leave the page; no titles, channels or video ids.
(function () {
  if (window.__offsetYoutubeActivity) return;
  window.__offsetYoutubeActivity = { started: false, done: false };
  var state = window.__offsetYoutubeActivity;

  var WINDOW_DAYS = 30;
  var PAGE = 500;
  var MAX_PAGES = 120;
  var ACTIVITY_URL = 'https://myactivity.google.com/product/youtube';
  // Watch time credited to an item whose length Google does not give (mostly Shorts and ads).
  var UNKNOWN_SECONDS = 45;
  var SHORT_SECONDS = 60;

  var sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  function banner(text) {
    var el = document.getElementById('offset-usage-banner');
    if (!el) {
      if (!document.body) return;
      el = document.createElement('div');
      el.id = 'offset-usage-banner';
      el.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:14px 16px;' +
        'background:#0f3d2e;color:#fff;font:15px/1.4 system-ui,sans-serif;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  // "1:11:30" or "4:05" to seconds.
  function seconds(text) {
    var t = String(text || '').trim();
    if (!/^\d{1,2}(:\d{2}){1,2}$/.test(t)) return 0;
    return t.split(':').reduce(function (sum, n) { return sum * 60 + Number(n); }, 0);
  }

  // One page of history, newest first, through the same request the page's own
  // "Load more" button makes. The page's request token stays on this site.
  async function page(token) {
    var w = window.WIZ_global_data;
    var query = new URLSearchParams({
      rpcids: 'y3VFHd',
      'source-path': '/product/youtube',
      'f.sid': w.FdrFJe,
      bl: w.cfb2h,
      hl: document.documentElement.lang || 'en',
      rt: 'c',
    });
    var args = JSON.stringify([[null, ['youtube']], token, PAGE]);
    var body = new URLSearchParams({ 'f.req': JSON.stringify([[['y3VFHd', args, null, 'generic']]]), at: w.SNlM0e });
    for (var attempt = 0; attempt < 3; attempt++) {
      var res = await fetch('/_/FootprintsMyactivityUi/data/batchexecute?' + query, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' },
        body: body,
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      var line = (await res.text()).split('\n').filter(function (l) { return l.indexOf('[["wrb.fr"') === 0; })[0];
      if (!line) return null;
      var payload = JSON.parse(line)[0][2];
      if (!payload) return { items: [], next: null };
      var data = JSON.parse(payload);
      return { items: data[0] || [], next: data[1] || null };
    }
    return null;
  }

  // Keeps only what the sums need from one history entry.
  function read(item) {
    var link = item[9] && item[9][3];
    if (typeof item[4] !== 'number' || !/youtube\.com\/watch\?v=/.test(link || '')) return null;
    var thumb = item[23] || [];
    return {
      at: item[4] / 1000, // Google gives microseconds.
      length: seconds(thumb[1]),
      percent: typeof thumb[2] === 'number' ? Math.min(100, thumb[2]) : null,
    };
  }

  async function collect() {
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var watched = [];
    // Pages can overlap by a few entries; an entry's start time identifies it.
    var seen = {};
    var truncated = false;
    var token = null;
    for (var p = 0; p < MAX_PAGES; p++) {
      var result = await page(token);
      if (!result) {
        truncated = true;
        break;
      }
      var older = false;
      result.items.forEach(function (item) {
        var w = read(item);
        if (!w || seen[item[4]]) return;
        seen[item[4]] = true;
        if (w.at < since) older = true;
        else watched.push(w);
      });
      token = result.next;
      if (older || !token || !result.items.length) break;
      if (p === MAX_PAGES - 1) truncated = true;
      banner('Reading your YouTube history: ' + watched.length + ' videos so far');
    }

    // A video cannot have been watched for longer than the time until the next
    // one started, so hold each to that. This is what stops a long video left
    // marked "fully watched" from counting for hours.
    watched.sort(function (a, b) { return a.at - b.at; });
    var days = {};
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    watched.forEach(function (w, i) {
      var claimed = w.length ? (w.length * (w.percent === null ? 100 : w.percent)) / 100 : UNKNOWN_SECONDS;
      var untilNext = i + 1 < watched.length ? (watched[i + 1].at - w.at) / 1000 : claimed;
      var d = new Date(w.at);
      var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var day = days[date] || (days[date] = { date: date, videos: 0, shorts: 0, hours: 0 });
      if (w.length > SHORT_SECONDS) day.videos++;
      else day.shorts++;
      day.hours += Math.max(0, Math.min(claimed, untilNext)) / 3600;
    });

    var round2 = function (n) { return Math.round(n * 100) / 100; };
    var daily = Object.keys(days).sort().map(function (k) {
      var x = days[k];
      return { date: x.date, videos: x.videos, shorts: x.shorts, hours: round2(x.hours) };
    });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'youtube',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      // Over a minute long. Everything shorter, or of unknown length, is under shorts.
      videos: sum('videos'),
      shorts: sum('shorts'),
      watchedHours: round2(sum('hours')),
      activeDays: daily.length,
      daily: daily,
      truncated: truncated,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    // Runs on Google's activity site only.
    if (location.hostname !== 'myactivity.google.com') return;
    if (location.pathname.replace(/\/$/, '') !== '/product/youtube') {
      // Signed out, Google shows a landing page at "/?continue=..." on this same site.
      // Going back to the activity page from there would only loop.
      if (!/[?&]continue=/.test(location.search)) location.href = ACTIVITY_URL;
      return;
    }
    var w = window.WIZ_global_data;
    if (!w || !w.SNlM0e || document.readyState === 'loading') return; // Still loading.
    state.started = true;
    try {
      banner('Reading your YouTube history. This takes a moment.');
      var usage = await collect();
      state.usage = usage;

      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({
          url: ACTIVITY_URL,
          method: 'GET',
          responseMatches: [{ type: 'regex', value: '"qwAQke":"(?<signedInPage>FootprintsMyactivityUi)"' }],
          responseRedactions: [{ regex: '"qwAQke":"(?<signedInPage>FootprintsMyactivityUi)"' }],
        });
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your YouTube history. Trying again...");
    }
  }

  var timer = setInterval(function () {
    if (state.done || (state.failures || 0) >= 3) {
      clearInterval(timer);
      return;
    }
    run();
  }, 1000);
  run();
})();
