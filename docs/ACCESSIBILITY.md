# Accessibility notes

Aalap is built for people with disabilities, so accessibility is tested, not assumed.

## Automated checks (axe-core 4, WCAG 2.0/2.1 A + AA + best-practice rules, real Chrome)

Zero violations on: landing page, Talk, Scene, Listen, Routine, Caregiver, dark theme, high-contrast mode,
Arabic (right-to-left) layout and the onboarding dialog.

Automated checks catch roughly a third of issues. Please also test with real assistive technology and real users.

## Design decisions

* Targets of at least 44 px (most are 130 px+); tile size is adjustable.
* No reading required: every tile pairs a picture with a label; the app speaks aloud.
* Four combinable support modes + one-button **switch scanning** for motor impairments.
* **Vision mode** forces high contrast and larger UI, and uses *tap once to hear, tap again to choose*.
* High-contrast mode puts pictograms on white badges so they stay visible on black.
* `prefers-reduced-motion` is respected; dark mode follows the system setting.
* Keyboard and screen-reader semantics: landmarks, `aria-live` regions, `aria-pressed`, labelled controls,
  focus rings, skip link, `lang` and `dir` set per language.
* Onboarding is a modal dialog that makes the page behind it `inert`.

## Known limitations

* Speech recognition (live captions) relies on the browser's Web Speech API — best in Chrome / Edge.
* On-device text-to-speech voices vary; for languages with no installed voice Aalap falls back to cloud TTS when AI is on.
* Pictograms are emoji-style artwork, not a clinical symbol set such as PCS or ARASAAC.
