// Counting script: Uber rides, last 30 days, plus rides per month before that.
// Reads the person's own trip list and, for recent trips, each trip's distance,
// through the same requests the "My Trips" page makes. Only counts, distances and
// dates leave the page; no addresses, routes, drivers or prices.
(function () {
  if (window.__offsetUberRides) return;
  window.__offsetUberRides = { started: false, done: false };
  var state = window.__offsetUberRides;

  var WINDOW_DAYS = 30;
  var PAGE = 30;
  var MAX_PAGES = 40;
  var BATCH = 3;
  var TRIPS_URL = 'https://riders.uber.com/trips';
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  var LIST_QUERY =
    'query Activities($limit: Int = 5, $nextPageToken: String, $orderTypes: [RVWebCommonActivityOrderType!] = [RIDES, TRAVEL], ' +
    '$profileType: RVWebCommonActivityProfileType = PERSONAL) { activities { past(limit: $limit, nextPageToken: $nextPageToken, ' +
    'orderTypes: $orderTypes, profileType: $profileType) { activities { uuid subtitle description } nextPageToken } } }';
  var TRIP_QUERY =
    'query GetTrip($tripUUID: String!) { getTrip(tripUUID: $tripUUID) { trip { beginTripTime dropoffTime status } ' +
    'receipt { distance distanceLabel duration } } }';

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

  async function gql(operationName, query, variables) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var res = await fetch('/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
        body: JSON.stringify({ operationName: operationName, variables: variables, query: query }),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      var body = await res.json();
      return body && body.data ? body.data : null;
    }
    return null;
  }

  async function listPage(token) {
    var data = await gql('Activities', LIST_QUERY, { limit: PAGE, nextPageToken: token || null, orderTypes: ['RIDES', 'TRAVEL'], profileType: 'PERSONAL' });
    return data && data.activities && data.activities.past ? data.activities.past : null;
  }

  // "Oct 9 • 12:44 PM" to a month number (0-11), or -1. The list gives no year.
  function monthOf(subtitle) {
    var m = String(subtitle || '').trim().slice(0, 3).toLowerCase();
    return MONTHS.indexOf(m);
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
    var truncated = false;
    var failedTrips = 0;

    // The list runs newest first with no year on each line. Walking back, the
    // year drops by one each time the month jumps forward (Jan back to Dec).
    var year = new Date(now).getFullYear();
    var lastMonth = new Date(now).getMonth();
    var inWindow = true;
    var page = first;

    for (var p = 0; p < MAX_PAGES && page; p++) {
      var rides = (page.activities || []).filter(function (a) {
        return a && a.uuid && !/cancel|unfulfilled/i.test(String(a.description || ''));
      });
      rides.forEach(function (a) {
        var month = monthOf(a.subtitle);
        if (month < 0) return;
        if (month > lastMonth) year--;
        lastMonth = month;
        var key = year + '-' + pad(month + 1);
        months[key] = (months[key] || 0) + 1;
      });

      // Distances need one request per trip, so ask only while trips are recent.
      for (var start = 0; inWindow && start < rides.length; start += BATCH) {
        banner('Reading your Uber trips...');
        var group = rides.slice(start, start + BATCH);
        var trips = await Promise.all(
          group.map(function (a) {
            return gql('GetTrip', TRIP_QUERY, { tripUUID: a.uuid }).catch(function () { return null; });
          }),
        );
        for (var i = 0; i < trips.length; i++) {
          var got = trips[i] && trips[i].getTrip;
          var trip = got && got.trip;
          var at = trip ? Date.parse(trip.beginTripTime) : NaN;
          if (!at) {
            failedTrips++;
            continue;
          }
          if (at < since) {
            inWindow = false;
            continue;
          }
          if (trip.status !== 'COMPLETED') continue;
          var receipt = got.receipt || {};
          var distance = parseFloat(receipt.distance) || 0;
          var miles = /kilomet|km/i.test(String(receipt.distanceLabel || '')) ? distance / 1.609344 : distance;
          var end = Date.parse(trip.dropoffTime);
          var minutes = end > at ? (end - at) / 60000 : parseFloat(receipt.duration) || 0;
          var date = localDate(new Date(at));
          var day = days[date] || (days[date] = { date: date, rides: 0, miles: 0, minutes: 0 });
          day.rides++;
          day.miles += miles;
          day.minutes += minutes;
        }
      }

      if (!page.nextPageToken) break; // The whole trip list has been read.
      if (p === MAX_PAGES - 1) {
        truncated = true;
        break;
      }
      await sleep(200);
      page = await listPage(page.nextPageToken);
      if (!page) truncated = true;
    }

    var round1 = function (n) { return Math.round(n * 10) / 10; };
    var daily = Object.keys(days).sort().map(function (k) {
      var d = days[k];
      return { date: d.date, rides: d.rides, miles: round1(d.miles), minutes: Math.round(d.minutes) };
    });
    var sum = function (key) {
      return daily.reduce(function (t, d) { return t + d[key]; }, 0);
    };
    var monthly = Object.keys(months).sort().map(function (m) { return { month: m, rides: months[m] }; });
    return {
      service: 'uber',
      windowDays: WINDOW_DAYS,
      collectedAt: new Date(now).toISOString(),
      rides: sum('rides'),
      miles: round1(sum('miles')),
      minutes: sum('minutes'),
      activeDays: daily.length,
      daily: daily,
      // Every ride the account has taken, by month. Months come from the trip
      // list, which shows no year, so the year is worked out by walking back.
      history: { firstRide: monthly.length ? monthly[0].month : null, monthly: monthly },
      truncated: truncated,
      failedTrips: failedTrips,
    };
  }

  async function run() {
    if (state.started || state.done) return;
    // Signed-out visitors are sent to Uber's login site, where this does nothing.
    if (location.hostname !== 'riders.uber.com') return;
    var first = await listPage(null).catch(function () { return null; });
    if (!first) return; // Not signed in, or not ready yet; the poll below tries again.
    if (state.started || state.done) return;
    state.started = true;
    try {
      banner('Reading your Uber trips. This takes a moment.');
      var usage = await collect(first);
      state.usage = usage;
      if (window.Reclaim && typeof window.Reclaim.updatePublicData === 'function') {
        window.Reclaim.updatePublicData(usage);
      }
      banner('Done.');
      if (window.Reclaim && typeof window.Reclaim.requestClaim === 'function') {
        await window.Reclaim.requestClaim({ url: TRIPS_URL, method: 'GET' });
      }
      state.done = true;
    } catch (e) {
      state.error = String((e && e.message) || e);
      state.started = false;
      state.failures = (state.failures || 0) + 1;
      banner("We couldn't read your Uber trips. Trying again...");
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
