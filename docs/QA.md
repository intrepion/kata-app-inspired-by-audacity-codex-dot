# Verification record

Date: 2026-11-10 UTC. Local app served at http://127.0.0.1:4174/ on macOS. No direct-file browser testing.

## Automated

`npm run check`: JavaScript syntax plus Node tests for immutable stereo edits, exact sample boundaries, fade endpoints, gain clipping, −1 dB normalization, silent/nonfinite/oversized input, WAV headers/interleaving, filenames, deterministic demo, partial numeric input, and loopback HTTP server behavior. 32 tests.

`npm run build`: produces dependency-free static `dist/`, with relative asset references and catalog screenshots.

## Browser observations

Chrome browser through the connected extension:

- App initialized original 12-second stereo demo and actual PCM waveform.
- Numeric 2–8s selection trimmed the clip from 12s to 6s. Undo restored 12s and the prior selection; Redo restored 6s.
- Fade in, fade out, and Normalize executed with undo history; resulting displayed peak was −1.0 dBFS.
- Playback visibly advanced and paused. This confirms Web Audio scheduling/UI, not an independent audible listening test.
- Zoom to 4× and Fit adjusted the waveform view. Pointer drag selected 2.182–7.855s. Clicking placed a cursor.
- Reverse and Delete executed in the 390px layout, reducing 12s to 6s. Undo restored the clip.
- Empty selection disables edits and selection-only export. Whole-clip Delete is disabled.
- Replacing edited audio opens confirmation. Keep editing preserved work; Replace audio reset source and history.
- After final patches, intermediate End input `1` preserved Start=5; completing `10` selected 5–10s and blur formatted 10.000. A 1.000–1.200s loop paused/resumed within the same range; Stop returned to 1.000. Quick guide opened/closed normally.
- Desktop and 390×844 CSS-pixel layouts inspected. Narrow layout measured clientWidth/scrollWidth 390/390 (no horizontal page overflow).
- WAV export action reached app completion, but the browser automation download-completion event timed out and no saved file was independently verified. WAV bytes/header/selection are covered by automated engine tests.

## Verification limits

End-to-end audio-file import was blocked by the connected Chrome extension's missing local-file access permission, before the file reached the app. Native picker/save-dialog inspection was unavailable while the Mac was locked. These are QA-environment limitations; import decoding and native save completion are not claimed as browser-verified. No bypass or permission setting change was attempted.

No physical mobile, Safari/Firefox, screen-reader audit, or subjective audio listening test was completed. The app is a focused single-clip kata, not full Audacity parity.

## Review fixes

Browser QA caught selection fields not committing under the browser automation fill flow. They now process valid drafts and canonicalize committed fields. Independent review caught partial numeric typing changing the opposite edge and cursor-loop pause/resume shrinking the interval; both were corrected. A playback request token prevents late AudioContext resume from starting audio after cancellation. Numeric regression tests cover empty drafts, intermediate digits, clamping, decimals, and endpoints.
