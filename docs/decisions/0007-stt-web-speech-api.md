# 0007 — Push-to-talk STT via Web Speech API

- Status: accepted
- Date: 2026-04-30
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-23 (T5 — Microphone STT). Source of scope: DWEA-22.
- Builds on: [0005-npc-llm-loop.md](0005-npc-llm-loop.md)

## Context

DWEA-22 asked for the user to **talk to Mara with their microphone**, not
just type at her. The original 4-ticket character plan (DWEA-12) only had
TTS (DWEA-19) — there was no STT scope. This ADR captures the choice we
made for v1 STT and the gaps we're explicitly accepting.

Constraints, in order:

1. **No backend.** We still deploy to GitHub Pages (see ADR 0002). No
   edge runtime, no signed token route, nothing to host a server-side
   STT model.
2. **No new third-party spend.** We swapped the LLM provider to a free
   OpenRouter tier in ADR 0005. We're not adding paid Whisper-API or
   Deepgram on top.
3. **Demo-quality is enough.** The board wants the loop to *exist*, not
   be production-grade. False rejections, latency in the 300–800ms
   range, and "Chrome only" are all acceptable trade-offs for the
   playtest deliverable.
4. **The mic transcript must reuse the existing LLM motor entry.** No
   parallel pipeline, no separate prompt; whatever the typed chat input
   produces, the voice transcript should produce.

## Decision

We use the **browser-native Web Speech API**
(`window.SpeechRecognition` / `window.webkitSpeechRecognition`) for
push-to-talk speech recognition.

### Why Web Speech API

- **Free, no key, no server.** It satisfies constraints 1 and 2 with
  zero infrastructure. Chrome dispatches the audio to Google's STT
  service transparently; Safari does the same against Apple's. Neither
  charges us, and neither is a service we have to operate.
- **It already lives in the browser.** No new bundle weight, no SDK,
  no permission model beyond the existing `getUserMedia` mic prompt.
- **The transcript shape is exactly what the chat input already
  consumes** — a string. No protocol work, no streaming-decode glue.
- **It's a one-liner to swap.** The whole STT surface is hidden behind
  `createMicController({ factory })` in `src/ui/micCapture.ts`. If we
  later want server-side Whisper, we change the factory; nothing else
  in the app moves.

### Push-to-talk, not always-on

Always-on recognition burns mic permission goodwill and produces noisy
false utterances when the user isn't talking *to* Mara. Push-to-talk:

- Hold-to-talk button (touch + mouse via `pointerdown` / `pointerup`,
  with `setPointerCapture` so a release outside the button still ends
  the recording).
- Hold-Space hotkey wired through `usePushToTalkHotkey`. The hotkey is
  disabled while the user is typing in a form field
  (`isContentEditable`, `<input>`, `<textarea>`, `<select>`) so Space
  keeps its native role inside the chat box.
- `recognition.continuous = false` and `interimResults = true` —
  we want one utterance per press and a streaming preview.

### State machine

`useMicCapture` (and the underlying `MicController` it adapts) exposes
exactly four states: `idle`, `listening`, `processing`, `error`. The
controller lives in plain TS so we can unit-test the transitions with
a mock `SpeechRecognition` — see `src/ui/micCapture.test.ts`.

The handful of subtleties baked into the controller, written down so a
future reader doesn't have to re-derive them:

- `aborted` errors fired *after* a clean `stop()` are normal in Chrome
  and are swallowed — surfacing them would flash a bogus error banner
  every utterance.
- The `processing` state is a brief gate between `stop()` and `onend`
  so the UI can show a spinner while the final transcript settles.
- The transcript value is a running concatenation of the final segments
  plus the most recent interim segment, so the input placeholder can
  show partial text while the user is still talking.

### Transcript flow

```
[hold button or Space]
  → mic.start()
  → SpeechRecognition fires onresult (interim, then final)
  → user releases
  → mic.stop() → controller waits for onend
  → onTranscript(finalText)
  → chat.send(finalText)            ← same entry point as typed input
  → existing LLM streaming, scene preamble, latency stats, etc.
```

We feed the transcript into the **same user-message slot** the typed
input would use. The system prompt does not change. Prompt-injection
surface is identical to the typed-text path: whatever Mara's prompt
already tolerates from a typed user is what she now tolerates from a
spoken one.

### Browser support — what we're shipping

| Browser            | Status         | Notes                                                      |
| ------------------ | -------------- | ---------------------------------------------------------- |
| Chrome / Edge desktop | ✅ Works       | Uses Google's STT, ~300ms first interim                    |
| Safari macOS / iOS    | ✅ Works       | `webkitSpeechRecognition`, Apple's STT                     |
| Chrome Android        | ✅ Works       | Same as desktop                                            |
| **Firefox (all)**     | ❌ Not supported | No `SpeechRecognition` global; never landed                |
| Brave                 | ⚠ Variable    | Disabled by default for privacy; users can re-enable       |

### The Firefox gap (and how we present it)

Firefox has had `SpeechRecognition` behind dev flags / on-and-off for
years and currently does **not** ship a usable implementation
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)).
For DWEA, that means:

- The mic button auto-disables and shows a tooltip:
  *"Speech recognition is not available in this browser."*
- The Space hotkey is a no-op (the hook detects unsupported and never
  attaches the listener path that would steal Space).
- Typed chat continues to work exactly as before — nothing about the
  Firefox experience regresses.

We accept this gap for v1. If Firefox parity becomes a real
requirement (currently it isn't — the demo audience uses Chrome and
Safari), the next step is to swap the factory for a small
`MediaRecorder → /api/stt → Whisper` proxy, which depends on us having
an edge runtime — the same dependency that ADR 0005 is already waiting
on.

## Consequences

- New module: `src/ui/micCapture.ts` (controller + types) and
  `src/ui/useMicCapture.ts` (React adapter). Both exist behind a
  single factory boundary.
- New module: `src/ui/usePushToTalkHotkey.ts`, encapsulating the
  Space-hotkey edge cases (form-field exclusion, blur reset,
  `e.repeat` filter).
- New module: `src/ui/MicButton.tsx`, integrated into `ChatPanel`.
- HUD copy mentions Space ↔ talk.
- Vitest config still runs in `node`; the controller is plain TS so it
  tests cleanly without jsdom. We did **not** add `@testing-library/react`
  for this — the React glue in the hook is thin enough that the
  controller-level tests cover the meaningful behavior.
- localStorage: nothing new. The mic does not persist anything.

## What this ADR explicitly does *not* cover

- **Server-side STT.** Out of scope for v1. The factory boundary
  exists so we can swap to it later.
- **Wake-word / hands-free.** Push-to-talk is the only mode shipped.
- **Voice ID / multi-speaker.** Out of scope.
- **Barge-in (talking over Mara's TTS).** Deferred — opens after both
  DWEA-23 and DWEA-19 land and we see the loop end-to-end.
- **Multi-language.** We default to `en-US`. Configurable via the hook
  but no UI exposes it yet.
