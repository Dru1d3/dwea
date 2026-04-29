# 0005 — First agentic NPC and LLM loop

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-5
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
