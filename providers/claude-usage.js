// Reclaim user script: Claude usage, last 30 days.
// After the person signs in, counts their prompts and extended-thinking
// responses per day in claude.ai chats, reads how much of the weekly limit is
// used, and proves the account's plan tier. Only counts and dates leave the
// page; no titles and no message text.
(function () {
  if (window.__offsetClaudeUsage) return;
  window.__offsetClaudeUsage = { started: false, done: false };
  var state = window.__offsetClaudeUsage;

  var WINDOW_DAYS = 30;
  var PAGE = 50;
  var MAX_PAGES = 8;
  var MAX_CONVERSATIONS = 200;
  var BATCH = 5;

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

  async function getJson(url) {
    for (var attempt = 0; attempt < 4; attempt++) {
      var res = await fetch(url, { credentials: 'include' });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return res.json();
    }
    return null;
  }

  async function organization() {
    try {
      var orgs = await getJson('/api/organizations');
      if (!Array.isArray(orgs) || !orgs.length) return null;
      // The chat organization, when the account also has an API one.
      return (
        orgs.filter(function (o) { return (o.capabilities || []).indexOf('chat') >= 0; })[0] || orgs[0]
      );
    } catch (e) {
      return null;
    }
  }

  async function collect(org) {
    var base = '/api/organizations/' + org.uuid;
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;

    var ids = [];
    var truncated = false;
    for (var page = 0; page < MAX_PAGES; page++) {
      var items = await getJson(base + '/chat_conversations?limit=' + PAGE + '&offset=' + page * PAGE);
      // A list page that cannot be read is a failure, not the end of the list.
      if (!Array.isArray(items)) throw new Error('could not read the chat list');
      var older = false;
      for (var i = 0; i < items.length; i++) {
        if (Date.parse(items[i].updated_at) < since) {
          older = true;
          break;
        }
        ids.push(items[i].uuid);
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
      return days[key] || (days[key] = { date: key, prompts: 0, reasoning: 0, toolCalls: 0 });
    };
    var conversations = 0;
    var failed = 0;

    for (var start = 0; start < ids.length; start += BATCH) {
      banner('Counting your Claude use: ' + Math.min(start + BATCH, ids.length) + ' of ' + ids.length + ' chats');
      var batch = await Promise.all(
        ids.slice(start, start + BATCH).map(function (id) {
          return getJson(base + '/chat_conversations/' + id + '?tree=True&rendering_mode=messages&render_all_tools=true').catch(
            function () { return null; },
          );
        }),
      );
      batch.forEach(function (c) {
        if (!c || !Array.isArray(c.chat_messages)) {
          failed++;
          return;
        }
        var used = false;
        c.chat_messages.forEach(function (m) {
          var ms = Date.parse(m.created_at);
          if (!(ms >= since) || ms > now + 86400000) return;
          var types = (m.content || []).map(function (p) { return p.type; });
          if (m.sender === 'human') {
            day(ms).prompts++;
            used = true;
          } else if (m.sender === 'assistant') {
            if (types.indexOf('thinking') >= 0) day(ms).reasoning++;
            day(ms).toolCalls += types.filter(function (t) { return t === 'tool_use'; }).length;
          }
        });
        if (used) conversations++;
      });
    }

    // Share of the plan's rolling limits in use. Unlike the chat counts, this
    // also reflects Claude Code and other apps on the same subscription.
    var limits = await getJson(base + '/usage').catch(function () { return null; });
    var percent = function (k) {
      return limits && limits[k] && typeof limits[k].utilization === 'number' ? limits[k].utilization : null;
    };

    var daily = Object.keys(days).sort().map(function (k) { return days[k]; });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'claude',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      rateLimitTier: org.rate_limit_tier || '',
      prompts: sum('prompts'),
      reasoningResponses: sum('reasoning'),
      toolCalls: sum('toolCalls'),
      images: 0,
      conversations: conversations,
      activeDays: daily.filter(function (d) { return d.prompts > 0; }).length,
      daily: daily,
      weeklyLimitUsedPercent: percent('seven_day'),
      fiveHourLimitUsedPercent: percent('five_hour'),
      truncated: truncated,
      failedConversations: failed,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    if (location.hostname !== 'claude.ai') return;
    var org = await organization();
    if (!org) return; // Not signed in yet; the poll below tries again.
    state.started = true;
    try {
      banner('Counting your Claude use. This takes about a minute.');
      var usage = await collect(org);
      state.usage = usage;
      if (!usage.rateLimitTier) throw new Error('no plan tier on the organization');

      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done. Confirming your account...');
      var claim = {
        url: 'https://claude.ai/api/organizations',
        cookies: '',
        headers: {
          accept: '*/*',
          'accept-language': navigator.language || 'en-US,en;q=0.9',
          'user-agent': navigator.userAgent,
        },
        method: 'GET',
        requestBody: '',
        responseBody: 'response',
        geoLocation: '{{DYNAMIC_GEO}}',
        extractedParams: { rateLimitTier: usage.rateLimitTier },
        responseMatches: [{ type: 'regex', value: '"rate_limit_tier":"(?<rateLimitTier>.*?)"' }],
        responseRedactions: [{ regex: '"rate_limit_tier":"(?<rateLimitTier>.*?)"' }],
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
      banner("We couldn't read your Claude use. Trying again...");
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
