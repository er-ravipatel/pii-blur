# 🔒 PII Blur

A Chrome extension that blurs personal information on any website — names, profile photos, addresses, and input fields — **before the content appears on screen**.

Blur rules are saved **per page and per domain**, so the right elements are blurred automatically every time you visit.

---

## Who is it for?

Anyone who works with sensitive personal data on screen and needs to share their screen, record a video, or take a screenshot without exposing private information.

**Common use cases:**
- **Screen recording tutorials** — record a portal walkthrough without revealing your username, address, or profile photo
- **Support tickets & bug reports** — capture a screenshot to send to your IT team without exposing PII
- **HR & finance teams** — share your screen during a meeting while browsing employee or customer records
- **Developers & testers** — demo a live application without showing real user data
- **Anyone privacy-conscious** — blur sensitive fields on banking, healthcare, or government portals before sharing your screen

---

## What does it do?

PII Blur lets you **click on any element on any webpage** and it will be blurred — permanently. On every future visit to that page the element is blurred before it even appears on screen.

You can blur:
- **Your name, username, or display name** shown on a profile or dashboard
- **Your profile photo or avatar**
- **Your address, phone number, or email** shown on an account page
- **Login input fields** so credentials are never visible during a recording
- **Any other text, image, or field** you want to keep private

Each blurred element is:
- **Matched precisely** — text is matched by its exact value, images by their `alt` attribute, so only that specific element is blurred, not every similar element on the page
- **Saved per page** — blurs on `/login` never bleed into `/profile`
- **Adjustable** — each element has its own blur intensity slider (2px subtle → 20px fully unreadable)

---

## How it works

### Blur application

| Element type | How it's identified | Blur mechanism |
|---|---|---|
| Text (`span`, `div`, `p` …) | Exact `textContent` match | JavaScript + MutationObserver |
| Image (`img`) | Exact `alt` / `aria-label` match | JavaScript + MutationObserver |
| Input / Textarea | Structural position (`nth-child` CSS path) | CSS `<style>` tag |

### Zero-delay rendering

Most extensions apply blurs after the page loads — causing a visible flash of the unblurred content. PII Blur avoids this with a two-phase approach:

1. **Phase 1 — Synchronous (0ms):** On every page load, saved blur rules are read from `localStorage` and a `<style>` tag is injected at the very top of `<head>` before the browser renders anything.
2. **Phase 2 — Async (~5ms):** `chrome.storage.local` is queried to verify and refresh the cache. If anything changed, blurs are updated.

### Dynamic content

A `MutationObserver` watches the entire document from `document_start`. As elements are added to the DOM (lazy loading, infinite scroll, JavaScript frameworks), matching elements are blurred immediately — before they scroll into view.

### SPA navigation

For single-page apps (React, Vue, Angular), the extension intercepts `pushState` and `replaceState` calls. When the URL path changes, the correct set of blurs for the new page is applied instantly without a full page reload.

### Per-page, per-domain config

Blur configurations are scoped to the exact URL path:

```
facebook.com/login     →  blurs: email input, password input
facebook.com/profile   →  blurs: profile photo, display name, address
facebook.com/feed      →  blurs: (none configured)
```

Blurs never cross page boundaries accidentally.

---

## Install from Chrome Web Store

> *(Link will be added once published)*

---

## Install manually (Developer mode)

1. Clone or download this repo
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** → select the `pii-blur` folder
5. Pin the 🔒 icon to your toolbar

---

## Usage

### Step 1 — Select elements to blur

1. Visit any page you want to configure
2. Click the **🔒 PII Blur** icon in your Chrome toolbar
3. Click **"Select element to blur"** — the popup closes and your cursor becomes a crosshair
4. Hover over the page — a **red dashed outline** highlights what you're about to select
5. Click the element → it blurs instantly and is saved
6. Open the popup again to add more elements

### Step 2 — Record or share your screen

That's it. Every blurred element stays blurred. Start your screen recording or share your screen — the sensitive content is never visible.

### Step 3 — Manage your blur list

Open the 🔒 popup at any time:

```
● facebook.com   /profile        2 blurs
─────────────────────────────────────────
🖼️  Profile photo
     img.ProfilePhoto · image
     Blur  [══════════──]  10px   ✕

🔤  Ravi Patel
     span.username · text
     Blur  [════────────]   6px   ✕
─────────────────────────────────────────
  [+ Select element to blur]
  [✕ Clear all blurs on this page]
```

| Control | What it does |
|---|---|
| Intensity slider | Drag to adjust blur strength live on the page |
| ✕ button | Remove that specific blur |
| Header toggle | Pause / resume all blurs on this site |
| Clear all | Remove every blur saved for the current page |

---

## Privacy

All data is stored **locally on your device** using Chrome's built-in storage API (`chrome.storage.local`) and `localStorage`.

- No data is collected
- No data is transmitted to any server
- No analytics, no tracking, no third-party services
- No account required

[Full Privacy Policy](https://er-ravipatel.github.io/pii-blur/privacy-policy.html)

---

## Project structure

```
pii-blur/
├── manifest.json          Chrome extension manifest (MV3)
├── content.js             Blur logic, selector builder, MutationObserver, SPA support
├── popup.html             Extension popup UI
├── popup.js               Popup — renders item list, sliders, controls
├── styles.css             Blur class + crosshair cursor styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── privacy-policy.html    Privacy policy hosted via GitHub Pages
```

---

## License

MIT
