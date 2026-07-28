// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/font-registry.ts
 * @brief   Project fonts: the handle ↔ family-name map for shipped font files.
 *
 * The whole text pipeline — layout, the glyph atlas cache key, every rasterizer
 * — speaks ONE language for "which typeface": a family name string. A system
 * font already has one. A font the game ships does not, until the platform's
 * text stack is told about it (browser `FontFace`, the native host's font
 * table), and that registration needs a name to file it under.
 *
 * This module owns that name. The font asset loader mints one per font asset,
 * registers the bytes with the platform under it, and gets back a handle to
 * store in `Text.font`; the text plugin turns that handle back into the family
 * it passes down the pipeline. Nothing downstream of the plugin changes — which
 * is the point: shipped fonts are not a second text path, just another way to
 * arrive at a family name.
 *
 * Handles are allocated from a HIGH base so they can never be confused with the
 * C++ bitmap-font handles `BitmapText.font` holds: both live in the same
 * `font`-typed asset slot vocabulary, and a `.fnt` assigned to `Text.font`
 * must miss this table (falling back to `fontFamily`) rather than alias a
 * project font that happens to share a small integer.
 */

/** Distinct from any ResourceManager handle (those count up from small ints). */
const HANDLE_BASE = 0x4000_0000;

let nextHandle = HANDLE_BASE;

/** handle → family name. */
const families = new Map<number, string>();
/** asset path → handle, so re-loading the same font is idempotent. */
const byPath = new Map<string, number>();

/** A CSS-safe, collision-free family name for a font asset path. */
export function familyNameFor(path: string): string {
    const stem = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
    const safe = stem.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
    // The path suffix keeps two same-named fonts in different folders apart —
    // a family name is a global key in every platform's text stack.
    const tag = Math.abs([...path].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)).toString(36);
    return `es-${safe}-${tag}`;
}

/**
 * Record a registered project font and return its handle. Idempotent per path:
 * loading the same asset twice yields the same handle, so scene reloads and
 * multiple referencing entities share one registration.
 */
export function registerProjectFont(path: string, family: string): number {
    const existing = byPath.get(path);
    if (existing !== undefined) return existing;
    const handle = nextHandle++;
    families.set(handle, family);
    byPath.set(path, handle);
    return handle;
}

/** The family name for a handle, or null when it is not a project font. */
export function projectFontFamily(handle: number): string | null {
    return families.get(handle) ?? null;
}

/** Forget a project font (asset unload). The family stays registered with the
 *  platform — browsers offer no removal that is safe while glyphs may be cached. */
export function unregisterProjectFont(path: string): void {
    const handle = byPath.get(path);
    if (handle === undefined) return;
    byPath.delete(path);
    families.delete(handle);
}

/**
 * The family a `Text` should rasterize with: its project font when `font` names
 * one, else the authored `fontFamily`. The single place that precedence lives.
 */
export function resolveTextFamily(font: number | undefined, fontFamily: string): string {
    return (font ? projectFontFamily(font) : null) ?? fontFamily;
}

/** Test seam: drop every registration. */
export function resetProjectFonts(): void {
    families.clear();
    byPath.clear();
    nextHandle = HANDLE_BASE;
}
