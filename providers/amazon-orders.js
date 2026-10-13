// Counting script: Amazon orders, last 30 days, plus orders per month for the last three.
// Reads the person's own "Your Orders" pages as Amazon shows them, ten orders at a
// time. Each item is sorted into a broad kind (electronics, clothing and so on) in
// the page. Counts, dates and order totals leave the page; no product names, item
// prices or addresses.
// Asked for the whole history, it reads every year Amazon lists, one after another.
(function () {
  if (window.__offsetAmazonOrders) return;
  window.__offsetAmazonOrders = { started: false, done: false };
  var state = window.__offsetAmazonOrders;

  var WINDOW_DAYS = 30;
  var PER_PAGE = 10;
  var WHOLE = window.__offsetHistory === true;
  // Ten orders a page, and each page is a fresh load of the tab.
  var MAX_PAGES = WHOLE ? 200 : 12;
  var ORDERS_PATH = '/your-orders/orders';
  // Amazon's "past 3 months" view. The whole history uses its year views instead.
  var RECENT = 'months-3';
  // Amazon fills each page in after it loads, so the orders already read are
  // kept here while the tab moves to the next page. Cleared when the count ends.
  var STASH = '__offsetAmazonOrders';
  var MONTH = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/;

  // Broad kinds of product, because a phone and a paperback have very different
  // footprints. Each item is sorted here, in the page, from its name; only the
  // tally per kind leaves. The first kind whose words match wins. It is a rough
  // sort by keyword, not Amazon's own category.
  var KINDS = [
    ['electronics', /\b(phone|iphone|laptop|macbook|tablet|ipad|kindle|charger|charging|cable|usb|hdmi|adapter|headphones?|earbuds?|airpods|speaker|monitor|keyboard|mouse|webcam|camera|tv|television|router|wi-?fi|ssd|hard drive|memory card|batter(y|ies)|power bank|smart ?watch|console|controller|printer|projector|microphone|echo|alexa|fire stick|gpu|processor|ethernet)\b/],
    ['clothing', /\b(shirts?|t-shirts?|tees?|pants|jeans|dress(es)?|skirt|jackets?|coats?|hood(ie|ies)|sweaters?|sweatshirt|socks|underwear|boxers|bras?|shoes?|sneakers?|boots?|sandals?|slippers|hats?|beanie|gloves|scarf|shorts|leggings|pajamas?|swimsuit|belt|backpack|handbag|wallet|sunglasses|watch band)\b/],
    ['books_media', /\b(book|paperback|hardcover|novel|edition|textbook|workbook|dvd|blu-?ray|vinyl|audio cd|magazine|comic|manga)\b/],
    ['beauty_health', /\b(shampoo|conditioner|soap|body wash|lotion|moisturizer|cream|serum|makeup|mascara|lipstick|toothpaste|toothbrush|floss|razors?|deodorant|vitamins?|supplements?|protein powder|medicine|ibuprofen|bandages?|sunscreen|perfume|cologne|skincare|contact lens)\b/],
    ['food', /\b(snacks?|coffee|tea|chocolate|candy|cereal|granola|sauce|pasta|rice|nuts|almonds|chips|cookies|crackers|juice|soda|sparkling water|olive oil|spices?|seasoning|protein bars?|grocer(y|ies)|organic|fl oz|ounces?)\b/],
    ['toys_sports', /\b(toys?|lego|board game|puzzle|doll|plush|action figure|yoga|fitness|dumbbells?|weights|treadmill|bike|bicycle|helmet|camping|tent|sleeping bag|fishing|golf|basketball|soccer|football|tennis)\b/],
    ['home', /\b(furniture|chair|desk|table|sofa|couch|mattress|pillows?|sheets?|blanket|comforter|towels?|curtains?|lamp|light bulbs?|shel(f|ves)|storage|organizer|vacuum|kitchen|cookware|pans?|pots?|kni(fe|ves)|utensils?|dish(es)?|mugs?|cups?|bottles?|rug|decor|tools?|drill|screws?|paint|garden|hose|cleaner|detergent|trash bags?|paper towels?|toilet paper|filters?|air fryer|blender|toaster|kettle)\b/],
  ];
  function kindOf(title) {
    var t = String(title || '').toLowerCase();
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(t)) return KINDS[i][0];
    return 'other';
  }

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

  var pageUrl = function (filter, start) {
    return 'https://www.amazon.com' + ORDERS_PATH + '?timeFilter=' + filter + '&startIndex=' + start;
  };

  // The years Amazon offers in its "orders placed in" menu, newest first.
  function yearFilters() {
    var menu = document.querySelector('#time-filter, select[name="timeFilter"]');
    if (!menu) return [];
    return Array.prototype.map
      .call(menu.options, function (o) { return o.value; })
      .filter(function (v) { return /^year-\d{4}$/.test(v); })
      .sort()
      .reverse();
  }

  // Waits until Amazon has filled in every order card on the page. It watches
  // the page instead of checking on a timer, because Chrome slows timers right
  // down in a tab nobody is looking at.
  function filled() {
    var look = function () {
      var cards = Array.prototype.slice.call(document.querySelectorAll('.order-card'));
      var read = cards.map(readCard);
      return cards.length && read.every(Boolean) ? { cards: cards, read: read } : null;
    };
    return new Promise(function (resolve) {
      var now = look();
      if (now) return resolve(now);
      var watcher = new MutationObserver(function () {
        var got = look();
        if (!got) return;
        watcher.disconnect();
        clearTimeout(giveUp);
        resolve(got);
      });
      watcher.observe(document.body, { childList: true, subtree: true });
      var giveUp = setTimeout(function () {
        watcher.disconnect();
        var cards = Array.prototype.slice.call(document.querySelectorAll('.order-card'));
        resolve({ cards: cards, read: cards.map(readCard) });
      }, 6000);
    });
  }

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
    var total = 0;
    for (var i = 0; i < header.length; i++) {
      var m = !date && header[i].textContent.match(MONTH);
      if (m) date = m[0].replace(/\s+/g, ' ');
      // The order total, as Amazon prints it in the card's header: "$39.86".
      var money = !total && header[i].textContent.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
      if (money) total = parseFloat(money[1].replace(/,/g, '')) || 0;
    }
    if (!date) return null;
    var titleNodes = card.querySelectorAll('.yohtmlc-product-title');
    var titles = titleNodes.length;
    var kinds = {};
    Array.prototype.forEach.call(titleNodes, function (node) {
      var kind = kindOf(node.textContent);
      kinds[kind] = (kinds[kind] || 0) + 1;
    });
    var extra = 0;
    var badges = 0;
    card.querySelectorAll('.product-image__qty').forEach(function (q) {
      var n = parseInt(q.textContent, 10) || 0;
      badges += n;
      if (n > 1) extra += n - 1;
    });
    var status = '';
    card.querySelectorAll('.yohtmlc-shipment-status-primaryText').forEach(function (e) { status += ' ' + e.textContent; });
    // A quantity badge shows only when more than one of a product was bought.
    var items = titles ? titles + extra : badges || 1;
    // An order shown as pictures with no product names is a grocery delivery.
    if (!titles) kinds.food = items;
    // Extra copies of a product cannot be matched to a name here; call them "other".
    else if (extra) kinds.other = (kinds.other || 0) + extra;
    return {
      at: Date.parse(date),
      items: items,
      total: total,
      kinds: kinds,
      cancelled: /cancell?ed/i.test(status),
    };
  }

  function finish(orders, truncated) {
    sessionStorage.removeItem(STASH);
    var now = Date.now();
    var since = now - WINDOW_DAYS * 86400000;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var cents = function (n) { return Math.round(n * 100) / 100; };
    var days = {};
    var months = {};
    var kinds = {};
    var spendKinds = {};
    orders.forEach(function (o) {
      if (!o.at || o.cancelled) return;
      var d = new Date(o.at);
      var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var month = date.slice(0, 7);
      var m = months[month] || (months[month] = { orders: 0, spend: 0 });
      m.orders++;
      m.spend += o.total || 0;
      // Amazon gives the day an order was placed, not the time, so compare whole days.
      if (o.at < since - 86400000) return;
      var day = days[date] || (days[date] = { date: date, orders: 0, items: 0, spend: 0 });
      day.orders++;
      day.items += o.items;
      day.spend += o.total || 0;
      Object.keys(o.kinds || {}).forEach(function (k) {
        kinds[k] = (kinds[k] || 0) + o.kinds[k];
        // Amazon's list gives one total per order, not a price per item, so an
        // order's total is shared out evenly over its items.
        spendKinds[k] = (spendKinds[k] || 0) + ((o.total || 0) * o.kinds[k]) / (o.items || 1);
      });
    });
    var daily = Object.keys(days).sort().map(function (k) {
      days[k].spend = cents(days[k].spend);
      return days[k];
    });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    Object.keys(spendKinds).forEach(function (k) { spendKinds[k] = cents(spendKinds[k]); });
    return {
      service: 'amazon',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      orders: sum('orders'),
      items: sum('items'),
      // Items in the window by broad kind: electronics, clothing, books_media,
      // beauty_health, food, toys_sports, home, other. Sorted by keyword, so rough.
      itemsByKind: kinds,
      // US dollars, from each order's total (so it includes tax and shipping).
      spend: cents(sum('spend')),
      spendByKind: spendKinds,
      currency: 'USD',
      activeDays: daily.length,
      daily: daily,
      // Orders per month. Usually the three months Amazon's "past 3 months" view
      // covers (the oldest may be partial); every year on the account when the
      // whole history was asked for, and then "whole" says whether it reached the end.
      history: {
        whole: WHOLE ? !truncated : undefined,
        monthly: Object.keys(months).sort().map(function (m) { return { month: m, orders: months[m].orders, spend: cents(months[m].spend) }; }),
      },
      truncated: truncated,
    };
  }

  async function run() {
    // Once the tab has been sent to another page, do nothing more on this one.
    if (state.started || state.done || state.leaving) return;
    if (location.hostname !== 'www.amazon.com') return;
    // Signed out, Amazon shows its sign-in page on this same site. Wait there.
    if (/^\/ap\//.test(location.pathname)) return;
    var params = new URLSearchParams(location.search);
    var start = Number(params.get('startIndex') || 0);
    var filter = params.get('timeFilter');
    var onOrders = location.pathname === ORDERS_PATH;
    // The stash says which view and page this count sent the tab to. Anything
    // else is a fresh start.
    var stash = readStash();
    var expected = stash && stash.filters[stash.at] === filter && stash.next === start;
    if (!onOrders || !expected) {
      if (onOrders && filter === RECENT && start === 0) stash = null; // The first page of a fresh count.
      else {
        sessionStorage.removeItem(STASH);
        state.leaving = true;
        location.href = pageUrl(RECENT, 0);
        return;
      }
    }
    if (document.readyState !== 'complete') return;
    state.started = true;
    try {
      banner('Reading your Amazon orders...');
      if (!stash) {
        stash = { orders: [], filters: [RECENT], at: 0, next: 0, pages: 0 };
        var years = WHOLE ? yearFilters() : [];
        if (years.length) {
          // The whole history: leave the three-month view and walk the years instead.
          stash.filters = years;
          sessionStorage.setItem(STASH, JSON.stringify(stash));
          state.leaving = true; // The next page loads a fresh copy of this script.
          location.href = pageUrl(years[0], 0);
          return;
        }
      }
      var got = await filled();
      var orders = stash.orders.concat(got.read.filter(Boolean));
      var pages = (stash.pages || 0) + 1;
      var more = got.cards.length >= PER_PAGE && !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a');
      var nextView = stash.at + 1 < stash.filters.length;
      if ((more || nextView) && pages < MAX_PAGES) {
        var next = more
          ? { orders: orders, filters: stash.filters, at: stash.at, next: start + PER_PAGE, pages: pages }
          : { orders: orders, filters: stash.filters, at: stash.at + 1, next: 0, pages: pages };
        sessionStorage.setItem(STASH, JSON.stringify(next));
        if (WHOLE) banner('Reading your Amazon orders: ' + orders.length + ' so far');
        state.leaving = true; // The next page loads a fresh copy of this script.
        location.href = pageUrl(next.filters[next.at], next.next);
        return;
      }
      var usage = finish(orders, more || nextView);
      state.usage = usage;
      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({ url: pageUrl(RECENT, 0), method: 'GET' });
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
