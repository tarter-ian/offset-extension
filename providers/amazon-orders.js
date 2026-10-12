// Counting script: Amazon orders, last 30 days, plus orders per month for the last three.
// Reads the person's own "Your Orders" pages as Amazon shows them, ten orders at a
// time. Only counts and dates leave the page; no product names, prices or addresses.
(function () {
  if (window.__offsetAmazonOrders) return;
  window.__offsetAmazonOrders = { started: false, done: false };
  var state = window.__offsetAmazonOrders;

  var WINDOW_DAYS = 30;
  var PER_PAGE = 10;
  var MAX_PAGES = 12;
  var ORDERS_PATH = '/your-orders/orders';
  var FILTER = 'months-3';
  // Amazon fills each page in after it loads, so the orders already read are
  // kept here while the tab moves to the next page. Cleared when the count ends.
  var STASH = '__offsetAmazonOrders';
  var MONTH = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/;

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

  var pageUrl = function (start) {
    return 'https://www.amazon.com' + ORDERS_PATH + '?timeFilter=' + FILTER + '&startIndex=' + start;
  };

  function readStash() {
    try {
      var s = JSON.parse(sessionStorage.getItem(STASH) || 'null');
      return s && Array.isArray(s.orders) ? s : null;
    } catch (e) {
      return null;
    }
  }

  // One order card to { at, items, cancelled }. Null while the card is still empty.
  function readCard(card) {
    var header = card.querySelectorAll('.order-header__header-list-item');
    var date = null;
    for (var i = 0; i < header.length && !date; i++) {
      var m = header[i].textContent.match(MONTH);
      if (m) date = m[0].replace(/\s+/g, ' ');
    }
    if (!date) return null;
    var titles = card.querySelectorAll('.yohtmlc-product-title').length;
    var extra = 0;
    var badges = 0;
    card.querySelectorAll('.product-image__qty').forEach(function (q) {
      var n = parseInt(q.textContent, 10) || 0;
      badges += n;
      if (n > 1) extra += n - 1;
    });
    var status = '';
    card.querySelectorAll('.yohtmlc-shipment-status-primaryText').forEach(function (e) { status += ' ' + e.textContent; });
    return {
      at: Date.parse(date),
      // A quantity badge shows only when more than one of a product was bought.
      items: titles ? titles + extra : badges || 1,
      cancelled: /cancell?ed/i.test(status),
    };
  }

  function finish(orders, truncated) {
    sessionStorage.removeItem(STASH);
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var days = {};
    var months = {};
    orders.forEach(function (o) {
      if (!o.at || o.cancelled) return;
      var d = new Date(o.at);
      var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var month = date.slice(0, 7);
      months[month] = (months[month] || 0) + 1;
      // Amazon gives the day an order was placed, not the time, so compare whole days.
      if (o.at < since - 86400000) return;
      var day = days[date] || (days[date] = { date: date, orders: 0, items: 0 });
      day.orders++;
      day.items += o.items;
    });
    var daily = Object.keys(days).sort().map(function (k) { return days[k]; });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    return {
      service: 'amazon',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      orders: sum('orders'),
      items: sum('items'),
      activeDays: daily.length,
      daily: daily,
      // The three months Amazon's "past 3 months" view covers; the oldest may be partial.
      history: { monthly: Object.keys(months).sort().map(function (m) { return { month: m, orders: months[m] }; }) },
      truncated: truncated,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    if (location.hostname !== 'www.amazon.com') return;
    // Signed out, Amazon shows its sign-in page on this same site. Wait there.
    if (/^\/ap\//.test(location.pathname)) return;
    var params = new URLSearchParams(location.search);
    var start = Number(params.get('startIndex') || 0);
    var stash = readStash();
    var onOrders = location.pathname === ORDERS_PATH && params.get('timeFilter') === FILTER;
    // Begin at the first page, and only carry on from a page this count sent the tab to.
    if (!onOrders || (start > 0 && !(stash && stash.next === start))) {
      sessionStorage.removeItem(STASH);
      location.href = pageUrl(0);
      return;
    }
    if (document.readyState !== 'complete') return;
    state.started = true;
    try {
      banner('Reading your Amazon orders...');
      // Wait for Amazon to fill the cards in.
      var cards = [];
      var read = [];
      for (var tries = 0; tries < 16; tries++) {
        cards = Array.prototype.slice.call(document.querySelectorAll('.order-card'));
        read = cards.map(readCard);
        if (cards.length && read.every(Boolean)) break;
        await sleep(500);
      }
      var orders = (start > 0 && stash ? stash.orders : []).concat(read.filter(Boolean));
      var page = start / PER_PAGE;
      var more = cards.length >= PER_PAGE && !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a');
      if (more && page + 1 < MAX_PAGES) {
        sessionStorage.setItem(STASH, JSON.stringify({ orders: orders, next: start + PER_PAGE }));
        state.started = false; // The next page loads a fresh copy of this script.
        location.href = pageUrl(start + PER_PAGE);
        return;
      }
      var usage = finish(orders, more);
      state.usage = usage;
      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({ url: pageUrl(0), method: 'GET' });
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your Amazon orders. Trying again...");
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
