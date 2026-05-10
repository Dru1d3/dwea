# σ_log RED_1000 — runbook

Status: stub. The operational sections (§4, §5, §7) become firm once Grafana / PagerDuty alerting is reachable. Source: [DWEA-97](/DWEA/issues/DWEA-97), follow-up [DWEA-99](/DWEA/issues/DWEA-99).

## 1. Trigger condition

This runbook fires when `sigma_log_verdict.json#verdict == "RED_1000"`. That happens when:

- An M0 measurement returns CI upper bound for σ_log > 0.6, or
- A subsequent re-measurement during M1 / M2 (per §5 below) returns the same.

The cohort-health board surfaces a red banner naming the doubled 1,000-session floor and linking this runbook. The M1-launch CI guard ([`sigma-log-gate.sh`](sigma-log-gate.sh)) exits 2 in this state — the launch is blocked until the verdict flips.

## 2. Who is paged

- **Primary on-call:** [FoundingEngineer](/DWEA/agents/foundingengineer).
- **Secondary (architecture decision):** [SystemsArchitect](/DWEA/agents/systemsarchitect).
- **Cohort-sizing review:** [Researcher](/DWEA/agents/researcher) — cohort-floor doubling reopens DWEA-91 §5.
- **Sign-off escalation (M3):** board sign-off chain via [DWEA-91](/DWEA/issues/DWEA-91#document-board-approval-pack-v1) item 5.

Paging mechanism is deferred until the observability stack from [DWEA-85](/DWEA/issues/DWEA-85) §7 lands. Until then, the verdict file change-event is the trigger; reviewers watch the `sigma-log-gate` CI step for `RED_1000` exits.

## 3. Re-file path on DWEA-91 item 5

Cohort-floor language in the board approval pack ([DWEA-91#document-board-approval-pack-v1](/DWEA/issues/DWEA-91#document-board-approval-pack-v1) item 5) currently reads "500-session floor pending M0". On `RED_1000`:

1. SystemsArchitect drafts a board-pack revision that flips the language to "1,000-session floor confirmed by M0 measurement at σ_log = <value>, CI = [<lower>, <upper>]".
2. CEO posts the revision request as a comment on [DWEA-91](/DWEA/issues/DWEA-91), routing the revised pack back to the board.
3. Until the board accepts, M3 sign-off and OD-9 gate-flip are paused.

## 4. M2 cohort-sizing re-evaluation

`RED_1000` doubles the cohort floor. That reshapes the M2 cohort-of-200 milestone in `docs/launch/v1-launch-checklist.md` (deliverable from [DWEA-85](/DWEA/issues/DWEA-85) §7). The re-evaluation is:

1. **Researcher** computes a new statistical-green cohort target at the doubled floor. New target = ceil(200 × 1000 / 500) = **400 sessions** as the lower bound.
2. **CEO** approves the new M2 cohort target and the calendar-week window shape per [DWEA-91](/DWEA/issues/DWEA-91) OQ-7.4.
3. **FoundingEngineer** updates the launch checklist + Grafana cohort-health board target lines.

Trailing-14-day window shape from §7 is preserved unless the board flips OQ-7.4.

## 5. Operational fill-in (deferred)

These sections become firm once the observability stack lands:

- **§5.a** Pager destinations + paging tool (Grafana OnCall vs. PagerDuty free tier).
- **§5.b** Thresholds for the auto re-measurement cadence (proposal: weekly while RED, daily during M0).
- **§5.c** Auto-flip rules for `verdict_source: m0-measurement` writes when consecutive measurements return GREEN.

Tracking: this runbook will be lifted from "stub" to "operational" in the heartbeat that wires Grafana OnCall (downstream of [DWEA-85](/DWEA/issues/DWEA-85) §7).

## 6. Plausible event

Plausible event `sigma_log_red_1000` fires once the cohort-health dashboard auto-refresh job runs against the updated verdict file. Product can watch this in their funnel view to make merch / comms decisions on the doubled cohort. Optional per [DWEA-99](/DWEA/issues/DWEA-99) acceptance; deferred until Plausible self-host is reachable.
