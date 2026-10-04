# TubeBulk — Bulk YouTube Description Editor

**What it does:** Find & replace, prepend, or append text across all your YouTube video descriptions in one go. Update affiliate links, sponsor mentions, and CTAs across your whole library in minutes instead of hours.

**Why it sells:** TubeBuddy locks bulk description tools behind its $24–33/mo Legend plan. TubeBulk does the one job creators actually need for a **$29 one-time** payment (free for the first 5 videos).

## Owner setup (your hand, ~20 min)

### 1. Google Cloud — YouTube Data API (required)
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project (e.g. `tubebulk`).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** → User type **External** → fill app name `TubeBulk`, support email, developer contact. Add scope `https://www.googleapis.com/auth/youtube.force-ssl`. Add yourself as a test user (or publish the app later).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Chrome** → paste your extension ID (from `chrome://extensions` in developer mode after loading unpacked — the 32-char ID under the extension name). Create.
5. Copy the client ID into `manifest.json` → `oauth2.client_id` (replace `YOUR_GOOGLE_OAUTH_CLIENT_ID`).

> ⚠️ Quota: `videos.update` costs 50 units; default daily quota is 10,000 units ≈ **~200 video updates/day**. Enough for most channels. Request a quota increase in Cloud Console if needed.

### 2. ExtensionPay — payments (required for the $29 paywall)
1. Sign up at [extensionpay.com](https://extensionpay.com/) and **register an extension** (free to start; they take a small % per sale).
2. Set the price to **$29 one-time**.
3. Copy your ExtensionPay **extension ID** and replace `'tubebulk'` in **both** `background.js` (`EXTPAY_EXTENSION_ID`) and `popup.js`.

### 3. Load & test
1. `chrome://extensions` → Developer mode → **Load unpacked** → select this folder.
2. Click the TubeBulk icon → **Connect YouTube channel** → pick the Google account that owns your channel → Allow.
3. Select videos → try Find & replace → **Preview changes** → Apply (first 5 videos free).

### 4. Publish
1. Zip the folder contents (not the folder itself): `manifest.json`, `popup.html`, `styles.css`, `popup.js`, `background.js`, `ExtPay.js`, `icons/`.
2. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → New item → upload ZIP → fill listing (description below), upload screenshots, set **PRIVACY.md** as privacy policy URL (host it, e.g. GitHub Pages), submit.
3. One-time $5 developer registration if you haven't paid it before (you have — Old Chrome Simulator is live).

## Suggested store listing copy (SEO-optimized)

**Title:** Bulk YouTube Description Editor – TubeBulk
*(keywords first — the store search weights the title heavily)*

**Summary (132 chars, shows in search results):** Bulk edit YouTube video descriptions: find & replace links, sponsors and CTAs across all your videos at once.

**Search keywords to weave into the description:** bulk edit youtube descriptions, youtube description updater, bulk description editor, find and replace youtube, update affiliate links youtube, youtube bulk tools, description manager

**Description:**
> Still updating video descriptions one by one? TubeBulk edits all your YouTube video descriptions in bulk:
>
> • **Find & replace** — swap an old affiliate or sponsor link across every video instantly
> • **Prepend / append** — add a CTA, disclaimer or link block to your whole library
> • **Preview before you apply** — see exactly what changes, video by video
> • **Safe** — dry-run first; titles, privacy settings and everything else stay untouched
>
> Free for your first 5 videos. **$29 one-time** unlocks unlimited bulk edits — no subscription, no credits that expire.
>
> Built for YouTubers who'd rather make videos than do admin.

## File map
| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (fill in OAuth client ID) |
| `popup.html` / `styles.css` / `popup.js` | Extension popup UI |
| `background.js` | Service worker: OAuth, YouTube API, ExtensionPay |
| `ExtPay.js` | ExtensionPay library (bundled, MV3-safe) |
| `icons/` | Store icons |
| `PRIVACY.md` | Privacy policy for the store listing |
