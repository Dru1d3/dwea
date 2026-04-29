# 0005 — First agentic NPC and LLM loop

- Status: accepted (with 2026-04-29 provider swap — see "Provider swap" below)
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-5 (provider swap requested on DWEA-3)
- Builds on: [0001-stack.md](0001-stack.md), [0002-splat-renderer.md](0002-splat-renderer.md)

## Context

DWEA-5 wants the world to feel alive: one LLM-driven character the user
can chat with and watch move. The constraints:

1. Mainstream LLM. Use Anthropic Claude. Haiku for cost; Sonnet only if
   quality demands it.
2. First-token latency under 1s on a warm session.
3. Streaming responses in the chat panel.
4. Cap context aggressively. Cost matters from day one.
5. We deploy to GitHub Pages today (see ADR 0002 deploy update). No
   backend, no edge function, no signed token route.

Everything below flows from those constraints.

## Decision

### Model: `claude-haiku-4-5`

We use `claude-haiku-4-5` (id `claude-haiku-4-5-20251001`) by default. It
is the fastest, cheapest member of the current Claude family, and for a
single-NPC chat loop with a tight system prompt, the quality is more than
enough. We escalate to `claude-sonnet-4-6` only if the personality starts
to feel flat under playtest. Model id is centralized in
`src/llm/personality.ts` so a swap is a one-line change.

### Browser-direct API calls (interim)

We call the Anthropic API **directly from the browser** using
`@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`. The user pastes
their own API key into a settings panel; we store it in `localStorage`
(`dwea.anthropic.key`) and never send it anywhere except `api.anthropic.com`.

This is not the long-term shape. The long-term shape is:

```
browser ──► our edge proxy (Vercel/Cloudflare Worker) ──► api.anthropic.com
```

with a server-side key, request signing, rate limiting, and a budget cap.

We are not there today because we have no edge runtime under our control.
ADR 0002's "Deploy target update" already noted that GH Pages has no edge
function story; the moment we get Vercel access (or a Worker) we wire a
`/api/chat` proxy, drop `dangerouslyAllowBrowser`, and remove the settings
panel's key field. The chat client lives behind a single
`createNpcClient()` factory so the swap is local.

Why this is acceptable as a v1:

- Each user is using their own key against their own quota; no shared
  blast radius.
- The page is internal-facing today. We surface the trade-off in the
  settings UI ("your key, never sent to a DWEA server").
- The alternative — block the deliverable on standing up a backend — is
  the wrong call at this stage of the company. The vertical slice ships;
  the proxy follows.

### Personality and prompt budget

One NPC named **"Mara"** — a small, curious wandering spirit who lives in
the splat scene. The personality prompt is ~120 tokens, hard-coded in
`src/llm/personality.ts`, and the conversation is capped at the **last 6
turns** (3 user / 3 assistant) before being sent. A short scene-state
preamble ("you are at position …") is injected each turn so Mara can
react to where she is in the world.

Per-turn token budget at peak:

| Slice            | Tokens (~) |
| ---------------- | ---------- |
| System prompt    | 120        |
| Scene state      | 40         |
| 6-turn history   | 600        |
| User message     | 100        |
| Output (capped)  | 200        |

So worst case ~1.1 KTok per turn. At Haiku pricing this is well under a
cent per exchange.

### Greeting cache

The very first thing Mara says on page load is a fixed hard-coded
greeting string baked into the bundle. **No API call.** Two reasons:

1. Removes the opening-message latency entirely (felt latency is what
   matters for first impression).
2. Saves a request per visitor. Cheapest API call is the one we don't
   make.

The greeting is varied across page reloads by picking from a small array
(stable for v1, can grow into a procedural opener later).

### Streaming

We use the SDK's `messages.stream()` API and pipe deltas into a single
React state slot rendered as the assistant bubble. We measure
first-token latency (`first_text_delta_at - request_started_at`) and
display it in the dev HUD; we'll log it for the issue write-up.

### Movement model (v1)

Naive but legible:

- Idle: Mara bobs in place (`sin(time)` Y offset).
- Walk-to-target: lerp position toward the target on the XZ plane at a
  fixed speed (`1.5 units/s`); face direction of travel.
- Targets are set by the user clicking on the ground plane. Each click
  retargets immediately.
- Periodic wander: every 8–14 s with no recent target, Mara picks a
  random nearby spot and walks there.

We do **not** add a physics engine, NavMesh, or pathfinding at this
stage. The splat scene has no walkable surface metadata yet. If we add
mesh colliders later, the NPC component grows a target validator without
changing the call sites.

### What we are not doing in v1

- **No tool/function calling.** The issue marks this as optional and
  we're holding the line on simplicity. If Mara should react to a click
  (e.g. "you walked me over here, what about it?"), the click target is
  passed in the next user-turn's scene preamble — no tool roundtrip.
- **No memory across page reloads.** Conversation history lives in
  React state and dies on refresh. A future ticket can wire long-term
  memory through a backend.
- **No skinning, no animations beyond bob + walk.** Placeholder mesh.

## Consequences

- New runtime dep: `@anthropic-ai/sdk`.
- New `localStorage` keys: `dwea.anthropic.key`,
  `dwea.anthropic.greeting-seed`.
- New module layout under `src/`:
  - `src/llm/` — Anthropic client wrapper + personality + greeting bank.
  - `src/npc/` — NPC mesh, movement state hook.
  - `src/ui/` — Chat panel + settings panel.
- `dangerouslyAllowBrowser: true` is set behind a single factory so it
  can be removed without a sweep.
- The 6-turn cap is enforced in one place (`buildMessages()`); raise it
  by editing one constant if quality calls for it.

## Open items

- Stand up an edge proxy and remove the browser-key flow.
  Pre-requisite: Vercel access (ADR 0002) **or** a Cloudflare Worker.
- Add a small background presence sound (separate ticket).
- Procedural openers (Mara reacts to time of day, weather, etc.) once
  the scene has those signals.

## Provider swap — 2026-04-29

Mara now talks via **OpenRouter** instead of Anthropic direct, defaulting
to a free model (`openai/gpt-oss-120b:free`). Board asked for this on
DWEA-3 to avoid paid Anthropic spend during the playtest phase.

### What changed

- `src/llm/openrouter.ts` replaces `src/llm/anthropic.ts`. Same exported
  surface (`createNpcClient`, `streamNpcReply`, `ChatTurn`, `SceneState`,
  `StreamHandlers`) so `useChat.ts` and `App.tsx` only changed import
  paths and one type alias.
- `@anthropic-ai/sdk` removed from `package.json`. The new client is a
  plain `fetch` against `https://openrouter.ai/api/v1/chat/completions`
  with manual SSE parsing (~80 lines). Net bundle effect: SDK removed
  vs. ~80 lines of fetch handler.
- localStorage keys renamed from `dwea.anthropic.*` to
  `dwea.openrouter.*`. No migration: the old keys held an `sk-ant-…`
  string that has no meaning on OpenRouter, so existing users will hit
  the settings dialog once and paste a fresh `sk-or-v1-…` key.
- Settings dialog copy + placeholder updated to reference OpenRouter.
- `NPC_MODEL` in `personality.ts` is the only model knob; swap there to
  try a different free model.

### Why `openai/gpt-oss-120b:free` (and not the other free models)

We probed eight `:free` models with the board's key. Most were
rate-limited upstream by Venice or returned no endpoints at all
(`deepseek-chat-v3.1:free`, `gemini-2.0-flash-exp:free`,
`mistral-small-3.2-24b-instruct:free` — 404 on `/chat/completions`).
Working candidates today:

- **`openai/gpt-oss-120b:free` (chosen).** Available, accepts a system
  prompt, gives a clean one-line reply, and supports
  `reasoning: { exclude: true }` so its chain-of-thought does not
  stream into the chat bubble.
- `openai/gpt-oss-20b:free` — also works; smaller and noisier reasoning.
  Fine fallback if 120b is busy. Same provider, same surface.
- `meta-llama/llama-3.3-70b-instruct:free` — preferred on quality but
  was rate-limited upstream during evaluation. Re-promote when stable.
- `google/gemma-3-12b-it:free` — rejects system prompts ("Developer
  instruction is not …"). Would require restructuring all prompts. Not
  worth it for the swap.

This pick is reversible — `personality.ts:NPC_MODEL` is the one knob.

### Two stream-shape gotchas this introduced

1. **Reasoning tokens are noise.** gpt-oss models stream a `reasoning`
   delta separately from the `content` delta. The fetch handler in
   `openrouter.ts` only honors `delta.content`; we additionally pass
   `reasoning: { exclude: true, effort: 'low' }` in the request body so
   OpenRouter suppresses the upstream chain-of-thought entirely. Without
   this, first-token latency is dominated by reasoning tokens that the
   user never sees.
2. **`provider: { sort: "throughput" }`** is set so OpenRouter routes to
   whichever upstream is fastest right now. Free models are
   multi-tenant; this avoids being stuck on a slow provider.

### Why not server-side proxy yet

Same reason as before. We still have no edge runtime. The
"browser-direct → edge proxy" plan from the original ADR is unchanged;
swapping the provider does not change that dependency. The factory
boundary still hides the provider, so the proxy path is the same
single-call-site change it was before.

### Security note

The OpenRouter key the board pasted into the DWEA-3 thread is now
visible in our issue history. We treat it as compromised on principle
even though it has worked correctly: when DWEA-3 closes again, the
board should rotate that key at <https://openrouter.ai/keys>. The
production answer is the proxy + a server-side key — same as before.
