# Architecture

Repo mirrors of accepted architecture decision records (ADRs).

The governance home for each ADR is the linked Paperclip issue document — that's where revisions are drafted, discussed, and signed off. This directory holds the in-repo copy at the latest **ACCEPTED** revision so the codebase is self-contained for readers without portal access. Amendments do not start here; they go through the ADR's §12 amendment log on the issue first, then this mirror is updated.

## v1

- [v1 Platform ADR](v1-platform-adr.md) — production stack, free-tier. Splat capture + runtime, character pipeline, brain (LiteLLM → Groq/Gemini/Ollama), STT/TTS (faster-whisper / Kokoro / Piper), Audio2Face-3D OSS precompute-and-cache, Cloudflare + GitHub Pages + Turso deploy, free-tier ceiling verification. Governance: [DWEA-88](/DWEA/issues/DWEA-88#document-v1-platform-adr) (active).
- [v1 Platform ADR (premium-tier roadmap, v0.5)](/DWEA/issues/DWEA-53#document-adr-v1-platform) — Wave 1 forward-looking ADR with premium components (Anthropic / Inworld / Deepgram / Postgres / self-host A2F-3D). Retired as the active v1 ADR by v1.0 above; preserved as the **v1.x premium-tier upgrade target**.
