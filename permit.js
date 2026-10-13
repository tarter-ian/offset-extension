// The permission window. Lists the services the site asked to measure that the
// extension cannot read yet, and asks Chrome for the ones the person picks.

const SERVICES = {
  chatgpt: { name: 'ChatGPT', site: 'chatgpt.com', reads: 'How many prompts and images you sent each day.' },
  claude: { name: 'Claude', site: 'claude.ai', reads: 'How many prompts you sent each day, and how much of your plan limit is used.' },
  gemini: { name: 'Gemini', site: 'myactivity.google.com', reads: 'How many Gemini prompts Google recorded each day.' },
  youtube: { name: 'YouTube', site: 'myactivity.google.com', reads: 'How many videos you watched each day and for how long.' },
  doordash: { name: 'DoorDash', site: 'www.doordash.com', reads: 'How many orders you placed each day, how many items, and what each order cost. Not what you ordered.' },
  ubereats: { name: 'Uber Eats', site: 'www.ubereats.com', reads: 'How many orders you placed each day, how many items, and what each order cost. Not what you ordered.' },
  amazon: { name: 'Amazon', site: 'www.amazon.com', reads: 'How many orders and items each day, what each order cost, and what kind of thing each item was (such as electronics or clothing). Not the products themselves.' },
  uber: { name: 'Uber', site: 'riders.uber.com', reads: 'How many rides you took each day, how far, and what each cost. Not where you went.' },
  netflix: { name: 'Netflix', site: 'www.netflix.com', reads: 'How many titles you watched each day. Not which ones.' },
};

const id = new URLSearchParams(location.search).get('id');
const list = document.getElementById('list');
const note = document.getElementById('note');
const buttons = ['all', 'some', 'none'].map((b) => document.getElementById(b));

const ask = (await chrome.storage.session.get(`ask:${id}`))[`ask:${id}`];
const missing = ask ? ask.missing.filter((s) => SERVICES[s]) : [];

// A whole-history count reads further back and takes longer; say so before the person agrees.
if (ask && ask.history) {
  document.getElementById('intro').textContent =
    'This time it looks back through your whole history on each one, not just the last 30 days, and adds things up by month: how many prompts, videos, orders or rides. It takes a few minutes. Untick any you would rather leave out.';
}

if (!missing.length) {
  note.textContent = 'This request is no longer open. You can close this window.';
  buttons.forEach((b) => (b.disabled = true));
}

for (const service of missing) {
  const s = SERVICES[service];
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = true;
  box.value = service;
  const text = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = `${s.name} (${s.site})`;
  const reads = document.createElement('span');
  reads.className = 'reads';
  reads.textContent = s.reads;
  text.append(name, reads);
  label.append(box, text);
  list.append(label);
}

// Gemini and YouTube are both read from Google's activity site, so Chrome treats them as one.
if (missing.includes('gemini') && missing.includes('youtube')) {
  note.textContent = 'Gemini and YouTube are both read from myactivity.google.com, so allowing one allows both.';
}

async function allow(services) {
  buttons.forEach((b) => (b.disabled = true));
  if (services.length) {
    const origins = [...new Set(services.map((s) => `https://${SERVICES[s].site}/*`))];
    // Chrome shows its own prompt here. It must be started by this click.
    await chrome.permissions.request({ origins }).catch(() => false);
  }
  // The background worker checks what Chrome actually granted and closes this window.
  await chrome.runtime.sendMessage({ type: 'permitted', id, services });
}

document.getElementById('all').addEventListener('click', () => allow(missing));
document.getElementById('some').addEventListener('click', () =>
  allow([...list.querySelectorAll('input:checked')].map((box) => box.value)),
);
document.getElementById('none').addEventListener('click', () => allow([]));
