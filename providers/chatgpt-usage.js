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

  // Counts for one chat, by day: { "2026-10-01": [prompts, reasoning, images] }.
  function countChat(c, since, now) {
    var days = {};
    Object.keys(c.mapping).forEach(function (k) {
      var m = c.mapping[k].message;
      if (!m || !m.author || typeof m.create_time !== 'number') return;
      var ms = m.create_time * 1000;
      if (ms < since || ms > now + 86400000) return;
      var type = m.content && m.content.content_type;
      var slot = m.author.role === 'user' && (type === 'text' || type === 'multimodal_text')
        ? 0
        : m.author.role === 'assistant' && type === 'reasoning_recap'
          ? 1
          : isImageMessage(m)
            ? 2
            : -1;
      if (slot < 0) return;
      var key = new Date(ms).toISOString().slice(0, 10);
      (days[key] || (days[key] = [0, 0, 0]))[slot]++;
    });
    return days;
  }

  async function collect(s) {
    var headers = { authorization: 'Bearer ' + s.accessToken };
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var sinceDate = new Date(since).toISOString().slice(0, 10);

    var chats = [];
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
        chats.push({ id: items[i].id, updated: items[i].update_time });
      }
      if (older || items.length < PAGE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    if (chats.length > MAX_CONVERSATIONS) {
      chats = chats.slice(0, MAX_CONVERSATIONS);
      truncated = true;
    }

    // What earlier runs counted, per chat, handed in by the extension. A chat
    // that has not changed since is not read again, which keeps the number of
    // reads under ChatGPT's limit and lets a run that was cut short be finished
    // by the next one. It holds counts only, never titles or text.
    var remembered = (window.__offsetCache && window.__offsetCache.chatgpt) || {};
    var counted = {};
    var todo = [];
    chats.forEach(function (chat) {
      var old = remembered[chat.id];
      if (old && old.u === chat.updated && old.d) counted[chat.id] = { u: old.u, d: old.d };
      else todo.push(chat);
    });
    var reused = chats.length - todo.length;

    // ChatGPT turns requests away past its limit. A chat that could not be read
    // is tried again, one at a time, so the total is not short.
    for (var pass = 0; pass < 4 && todo.length && (pass === 0 || heldMs < MAX_HOLD_MS); pass++) {
      var size = pass === 0 ? BATCH : 1;
      var missed = [];
      for (var start = 0; start < todo.length; start += size) {
        var have = Object.keys(counted).length;
        banner('Counting your ChatGPT use: ' + have + ' of ' + chats.length + ' chats');
        if (pass > 0) await sleep(1500 * pass);
        var group = todo.slice(start, start + size);
        var batch = await Promise.all(
          group.map(function (chat) {
            return getJson('/backend-api/conversation/' + chat.id, headers).catch(function () { return null; });
          }),
        );
        batch.forEach(function (c, i) {
          if (!c || !c.mapping) missed.push(group[i]);
          else counted[group[i].id] = { u: group[i].updated, d: countChat(c, since, now) };
        });
      }
      todo = missed;
    }

    var days = {};
    var conversations = 0;
    Object.keys(counted).forEach(function (id) {
      var d = counted[id].d;
      var used = false;
      Object.keys(d).forEach(function (date) {
        if (date < sinceDate) return;
        var day = days[date] || (days[date] = { date: date, prompts: 0, reasoning: 0, images: 0 });
        day.prompts += d[date][0];
        day.reasoning += d[date][1];
        day.images += d[date][2];
        if (d[date][0] + d[date][2] > 0) used = true;
      });
      if (used) conversations++;
    });

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
      // Chats in the window that could not be read this time. Above zero, the totals are too low.
      failedConversations: todo.length,
      reusedConversations: reused,
      // For the extension to keep for next time. It removes this before anything goes to the site.
      remember: counted,
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
