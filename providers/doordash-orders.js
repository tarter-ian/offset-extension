// Counting script: DoorDash orders, last 30 days, plus orders per month before that.
// Reads the person's own order history through the page's own data client.
// Counts, dates and order totals leave the page; no restaurants, items, item
// prices or addresses.
(function () {
  if (window.__offsetDoordashOrders) return;
  window.__offsetDoordashOrders = { started: false, done: false };
  var state = window.__offsetDoordashOrders;

  var WINDOW_DAYS = 30;
  var PAGE = 20;
  var MAX_PAGES = 60;
  var ORDERS_URL = 'https://www.doordash.com/orders';

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

  // The order-history request the page itself made, so more pages can be asked
  // for in exactly the same way. Null until the orders page has loaded it.
  function ordersQuery() {
    var client = window.__APOLLO_CLIENT__;
    var queries = client && client.queryManager && client.queryManager.queries;
    if (!queries || typeof queries.forEach !== 'function') return null;
    var found = null;
    queries.forEach(function (info) {
      var doc = info.document;
      var def = doc && doc.definitions && doc.definitions[0];
      var name = def && def.name && def.name.value;
      if (name === 'getConsumerOrdersWithDetails' && info.variables) found = { client: client, doc: doc, variables: info.variables };
    });
    return found;
  }

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var localDate = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  async function collect(q) {
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var days = {};
    var months = {};
    var first = null;
    var truncated = false;
    var currency = null;
    var cents = function (n) { return Math.round(n * 100) / 100; };

    for (var page = 0; page < MAX_PAGES; page++) {
      var result = await q.client.query({
        query: q.doc,
        variables: Object.assign({}, q.variables, { offset: page * PAGE, limit: PAGE, includeCancelled: true }),
        fetchPolicy: 'network-only',
      });
      var list = (result.data && result.data.getConsumerOrdersWithDetails) || [];
      list.forEach(function (order) {
        var at = Date.parse(order.createdAt || order.submittedAt);
        if (!at || order.cancelledAt) return;
        var d = new Date(at);
        var date = localDate(d);
        if (!first || date < first) first = date;
        // What the order cost in all, as DoorDash shows it: food, fees, tax and tip.
        var grand = order.grandTotal;
        var total = 0;
        if (grand && typeof grand.unitAmount === 'number') {
          total = grand.unitAmount / Math.pow(10, typeof grand.decimalPlaces === 'number' ? grand.decimalPlaces : 2);
          if (!currency && grand.currency) currency = grand.currency;
        }
        var month = date.slice(0, 7);
        var m = months[month] || (months[month] = { month: month, orders: 0, spend: 0 });
        m.orders++;
        m.spend += total;
        if (at < since) return;
        var items = 0;
        (order.orders || []).forEach(function (part) {
          (part.items || []).forEach(function (item) {
            items += Number(item.quantity) > 0 ? Number(item.quantity) : 1;
          });
        });
        var day = days[date] || (days[date] = { date: date, orders: 0, deliveries: 0, pickups: 0, groceryOrders: 0, items: 0, spend: 0 });
        day.orders++;
        day.spend += total;
        if (order.isPickup) day.pickups++;
        else day.deliveries++;
        if (order.isRetail) day.groceryOrders++;
        day.items += items;
      });
      if (list.length < PAGE) break; // The whole history has been read.
      if (page === MAX_PAGES - 1) truncated = true;
      banner('Reading your DoorDash orders...');
      await sleep(200);
    }

    var daily = Object.keys(days).sort().map(function (k) {
      days[k].spend = cents(days[k].spend);
      return days[k];
    });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'doordash',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      orders: sum('orders'),
      // A delivery means a courier trip; a pickup does not.
      deliveries: sum('deliveries'),
      pickups: sum('pickups'),
      groceryOrders: sum('groceryOrders'),
      items: sum('items'),
      // Order totals, in the currency DoorDash charged.
      spend: cents(sum('spend')),
      currency: currency,
      activeDays: daily.length,
      daily: daily,
      // Every order the account has made, by month, so past use need not be guessed.
      history: {
        firstOrder: first,
        monthly: Object.keys(months).sort().map(function (k) {
          return { month: k, orders: months[k].orders, spend: cents(months[k].spend) };
        }),
      },
      truncated: truncated,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    // Signed-out visitors are sent to DoorDash's login site, where this does nothing.
    if (location.hostname !== 'www.doordash.com') return;
    if (!/^\/orders\/?$/.test(location.pathname)) {
      location.href = ORDERS_URL;
      return;
    }
    var q = ordersQuery();
    if (!q) return; // The page has not loaded its order list yet.
    state.started = true;
    try {
      banner('Reading your DoorDash orders. This takes a moment.');
      var usage = await collect(q);
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
      banner("We couldn't read your DoorDash orders. Trying again...");
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
