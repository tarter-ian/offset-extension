// Counting script: Amazon orders, last 30 days, plus orders per month for the last three.
// Reads the person's own "Your Orders" pages as Amazon shows them, ten orders at a
// time. Each item is sorted into a broad kind (electronics, clothing and so on) in
// the page. Only counts and dates leave the page; no product names, prices or addresses.
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
      kinds: kinds,
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
    var kinds = {};
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
      Object.keys(o.kinds || {}).forEach(function (k) {
        kinds[k] = (kinds[k] || 0) + o.kinds[k];
      });
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
      // Items in the window by broad kind: electronics, clothing, books_media,
      // beauty_health, food, toys_sports, home, other. Sorted by keyword, so rough.
      itemsByKind: kinds,
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
