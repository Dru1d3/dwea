# Genie integration — research note

- Status: research note (not an ADR)
- Issue: [DWEA-9](/DWEA/issues/DWEA-9) (board ask routed via [DWEA-3](/DWEA/issues/DWEA-3))
- Author: Researcher
- Date: 2026-04-29
- Last verified (access-reality claims): 2026-04-29

## TL;DR

- **Genie 3 itself: WAIT.** No public API, no developer SDK, no self-hostable
  weights. The only consumer access today is a Google Labs prototype web app
  bundled into a Google AI Ultra subscription, US-only, 18+, not for
  Business users — none of which is integrable into a Three.js SPA.
- **The capability the board actually wants — text/image → explorable 3D
  world — IS available today through a peer.** World Labs' Marble + World
  API ships gaussian splats (`.PLY`, `.SPZ`, `.SPLAT`, `.RAD`) that drop
  straight into our drei `<Splat>` renderer at ~$1.20 per world.
- **Recommendation:** WAIT on Genie 3 (revisit trigger below) and PROTOTYPE
  World Labs Marble in a separate ticket. Calling the substitution out
  explicitly per the board's instruction: the recommendation pivots to
  Marble, not silently.
- **Confidence:** high on access reality (multiple primary sources), medium
  on long-term peer ranking (this market is changing weekly).
- **Revisit trigger for Genie:** any of (a) Google publishes a Genie
  developer API or SDK, (b) DeepMind releases Genie 3 weights or a
  self-hostable variant, (c) Genie outputs become exportable to a static
  asset our renderer can consume.

## Context

The board asked on [DWEA-3](/DWEA/issues/DWEA-3) for the company to
investigate whether and how Google DeepMind's Genie should plug into
DWEA's product. Our existing stack is:

- React + Three.js + R3F + drei `<Splat>` renderer
  (see [`docs/decisions/0002-splat-renderer.md`](../decisions/0002-splat-renderer.md))
- Asset pipeline: `public/splats/<id>.<ext>` for `.splat` / `.ksplat` /
  `.ply`, registered in `src/splats/registry.ts`
  (see [`docs/decisions/0003-asset-pipeline.md`](../decisions/0003-asset-pipeline.md))
- One LLM-driven NPC ("Mara") via OpenRouter free model, browser-direct
  (see [`docs/decisions/0005-npc-llm-loop.md`](../decisions/0005-npc-llm-loop.md))
- Static SPA on GitHub Pages today; Vercel deferred. **No backend, no
  edge function under our control.**

The product hypothesis is: 3D websites built from gaussian-splat captures,
with agentic NPCs that move and talk inside them. So when the board asks
"can Genie help here", the underlying question is whether a foundation
world model can replace, supplement, or run alongside the splat-capture
pipeline.

## Access reality

### Genie 3

- **Original announcement (research only):** DeepMind announced Genie 3
  on 2025-08-05 as "a limited research preview, providing early access to
  a small cohort of academics and creators."[^genie3-blog]
- **Consumer prototype (2026):** On 2026-01-29 Google began rolling
  Genie out as **"Project Genie"**, a Google Labs prototype web app at
  `labs.google/projectgenie/`, gated to **Google AI Ultra subscribers in
  the U.S. (18+)**, expanding "to more territories in due course" and
  **not available to Google AI Ultra for Business users**.[^projectgenie-blog]
- **No developer API.** Neither the DeepMind announcement nor the Google
  blog post mentions an API, an SDK, or developer documentation. The
  product is a hosted web app, not a service.
- **No self-hostable weights.** The model is closed; no Hugging Face
  release, no published checkpoint.
- **Genie 2 is the same story** — the December 2024 announcement is
  paper + research preview, no public access.[^genie2-blog]
- **The original Genie paper (arXiv 2402.15391)**[^genie-arxiv] is open
  but the model is research-only.

### What we'd actually have to do to "use Genie"

Today, only one of these doors exists, and it doesn't fit our product:

1. Sign the company up for Google AI Ultra (consumer, US, $-tier
   subscription) so a single human user can play in the prototype web
   app. **This is not integration.** There is no exportable scene, no
   embed, no API call. We can't put a Genie scene on dwea.io.
2. Apply for the academic/creator research preview. Timeline and
   acceptance criteria are not published; "priority access is given to
   developers and creative professionals" per third-party summaries, but
   the only authoritative sign-up surface is Google Labs itself.
3. Wait for Google to ship a developer-facing API. **No timeline.**

### Cost

Project Genie cost is bundled into the Google AI Ultra subscription;
no per-call price is published. There is no developer-tier pricing
because there is no developer tier.

### Half-life note

Access details on Genie churn fast. The August 2025 announcement said
"limited research preview"; by January 2026 there was a consumer
prototype. By the next quarter there could be a developer API or there
could be a tighter clamp-down. Re-verify before committing to anything.

## Capability fit

### What Genie 3 actually outputs

Per the DeepMind model page,[^genie3-page] Genie 3 is a streamed,
autoregressive, real-time interactive video model:

- **Inputs:** text environment prompt + character prompt, plus
  "promptable world events".
- **Outputs:** 720p video stream at 20–24 fps, generated frame-by-frame
  conditioned on user actions and prior frames.
- **Consistency horizon:** "largely consistent for several minutes",
  visual memory "for up to a minute".
- **Stated limitations** (verbatim):[^genie3-blog]
  - "the range of actions agents can perform directly is currently
    constrained"
  - "accurately modeling complex interactions between multiple
    independent agents in shared environments is still an ongoing
    research challenge"
  - "the model can currently support a few minutes of continuous
    interaction, rather than extended hours"
  - "clear and legible text is often only generated when provided in
    the input world description"

### What this means for our pipeline

Genie 3 is **not a splat generator**. It does not output a `.ply` or
`.splat` file, it does not output a mesh, it does not output a scene
graph. It outputs a stream of video frames, generated server-side, on
DeepMind's hardware, with a human's input loop. Composing it with our
stack would mean replacing `<SplatScene>` with a `<video>` element fed
from a Google-hosted streaming endpoint that does not exist for
third parties.

Mapped against the board's three framings:

- **Replacement for splat capture?** Not viable today (no API), and
  conceptually different — a captured splat is a static asset we own
  and can re-render forever; a Genie scene is a frame stream that lives
  inside Google's runtime for a few minutes at a time.
- **Supplement (generate the world, then capture splats from it)?**
  Interesting in principle but blocked by access. We'd need scripted,
  programmatic camera trajectories inside the prototype — there is no
  such interface — and even then the output is video frames, so we'd
  be doing post-hoc photogrammetry on AI video, which produces lower
  quality than capturing real footage in the first place.
- **Parallel product (Genie scenes vs. splat scenes side by side)?**
  Also blocked by access. No way to embed.

The honest read: **Genie 3 is a different runtime, not a building block
for our runtime.** The right product analogy is "Sora for game worlds",
not "a splat generator".

## Integration shape

If access existed today, the three plausible shapes — and why none of
them work for DWEA right now:

1. **Client-side runtime.** Not possible: Genie is far too big to run in
   the browser, and DeepMind has not released weights.
2. **Server-side frame generation, streamed to the browser.** This is
   what Project Genie itself is. We don't host it; we don't have a way
   to call it; and even if we did, the runtime cost (multi-billion-param
   autoregressive video generation per user session) is wildly outside
   any cost envelope we'd accept for a per-page-load 3D website.
3. **Pre-baked frames.** Could in theory record a Genie session and
   ship the video. But (a) we still can't get programmatic access, and
   (b) a recorded Genie session is just a video, which is strictly
   worse than a captured splat scene for "user can move around".

So the integration-shape table for Genie itself in 2026-Q2 is "none
work yet; revisit when access changes".

## Peer landscape

Comparing against the alternatives the board explicitly named, plus the
ones that have appeared in the meantime. **The peer that actually fits
DWEA is World Labs Marble — calling out the substitution explicitly per
the board's instruction.**

### World Labs (Marble + World API + Spark) — public API, splat-native

This is the closest match to our stack of anything in the field.

- **Access:** Public API, available since 2026-01-21.[^worldlabs-blog]
  Self-serve API keys, no waitlist, "you can start using it today". Open
  enrollment, billing dashboard, no contract.
- **Inputs:** text, single image, multi-image, 360° panorama, video.
- **Outputs:** **gaussian splats** in `.PLY`, `.SPZ`, `.SPLAT`,
  `.KSPLAT`, `.SOG`, plus their new streaming `.RAD` format. Also
  exportable as triangle meshes (collider + visual) and video.[^marble-export]
  These are *exactly* the formats our existing splat pipeline already
  consumes.
- **Renderer:** Spark (their THREE.js-based 3DGS renderer)[^spark] —
  same underlying tech as drei `<Splat>`. Direct compatibility with our
  current renderer; or we can use Spark itself as a drop-in if we want
  the LOD/streaming features.
- **Pricing:** $1.00 USD per 1,250 credits, $5 minimum.[^marble-pricing]
  - Marble 1.0 / 1.1: 1,500 credits/world ≈ **$1.20 per world**
  - Marble 1.0 Draft: 150 credits ≈ $0.12 per world (preview-grade)
  - Marble 1.1 Plus: 1,500–3,000 credits ≈ $1.20–$2.40 per world
  - Plus per-input pre-processing: 80 credits ($0.06) for text or
    non-pano image, 100 credits ($0.08) for video/multi-image, free for
    panorama.
- **Latency:** ~5 minutes per world generation; ~6 generation requests
  per minute per user.[^marble-rate-limits] So this is a **build-time**
  asset pipeline, not a per-page-load runtime.
- **Capability fit verdict:** *parallel + supplement* to splat capture.
  Same output format, same renderer, same scene model — just generated
  from a prompt instead of captured with a camera. Uniquely good fit.

### Tencent HY-World 2.0 — open weights, self-host required

- **Access:** Open-source, weights on GitHub and Hugging Face,[^hyworld-hf]
  released 2026-04-16. "However, HY-World 2.0 isn't deployed by any
  Inference Provider currently" — meaning if we want to use it we host
  it ourselves on a GPU.
- **Inputs/outputs:** multi-modal world model for "Reconstructing,
  Generating, and Simulating 3D Worlds." Specific output formats need
  to be confirmed at the model card level if we ever go down this path.
- **HunyuanWorld 1.0** (predecessor, also open) ships **3D meshes** with
  a web-based ModelViewer.[^hunyuan-world-1] Mesh, not splat — useful
  if we later want a hybrid mesh + splat renderer, less direct fit
  today.
- **Capability fit verdict:** Future-track. The "build our own world
  model service" path is real but is a six-figure-engineering-quarter
  commitment we should not start unsolicited. Worth tracking for the
  moment we have a backend and a real GPU budget.

### NVIDIA Cosmos — open, robotics-leaning

- **Access:** Open-source / open-weight under permissive licenses,[^cosmos]
  hosted weights on Hugging Face.
- **Targeting:** "Physical AI" / robotics simulation, not consumer 3D
  websites. Outputs are world-model predictions for downstream training,
  not standalone explorable scenes.
- **Capability fit verdict:** Out of scope for DWEA's product. Mention
  for completeness; not a peer we should evaluate further this quarter.

### Decart Oasis — real-time interactive video, Minecraft-shaped

- **Access:** Hosted demo at oasis.decart.ai, with developer API
  reportedly available.[^oasis]
- **Output:** Streamed video at 20fps, conditioned on keyboard/mouse,
  trained on Minecraft footage. Same "video stream as runtime" shape as
  Genie 3.
- **Capability fit verdict:** Same architectural mismatch as Genie —
  this is a streamed-video runtime, not a splat asset producer. Not a
  drop-in for our pipeline, even though the access story is friendlier.

### Sora-based / Veo-based world models — video, not interactive scenes

- OpenAI Sora 2 and Google Veo 3 are video generation models. They are
  not interactive world models in the Genie sense. Useful for cutscenes
  or NPC backstory clips, irrelevant to "render a navigable 3D world".
- *Mention only*; not a substitute for Genie or for splat capture.

### GAIA-1 / WorldDreamer / MagicWorld

- Driving-domain (GAIA-1) or research-only video diffusion world models.
  Either domain-specific (autonomous driving) or paper-only with no
  productized access path. Not relevant to DWEA's product surface
  today.

## Recommendation

### Genie 3: **WAIT.**

Specific revisit triggers (any one is sufficient to re-open this note):

1. Google ships a Genie developer API, SDK, or programmatic access
   surface (announced via DeepMind blog, Google Cloud, or Google AI
   Studio).
2. DeepMind releases Genie 2 or Genie 3 weights or a self-hostable
   variant.
3. Project Genie ships an export that produces an asset (mesh, splat,
   or video file we can host ourselves) that our renderer can consume.
4. A credible third party gets brokered access and we can sub-license
   through them.

Until one of those is true, there is no integration to design.

### What to do instead: **PROTOTYPE World Labs Marble.**

This is the explicit pivot the board's instructions allow as long as we
call it out — and we are: the board asked about Genie; the recommendation
ships a peer because the peer is the only one with a viable access
reality and an output format that matches our renderer.

The prototype is small and scoped:

- Generate one Marble world from a text prompt and one from a panorama,
  download the `.ply` (or `.splat`) and the collider mesh.
- Drop the asset into our existing `public/splats/<id>.<ext>` pipeline
  (or its splat sibling) using `scripts/add-splat.sh`.
- Register it in `src/splats/registry.ts`, route at
  `/#/marble-{prompt-id}`.
- Compare visual fidelity, file size, and load time against our existing
  scenes in `src/splats/registry.ts` (currently `nike`, `plush`, `garden`,
  `treehill`).
- Write up findings as an ADR amendment to
  [`docs/decisions/0003-asset-pipeline.md`](../decisions/0003-asset-pipeline.md).

Success criteria for the prototype:

1. We ship one Marble-generated scene at the same fidelity bar as our
   captured splats, on the same GitHub Pages SPA.
2. End-to-end cost per scene is logged (under $5 expected).
3. We answer the question "is Marble a credible parallel to camera
   capture for DWEA?" — yes, no, or "yes for some scenes" with a rule
   of thumb.

A follow-up implementation issue should be opened parented to DWEA-9,
assigned to FoundingEngineer, with the success criteria above. **The
researcher does not start the implementation.**

### Track HY-World 2.0 in the background.

Open weights + self-hostable means there is a "build-our-own world
model service" path if we ever want to escape vendor pricing or vendor
roadmap. Not actionable until we have an edge runtime and a GPU budget;
worth re-checking next quarter or when we wire a backend, whichever
comes first.

### Cost / governance asks before any prototype starts

- World Labs Marble is paid. Even at $5–$20 for a meaningful prototype,
  it requires the CEO to approve the spend and provide an API key (we
  do not commit the company to paid plans without approval — see
  Researcher charter).
- The prototype itself ships into a public-internet GitHub Pages
  deploy. Generated content should be reviewed for IP / trademark
  collisions before being committed (we are using prompts, so easier
  to control than user-uploads, but worth flagging).

## References

Primary sources first.

[^genie3-blog]: Google DeepMind, "Genie 3: A new frontier for world models", 2025-08-05. <https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/>
[^genie3-page]: Google DeepMind, Genie model page. <https://deepmind.google/models/genie/>
[^projectgenie-blog]: Google, "Project Genie: AI world model now available for Ultra users in U.S.", 2026-01-29. <https://blog.google/innovation-and-ai/models-and-research/google-deepmind/project-genie/>
[^genie2-blog]: Google DeepMind, "Genie 2: A large-scale foundation world model", 2024-12. <https://deepmind.google/blog/genie-2-a-large-scale-foundation-world-model/>
[^genie-arxiv]: Bruce et al., "Genie: Generative Interactive Environments", arXiv:2402.15391. <https://arxiv.org/abs/2402.15391>
[^worldlabs-blog]: World Labs, "Announcing the World API", 2026-01-21. <https://www.worldlabs.ai/blog/announcing-the-world-api>
[^marble-pricing]: World Labs API docs, Pricing. <https://docs.worldlabs.ai/api/pricing.md>
[^marble-rate-limits]: World Labs API docs, Rate limits. <https://docs.worldlabs.ai/api/rate-limits.md>
[^marble-export]: World Labs API docs, Export specs. <https://docs.worldlabs.ai/marble/export/specs.md>
[^spark]: Spark (3DGS renderer for THREE.js), GitHub. <https://github.com/sparkjsdev/spark>
[^hyworld-hf]: Tencent HY-World 2.0 on Hugging Face. <https://huggingface.co/tencent/HY-World-2.0>
[^hunyuan-world-1]: Tencent, HunyuanWorld 1.0, GitHub. <https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0>
[^cosmos]: NVIDIA, "Cosmos World Foundation Model Platform for Physical AI", arXiv:2501.03575. <https://arxiv.org/abs/2501.03575>
[^oasis]: Decart, Oasis. <https://oasis.decart.ai/welcome>
