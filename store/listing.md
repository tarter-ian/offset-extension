# Chrome Web Store listing

Text to paste into the Chrome Web Store developer dashboard. Build the zip with
`node store/build.mjs`.

## Store listing tab

**Name**

My Offset: measure my usage

**Summary** (132 characters at most)

Counts how much you use AI, video, food delivery, shopping and ride apps, so My Offset can work out your footprint. Counts only.

**Category**

Tools

**Language**

English

**Description**

My Offset works out the environmental footprint of the things you do online and
through apps, so you can pay to undo it. Most footprint calculators ask you to
guess. This extension measures instead.

When you press Measure on the My Offset site, the extension opens each service you
choose in a separate, minimized window, counts your last 30 days there, sends
the counts to My Offset and closes the window. You stay on the My Offset page.

What it can count:

- ChatGPT, Claude and Gemini: prompts and images per day
- YouTube: videos and hours per day
- Netflix: titles per day
- DoorDash and Uber Eats: orders per day
- Amazon: orders, items by broad kind, and what each order cost
- Uber: rides and miles per day

What it never sends: your chats, video titles, product names, addresses, routes
or passwords. Only counts, dates and, for Amazon, order totals leave each page.

You stay in control:

- It installs with access to no site. The first time you measure a service, it
  asks for that one site. You can allow services one at a time or all at once.
- It runs only when you press Measure, unless you switch on "measure again every 30 days". That is off by default.
- It keeps your last results on your own computer so you do not have to count
  again. One button on the My Offset site deletes them.
- It only works for services you are already signed in to. It never asks for a
  password and never signs in for you.

The code is open source: https://github.com/tarter-ian/offset-extension

## Privacy tab

**Single purpose**

Count how much the user has used a set of online services (AI assistants, video,
food delivery, shopping and ride-hailing) over the last 30 days, and pass those
counts to the My Offset website so it can estimate the user's environmental
footprint.

**Permission justifications**

| Permission | Why it is needed |
| --- | --- |
| `scripting` | To run the counting script in the tab the extension opens on a service the user chose to measure. The script reads the user's own usage history on that page and adds up counts. |
| `alarms` | To check twice a day whether 30 days have passed, for users who turn on "measure again by itself". Off by default. |
| `storage` | To keep the user's last results and day-by-day counts on their own computer, so the site can show them without counting again, and so a ChatGPT count that was cut short can continue. Nothing is stored elsewhere. |
| Host: `chatgpt.com` | Optional, asked for when the user first measures ChatGPT. To count the user's prompts, images and agent tokens. |
| Host: `claude.ai` | Optional, asked for when the user first measures Claude. To count the user's prompts and read the share of their plan limit used. |
| Host: `myactivity.google.com` | Optional, asked for when the user first measures Gemini or YouTube. To count the user's Gemini prompts and YouTube videos from their own Google activity page. |
| Host: `www.netflix.com` | Optional, asked for when the user first measures Netflix. To count titles in the user's viewing activity. |
| Host: `www.doordash.com` | Optional, asked for when the user first measures DoorDash. To count the user's orders. |
| Host: `www.ubereats.com` | Optional, asked for when the user first measures Uber Eats. To count the user's orders. |
| Host: `www.amazon.com` | Optional, asked for when the user first measures Amazon. To count the user's orders and items and read order totals. |
| Host: `riders.uber.com` | Optional, asked for when the user first measures Uber. To count the user's rides and their distance. |
| Content script on the My Offset site | To pass messages between the My Offset web page and the extension: the page's request to measure, and the counts in reply. |

**Remote code**

No. All code is in the package.

**Data usage**

Tick these categories:

- **Web history**: no.
- **User activity**: yes. Counts of the user's activity on the services they choose (for example prompts sent, videos watched, orders placed), by day.
- **Financial and payment information**: yes. Amazon order totals, when the user measures Amazon. No card or account details.
- **Location**: no. Uber ride distance is read, but no addresses or routes.
- **Personal communications**: no. Chat text is counted in the page and never leaves it.
- **Website content**: no.
- **Authentication information**: no.
- **Personally identifiable information**: no.

Certify all three:

- The data is not sold or transferred to third parties, outside the approved use cases.
- The data is not used or transferred for purposes unrelated to the item's single purpose.
- The data is not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL**

https://offset-website.itsian123.workers.dev/data

Check before submitting that this page says, in its own words, what the list
under "Data usage" says. The store compares the two.

## Distribution tab

- Visibility: Public (or Unlisted while testing with a few people)
- Regions: United States

## Screenshots

At least one, 1280 x 800. `store/screenshot-*.png` in this folder are ready to
upload. They show made-up numbers, not a real person's.

## Before each submission

1. Raise `version` in `manifest.json`. The store refuses a version it has seen.
2. If the site has a new address, add it to `SITE_MATCHES` in `store/build.mjs`
   and to `content_scripts.matches` in `manifest.json`.
3. Run `node store/build.mjs` and upload the zip from `dist/`.
