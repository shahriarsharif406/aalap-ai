# Aalap — *Every child has something to say.*

**Aalap** (আলাপ — "conversation") turns **one photo** into a personal communication board for children who are blind, deaf, non-speaking, or have an intellectual disability. It speaks for the child, captions the world for them, and adapts its whole interface to each child's needs — in **8 languages**.

> Built for the **CTRL-V Hackathon** — *Accessibility for people with disabilities.*

## The problem

Children who cannot speak rely on AAC (Augmentative & Alternative Communication) boards. Today these are:

* **Expensive** — leading apps cost around US$250 plus therapist time.
* **Slow to set up** — someone has to hand-build a vocabulary for every place and routine.
* **Single-need** — most assume one disability, but many children have several at once.
* **Out of reach** — in much of the world there are almost no speech therapists to build boards at all.

## What Aalap does

| Feature | How it helps |
|---|---|
| **Photo → board (AI)** | Point the camera at a mealtime, classroom or playground. Gemini Vision builds a board of the phrases the child is most likely to need *in that exact place*, in the child's language. |
| **Talk** | Tap picture tiles → a sentence strip → the device speaks. A type-to-speak box offers AI phrase suggestions plus the child's own most-used phrases. |
| **Listen** | Live captions of what people say, with picture hints, adjustable size, and a vibrate + flash alert when the child's **name** is heard. |
| **Routine** | A visual *First → Then* schedule with big tick buttons and praise, to support predictability. |
| **SOS** | One always-visible button: loud repeated speech, vibration and a flashing screen. |
| **Caregiver** | Child profile, custom words, usage insights, export / import, privacy. |
| **4 combinable support modes** | 🗣️ *Speech* · 👂 *Hearing* · 🧩 *Simple* (fewer, larger tiles, praise) · 👁️ *Vision* (high contrast, larger UI, **tap once to hear, tap again to choose**, screen announcements). Turn on several at once. |
| **8 languages** | English, বাংলা, हिन्दी, اردو, العربية, Español, Français, 中文 — full UI and vocabulary, with right-to-left layout for Urdu and Arabic. |
| **Works offline** | Installable PWA. Ready-made boards, routine, voice and settings work with no internet. AI boards need a connection. |
| **Private** | Photos are used once to build a board and are **never stored**. Settings stay on the device. |

## How it works

```
 phone / browser (PWA, plain JS)                      FastAPI                Gemini
 ┌──────────────────────────────┐   photo (resized)   ┌────────────┐  vision ┌────────┐
 │ Talk · Listen · Routine · SOS │ ─────────────────► │ /api/board │ ──────► │ board  │
 │ Web Speech (TTS + captions)   │ ◄───────────────── │ /api/phrases│ ◄────── │ JSON   │
 │ localStorage + service worker │   JSON tiles        │ /api/tts   │         └────────┘
 └──────────────────────────────┘                      └────────────┘
```

* **Frontend** — dependency-free HTML/CSS/JS. Browser speech synthesis and recognition do the talking and captioning, so the core experience costs nothing to run.
* **Backend** — FastAPI. Structured-JSON prompts to Gemini produce validated, de-duplicated, length-capped tiles. Per-IP rate limiting. No image or text is logged or stored.
* **Cloud voice fallback** — if a device has no voice for the chosen language (common for Bangla on desktop), `/api/tts` supplies one.
* **Graceful degradation** — with no API key the server reports `ai: false` and every offline feature still works.

## Run it locally

```bash
git clone https://github.com/shahriarsharif406/aalap-ai.git
cd aalap-ai
pip install -r requirements.txt
export GEMINI_API_KEY=your_key      # optional: enables photo→board, phrase suggestions, cloud voice
uvicorn backend.main:app --reload
# open http://localhost:8000
```

Get a free key at <https://aistudio.google.com/apikey>. Chrome or Edge gives the best speech recognition.

### Tests

```bash
pip install pytest
pytest -q tests
```

### Deploy

* **Render:** connect the repo (a `render.yaml` blueprint is included) and set `GEMINI_API_KEY`.
* **Docker:** `docker build -t aalap . && docker run -p 8000:8000 -e GEMINI_API_KEY=... aalap`

## Judging criteria, mapped

* **Impact** — removes the cost and the setup labour that keep AAC out of reach; multilingual by design, with Bangla and other low-resource languages first-class.
* **Innovation** — context-aware boards generated from the child's real surroundings, and several disabilities supported in one adaptive interface.
* **Technical implementation** — structured-output vision pipeline, offline PWA, cloud voice fallback, RTL layout, rate limiting, automated tests.
* **User experience** — large tap targets, high contrast, screen-reader semantics, reduced-motion support, no reading required.
* **Presentation** — see [`docs/DEVPOST.md`](docs/DEVPOST.md).

## Limitations & roadmap

Aalap is a communication aid, not a medical device or a replacement for a therapist. Next steps: licensed pictogram sets (e.g. ARASAAC) instead of emoji, sign-language video clips, motor-impairment switch scanning, and shared boards between caregivers and teachers.

## License

MIT — © FutureTech.ai
