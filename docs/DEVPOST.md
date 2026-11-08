# Devpost submission text — Aalap

**Project name:** Aalap

**Tagline:** One photo becomes a personal communication board for children who can't speak, hear or see well — in 8 languages.

## Detailed description

### The problem
240 million children live with a disability (UNICEF). Assistive tech reaches as little as 3% of those who need it in poorer countries (WHO/UNICEF). Apps that give a non-speaking child a voice cost hundreds of dollars, and someone has to build every board by hand.

### What Aalap does
**Take a photo. Get a board. Tap to speak.**
A photo of a meal table gives "I want water", "more", "too hot". A classroom gives "I need a break". Gemini Vision builds the board in the child's language, and the phone speaks it.

One app, five combinable modes: **Speech · Hearing** (live captions) **· Simple** (fewer, bigger tiles) **· Vision** (tap once to hear, again to choose) **· Switch** (one-button scanning).

Designed on standard AAC practice: **core words stay in the same place on every board**, so a child builds motor memory (the approach used by Proloquo2Go and other leading AAC apps).

Plus: boards that learn the child's own words, sharing by QR code, export to the open **Open Board Format** (works with Cboard and CoughDrop), SOS, offline use, 8 languages incl. Urdu/Arabic right-to-left.

### How it's built
Built during the hackathon (Nov 6–10, 2026), solo. Plain JavaScript PWA + FastAPI + Gemini (vision, structured JSON, TTS). 1,300 bundled pictograms (Twemoji, CC-BY). WCAG 2.1 AA checked with axe-core: 0 violations. Photos are never stored.

### Why it's different
Existing open-source AAC tools (Cboard, AsTeRICS Grid, CoughDrop) rely on boards built by hand. Aalap builds the board for the moment the child is in.

### Next
Licensed pictogram sets, sign-language clips, and pilots with special-education schools.

## Technologies
JavaScript, HTML/CSS, Web Speech API, PWA/Service Worker, Python, FastAPI, Gemini API (vision, structured output, TTS), Open Board Format, qrcode-generator, Twemoji, axe-core, Docker, Render

## 90-second demo video script

| Time | Show | Say |
|---|---|---|
| 0:00–0:10 | A tablet, a glass of water out of reach | "This child can't ask for water. AAC apps cost hundreds of dollars and take hours to set up." |
| 0:10–0:35 | Photograph the meal table, board appears, tap "I want water", phone speaks | "With Aalap, a parent takes one photo. Seconds later the board matches the room." |
| 0:35–0:50 | Switch to Bangla, then Arabic (layout flips) | "Eight languages, including right-to-left." |
| 0:50–1:10 | Hearing captions, then Vision (eyes closed), then Switch scanning (fast cuts) | "Hearing, vision, simple and switch modes combine in one app." |
| 1:10–1:20 | Scan QR on a second phone; export .obf | "Share to a teacher by QR, or export to open standard format." |
| 1:20–1:30 | Airplane mode, SOS | "Works offline. 240 million children deserve a voice." |

> Film with a family member or a doll as the "child". Never film a real child without permission.

## Screenshots
Ready in `docs/screenshots/` (landing, talk board, photo-to-board examples, Bangla, Arabic right-to-left, modes).
