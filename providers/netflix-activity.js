// Counting script: Netflix titles watched, last 30 days.
// Reads the person's own "Viewing Activity" page for the profile that is active,
// pressing its "Show More" button until the list reaches back 30 days. Netflix
// gives a date for each title but not how long it was watched. Only counts and
// dates leave the page; no titles.
(function () {
  if (window.__offsetNetflixActivity) return;
  window.__offsetNetflixActivity = { started: false, done: false };
  var state = window.__offsetNetflixActivity;

  var WINDOW_DAYS = 30;
  var MAX_ROUNDS = 40;
  var ACTIVITY_URL = 'https://www.netflix.com/viewingactivity';

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

  var models = function () {
    var n = window.netflix && window.netflix.reactContext && window.netflix.reactContext.models;
    return n || null;
  };

  // Netflix writes each date in the account's own style, such as 6/19/26 or
  // 19/06/26. Work out which number is the day from how that locale writes dates.
  function dateReader() {
    var id = 'en-US';
    try {
      id = models().userInfo.data.userLocale.locale.id || id;
    } catch (e) {}
    var order = ['month', 'day', 'year'];
    try {
      order = new Intl.DateTimeFormat(id, { year: '2-digit', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date(2001, 1, 3))
        .filter(function (p) { return p.type === 'day' || p.type === 'month' || p.type === 'year'; })
        .map(function (p) { return p.type; });
    } catch (e) {}
    return function (text) {
      var nums = String(text || '').match(/\d+/g);
      if (!nums || nums.length < 3) return null;
      var parts = {};
      for (var i = 0; i < 3; i++) parts[order[i]] = Number(nums[i]);
      var year = parts.year < 100 ? 2000 + parts.year : parts.year;
      var d = new Date(year, parts.month - 1, parts.day, 12);
      return isNaN(d.getTime()) ? null : d;
    };
  }

  var rows = function () {
    return document.querySelectorAll('li.retableRow');
  };

  // The button under the list that loads older titles. Its label is translated.
  function moreButton() {
    var list = rows();
    var last = list[list.length - 1];
    if (!last) return null;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.disabled || b.closest('li.retableRow')) continue;
      if (last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return b;
    }
    return null;
  }

  async function collect() {
    var readDate = dateReader();
    var since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - WINDOW_DAYS);
    var truncated = false;

    var oldest = function () {
      var list = rows();
      var last = list[list.length - 1];
      return last ? readDate((last.querySelector('.date') || {}).textContent) : null;
    };

    for (var round = 0; round < MAX_ROUNDS; round++) {
      var o = oldest();
      if (!o || o < since) break;
      var button = moreButton();
      if (!button) break; // The whole history is on the page.
      if (round === MAX_ROUNDS - 1) {
        truncated = true;
        break;
      }
      banner('Reading your Netflix history: ' + rows().length + ' titles so far');
      var before = rows().length;
      button.click();
      for (var wait = 0; wait < 16 && rows().length === before; wait++) await sleep(500);
      if (rows().length === before) {
        truncated = !!moreButton();
        break;
      }
    }

    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var days = {};
    var unread = 0;
    Array.prototype.forEach.call(rows(), function (row) {
      var d = readDate((row.querySelector('.date') || {}).textContent);
      if (!d) {
        unread++;
        return;
      }
      if (d < since) return;
      var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      days[date] = (days[date] || 0) + 1;
    });
    var daily = Object.keys(days).sort().map(function (k) { return { date: k, titles: days[k] }; });
    var everWatched = null;
    try {
      everWatched = models().vaModel.data.vhSize;
    } catch (e) {}
    return {
      service: 'netflix',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date().toISOString(),
      // One per episode or film started on this profile. Netflix does not say how much of each was watched.
      titles: daily.reduce(function (t, d) { return t + d.titles; }, 0),
      activeDays: daily.length,
      daily: daily,
      titlesEver: typeof everWatched === 'number' ? everWatched : null,
      truncated: truncated,
      unreadRows: unread,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    if (location.hostname !== 'www.netflix.com') return;
    // Signed out, Netflix shows its login page on this same site. Wait there.
    if (/^\/([a-z]{2}(-[a-z]{2})?\/)?login/i.test(location.pathname)) return;
    if (!/^\/viewingactivity\/?$/.test(location.pathname)) {
      location.href = ACTIVITY_URL;
      return;
    }
    var m = models();
    if (!m || !m.vaModel || document.readyState !== 'complete') return; // Still loading.
    state.started = true;
    try {
      banner('Reading your Netflix history. This takes a moment.');
      await sleep(800);
      var usage = await collect();
      state.usage = usage;
      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({ url: ACTIVITY_URL, method: 'GET' });
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your Netflix history. Trying again...");
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
