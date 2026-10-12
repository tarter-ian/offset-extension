// Reclaim user script: Gemini use, last 30 days.
// After the person signs in to Google, reads their Gemini Apps Activity page
// back 30 days and counts activity items per day. Only counts and dates leave
// the page; no prompt text.
(function () {
  if (window.__offsetGeminiActivity) return;
  window.__offsetGeminiActivity = { started: false, done: false };
  var state = window.__offsetGeminiActivity;

  var WINDOW_DAYS = 30;
  // Asked for the whole history, it reads to the end of the list and adds items per month.
  var WHOLE = window.__offsetHistory === true;
  var MAX_ROUNDS = WHOLE ? 600 : 80;
  var MAX_ITEMS = WHOLE ? 60000 : 8000;
  var ACTIVITY_URL = 'https://myactivity.google.com/product/gemini';

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

  // Each day's group carries its date as data-date="YYYYMMDD", in any language.
  function read() {
    var days = {};
    var total = 0;
    var oldest = null;
    var items = document.querySelectorAll('[role="main"] [role="listitem"]');
    for (var i = 0; i < items.length; i++) {
      var holder = items[i].closest('[data-date]');
      var raw = holder && holder.getAttribute('data-date');
      if (!raw || !/^\d{8}$/.test(raw)) continue;
      var date = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
      days[date] = (days[date] || 0) + 1;
      total++;
      if (!oldest || date < oldest) oldest = date;
    }
    return { days: days, total: total, oldest: oldest };
  }

  // The "Load more" button at the end of the list. Its label is translated, so find it by position.
  function moreButton() {
    var named = document.querySelector('[role="main"] button[jsname="T8gEfd"]');
    if (named) return named;
    var items = document.querySelectorAll('[role="main"] [role="listitem"]');
    var last = items[items.length - 1];
    if (!last) return null;
    var buttons = document.querySelectorAll('[role="main"] button');
    for (var i = buttons.length - 1; i >= 0; i--) {
      var b = buttons[i];
      if (b.closest('[role="listitem"]') || b.closest('[data-date]')) continue;
      if (last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return b;
    }
    return null;
  }

  // Waits for the list to grow past `before` items. It watches the page instead
  // of checking on a timer, because Chrome slows timers right down in a tab
  // nobody is looking at.
  function grown(before) {
    return new Promise(function (resolve) {
      var main = document.querySelector('[role="main"]') || document.body;
      var watcher = new MutationObserver(function () {
        var next = read();
        if (next.total <= before) return;
        watcher.disconnect();
        clearTimeout(giveUp);
        resolve(next);
      });
      watcher.observe(main, { childList: true, subtree: true });
      var giveUp = setTimeout(function () {
        watcher.disconnect();
        var next = read();
        resolve(next.total > before ? next : null);
      }, 8000);
    });
  }

  async function collect() {
    var since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var sinceDate = since.getFullYear() + '-' + p(since.getMonth() + 1) + '-' + p(since.getDate());

    var seen = read();
    var truncated = false;
    for (var round = 0; round < MAX_ROUNDS; round++) {
      if (!WHOLE && seen.oldest && seen.oldest < sinceDate) break;
      var button = moreButton();
      if (!button) break; // End of the activity.
      if (seen.total >= MAX_ITEMS || round === MAX_ROUNDS - 1) {
        truncated = true;
        break;
      }
      banner('Reading your Gemini activity: ' + seen.total + ' items so far');
      var waiting = grown(seen.total);
      button.click();
      var next = await waiting;
      if (!next) {
        // Nothing came. Ask once more before deciding.
        waiting = grown(seen.total);
        button.click();
        next = await waiting;
      }
      if (next) seen = next;
      else {
        // Google keeps this button in the page (out of sight) even at the end of
        // the activity, so two presses that bring nothing are the only sign of
        // the end. Offline, they mean nothing.
        if (!navigator.onLine) truncated = true;
        break;
      }
    }

    var daily = Object.keys(seen.days)
      .filter(function (d) { return d >= sinceDate; })
      .sort()
      .map(function (d) { return { date: d, prompts: seen.days[d] }; });
    var months = {};
    Object.keys(seen.days).forEach(function (d) {
      months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + seen.days[d];
    });
    var monthly = Object.keys(months).sort().map(function (m) { return { month: m, prompts: months[m] }; });
    return {
      service: 'gemini',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date().toISOString(),
      // Items in Gemini Apps Activity. Nearly all are prompts; image and video
      // requests are not told apart.
      prompts: daily.reduce(function (t, d) { return t + d.prompts; }, 0),
      activeDays: daily.length,
      daily: daily,
      history: WHOLE ? { whole: !truncated, monthly: monthly } : undefined,
      truncated: truncated,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    // Runs on Google's activity site only.
    if (location.hostname !== 'myactivity.google.com') return;
    if (location.pathname !== '/product/gemini') {
      // Signed out, Google shows a landing page at "/?continue=..." on this same site.
      // Going back to the activity page from there would only loop.
      if (!/[?&]continue=/.test(location.search)) location.href = ACTIVITY_URL;
      return;
    }
    if (!document.querySelector('[role="main"]') || document.readyState !== 'complete') return; // Still loading.
    state.started = true;
    try {
      banner('Reading your Gemini activity. This takes a moment.');
      await sleep(1500);
      var usage = await collect();
      state.usage = usage;

      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done. Confirming your account...');
      var claim = {
        url: ACTIVITY_URL,
        cookies: '',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': navigator.language || 'en-US,en;q=0.9',
          'user-agent': navigator.userAgent,
          'sec-fetch-mode': 'navigate',
        },
        method: 'GET',
        requestBody: '',
        responseBody: 'response',
        geoLocation: '{{DYNAMIC_GEO}}',
        extractedParams: { signedInPage: 'FootprintsMyactivityUi' },
        responseMatches: [{ type: 'regex', value: '"qwAQke":"(?<signedInPage>FootprintsMyactivityUi)"' }],
        responseRedactions: [{ regex: '"qwAQke":"(?<signedInPage>FootprintsMyactivityUi)"' }],
      };
      state.claim = claim;
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim(claim);
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your Gemini activity. Trying again...");
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
