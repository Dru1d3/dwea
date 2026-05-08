#!/usr/bin/env node
// Headless visual-capture harness.
//
// Loads a built (or dev) DWEA app at a given URL, navigates to a committed
// scene route (`#/<scene-id>`), waits until the splat has settled, and
// writes a PNG. Designed to be reused across DWEA-60 (palette), DWEA-61
// (motion-curves), DWEA-62 (lighting) and any future visual gates.
//
// Usage:
//   node scripts/visual-capture/capture.mjs \
//     --url http://localhost:4173 \
//     --scene garden \
//     --out /tmp/hollow-after.png \
//     [--viewport 1280x800] [--settle-ms 9000] [--hide-ui]
//
// Notes:
//   * The harness does NOT spawn a server — the caller starts/stops the
//     vite dev or preview server. That keeps the script reusable across
//     branches (you can point it at any local or remote build).
//   * `--settle-ms` is the wall-clock pause AFTER the canvas appears and
//     network goes idle, before the screenshot. Splats are streamed and
//     progressively densify; the default 9 s yields a stable bake on
//     cakewalk-format scenes via swiftshader. Bump it for slower captures.
//   * `--hide-ui` injects CSS that hides the HUD/SceneSwitcher/ChatPanel so
//     the screenshot only contains the canvas. Defaults to ON because the
//     visual gate is the canvas; opt out with `--hide-ui=false`.
//   * If the canvas read-back is fully black or transparent (swiftshader
//     bailed on the splat shader), the script exits 2 — that is the signal
//     to escalate to the board for a manual capture.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { chromium } from 'playwright';

/**
 * Resolve a chromium binary, falling back to the regular Chrome for Testing
 * build if `chromium-headless-shell` is not installed. Some CI environments
 * (notably Paperclip agent containers) cannot install both browsers.
 */
function resolveChromiumExecutable() {
  const root = env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined; // playwright will use its default cache
  const candidates = [
    `${root}/chromium_headless_shell-1217/chrome-linux/headless_shell`,
    `${root}/chromium-1217/chrome-linux/chrome`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function parseArgs() {
  const args = { hideUi: true, viewport: '1280x800', settleMs: 9000 };
  const tail = argv.slice(2);
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if (a === '--url') args.url = tail[++i];
    else if (a === '--scene') args.scene = tail[++i];
    else if (a === '--out') args.out = tail[++i];
    else if (a === '--viewport') args.viewport = tail[++i];
    else if (a === '--settle-ms') args.settleMs = Number.parseInt(tail[++i], 10);
    else if (a === '--hide-ui') args.hideUi = true;
    else if (a === '--hide-ui=false') args.hideUi = false;
    else if (a === '--keep-ui') args.hideUi = false;
    else if (a === '--help' || a === '-h') {
      console.info(
        'Usage: capture.mjs --url <base> --scene <id> --out <path>',
        '[--viewport WxH] [--settle-ms N] [--hide-ui|--keep-ui]',
      );
      exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      exit(64);
    }
  }
  if (!args.url || !args.scene || !args.out) {
    console.error('--url, --scene and --out are required');
    exit(64);
  }
  const [w, h] = args.viewport.split('x').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    console.error(`--viewport must be WxH, got ${args.viewport}`);
    exit(64);
  }
  args.width = w;
  args.height = h;
  return args;
}

const HIDE_UI_CSS = `
  /* DWEA HUD + scene switcher + chat panel + emotion badge — chrome we
     never want in the visual gate. The R3F canvas is left untouched. */
  nav[aria-label="Splat scene"],
  [data-vc-hide="true"],
  [class*="ChatPanel"],
  [class*="Hud"],
  [class*="SceneTuner"],
  [class*="SettingsDialog"],
  [class*="EmotionBadge"],
  body > div:not(#root):not([data-vc-keep])
  { display: none !important; visibility: hidden !important; }
`;

async function main() {
  const args = parseArgs();
  const target = `${args.url.replace(/\/+$/, '')}/#/${args.scene}`;
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });

  const executablePath = resolveChromiumExecutable();
  if (executablePath) console.error(`[capture] using browser: ${executablePath}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // swiftshader is the headless-WebGL fallback. The splat renderer
      // uses WebGL2; force-enable it for chromium's headless mode.
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      console.error(`[page:${t}]`, m.text());
    }
  });
  page.on('pageerror', (e) => console.error('[page:error]', e.message));

  console.error(`[capture] navigating: ${target}`);
  await page.goto(target, { waitUntil: 'load', timeout: 60_000 });

  if (args.hideUi) {
    await page.addStyleTag({ content: HIDE_UI_CSS });
  }

  console.error('[capture] waiting for canvas …');
  await page.waitForSelector('canvas', { timeout: 30_000 });

  // Wait for the splat fetch to land (cakewalk hosts on huggingface.co).
  // Network-idle alone is unreliable because three.js sets up persistent
  // workers, so we additionally settle on a fixed timer.
  try {
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
  } catch {
    console.error('[capture] networkidle timeout — proceeding to settle window anyway');
  }
  console.error(`[capture] settling ${args.settleMs} ms before snapshot …`);
  await page.waitForTimeout(args.settleMs);

  // Sanity-check the canvas has non-trivial pixel content. A fully black
  // or fully white frame usually means swiftshader could not run the splat
  // shader, which is the signal to escalate per CEO directive.
  const stats = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const w = Math.min(canvas.width, 256);
    const h = Math.min(canvas.height, 256);
    if (w <= 0 || h <= 0) return null;
    // Read via a 2d offscreen so we don't need a preserve-drawing-buffer.
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const buckets = new Map();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0) opaque += 1;
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return { sampled: (data.length / 4) | 0, opaque, distinctBuckets: buckets.size };
  });
  console.error('[capture] canvas stats:', stats);
  if (!stats || stats.opaque < 16 || stats.distinctBuckets < 4) {
    console.error(
      '[capture] canvas appears blank or near-uniform — swiftshader likely could not render the splat. Escalate to board for manual capture.',
    );
    await browser.close();
    exit(2);
  }

  await page.screenshot({ path: outPath, type: 'png', fullPage: false });
  console.error(`[capture] wrote ${outPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
