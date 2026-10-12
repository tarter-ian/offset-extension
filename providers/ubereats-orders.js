// Counting script: Uber Eats orders, last 30 days, plus orders per month before that.
// Reads the person's own past orders from the same address the orders page uses.
// Only counts and dates leave the page; no restaurants, items, prices or addresses.
(function () {
  if (window.__offsetUbereatsOrders) return;
  window.__offsetUbereatsOrders = { started: false, done: false };
  var state = window.__offsetUbereatsOrders;

  var WINDOW_DAYS = 30;
  var MAX_PAGES = 60;
  var ORDERS_URL = 'https://www.ubereats.com/orders';

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

  // One page of past orders, newest first. `after` is the last order of the page before.
  async function page(after) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var res = await fetch('/_p/api/getPastOrdersV1?localeCode=us', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
        body: JSON.stringify({ lastWorkflowUUID: after || '' }),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      var body = await res.json();
      return body && body.status === 'success' && body.data ? body.data : null;
    }
    return null;
  }

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var localDate = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  async function collect(first) {
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var days = {};
    var months = {};
    var firstOrder = null;
    var truncated = false;
    var data = first;

    for (var p = 0; p < MAX_PAGES && data; p++) {
      var ids = data.orderUuids || [];
      ids.forEach(function (id) {
        var order = (data.ordersMap || {})[id];
        var base = order && order.baseEaterOrder;
        if (!base || base.isCancelled || !base.isCompleted) return;
        var at = Date.parse(base.completedAt || base.lastStateChangeAt);
        if (!at) return;
        var date = localDate(new Date(at));
        if (!firstOrder || date < firstOrder) firstOrder = date;
        var month = date.slice(0, 7);
        months[month] = (months[month] || 0) + 1;
        if (at < since) return;
        var day = days[date] || (days[date] = { date: date, orders: 0, deliveries: 0, pickups: 0, items: 0 });
        day.orders++;
        if (/pickup/i.test(String(base.fulfillmentType || ''))) day.pickups++;
        else day.deliveries++;
        day.items += Number(base.totalQuantity) > 0 ? Number(base.totalQuantity) : Number(base.numItems) || 1;
      });
      if (!(data.meta && data.meta.hasMore) || !ids.length) break; // The whole history has been read.
      if (p === MAX_PAGES - 1) {
        truncated = true;
        break;
      }
      banner('Reading your Uber Eats orders...');
      await sleep(200);
      data = await page(ids[ids.length - 1]);
      if (!data) truncated = true;
    }

    var daily = Object.keys(days).sort().map(function (k) { return days[k]; });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'ubereats',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      orders: sum('orders'),
      // A delivery means a courier trip; a pickup does not.
      deliveries: sum('deliveries'),
      pickups: sum('pickups'),
      items: sum('items'),
      activeDays: daily.length,
      daily: daily,
      // Every order the account has made, by month, so past use need not be guessed.
      history: {
        firstOrder: firstOrder,
        monthly: Object.keys(months).sort().map(function (m) { return { month: m, orders: months[m] }; }),
      },
      truncated: truncated,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    // Signed-out visitors are sent to Uber's login site, where this does nothing.
    if (location.hostname !== 'www.ubereats.com') return;
    var first = await page('').catch(function () { return null; });
    if (!first) return; // Not signed in, or not ready yet; the poll below tries again.
    if (state.started || state.done) return;
    state.started = true;
    try {
      banner('Reading your Uber Eats orders. This takes a moment.');
      var usage = await collect(first);
      state.usage = usage;
      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({ url: ORDERS_URL, method: 'GET' });
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your Uber Eats orders. Trying again...");
    }
  }

  var timer = setInterval(function () {
    if (state.done || (state.failures || 0) >= 3) {
      clearInterval(timer);
      return;
    }
    run();
  }, 2000);
  run();
})();
