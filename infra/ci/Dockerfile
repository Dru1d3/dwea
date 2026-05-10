# Shared DWEA CI image
#
# Extends the official Microsoft Playwright Jammy image so headless Chromium
# starts inside CI/agent containers without the libglib/libnss/libX11 gap that
# blocks the visual-gate harness on stock GitHub Ubuntu runners. Bakes in the
# extra tooling DWEA's §1 capture pipeline and §5 lint/typecheck/test/build
# pipeline both need.
#
# Source: infra/ci/Dockerfile in github.com/Dru1d3/dwea
# Published: ghcr.io/dru1d3/dwea-ci:latest (see .github/workflows/build-ci-image.yml)

ARG PLAYWRIGHT_TAG=v1.49.1-jammy
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_TAG}

ARG PNPM_VERSION=10.33.2

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Base build/test tooling. ffmpeg covers §1 frame extraction; jq/git/curl are
# table-stakes; build-essential + python3 cover any node-gyp packages; image
# utilities (optipng/pngquant) and ImageMagick support visual-gate diff steps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        jq \
        git \
        curl \
        ca-certificates \
        xz-utils \
        unzip \
        build-essential \
        python3 \
        python3-pip \
        optipng \
        pngquant \
        imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Pin pnpm via corepack so it matches packageManager in package.json.
RUN corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate \
    && pnpm --version

# §1 capture-pipeline binaries (Brush 0.3 + gsbox SPZ 4) install at workflow
# time once their release URLs are pinned in DWEA-87's quality-gate work — they
# pull GPU-only deps that are wasted weight on the lint/typecheck/test/build
# path. The system libs they need are already provided by the Playwright base
# (libgl1, libegl1, libglib2.0, libnss3, libx11) so a `curl … | tar -xz` step
# in the consuming workflow is sufficient.

WORKDIR /workspace

LABEL org.opencontainers.image.source="https://github.com/Dru1d3/dwea" \
      org.opencontainers.image.description="Shared DWEA CI image — Playwright Jammy + Node 20 + pnpm + ffmpeg, used by lint/typecheck/test/build and the visual-gate harness." \
      org.opencontainers.image.licenses="MIT"
