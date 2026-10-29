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

import { RuntimeConfig } from '../../defaults';
import { bitmapFontFamily } from './bitmap-font';

/** Distinct from any ResourceManager handle (those count up from small ints). */
const HANDLE_BASE = 0x4000_0000;

let nextHandle = HANDLE_BASE;
let nextFontLoad = 0;

/** Runtime handle → owned path and platform family. */
const families = new Map<number, { path: string; family: string }>();
/** Asset path → live handles; legacy path registration reuses the first. */
const byPath = new Map<string, Set<number>>();

/** A CSS-safe, collision-free family name for a font asset path. */
export function familyNameFor(path: string): string {
    const stem = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
    const safe = stem.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
    // ASCII uses two hex digits; other UTF-16 units use a distinct marker plus
    // four digits. The reversible suffix preserves paths without a shared registry.
    let tag = '';
    for (let i = 0; i < path.length; i++) {
        const code = path.charCodeAt(i);
        tag += code < 128 ? code.toString(16).padStart(2, '0') : `z${code.toString(16).padStart(4, '0')}`;
    }
    return `es-${safe}-${tag || '0'}`;
}

/**
 * Record a registered project font and return its handle. Idempotent per path:
 * loading the same asset twice yields the same handle, so scene reloads and
 * multiple referencing entities share one registration.
 */
export function registerProjectFont(path: string, family: string): number {
    const existing = byPath.get(path)?.values().next().value;
    if (existing !== undefined) return existing;
    return registerProjectFontEra(path, family);
}

/** @internal A platform registration must not overwrite a still-owned font face. */
export function freshProjectFontFamily(path: string): string {
    return `${familyNameFor(path)}-load${(++nextFontLoad).toString(36)}`;
}

/** @internal Each prepared asset era owns a distinct runtime handle. */
export function registerProjectFontEra(path: string, family: string): number {
    const handle = nextHandle++;
    families.set(handle, { path, family });
    let handles = byPath.get(path);
    if (!handles) byPath.set(path, handles = new Set());
    handles.add(handle);
    return handle;
}

/** The family name for a handle, or null when it is not a project font. */
export function projectFontFamily(handle: number): string | null {
    return families.get(handle)?.family ?? null;
}

/** @internal Release only the registration owned by this font result. */
export function releaseProjectFontEra(handle: number): void {
    const record = families.get(handle);
    if (!record) return;
    families.delete(handle);
    const handles = byPath.get(record.path);
    handles?.delete(handle);
    if (handles?.size === 0) byPath.delete(record.path);
}

/** Forget a project font (asset unload). The family stays registered with the
 *  platform — browsers offer no removal that is safe while glyphs may be cached. */
export function unregisterProjectFont(path: string): void {
    const handles = byPath.get(path);
    if (!handles) return;
    for (const handle of handles) releaseProjectFontEra(handle);
}

/**
 * The family a `Text` should rasterize with: its project font when `font` names
 * one, else the authored `fontFamily`, else the project's default family. The
 * single place that precedence lives — an empty `fontFamily` is how a Text says
 * "whatever this project uses", which is what makes that project setting real.
 */
export function resolveTextFamily(font: number | undefined, fontFamily: string): string {
    return (font ? projectFontFamily(font) ?? bitmapFontFamily(font) : null) ?? (fontFamily || RuntimeConfig.defaultFontFamily);
}

/** Test seam: drop every registration. */
export function resetProjectFonts(): void {
    families.clear();
    byPath.clear();
    nextHandle = HANDLE_BASE;
}
