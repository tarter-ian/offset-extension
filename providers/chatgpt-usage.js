// Reclaim user script: ChatGPT usage, last 30 days.
// After the person signs in, counts their prompts, reasoning responses and
// generated images per day, and proves the account's plan. Only counts and
// dates leave the page; no titles and no message text.
(function () {
  if (window.__offsetChatgptUsage) return;
  window.__offsetChatgptUsage = { started: false, done: false };
  var state = window.__offsetChatgptUsage;

  var WINDOW_DAYS = 30;
  var PAGE = 28;
  var MAX_PAGES = 12;
  var MAX_CONVERSATIONS = 200;
  var BATCH = 3;

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

  // ChatGPT allows only so many chat reads a minute. When it says "too many
  // requests" it also says how long to wait; every request then holds off
  // until that time, so the wait is served once and not once per request.
  // If it is still refusing after this much waiting, stop and report what was
  // read as incomplete, so the person is not left watching a tab for good.
  var MAX_HOLD_MS = 150000;
  var holdUntil = 0;
  var heldMs = 0;
  async function getJson(url, headers) {
    for (var attempt = 0; attempt < 5; attempt++) {
      var wait = holdUntil - Date.now();
      if (wait > 0) {
        banner('ChatGPT asked us to slow down. Waiting ' + Math.ceil(wait / 1000) + ' seconds...');
        await sleep(wait);
      }
      var res = await fetch(url, { headers: headers, credentials: 'include' });
      if (res.status === 429) {
        if (heldMs >= MAX_HOLD_MS) return null;
        if (holdUntil <= Date.now()) {
          var asked = (Math.min(Number(res.headers.get('retry-after')) || 20, 90) + 1) * 1000;
          holdUntil = Date.now() + asked;
          heldMs += asked;
        }
        continue;
      }
      if (res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return res.json();
    }
    return null;
  }

  async function session() {
    try {
      var res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) return null;
      var s = await res.json();
      return s && s.accessToken && s.user ? s : null;
    } catch (e) {
      return null;
    }
  }

  function isImageMessage(m) {
    if (m.author.role !== 'tool' || !m.content || m.content.content_type !== 'multimodal_text') return false;
    // The code sandbox also returns images (charts, opened files); those are not generations.
    if (/^container\./.test(m.author.name || '')) return false;
    return (m.content.parts || []).some(function (p) {
      return p && p.content_type === 'image_asset_pointer';
    });
  }

  async function collect(s) {
    var headers = { authorization: 'Bearer ' + s.accessToken };
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;

    var ids = [];
    var truncated = false;
    for (var page = 0; page < MAX_PAGES; page++) {
      var list = await getJson('/backend-api/conversations?offset=' + page * PAGE + '&limit=' + PAGE + '&order=updated', headers);
      // A list page that cannot be read is a failure, not the end of the list.
      if (!list || !Array.isArray(list.items)) throw new Error('could not read the chat list');
      var items = list.items;
      var older = false;
      for (var i = 0; i < items.length; i++) {
        if (Date.parse(items[i].update_time) < since) {
          older = true;
          break;
        }
        ids.push(items[i].id);
      }
      if (older || items.length < PAGE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    if (ids.length > MAX_CONVERSATIONS) {
      ids = ids.slice(0, MAX_CONVERSATIONS);
      truncated = true;
    }

    var days = {};
    var day = function (ms) {
      var key = new Date(ms).toISOString().slice(0, 10);
      return days[key] || (days[key] = { date: key, prompts: 0, reasoning: 0, images: 0 });
    };
    var conversations = 0;

    // ChatGPT turns requests away when too many arrive together. A chat that
    // could not be read is tried again, slowly, so the total is not short.
    var todo = ids;
    for (var pass = 0; pass < 4 && todo.length && (pass === 0 || heldMs < MAX_HOLD_MS); pass++) {
      var size = pass === 0 ? BATCH : 1;
      var missed = [];
      for (var start = 0; start < todo.length; start += size) {
        var done = ids.length - todo.length + start;
        banner('Counting your ChatGPT use: ' + Math.min(done + size, ids.length) + ' of ' + ids.length + ' chats');
        if (pass > 0) await sleep(1500 * pass);
        var group = todo.slice(start, start + size);
        var batch = await Promise.all(
          group.map(function (id) {
            return getJson('/backend-api/conversation/' + id, headers).catch(function () { return null; });
          }),
        );
        batch.forEach(function (c, i) {
          if (!c || !c.mapping) missed.push(group[i]);
          else count(c);
        });
      }
      todo = missed;
    }
    var failed = todo.length;

    function count(c) {
        var used = false;
        Object.keys(c.mapping).forEach(function (k) {
          var m = c.mapping[k].message;
          if (!m || !m.author || typeof m.create_time !== 'number') return;
          var ms = m.create_time * 1000;
          if (ms < since || ms > now + 86400000) return;
          var type = m.content && m.content.content_type;
          if (m.author.role === 'user' && (type === 'text' || type === 'multimodal_text')) {
            day(ms).prompts++;
            used = true;
          } else if (m.author.role === 'assistant' && type === 'reasoning_recap') {
            day(ms).reasoning++;
          } else if (isImageMessage(m)) {
            day(ms).images++;
            used = true;
          }
        });
        if (used) conversations++;
    }

    var daily = Object.keys(days).sort().map(function (k) { return days[k]; });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'chatgpt',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      planType: (s.account && s.account.planType) || '',
      prompts: sum('prompts'),
      reasoningResponses: sum('reasoning'),
      images: sum('images'),
      conversations: conversations,
      activeDays: daily.filter(function (d) { return d.prompts + d.images > 0; }).length,
      daily: daily,
      truncated: truncated,
      failedConversations: failed,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    if (location.hostname !== 'chatgpt.com') return;
    var s = await session();
    if (!s) return; // Not signed in yet; the poll below tries again.
    state.started = true;
    try {
      banner('Counting your ChatGPT use. This takes about a minute.');
      var usage = await collect(s);
      state.usage = usage;
      if (!usage.planType) throw new Error('no plan in session');

      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done. Confirming your account...');
      var claim = {
        url: 'https://chatgpt.com/',
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
        extractedParams: { planType: usage.planType },
        responseMatches: [{ type: 'regex', value: '"planType":"(?<planType>.*?)"' }],
        responseRedactions: [{ regex: '"planType":"(?<planType>.*?)"' }],
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
      banner("We couldn't read your ChatGPT use. Trying again...");
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
