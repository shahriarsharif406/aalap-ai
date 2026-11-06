# Devpost submission text — Aalap

**Project name:** Aalap

**Short description (tagline):**
One photo becomes a personal communication board for children who can't speak, hear or see well — in 8 languages.

## Detailed project explanation

### Inspiration
About 240 million children live with a disability (UNICEF, 2021), and WHO/UNICEF estimate that access to assistive products can be as low as 3% of the need in poorer countries (2022). The tools that give a non-speaking child a voice — AAC apps — can cost hundreds of dollars and need a therapist to build every vocabulary by hand. In many countries, including mine (Bangladesh), such therapists barely exist. We asked: what if a parent could simply take a photo?

### What it does
Aalap builds a communication board from a photo of the child's real surroundings. A mealtime photo produces "I want water", "more", "too hot"; a classroom photo produces "I don't understand", "I need a break". Tapping tiles builds a sentence and the device speaks it.

One app adapts to several needs at once (modes can be combined):
* **Speech** — picture tiles, sentence strip, type-to-speak with AI suggestions.
* **Hearing** — live captions with picture hints, and an alert when the child's name is heard.
* **Simple (intellectual disability)** — fewer, larger tiles, positive feedback, a visual First→Then routine.
* **Vision** — high contrast, larger UI, "tap once to hear, tap again to choose", spoken navigation.
* **Switch** — one-button scanning for children who cannot use a touch screen.

Boards **learn the child's vocabulary** (a "For you" board by time of day), can be **shared by QR code** with a teacher, and the app has a one-tap SOS, a caregiver area, 8 languages including right-to-left Urdu and Arabic, onboarding, dark mode and offline use as an installable PWA. Caregivers can also paste their own free Gemini key so the AI works even on static hosting.

### How we built it
Dependency-free JavaScript PWA (Web Speech API for voice and captions), FastAPI backend, and Gemini Vision with structured JSON output to build boards. ~1,300 Twemoji pictograms (CC-BY 4.0) are bundled for offline use. We audited the interface with axe-core (WCAG 2.1 AA) in real Chrome: zero violations across every screen, dark and high-contrast modes, and RTL. A cloud text-to-speech fallback covers languages with no on-device voice. Photos are never stored. Rate limiting and automated tests are included.

### Challenges
Making one interface serve very different disabilities without becoming cluttered; getting natural phrases (not translations of English) in the child's language; and making the app useful with no internet.

### Accomplishments
A complete, working product — not a mockup — that is usable offline and degrades gracefully without AI.

### What we learned
Accessibility is mostly about removing steps. Every setup step we removed made the tool more usable for real families.

### What's next
Licensed pictogram sets, sign-language clips, switch scanning for motor impairments, and shared boards between parents and teachers. We want to test with special-education schools.

## Technologies used
JavaScript, HTML/CSS, Web Speech API, Service Workers (PWA), MediaDevices (camera), Python, FastAPI, Gemini API (vision, structured output, TTS), qrcode-generator, Twemoji, axe-core, Docker, Render

## Demo video script (≈4 min)

1. **0:00 – Hook (20s).** "This is a child who can't ask for water." Show the problem: expensive apps, hours of setup.
2. **0:20 – Photo to board (60s).** Photograph a meal table → board appears in seconds → tap "I want water" → the phone speaks.
3. **1:20 – Languages (30s).** Switch to Bangla, then Arabic (layout flips right-to-left).
4. **1:50 – Hearing mode (40s).** Someone speaks; live captions with picture hints; say the child's name → phone flashes and vibrates.
5. **2:30 – Vision mode (30s).** Eyes-closed demo: tap once to hear, tap again to choose.
6. **3:00 – Simple mode + Routine (30s).** Fewer, bigger tiles; First→Then; praise.
7. **3:30 – Share by QR + Switch scanning (20s).** Scan a board onto a second phone; one-button scanning.
8. **3:50 – SOS + offline (10s).** Airplane mode, SOS still works.
9. **4:00 – Close (20s).** Impact line (240M children, 3% access) + roadmap.

> Tip: record real screen footage on a phone; use a family member as the "child" for the demo, never a real child you do not have permission to film.
