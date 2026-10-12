# Offset browser extension

Measures how much a person uses ChatGPT, Claude, Gemini, YouTube, Netflix, DoorDash, Uber Eats, Amazon and Uber, so the
site can work out their footprint from real numbers instead of an estimate.

The person installs it once. After that the site can ask it to measure, and it
does the rest: it opens each service in a separate minimized window, counts the
last 30 days there, hands the counts to the site and closes the window. Only counts and
dates leave the service's page. No chat text, titles or video ids.

It is installed with access to no site. The first time a service is measured, a
small window lists what would be read and asks the person to allow it, one
service at a time or all at once.

Chrome and Edge on computers only. It has no effect on phones.

## Try it

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and choose this folder (the one that holds `manifest.json`).
2. Run `node demo/serve.mjs` and open <http://localhost:5173>.
3. Press **Measure everything**, or **Measure** on one row.

After changing any file here, press the reload arrow on the extension's card in
`chrome://extensions`, then reload the page that talks to it.

## How the site talks to it

`site-bridge.js` runs on the site's own pages (the addresses under
`content_scripts.matches` in `manifest.json`) and relays `window.postMessage`
messages on the page's origin.

| Page sends (`source: 'offset-site'`) | Meaning |
| --- | --- |
| `{ type: 'ping' }` | Is the extension installed? |
| `{ type: 'forget' }` | Delete the per-chat counts the extension keeps between runs. Answered with `{ type: 'forgotten' }`. |
| `{ type: 'measure-all', requestId, services? }` | Measure every service, or the ones listed, in a separate minimized window. |
| `{ type: 'measure-all', ..., openLogins: true }` | As above, and the login page of each signed-out service is brought to the person: its tab moves beside the site, the first is put in front, and each closes itself once it has counted. Answered with `login-needed` for those services. Ask only for services the person says they use, or a new visitor gets a tab for every service. |
| `{ type: 'measure', service, requestId }` | Measure one service in a front tab, so the person can sign in. |

| Extension sends (`source: 'offset-extension'`) | Meaning |
| --- | --- |
| `{ type: 'ready', version }` | Installed. Sent on page load and in answer to `ping`. |
| `{ type: 'started', requestId, services, needsPermission }` | Under way. `needsPermission` lists services the person is being asked to allow first. |
| `{ type: 'counting', service, requestId }` | The person allowed this service and its count has begun. |
| `{ type: 'login-needed', service, requestId }` | With `openLogins`: this service's login page is now open in a tab beside the site. `usage` follows once the person signs in; `error: 'closed'` if they close the tab. |
| `{ type: 'usage', service, requestId, usage }` | One service's counts. |
| `{ type: 'error', service, requestId, error }` | `signed-out`, `denied`, `closed`, `timeout`, `reload-page` (the extension was reloaded after the page loaded; refresh the page) or `unavailable`. |

`demo/index.html` is a working example.

## What `usage` holds

Every service: `service`, `windowDays` (30), `collectedAt`, `activeDays`,
`daily[]`, `truncated`.

| Service | Also | `daily[]` items |
| --- | --- | --- |
| `chatgpt` | `prompts`, `reasoningResponses`, `images`, `conversations`, `planType`, `failedConversations`, `reusedConversations`, `history` | `{ date, prompts, reasoning, images }` |
| `claude` | `prompts`, `reasoningResponses`, `toolCalls`, `conversations`, `rateLimitTier`, `weeklyLimitUsedPercent`, `fiveHourLimitUsedPercent`, `failedConversations`, `history` | `{ date, prompts, reasoning, toolCalls }` |
| `gemini` | `prompts` | `{ date, prompts }` |
| `doordash` | `orders`, `deliveries`, `pickups`, `groceryOrders`, `items`, `history` | `{ date, orders, deliveries, pickups, groceryOrders, items }` |
| `ubereats` | `orders`, `deliveries`, `pickups`, `items`, `history` | `{ date, orders, deliveries, pickups, items }` |
| `amazon` | `orders`, `items`, `itemsByKind`, `history` | `{ date, orders, items }` |
| `uber` | `rides`, `miles`, `minutes`, `history`, `failedTrips` | `{ date, rides, miles, minutes }` |
| `netflix` | `titles`, `titlesEver`, `unreadRows` | `{ date, titles }` |
| `youtube` | `videos`, `shorts`, `watchedHours` | `{ date, videos, shorts, hours }` |

Things to know when using these numbers:

- Claude counts cover chats on claude.ai. Claude Code and other apps on the same
  plan appear only in `weeklyLimitUsedPercent`.
- Gemini counts items in Gemini Apps Activity, which the person must have turned
  on. Image and video requests are not told apart from chat.
- YouTube is read from the person's YouTube history in Google My Activity, which
  they must have turned on. `hours` is each video's length times the share
  watched, held to the time until the next video started, so a long video left
  marked as fully watched cannot count for hours. An item with no length (mostly
  Shorts and ads) counts for 45 seconds at most. `videos` are over a minute
  long; everything else is under `shorts`.
- ChatGPT has no message total, so every chat from the last 30 days has to be
  read, and ChatGPT refuses reads past an allowance that refills slowly. When
  `failedConversations` is above zero the totals are too low: show the result
  as incomplete and offer to measure again later. Each run picks up where the
  last one stopped (see below), so a few tries complete it.
- ChatGPT and Claude also send `history`: `{ firstChat, chats, chatsBeforeWindow,
  months: { "2024-03": 12, ... }, complete }`, the chats the account still has
  by the month each was started. It comes from the chat list alone (no chat is
  opened), so it counts chats, not prompts, and deleted chats are missing.
  `complete` is false when the list was longer than 5,000 chats. `history` is
  null when the list could not be read.
- The numbers are measured in the person's own browser. Nothing proves them.

## What the extension remembers

For ChatGPT it keeps, per chat, the counts it made (prompts, reasoning answers
and images per day) and when that chat last changed. A chat that has not changed
is not read again. This is what lets a run that ChatGPT cut short be finished by
the next one, and makes a monthly re-measure read only that month's chats.

It holds numbers only, never titles or text. It stays in the extension's own
storage on the person's computer and is never sent to the site. The site can
have it deleted with a `forget` message, and removing the extension deletes it.

## How it is put together

| File | Runs in | Job |
| --- | --- | --- |
| `background.js` | Extension worker | Opens the tabs, injects the scripts, returns the counts, closes the tabs. |
| `site-bridge.js` | The site's pages | Relays messages between the page and the worker. |
| `permit.html`, `permit.js` | Its own small window | Asks the person which services to allow. Chrome only lets an extension page ask. |
| `provider-shim.js` | The service's page | Gives the counting scripts the `window.Reclaim` they report through. |
| `provider-relay.js` | The service's tab | Passes the counts from the page to the worker. |
| `providers/*.js` | The service's page | One counting script per service. |

The counting scripts began as Reclaim providers (the YouTube one was since rewritten), which is
why they report through `window.Reclaim`. They read endpoints and page data the
services do not document, so one can stop working when its service changes.

## Before it is released

- Add the site's final domain to `content_scripts.matches` in `manifest.json`.
- Add icons.
- Submit it to the Chrome Web Store.

## Licence

MIT. See `LICENSE`.

## Food delivery

DoorDash and Uber Eats return orders, not energy. A delivery is a courier trip;
a pickup is not. `items` is how many things were in the orders. `history` holds
`firstOrder` and `monthly[]` of `{ month, orders }` for every order the account
has made, which is cheap to read because both sites list all past orders.
Cancelled orders are left out. No restaurant, item name, price or address leaves
the page.

## Amazon

Amazon returns orders and items, and `itemsByKind`: how many of the items fall
under `electronics`, `clothing`, `books_media`, `beauty_health`, `food`,
`toys_sports`, `home` or `other`. Each item is sorted in the page from its name
by keyword, so the split is rough, and only the tally leaves. It does not return
what was bought. It is read from the
"Your Orders" pages as Amazon shows them, ten orders at a time, so the tab moves
through a few pages while it counts. `history.monthly` covers only the three
months of Amazon's "past 3 months" view, and the oldest of them may be partial.
Amazon gives the day an order was placed, not the time. Cancelled orders are
left out; returned ones are not. No product name, price or address leaves the
page.

## Uber

Uber returns rides, miles and minutes per day. The trip list is one request, but
each trip's distance is one request more, so distances are read only for trips
in the last 30 days. `history.monthly` counts every ride the account has
taken, by month; the list shows no year, so the year is worked out by walking
back through it. Distances are converted to miles. Cancelled trips are left out.
No address, route, driver or price leaves the page.

## Netflix

Netflix returns titles per day: one for each episode or film started on the
profile that is active. Netflix gives no watch time, so the site has to assume a
length per title. It presses the page's "Show More" button until the list
reaches back 30 days. `titlesEver` is the size of that profile's whole history.
No title leaves the page.
