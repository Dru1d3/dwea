# Embodiment cost envelope — A2F-3D NIM + ElevenLabs scaled (v1.2 gate)

Source ticket: [DWEA-48](/DWEA/issues/DWEA-48). Dependent: [DWEA-49](/DWEA/issues/DWEA-49). Prior envelope: [DWEA-41 §9 plan rev-3](/DWEA/issues/DWEA-41#document-plan).
Author: FoundingEngineer. Last updated: 2026-05-07.

## TL;DR

- **Self-host Audio2Face-3D on AWS `g6.xlarge` (L4, 1-yr reserved) is the recommended target**: ~**$400/mo steady-state**, ~**$4.8k first-year**. NVIDIA marketplace/managed is not a published rate-card product; it collapses to "self-host + NVAIE license fee" (~$1,300/mo). LaunchPad is a 2–4 week lab trial, not a production target.
- **ElevenLabs Business at $990/mo** is the smallest plan that covers our v1 character volume (~7.5–11.25M chars/mo at the ~150–250 char/turn estimate) using Flash v2.5 streaming TTS at 0.5 credits/char. Streaming has no surcharge. One custom monster voice fits inside the 10 included professional voice clones.
- **Combined embodiment monthly burn at v1 shape: ~$1,390–$1,570/mo** (A2F self-host + ElevenLabs Business, including modest Business-plan overage at the high end of volume).
- **This trips the [DWEA-41 §9](/DWEA/issues/DWEA-41#document-plan) envelope.** Plan rev-3 envelope is ~$450–$780/mo all-in at 100 sessions/day. Embodiment alone now eats ~2× that. All-in (brain + embodiment) lands at **~$1,630–$1,930/mo** = **~2.1–4.3× the envelope**. The §9 disconfirming-evidence rule is "cost-envelope move >2×" — this fires.
- **Largest contributor: ElevenLabs Business at $990/mo** as a fixed cost. Underlying issue: the unbundled stack carries fixed cost (GPU keep-warm + premium TTS subscription) that the bundled Convai stack didn't, so per-session math from §9 was structurally wrong for the new architecture.
- **Recommendation: trip the gate, escalate to CEO board approval.** Two viable framings for board: (a) accept ~$1.6–1.9k/mo all-in for v1 (~$22k first year) on the rationale that fixed-cost spread amortizes to envelope-fit at v2 traffic; or (b) revise §9 envelope to reflect unbundled-stack fixed cost reality. Both need a board call; FE is filing the approval.

## Context

[DWEA-44](/DWEA/issues/DWEA-44) gate-fail flipped Option A (roll-your-own) into the v1 path. CEO sign-off ([DWEA-44 decision comment](/DWEA/issues/DWEA-44#comment-01b062ea-cb2b-4478-85b2-bd77634cd464)) explicitly named the GPU + premium-TTS cost lines as "needing eyes on" before [DWEA-49](/DWEA/issues/DWEA-49) implementation work begins.

v1 usage shape (from [DWEA-41 §9](/DWEA/issues/DWEA-41#document-plan)):

- 100 sessions/day × 10–15 turns/session = 30,000–45,000 turns/month.
- Peak concurrency: ≤5 streams (back-of-envelope).
- Per-turn TTS character estimate: ~150–250 chars (short, action-oriented monster utterances).
- Total TTS volume/mo: 30k × 150 = **4.5M chars** (low) to 45k × 250 = **11.25M chars** (high).

§9 plan rev-3 envelope:

- Embodiment layer target: $0.01–$0.05/session.
- Brain target: $0.08–$0.12/session.
- p50 total: $0.15–$0.26/session.
- Monthly all-in at 100 sessions/day: **$450–$780/mo**.
- Trip threshold (§9 disconfirming-evidence): "cost-envelope move >2×".

## 1. Audio2Face-3D NIM hosting

### Background — licensing pivot vs the original cost framing

NVIDIA released Audio2Face-3D under MIT license on **September 24, 2025** ([NVIDIA blog](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/)). The MIT release covers core models, the C++/CUDA SDK, training framework, and Maya/UE5 plugins — i.e. everything we need to build our own container around the open-source model and skip the NVIDIA AI Enterprise (NVAIE) license entirely. This is a meaningful pivot vs the pre-2025 cost framing where A2F-as-a-service implied a ~$1/GPU/hr NVAIE bundle on top of the cloud GPU.

Practically: we have two A2F packaging paths.

- **Path A1 — Custom container around the open-source SDK.** No NVIDIA license fee. ~1 day of engineering to wrap the SDK + gRPC face/blendshape stream into a container. We pay only for the cloud GPU.
- **Path A2 — Pull the official NIM container from NGC.** May still require NVAIE on the deployment host. Less engineering, more recurring cost.

Recommend **A1** for v1. The SDK is in active NVIDIA-maintained repos; the engineering tax is small; the recurring cost win is large.

### GPU sizing

Per [NVIDIA's A2F-3D support matrix](https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/support-matrix.html):

- Memory formula (FP16, no pre-built TRT engines): `0.15 × number_of_streams + 9` GB.
- 5 concurrent streams ≈ **9.75 GB** VRAM floor.
- Optimized GPU set: A10G, A30, **L4**, L40S, RTX 4090, RTX 6000 Ada, B200.
- No multi-GPU support per service instance — scale by running multiple instances if we ever need it (we won't at v1).

Cheapest cloud GPU that comfortably clears the floor and is on the optimized list: **NVIDIA L4 (24 GB)**, available on AWS `g6.xlarge`. A10G via `g5.xlarge` is the fallback.

### Hosting target 1A — Self-host on AWS `g6.xlarge` (L4)

Source: [Vantage instances/g6.xlarge](https://instances.vantage.sh/aws/ec2/g6.xlarge), us-east-1.

| Pricing mode | $/hr | $/mo (730 hr) | $/yr |
|---|---|---|---|
| On-demand | $0.805 | $588 | $7,055 |
| **1-yr reserved (recommended)** | **$0.524** | **$383** | **$4,591** |
| 3-yr reserved | $0.369 | $269 | $3,232 |
| Spot (interruptible — not for prod) | $0.367 | $268 | — |

- Add ~$15/mo overhead for EBS gp3 storage + low egress (audio/blendshape traffic is small).
- **Recommend 1-yr reserved** for v1: ~**$400/mo** steady-state, ~**$4.8k first-year**. Reserved at 1 yr matches v1's 4–6 week shipping window plus 6–9 months of post-launch demo runway without locking us out of a v2 architecture pivot.

### Hosting target 1B — Self-host on AWS `g5.xlarge` (A10G)

Sources: [Vantage instances/g5.xlarge](https://instances.vantage.sh/aws/ec2/g5.xlarge).

| Pricing mode | $/hr | $/mo (730 hr) |
|---|---|---|
| On-demand | $1.006 | $734 |
| 1-yr reserved | $0.634 | $463 |
| 3-yr reserved | $0.435 | $318 |

`g5.xlarge` (A10G) is ~20% more expensive than `g6.xlarge` (L4) at every term. A10G has more compute headroom — useful only if the L4's compute (not VRAM) becomes the bottleneck under load. At our v1 shape (5 concurrent streams, 1 box), the L4 wins on price/performance. Keep `g5.xlarge` as the fallback if we hit unexplained latency on L4.

### Hosting target 2 — NVIDIA NIM marketplace / managed

NVIDIA does **not** publish a per-inference rate card or a per-hour managed endpoint price for A2F-3D as a SaaS product.

- [build.nvidia.com](https://build.nvidia.com/nvidia/audio2face-3d) hosts a preview endpoint for evaluation only — 40 req/min, dev-account credits (~1k–5k inferences), and the NVIDIA Developer Program ToS explicitly excludes production use ("not for serving real end-users" — [NIM FAQ](https://docs.api.nvidia.com/nim/docs/product)).
- The "production" path NVIDIA points to is **NVIDIA AI Enterprise** (NVAIE) license + NIM container on your own cloud GPU. NVAIE is priced per GPU per hour cloud (~$1/GPU/hr on AWS/GCP/Azure marketplaces) or $1,000–$4,500/GPU/yr for a multi-year subscription ([NVIDIA AI Enterprise pricing guide](https://docs.nvidia.com/ai-enterprise/planning-resource/licensing-guide/latest/pricing.html)).

This collapses to "self-host with a license tax":

| Component | Cost |
|---|---|
| `g6.xlarge` 1-yr reserved | $383/mo |
| NVAIE license, ~$1/GPU/hr cloud | $730/mo |
| Storage + egress | $15/mo |
| **Total** | **~$1,128/mo, ~$13.5k first-year** |

Recommend **against**. Pays a license tax for ergonomic packaging when the underlying model is MIT-licensed and we can build a thin container ourselves in a day. The only argument for taking the NIM container is enterprise support — irrelevant at v1 founding-engineer scale.

### Hosting target 3 — NVIDIA LaunchPad

- 2–4 week free hands-on lab environment (per [NVIDIA LaunchPad FAQ](https://www.nvidia.com/en-us/launchpad/faq/)).
- vSphere-on-NVIDIA enterprise reference servers, time-boxed.
- **Not a production target.** Useful as the first day-zero spike harness for the v1.2 SDK-shape verification — i.e. "run A2F-3D in a known-good environment to bisect issues" — but does not host a deployed monster.

Confirmed: LaunchPad is an evaluation harness only.

### Recommendation — Audio2Face-3D hosting

**Path A1 + AWS `g6.xlarge` (L4) on a 1-year reserved instance.**

- Steady-state: **~$400/mo**.
- First-year: **~$4.8k** (reserved instance + storage + overhead).
- Why: cheapest credible target that fits the optimized GPU set; sidesteps the NVAIE license via the MIT-released SDK; reversible at 12 months if we want to pivot architecture or move to a different cloud.

## 2. ElevenLabs scaled

Sources: [ElevenLabs pricing](https://elevenlabs.io/pricing), [ElevenLabs models](https://elevenlabs.io/docs/overview/models), [Flash/Turbo credit-per-char clarification (ElevenLabs help)](https://help.elevenlabs.io/hc/en-us/articles/27562020846481-What-are-credits).

### Plan tiers (May 2026)

| Plan | $/mo | Credits/mo | Pro voice clones | Notes |
|---|---|---|---|---|
| Free | $0 | 10k | — | Watermarked output, not for prod |
| Starter | $6 | 30k | — | |
| Creator | $11 | 121k | 1 | |
| Pro | $99 | 600k | — | |
| Scale | $299 | 1.8M | 3 | Multi-seat, low-latency labelled |
| **Business** | **$990** | **6M** | **10** | Low-latency "as low as 5¢/min" |
| Enterprise | Custom | Custom | Custom | Sales-only, annual commit |

Credit conversion: standard models (V1 / V2 multilingual) charge **1 credit/char**. **Flash v2.5 / Turbo v2.5 charge 0.5 credits/char on all paid plans** ([source](https://x.com/elevenlabsio/status/1826657205644365908)). Flash v2.5 has ~75ms latency and is the model we want for streaming.

**Streaming surcharge:** none. WebSocket streaming endpoint is included on every paid plan. Same Flash/Turbo credit rate applies whether we hit the streaming endpoint or batch endpoint.

**Voice clone hosting:** professional voice clone count is included in plan tier. No per-clone monthly fee. One custom monster voice fits inside Pro (0 PVCs — Creator only? need to verify on signup), Scale (3 PVCs), or Business (10 PVCs).

### v1 volume sizing

| Volume case | chars/mo | credits/mo (Flash 0.5/char) |
|---|---|---|
| Low: 30k turns × 150 chars | 4.5M | 2.25M |
| Mid: 38k turns × 200 chars | 7.5M | 3.75M |
| **High: 45k turns × 250 chars** | **11.25M** | **5.625M** |

Plan fit (using Flash v2.5 at 0.5 credits/char):

| Plan | Included credits | Covers volume? | Total $/mo at high-case (11.25M chars) |
|---|---|---|---|
| Pro $99 | 600k | No, ~9× short | $99 + 10.65M chars overage @ $0.24/1k = **~$2,650/mo** |
| Scale $299 | 1.8M | No, ~3× short | $299 + 7.65M chars overage @ $0.18/1k = **~$1,675/mo** |
| **Business $990** | **6M** | **Yes for low/mid; ~6% short at high case** | $990 + ~750k chars overage @ $0.12/1k = **~$1,080/mo** |
| Enterprise (rumoured ~$50/M chars Turbo, [source](https://x.com/elevenlabsio/status/1826657205644365908)) | Custom | Yes | ~$560/mo Turbo marginal, but annual commit + sales process |

**Recommendation: Business plan at $990/mo.** First-year: **~$11.9k–$13k** depending on whether we hit overage at the high end of volume. Re-evaluate Enterprise once v1 ships and we have real measured TTS volume — at that point a 12-month Enterprise commit can plausibly halve the line item.

Voice clone setup is a one-time creator action against the Business plan's PVC pool — no extra cost.

## 3. Comparison vs [DWEA-41 §9](/DWEA/issues/DWEA-41#document-plan) envelope

### Combined embodiment line

| Component | Monthly | First-year |
|---|---|---|
| A2F-3D self-host (`g6.xlarge` 1-yr reserved + overhead) | $400 | $4,800 |
| ElevenLabs Business | $990 | $11,880 |
| Embodiment overage (high-volume case) | ~$0–$180 | ~$0–$2,160 |
| **Embodiment subtotal (low–high)** | **$1,390–$1,570** | **$16,680–$18,840** |
| Brain LLM (FE rev-3 calibration: $0.08–$0.12/sess × 3,000 sess/mo) | $240–$360 | $2,880–$4,320 |
| **All-in monthly at 100 sessions/day (low–high)** | **$1,630–$1,930** | **~$19.5k–$23.2k** |

### Per-session cost (amortized)

At the v1 shape of 100 sessions/day = 3,000 sessions/mo:

| Layer | $/session |
|---|---|
| A2F-3D (self-host fixed) | $0.13 |
| ElevenLabs Business (fixed + Flash marginal) | $0.33–$0.42 |
| Brain LLM | $0.08–$0.12 |
| **Total p50** | **$0.54–$0.67** |

§9 envelope target: $0.15–$0.26/session (mid ~$0.20). Per-session at 100/day is **2.1–3.4× the envelope mid**.

### Per-session cost is amortization-noise

The unbundled stack carries **~$1,400/mo of fixed cost** (GPU keep-warm + Business plan minimum) that the Convai-bundled stack didn't have. Per-session math is misleading at low traffic and only fits the envelope at higher traffic:

| Sessions/day | Fixed monthly burn / sessions | $/session (fixed-only) |
|---|---|---|
| 5 (early v1 testing) | $1,400 / 150 | **~$9.30** |
| 100 (v1 demo) | $1,400 / 3,000 | $0.47 |
| 500 (v2 traffic) | $1,400 / 15,000 | $0.09 |
| 1,000 (v2/v3 traffic) | $1,400 / 30,000 | $0.05 |

The §9 envelope was structurally built on a per-session blended rate. The new architecture is fixed + marginal. We need to revise §9 to reflect this — that revision is [DWEA-47](/DWEA/issues/DWEA-47)'s scope ([@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1)) but the FE numbers for the rev are landing here.

### Trip-the-gate determination

§9's disconfirming-evidence rule: **"cost-envelope move >2×"**.

- All-in monthly at 100 sessions/day: **$1,630–$1,930** vs envelope **$450–$780** = **2.1–4.3× the envelope**.
- This **trips the gate**. The §9 rule fires from this direction (unbundled stack), exactly as the [DWEA-44 decision comment](/DWEA/issues/DWEA-44#comment-01b062ea-cb2b-4478-85b2-bd77634cd464) warned: *"these need to land inside §9's envelope or we trip the same gate from the other direction."*

**Largest contributor: ElevenLabs Business plan at $990/mo fixed.** A2F self-host ($400/mo) is a meaningful but smaller line. Brain ($240–$360) is unchanged from rev-3.

## Recommendation

**Trip the gate. File CEO board approval.**

Two framings the board should pick between:

### Framing 1 — Accept the burn for v1 (recommended)

- All-in monthly at v1 shape: **~$1.6–1.9k/mo**, **~$22k first-year**.
- Rationale: $22k is small relative to founding-engineer time-to-ship; the unbundled architecture has structural reversibility (every layer is swappable, no vendor lock); fixed-cost amortizes into envelope-fit by v2 traffic shape; revising §9 to reflect unbundled-stack reality is cheap.
- Risk: spend overshoots if v1 stalls past the 4–6 week window without producing product evidence. Mitigation: revisit at week 6 with measured numbers.

### Framing 2 — Restructure to fit envelope before commit

Three available levers, ordered by reversibility:

1. **Drop ElevenLabs to Pro tier + accept synthetic-quality-cap on v1.** Saves ~$890/mo. Costs the v1.2 voice quality bar — defeats the v1 thesis ("the monster sounds real"). **Reject.**
2. **Negotiate ElevenLabs Enterprise annual commit at ~$50/M chars Turbo.** Saves ~$400–$500/mo. Costs sales cycle (1–2 weeks) and locks 12-month commit. **Worth pursuing in parallel** — but doesn't change the v1 ship plan since fixed-cost reduction is bounded.
3. **Lower v1 traffic target from 100 sessions/day to 25–30 sessions/day** (matches realistic early demo traffic anyway). Embodiment burn unchanged ($1,400/mo fixed); per-session cost rises but absolute monthly burn is the same. Doesn't actually save money — would only help if §9 envelope is rewritten in absolute-monthly terms instead of per-session terms.

### Framing 3 — Pivot architecture

Replace ElevenLabs+A2F with a cheaper TTS+lipsync chain:

- OpenAI gpt-4o-mini-tts ($15/M chars) + Wav2Lip / Riva phoneme-driven lipsync.
- Saves ~$700–$800/mo.
- Costs the v1.2 face/voice quality bar. Wav2Lip is a 2D pixel-paint model and **does not drive ARKit-52 blendshapes** — defeats the §6 v1.2 thesis on a non-humanoid monster rig. **Reject.**

**FE recommendation: Framing 1.** Ship v1 on the spec'd stack; pursue ElevenLabs Enterprise negotiation in parallel; revise §9 envelope rev-4 to acknowledge fixed-cost-plus-marginal architecture.

## Next actions

- [x] Numbers landed in this doc.
- [ ] FE files `request_board_approval` linking [DWEA-48](/DWEA/issues/DWEA-48) + [DWEA-49](/DWEA/issues/DWEA-49) with Framing 1 as the recommended option.
- [ ] On approval, close [DWEA-48](/DWEA/issues/DWEA-48) → auto-resumes [DWEA-49](/DWEA/issues/DWEA-49).
- [ ] [@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1) to fold the fixed-cost-plus-marginal framing into [DWEA-47](/DWEA/issues/DWEA-47) plan rev-3 §9.

## References

- [DWEA-41 §9 plan rev-3 — cost envelope](/DWEA/issues/DWEA-41#document-plan)
- [DWEA-44 — Convai gate-fail spike + decision comment](/DWEA/issues/DWEA-44#comment-01b062ea-cb2b-4478-85b2-bd77634cd464)
- [DWEA-47 — plan rev-3 in flight at ConceptPlanner](/DWEA/issues/DWEA-47)
- [DWEA-49 — v1.2 implementation (blocked on this ticket)](/DWEA/issues/DWEA-49)
- [Audio2Face-3D support matrix (memory formula)](https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/support-matrix.html)
- [NVIDIA Audio2Face open-source release (Sept 24, 2025)](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/)
- [NVIDIA AI Enterprise pricing guide](https://docs.nvidia.com/ai-enterprise/planning-resource/licensing-guide/latest/pricing.html)
- [NVIDIA LaunchPad FAQ](https://www.nvidia.com/en-us/launchpad/faq/)
- [AWS `g6.xlarge` pricing (Vantage)](https://instances.vantage.sh/aws/ec2/g6.xlarge)
- [AWS `g5.xlarge` pricing (Vantage)](https://instances.vantage.sh/aws/ec2/g5.xlarge)
- [ElevenLabs pricing page](https://elevenlabs.io/pricing)
- [ElevenLabs Flash v2.5 / Turbo v2.5 credit pricing](https://x.com/elevenlabsio/status/1826657205644365908)
