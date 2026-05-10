# DWEA observability — σ_log verdict scaffolding

This directory holds the σ_log cohort-floor verdict scaffolding. It is the
truth source for three downstream consumers:

1. **M1 launch CI gate** — `sigma-log-gate.sh` exits 0 on GREEN, 2 on RED /
   missing / malformed. Wired to [`.github/workflows/m1-launch-gate.yml`](../../../.github/workflows/m1-launch-gate.yml).
2. **Grafana cohort-health overlays** — `grafana/sigma-log-overlays.json` is a
   Grafana 9+ dashboard JSON with three panels (TTFA p95, TTF-Face p95,
   cohort-health verdict gauge) plus the chip / banner UI affordances.
   `grafana/dashboard-loader.sh` POSTs the dashboard to a Grafana instance with
   the `$verdict` template variable baked from `sigma_log_verdict.json`.
3. **RED_1000 runbook** — `sigma-log-red-runbook.md`. Stub; operational
   sections fill in once Grafana OnCall lands.

## Files

| File | Role |
|---|---|
| `sigma_log_verdict.json` | Canonical verdict file. v1 default = `GREEN_500_FLAG`. |
| `sigma_log_verdict.schema.json` | JSON Schema for the verdict file. |
| `sigma-log-verdict-state.md` | State machine spec + UI affordances. |
| `sigma-log-red-runbook.md` | RED_1000 paging runbook (stub). |
| `sigma-log-gate.sh` | Fail-closed M1 launch deploy gate. |
| `sigma-log-write.sh` | Atomic writer for `sigma_log_verdict.json` — supports manual override and measurement-derived modes. |
| `grafana/sigma-log-overlays.json` | Importable Grafana dashboard. |
| `grafana/dashboard-loader.sh` | Renders dashboard with current verdict + POSTs to Grafana API. |

## Common operations

### Hand-flip the verdict (staging branch)

```bash
docs/architecture/observability/sigma-log-write.sh --manual-override --verdict GREEN_500 --notes "M0 measurement returned σ_log=0.42 CI=[0.30,0.49]"
git add docs/architecture/observability/sigma_log_verdict.json
git commit -m "ops: flip σ_log verdict to GREEN_500"
```

### Drive the verdict from a real measurement

```bash
docs/architecture/observability/sigma-log-write.sh --from-measurement path/to/sigma_log_M0.json
```

The measurement JSON must include `sigma_log`, `ci_lower`, `ci_upper`,
`measured_at`, and ideally `sample_count`. Verdict derivation rules are in
`sigma-log-verdict-state.md` §2.

### Push the dashboard to Grafana

```bash
GRAFANA_URL=https://example.grafana.net \
GRAFANA_TOKEN=glsa_… \
docs/architecture/observability/grafana/dashboard-loader.sh
```

For local validation without a Grafana instance: `… dashboard-loader.sh --dry-run`.

### Run the gate locally

```bash
docs/architecture/observability/sigma-log-gate.sh   # uses the canonical file
```

## Verdict-write integration choice

Per [DWEA-97](/DWEA/issues/DWEA-97) item 3, two options were on the table:

- **Option 1 (chosen)** — promote the ad-hoc `compute_sigma_log.py` invocation to a standardised writer (`sigma-log-write.sh`). One canonical writer keeps the truth-bearing surface narrow and decouples cadence from format.
- **Option 2 (rejected)** — extend an existing measurement script with a `--write-verdict` flag.

Rationale: the verdict file is the source of truth for both the gate and the dashboard. A standalone writer has no coupling to a particular measurement script, and CI workflows can call it with `--manual-override` for emergency state flips without touching measurement code.
