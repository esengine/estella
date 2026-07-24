// Static config for the hot-update center: the delivery endpoint, the DLC pack
// refs, and the palette. Kept data-only so the systems read as pure wiring.
import type { Color } from 'esengine';

/** The `pack` addressable group (see `.esengine/asset-groups.json`) pulled on
 *  demand by the "Download pack" button — the DLC pattern. */
export const PACK_GROUP = 'pack';

/** The pack's textures, by ordinary project-relative path (the ref a game
 *  actually writes — loaders resolve it, routing through the `pack` remote group
 *  to the CDN automatically). The order here is the on-screen tile order. */
export const PACK_TILES: readonly string[] = [
    'assets/pack/tile0.png',
    'assets/pack/tile1.png',
    'assets/pack/tile2.png',
    'assets/pack/tile3.png',
    'assets/pack/tile4.png',
    'assets/pack/tile5.png',
];

/**
 * Where "Check for update" looks for a candidate manifest. A shipped build (or a
 * host) can point this at a CDN by setting `window.__estellaHotUpdate` before the
 * game boots; otherwise we probe a same-origin `asset-manifest.json` and treat a
 * miss as "already up to date" (the editor Play case — there is no newer build to
 * fetch, so the update flow honestly reports it).
 */
export interface HotUpdateEndpoint {
    manifestUrl: string;
    remoteRoot: string;
}

export function hotUpdateEndpoint(): HotUpdateEndpoint {
    const w = globalThis as unknown as { __estellaHotUpdate?: Partial<HotUpdateEndpoint> };
    const cfg = w.__estellaHotUpdate ?? {};
    return {
        manifestUrl: cfg.manifestUrl ?? 'asset-manifest.json',
        remoteRoot: cfg.remoteRoot ?? '',
    };
}

/**
 * True when booted headless for the render verify (`index.html?headless=1`). In
 * that mode the verify harness drives `checkForUpdate`/`applyUpdate` directly on
 * the Assets resource, so we must NOT auto-check — two drivers would race the one
 * staged pending-update. Button-driven flows are always safe (never auto-fired).
 */
export function isHeadless(): boolean {
    const loc = (globalThis as unknown as { location?: { search?: string } }).location;
    return typeof loc?.search === 'string' && /(?:\?|&)headless\b/.test(loc.search);
}

// ── Palette (0..1 linear-ish sRGB triples the UI authors in) ────────────────
export const COLORS = {
    card: { r: 0.11, g: 0.12, b: 0.15, a: 0.96 } as Color,
    cardSoft: { r: 0.11, g: 0.12, b: 0.15, a: 0.90 } as Color,
    track: { r: 0.24, g: 0.26, b: 0.31, a: 1 } as Color,
    accent: { r: 0.29, g: 0.56, b: 0.95, a: 1 } as Color,
    accentHover: { r: 0.36, g: 0.62, b: 0.98, a: 1 } as Color,
    accentPressed: { r: 0.22, g: 0.46, b: 0.82, a: 1 } as Color,
    control: { r: 0.22, g: 0.24, b: 0.29, a: 1 } as Color,
    controlHover: { r: 0.28, g: 0.30, b: 0.36, a: 1 } as Color,
    controlPressed: { r: 0.18, g: 0.20, b: 0.24, a: 1 } as Color,
    ok: { r: 0.29, g: 0.80, b: 0.52, a: 1 } as Color,
    warn: { r: 0.96, g: 0.62, b: 0.30, a: 1 } as Color,
    text: { r: 0.93, g: 0.95, b: 0.98, a: 1 } as Color,
    muted: { r: 0.60, g: 0.64, b: 0.72, a: 1 } as Color,
    tileEmpty: { r: 0.20, g: 0.22, b: 0.27, a: 1 } as Color,
} as const;
