# σ_log verdict — state machine + UI affordances

Status: v1 launch default `GREEN_500_FLAG`. Source decision: [DWEA-95](/DWEA/issues/DWEA-95) (CEO Path 1 — pre-emptive prudence). Pre-wire scaffolding: [DWEA-97](/DWEA/issues/DWEA-97). Grafana panels + M1-launch CI gate: [DWEA-99](/DWEA/issues/DWEA-99).

## 1. Why this state machine exists

`σ_log` is the cohort-floor pre-condition for the M1 launch gate. The cohort-floor assumption (500 sessions) is unmeasured at v1 cut. Voice-agent pipelines structurally sit at `σ_log ∈ [0.5, 0.8]`, which makes `GREEN_500_FLAG` the most-likely M0 outcome. Wiring all three verdict states now removes M1-launch coupling and avoids a scramble on launch day.

## 2. Three verdict states

| Verdict | σ_log range | Cohort floor | UI treatment | Gate exit |
|---|---|---|---|---|
| `GREEN_500` | σ_log ≤ 0.5 with CI upper bound ≤ 0.5 | 500 | Neutral. No chip, no banner. | exit 0 |
| `GREEN_500_FLAG` | σ_log ≤ 0.5 but CI upper bound ∈ (0.5, 0.6], **or** unmeasured | 500 | Warning chip on TTFA p95 / TTF-Face p95 panels: "σ_log cohort-floor assumption unmeasured — see [DWEA-95](/DWEA/issues/DWEA-95) and the M0 measurement child" | exit 0 |
| `RED_1000` | CI upper bound > 0.6 | 1000 | Red banner on cohort-health board: "σ_log breach: cohort floor doubled to 1,000 sessions — see RED_1000 runbook" linking [`sigma-log-red-runbook.md`](sigma-log-red-runbook.md) | exit 2 |

**Undefined band — escalate to architect.** Measurements with `σ_log > 0.5` *and* `ci_upper ∈ (0.5, 0.6]` (i.e. the point estimate is above the GREEN ceiling but the CI has not yet crossed into RED) do **not** map to any of the three verdicts. `sigma-log-write.sh --from-measurement` deliberately exits 65 without writing the verdict file rather than guessing. On-call action: escalate to [SystemsArchitect](/DWEA/agents/systemsarchitect) for an architectural call — typical responses are to re-measure with a larger sample, or to treat as `RED_1000` if the trend is degrading. Do **not** silently extend `GREEN_500_FLAG` to cover this band.

### 2.1 State transitions

```
            +-----------------+
            |  GREEN_500_FLAG |  <-- v1 launch default (prudent)
            +--------+--------+
                     |
        M0 returns   |   M0 returns
        σ_log ≤ 0.5  |   CI upper > 0.6
        and CI ≤ 0.5 |
                     v
            +-----------------+         +------------+
            |    GREEN_500    |         |  RED_1000  |
            +-----------------+         +------------+
                     ^                        |
                     |                        |
                     +---- new measurement ---+
                          puts CI ≤ 0.5
```

`verdict_source` field captures provenance (`default-prudent`, `m0-measurement`, `manual-override`).

### 2.2 UI affordances detail

- **TTFA p95 panel** (latency budget ≤ 1500 ms, per ADR §4.4): adds a `σ_log` row beneath the p95 stat that surfaces the warning chip when verdict is `GREEN_500_FLAG`. Tooltip text: "Cohort-floor of 500 sessions assumed; σ_log is unmeasured. Measurement filed as DWEA-95." Tooltip link → `/DWEA/issues/DWEA-95`.
- **TTF-Face p95 panel** (latency budget ≤ 2000 ms): same chip, same tooltip.
- **Cohort-health board** verdict gauge: a single-stat panel mapped to the verdict label. `GREEN_500` is green, `GREEN_500_FLAG` is amber, `RED_1000` is red. When `RED_1000`, an annotation banner above the panel shows the runbook link.
- **Tooltip / link wiring:** all three panels carry a `verdict_doc_url` panel-link template variable, defaulted to the doc URL of [DWEA-95](/DWEA/issues/DWEA-95) and overridden to the runbook in `RED_1000`.

## 3. Verdict source

The verdict file is `docs/architecture/observability/sigma_log_verdict.json` (committed). Schema: [`sigma_log_verdict.schema.json`](sigma_log_verdict.schema.json).

- v1 launch ships the file with `verdict: GREEN_500_FLAG` and `verdict_source: default-prudent`.
- Once a real M0 measurement runs in staging, the measurement script writes a fresh verdict file (see §4 verdict-write integration).

The Grafana panels read the verdict via a `$verdict` template variable. The M1-launch CI gate reads it directly via [`sigma-log-gate.sh`](sigma-log-gate.sh).

## 4. Verdict-write integration

DWEA-97 left this open between two options:

- **Option 1**: promote the ad-hoc `compute_sigma_log.py` invocation to a standardised "M0 measurement run" that writes `sigma_log_M0.json` directly into the canonical path.
- **Option 2**: extend an existing measurement script with a `--write-verdict` flag.

**Choice: Option 1.** The measurement run becomes a standalone CLI under `docs/architecture/observability/sigma-log-write.sh`, writing the canonical `sigma_log_verdict.json`. Justification:

1. The verdict file is the source of truth for both the gate and the dashboard. One canonical writer keeps the truth-bearing surface narrow.
2. A standalone writer has no coupling to a particular measurement script — when the M0 measurement script lands ([DWEA-95](/DWEA/issues/DWEA-95)), it can call the writer and pass `--from-measurement <json>`. This decouples cadence from format.
3. CI workflows can call the writer with `--manual-override` for emergency state flips without touching the measurement code path.

The writer enforces the schema, refuses unknown verdicts, and writes atomically (tmpfile + rename). See `sigma-log-write.sh --help` for usage.

## 5. M0 dogfood run plan

Per [DWEA-95](/DWEA/issues/DWEA-95), the M0 measurement runs against staging TTFA / TTF-Face traffic before M1 launch. Once the measurement script writes a verdict via `sigma-log-write.sh --from-measurement`, the workflow is:

1. Staging deploy job runs the measurement, captures `sigma_log_<date>.json`.
2. `sigma-log-write.sh --from-measurement` overwrites `sigma_log_verdict.json` and commits the change on a measurement branch.
3. `m1-launch-gate.yml` re-runs against the updated verdict; `GREEN_500` unblocks the launch.
4. If `RED_1000`, the runbook in [`sigma-log-red-runbook.md`](sigma-log-red-runbook.md) takes over.

## 6. Plausible event id (optional)

The runbook §6 calls for a Plausible event id that fires on `RED_1000` for product-side awareness. Event name: `sigma_log_red_1000`. Wired by the cohort-health dashboard auto-refresh job once Plausible is reachable; deferred until the [DWEA-85](/DWEA/issues/DWEA-85) §7 Plausible self-host stack lands.
