// Offset extension, background worker.
// The Offset site asks for services to be measured. For each one this opens the
// service in a tab, runs the counting script there, hands the counts back to
// the site and closes the tab.
//
// Two ways to ask:
//   measure-all  Every service at once, in a separate minimized window the person
//                never has to look at. A service they are not signed in to is
//                reported as "signed-out" and its tab is closed.
//                With openLogins, its login page is brought to the person
//                instead: the tab moves beside the site, the first such tab is
//                put in front, and each closes itself once it has counted.
//   measure      One service, in a tab brought to the front, so the person can
//                sign in. Counting starts once they have.

const SERVICES = {
  chatgpt: { url: 'https://chatgpt.com/', host: 'chatgpt.com', script: 'providers/chatgpt-usage.js' },
  claude: { url: 'https://claude.ai/new', host: 'claude.ai', script: 'providers/claude-usage.js' },
  youtube: { url: 'https://myactivity.google.com/product/youtube', host: 'myactivity.google.com', script: 'providers/youtube-activity.js' },
  gemini: { url: 'https://myactivity.google.com/product/gemini', host: 'myactivity.google.com', script: 'providers/gemini-activity.js' },
  doordash: { url: 'https://www.doordash.com/orders', host: 'www.doordash.com', script: 'providers/doordash-orders.js' },
  ubereats: { url: 'https://www.ubereats.com/orders', host: 'www.ubereats.com', script: 'providers/ubereats-orders.js' },
  amazon: { url: 'https://www.amazon.com/your-orders/orders?timeFilter=months-3&startIndex=0', host: 'www.amazon.com', script: 'providers/amazon-orders.js' },
  uber: { url: 'https://riders.uber.com/trips', host: 'riders.uber.com', script: 'providers/uber-rides.js' },
  netflix: { url: 'https://www.netflix.com/viewingactivity', host: 'www.netflix.com', script: 'providers/netflix-activity.js' },
};

// Long enough for someone to sign in, including two-step checks.
const TIMEOUT_MS = 10 * 60 * 1000;

// Jobs are kept in session storage, keyed by the measuring tab's id, because
// Chrome stops this worker whenever it is idle (for example during a login).
const key = (tabId) => `job:${tabId}`;
const getJob = async (tabId) => (await chrome.storage.session.get(key(tabId)))[key(tabId)] ?? null;
const setJob = (tabId, job) => chrome.storage.session.set({ [key(tabId)]: job });
const dropJob = (tabId) => chrome.storage.session.remove(key(tabId));

// Counts already made for each chat (numbers per day, no titles or text), kept
// on this computer between runs. See the "remembered" note in the counting scripts.
const memoryKey = (service) => `memory:${service}`;

// The last result for each service and when it was measured, kept on this
// computer so the site can show it at once instead of counting again. Beside it,
// the counts for each day ever measured, so a record builds up that reaches
// further back than any one count does. Totals and dates only, as sent to the site.
const savedKey = (service) => `saved:${service}`;
const KEEP_DAYS = 800;

async function saveResult(service, usage) {
  const measuredAt = new Date().toISOString();
  const old = (await chrome.storage.local.get(savedKey(service)))[savedKey(service)];
  const days = { ...(old && old.days) };
  for (const day of Array.isArray(usage.daily) ? usage.daily : []) {
    if (day && typeof day.date === 'string') days[day.date] = day;
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const date of Object.keys(days)) if (date < cutoff) delete days[date];
  await chrome.storage.local.set({ [savedKey(service)]: { usage, measuredAt, days } });
  return measuredAt;
}

// What the site is given for a saved service: its last result, when that was
// measured, and every day on record, oldest first.
async function savedResult(service) {
  const saved = (await chrome.storage.local.get(savedKey(service)))[savedKey(service)];
  if (!saved || !saved.usage) return null;
  const record = Object.keys(saved.days || {}).sort().map((date) => saved.days[date]);
  return { usage: saved.usage, measuredAt: saved.measuredAt, record };
}

// Tabs this worker is closing itself, so their closing is not reported as the person's doing.
const closing = new Set();

async function finish(tabId, job, message, closeTab = true) {
  if (closeTab) closing.add(tabId);
  await dropJob(tabId);
  chrome.tabs.sendMessage(job.siteTabId, { ...message, requestId: job.requestId, service: job.service }).catch(() => {});
  if (closeTab) chrome.tabs.remove(tabId).catch(() => {});
  // A tab the person was working in hands over to the next login that is
  // waiting, or goes back to the site; background ones never took the screen.
  if (job.front) {
    const next = await waitingLogin(job.siteTabId);
    chrome.tabs.update(next ?? job.siteTabId, { active: true }).catch(() => {});
  }
}

const newJob = (service, front, requestId, siteTab, openLogins = false) => ({
  service,
  front,
  requestId,
  siteTabId: siteTab.id,
  siteWindowId: siteTab.windowId,
  openLogins,
  startedAt: Date.now(),
});

// The tab of another service still waiting for this site's person to sign in, if any.
async function waitingLogin(siteTabId) {
  const all = await chrome.storage.session.get(null);
  for (const [k, job] of Object.entries(all)) {
    if (k.startsWith('job:') && job.front && job.siteTabId === siteTabId) return Number(k.slice(4));
  }
  return null;
}

// A background tab found its service signed out. Either report that, or, when
// the site asked for it, bring the login page to the person: the tab moves
// beside the site and, unless another login is already in front, takes the screen.
async function signedOut(tabId, job) {
  if (!job.openLogins) {
    await finish(tabId, job, { type: 'error', error: 'signed-out' });
    return;
  }
  const alreadyWaiting = await waitingLogin(job.siteTabId);
  await setJob(tabId, { ...job, front: true, startedAt: Date.now() });
  try {
    await chrome.tabs.move(tabId, { windowId: job.siteWindowId, index: -1 });
    if (alreadyWaiting === null) {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(job.siteWindowId, { focused: true });
    }
  } catch (e) {
    await finish(tabId, { ...job, front: false }, { type: 'error', error: 'signed-out' });
    return;
  }
  chrome.tabs.sendMessage(job.siteTabId, { type: 'login-needed', service: job.service, requestId: job.requestId }).catch(() => {});
}

// One service in a tab beside the site, in front, so the person can sign in.
async function startInFront(service, requestId, siteTab) {
  const tab = await chrome.tabs.create({ url: SERVICES[service].url, active: true, windowId: siteTab.windowId });
  await setJob(tab.id, newJob(service, true, requestId, siteTab));
}

// Every service in a window of its own, minimized, so the site keeps the
// screen and the keyboard. The window goes away when its last tab closes.
async function startInBackground(services, requestId, siteTab, openLogins) {
  const urls = services.map((s) => SERVICES[s].url);
  let tabs;
  try {
    const win = await chrome.windows.create({ url: urls, focused: false, state: 'minimized' });
    tabs = win.tabs;
  } catch (e) {
    tabs = null;
  }
  if (!tabs || tabs.length !== services.length) {
    // No separate window to be had; use background tabs beside the site instead.
    if (tabs) for (const t of tabs) chrome.tabs.remove(t.id).catch(() => {});
    tabs = [];
    for (const url of urls) tabs.push(await chrome.tabs.create({ url, active: false, windowId: siteTab.windowId }));
  }
  for (let i = 0; i < services.length; i++) await setJob(tabs[i].id, newJob(services[i], false, requestId, siteTab, openLogins));
}

async function inject(tabId, job) {
  const target = { tabId };
  try {
    // Receives the counts inside the extension's own world and passes them here.
    await chrome.scripting.executeScript({ target, files: ['provider-relay.js'] });
    // The counting scripts report through window.Reclaim; give them one that talks to the relay.
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['provider-shim.js'] });
    // What earlier runs counted for this service, so unchanged chats are not read again.
    const remembered = (await chrome.storage.local.get(memoryKey(job.service)))[memoryKey(job.service)] || {};
    await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: (service, data) => {
        window.__offsetCache = window.__offsetCache || {};
        window.__offsetCache[service] = data;
      },
      args: [job.service, remembered],
    });
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: [SERVICES[job.service].script] });
  } catch (e) {
    // The tab moved on before the scripts landed. The next page load tries again.
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete') return;
  const job = await getJob(tabId);
  if (!job) return;
  if (Date.now() - job.startedAt > TIMEOUT_MS) {
    await finish(tabId, job, { type: 'error', error: 'timeout' });
    return;
  }
  // tab.url is only visible on the hosts this extension may read, so a login
  // page on another host shows up here as no url at all.
  const onService = !!tab.url && new URL(tab.url).host === SERVICES[job.service].host;
  if (onService) await inject(tabId, job);
  else if (!job.front) await signedOut(tabId, job);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (closing.delete(tabId)) return;
  const job = await getJob(tabId);
  if (job) await finish(tabId, job, { type: 'error', error: 'closed' }, false);
});

// The extension is installed with access to no site at all. It asks for each
// service's site the first time that service is measured, on its own page
// (permit.html), because Chrome only lets an extension page ask.
const origin = (service) => `https://${SERVICES[service].host}/*`;
const allowed = (service) => chrome.permissions.contains({ origins: [origin(service)] });

const PERMIT_PAGE = chrome.runtime.getURL('permit.html');
const askKey = (id) => `ask:${id}`;

function begin(services, front, requestId, siteTab, openLogins) {
  if (!services.length) return Promise.resolve();
  return front ? startInFront(services[0], requestId, siteTab) : startInBackground(services, requestId, siteTab, openLogins);
}

function tellSite(siteTabId, message) {
  chrome.tabs.sendMessage(siteTabId, message).catch(() => {});
}

// If the person closes the permission window without answering, nothing was allowed.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const all = await chrome.storage.session.get(null);
  for (const [k, ask] of Object.entries(all)) {
    if (!k.startsWith('ask:') || ask.windowId !== windowId) continue;
    await chrome.storage.session.remove(k);
    for (const service of ask.missing) tellSite(ask.siteTabId, { type: 'error', error: 'denied', service, requestId: ask.requestId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  // From the Offset site: throw away everything kept between runs.
  if (message.type === 'forget') {
    (async () => {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('memory:') || k.startsWith('saved:')));
      sendResponse({ ok: true });
    })();
    return true;
  }

  // From the Offset site: the saved result of every service that has one. Opens nothing.
  if (message.type === 'results') {
    (async () => {
      const results = {};
      for (const service of Object.keys(SERVICES)) {
        const saved = await savedResult(service);
        if (saved) results[service] = saved;
      }
      sendResponse({ ok: true, results });
    })();
    return true;
  }

  // From the Offset site, through site-bridge.js.
  if (message.type === 'measure' || message.type === 'measure-all') {
    const front = message.type === 'measure';
    const wanted = front ? [message.service] : message.services || Object.keys(SERVICES);
    const services = wanted.filter((s) => Object.hasOwn(SERVICES, s));
    if (!services.length) {
      sendResponse({ ok: false, error: 'unknown-service' });
      return;
    }
    (async () => {
      // With maxAgeHours, a service measured that recently is answered from
      // what is saved, and no tab is opened for it.
      const maxAgeMs = Number(message.maxAgeHours) > 0 ? Number(message.maxAgeHours) * 3600000 : 0;
      const fresh = [];
      if (maxAgeMs) {
        for (const service of services) {
          const saved = await savedResult(service);
          if (saved && Date.now() - Date.parse(saved.measuredAt) < maxAgeMs && !saved.usage.failedConversations) {
            fresh.push(service);
            tellSite(sender.tab.id, { type: 'usage', service, requestId: message.requestId, ...saved, saved: true });
          }
        }
      }
      const wanted = services.filter((s) => !fresh.includes(s));
      const ok = await Promise.all(wanted.map(allowed));
      const ready = wanted.filter((s, i) => ok[i]);
      const missing = wanted.filter((s, i) => !ok[i]);
      const openLogins = !front && message.openLogins === true;
      await begin(ready, front, message.requestId, sender.tab, openLogins);
      if (missing.length) {
        const id = crypto.randomUUID();
        // Saved before the window opens, so the page finds it however fast it loads.
        const ask = { missing, front, openLogins, requestId: message.requestId, siteTabId: sender.tab.id, siteWindowId: sender.tab.windowId, windowId: null };
        await chrome.storage.session.set({ [askKey(id)]: ask });
        const win = await chrome.windows.create({ url: `${PERMIT_PAGE}?id=${id}`, type: 'popup', width: 480, height: 620, focused: true });
        await chrome.storage.session.set({ [askKey(id)]: { ...ask, windowId: win.id } });
      }
      sendResponse({ ok: true, services, needsPermission: missing });
    })();
    return true;
  }

  // From permit.html, after the person answered Chrome's own permission prompt.
  if (message.type === 'permitted' && sender.url && sender.url.startsWith(PERMIT_PAGE)) {
    (async () => {
      const ask = (await chrome.storage.session.get(askKey(message.id)))[askKey(message.id)];
      if (!ask) return;
      await chrome.storage.session.remove(askKey(message.id));
      // Measure what the person picked, and only where Chrome now reports access.
      const picked = Array.isArray(message.services) ? message.services : [];
      const ok = await Promise.all(ask.missing.map(allowed));
      const granted = ask.missing.filter((s, i) => ok[i] && picked.includes(s));
      const siteTab = { id: ask.siteTabId, windowId: ask.siteWindowId };
      for (const service of ask.missing) {
        if (!granted.includes(service)) tellSite(ask.siteTabId, { type: 'error', error: 'denied', service, requestId: ask.requestId });
      }
      // Lets the site move these from "waiting for permission" to "counting".
      for (const service of granted) tellSite(ask.siteTabId, { type: 'counting', service, requestId: ask.requestId });
      await begin(granted, ask.front, ask.requestId, siteTab, ask.openLogins);
      chrome.windows.remove(ask.windowId).catch(() => {});
      if (!ask.front) chrome.windows.update(ask.siteWindowId, { focused: true }).catch(() => {});
    })();
    return;
  }

  // From a measuring tab, through provider-relay.js.
  (async () => {
    const tabId = sender.tab.id;
    const job = await getJob(tabId);
    if (!job) return;
    if (message.type === 'done' && message.data && message.data.service === job.service) {
      // Per-chat counts stay in the extension, on this computer. The site gets the totals only.
      const { remember, ...usage } = message.data;
      if (remember && typeof remember === 'object') await chrome.storage.local.set({ [memoryKey(job.service)]: remember });
      const measuredAt = await saveResult(job.service, usage);
      const saved = await savedResult(job.service);
      await finish(tabId, job, { type: 'usage', usage, measuredAt, record: saved ? saved.record : [] });
    } else if (message.type === 'progress' && message.data && message.data.service === job.service) {
      // A running estimate while a slow count is still under way.
      chrome.tabs.sendMessage(job.siteTabId, { type: 'progress', service: job.service, requestId: job.requestId, usage: message.data }).catch(() => {});
    } else if (message.type === 'idle' && !job.front) {
      // The service's page loaded but counting never began: not signed in.
      await signedOut(tabId, job);
    }
  })();
});
