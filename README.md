# Aalap — *Every child has something to say.*

**Aalap** (আলাপ — "conversation") turns **one photo** into a personal communication board for children who are non-speaking, deaf, blind, or have an intellectual disability. It speaks for the child, captions the world for them, and adapts its whole interface to each child's needs — in **8 languages**, offline, with no sign-up.

> Built for the **CTRL-V Hackathon** — *Accessibility for people with disabilities.*

## Why this matters

* About **240 million children** worldwide live with a disability ([UNICEF, 2021](https://www.unicef.org/philippines/press-releases/worlds-nearly-240-million-children-living-disabilities-are-being-denied-basic-rights)).
* **2.5 billion people** need at least one assistive product — communication aids included — yet access can be as low as **3%** of the need in poorer countries ([WHO & UNICEF, 2022](https://www.unicef.org/reports/global-report-assistive-technology)).
* Affordability is a major barrier; AAC apps cost hundreds of dollars and need a therapist to hand-build each board.

## What Aalap does

| Feature | How it helps |
|---|---|
| **Photo → board (AI)** | Take a photo (live camera or gallery) or describe a place. Gemini builds the phrases the child is most likely to need *there*, in the child's language. |
| **Talk** | Tap picture tiles → sentence strip → the device speaks. Type-to-speak with AI and personal suggestions. |
| **For you** | The app learns each child's vocabulary and surfaces their most-used phrases for the time of day. |
| **Listen** | Live captions with picture hints, adjustable size, and a vibrate + flash alert when the child's **name** is heard. |
| **Routine** | Visual *First → Then* schedule with big tick buttons and praise. |
| **SOS** | Always-visible: repeated loud speech, vibration and a flashing screen. |
| **Share by QR** | Hand a board to a teacher or grandparent with one scan. No account, no server. |
| **Caregiver** | Child profile, custom words, usage insights, export / import, theme (auto / light / dark). |
| **5 combinable modes** | 🗣️ *Speech* · 👂 *Hearing* · 🧩 *Simple* (fewer, larger tiles, praise) · 👁️ *Vision* (high contrast, *tap once to hear, tap again to choose*) · 🔘 *Switch* (one-button scanning for motor impairments). |
| **8 languages** | English, বাংলা, हिन्दी, اردو, العربية, Español, Français, 中文 — full UI and vocabulary, right-to-left for Urdu and Arabic. |
| **Offline PWA** | Installable. Boards, routines, voice and settings work with no internet. |
| **Private** | Photos are used once and never stored. Settings stay on the device. |

## Two ways to run the AI

1. **Hosted server** — set `GEMINI_API_KEY` on the backend; everyone gets AI.
2. **Bring your own key** — with no server key (or on static hosting) a caregiver can paste a free Gemini key under *Caregiver → AI*. It is stored only in that browser and calls Gemini directly. This lets judges try the photo-to-board feature in seconds.

Without any key, every other feature still works.

## Architecture

```
 phone / browser (PWA, plain JS, no build step)            FastAPI (optional)         Gemini
 ┌────────────────────────────────────────────┐  photo   ┌────────────────┐ vision  ┌───────┐
 │ Talk · Listen · Routine · SOS · Share (QR)  │ ───────► │ /api/board     │ ──────► │ board │
 │ Web Speech (TTS + captions) · Switch scan   │ ◄─────── │ /api/phrases   │ ◄────── │ JSON  │
 │ localStorage · service worker (offline)     │  tiles   │ /api/tts       │         └───────┘
 └────────────────────────────────────────────┘          └────────────────┘
        └── or direct to Gemini with the caregiver's own key
```

* **Frontend** — dependency-free HTML/CSS/JS, ~1,300 licensed pictograms bundled for offline use.
* **Backend** — FastAPI. Structured-JSON prompts, validated / de-duplicated / length-capped tiles, per-IP rate limiting, nothing logged or stored.
* **Cloud voice fallback** — if the device has no voice for the language (common for Bangla on desktop), `/api/tts` (or the caregiver's key) supplies one.

## Run it locally

```bash
git clone https://github.com/shahriarsharif406/aalap-ai.git
cd aalap-ai
pip install -r requirements.txt
export GEMINI_API_KEY=your_key      # optional
uvicorn backend.main:app --reload
# open http://localhost:8000
```

Free key: <https://aistudio.google.com/apikey>. Chrome or Edge gives the best speech recognition.

The `web/` folder is fully static — you can also serve it from any static host (GitHub Pages, Netlify, Cloudflare Pages); AI then runs through the caregiver's own key.

### Tests

```bash
pip install pytest && pytest -q tests       # API tests
```

Front-end behaviour (onboarding, AI flow with a mocked Gemini, QR round-trip, switch scanning, learned board) and an **axe-core WCAG 2.1 AA audit** were run in real Chrome — see [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md).

### Deploy

* **Render:** connect the repo (`render.yaml` is included) and set `GEMINI_API_KEY`.
* **Docker:** `docker build -t aalap . && docker run -p 8000:8000 -e GEMINI_API_KEY=... aalap`

## Judging criteria, mapped

* **Impact** — removes the cost and setup labour that keep AAC out of reach; multilingual by design, with Bangla, Hindi, Urdu and Arabic first-class.
* **Innovation** — boards generated from the child's real surroundings; one adaptive app for several disabilities at once; a one-scan way to share boards; vocabulary that learns the child.
* **Technical implementation** — structured-output vision pipeline, offline PWA, cloud-voice fallback, switch scanning, RTL layout, rate limiting, automated tests and accessibility audit.
* **User experience** — large targets, picture-first, high-contrast and dark themes, reduced-motion support, screen-reader semantics, no reading required.
* **Presentation** — landing page at `/`, plus [`docs/DEVPOST.md`](docs/DEVPOST.md).

## Limitations & roadmap

Aalap is a communication aid, not a medical device or a replacement for a speech therapist. It has not yet been clinically evaluated; we want to pilot it with special-education teachers and families. Next: clinical pictogram sets (e.g. ARASAAC), sign-language clips, eye-gaze input, and shared boards between caregivers and schools.

## Credits & license

MIT — © FutureTech.ai. Pictograms: Twemoji (CC-BY 4.0). QR: qrcode-generator (MIT). See [`NOTICE.md`](NOTICE.md).
