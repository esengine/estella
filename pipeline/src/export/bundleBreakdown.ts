// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bundleBreakdown.ts — which subsystem each byte of a JS bundle came from.
 *
 * A mini-game inlines the SDK, so once the engine binary moves out of the main
 * package the bundle is the largest file left — and `.js` is the one thing a
 * vendor's brotli path does not take. "The scripts are 1.4MB" is not something
 * anyone can act on; "spine is 180KB of it, in a project with no spine" is.
 *
 * esbuild already knows this: a metafile says how many bytes of each INPUT
 * survived into an output, tree-shaking included. This only groups them, and the
 * grouping is the SDK's own directory layout rather than a list kept here.
 */

/** Bytes of one output that came from one module. */
export interface ModuleBytes {
  /** An SDK subsystem (`spine`, `tilemap`…), `dep:<pkg>`, `core`, or `project`. */
  readonly module: string;
  readonly bytes: number;
  /** How many input files contributed — a module that is one file and a module
   *  that is forty read very differently when deciding what to make optional. */
  readonly files: number;
}

/** The shape this reads out of esbuild's metafile — its own type is not imported
 *  so a caller can pass a parsed metafile from anywhere. */
export interface BundleMetafile {
  outputs: Record<string, { inputs?: Record<string, { bytesInOutput?: number }> }>;
}

/**
 * Which module an input path belongs to.
 *
 * A mini-game bundles the SDK's BUILT chunks, and a chunk is also the unit a
 * bundler can act on: it can drop one nothing reaches, and cannot drop half of
 * one. So the SDK's own split is the grouping, not a list kept here.
 */
export function moduleOfInput(input: string): string {
  const chunk = /(?:^|\/)sdk\/dist\/(?:shared\/)?([^/]+)\.[cm]?js$/.exec(input);
  if (chunk) return chunk[1];
  const src = /(?:^|\/)sdk\/src\/([^/]+)\/.+$/.exec(input);
  if (src) return src[1];
  if (/(?:^|\/)sdk\/src\/[^/]+$/.test(input)) return 'core';
  const dep = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (dep) return `dep:${dep[1]}`;
  return 'project';
}

/**
 * Group one output's inputs by module, largest first.
 *
 * `output` is the key as the metafile spells it; a caller that cannot predict
 * esbuild's path spelling can pass a suffix and the single match is used.
 */
export function breakdownOf(meta: BundleMetafile, output: string): ModuleBytes[] {
  const key = meta.outputs[output] ? output
    : Object.keys(meta.outputs).find((k) => k.endsWith(output));
  const inputs = key ? meta.outputs[key]?.inputs ?? {} : {};
  const by = new Map<string, { bytes: number; files: number }>();
  for (const [input, info] of Object.entries(inputs)) {
    const bytes = info.bytesInOutput ?? 0;
    // A file tree-shaken down to nothing is not a module this package carries,
    // and listing it as 0 bytes reads as one that is merely small.
    if (bytes <= 0) continue;
    const at = by.get(moduleOfInput(input)) ?? { bytes: 0, files: 0 };
    at.bytes += bytes;
    at.files += 1;
    by.set(moduleOfInput(input), at);
  }
  return [...by.entries()]
    .map(([module, v]) => ({ module, bytes: v.bytes, files: v.files }))
    .sort((a, b) => b.bytes - a.bytes);
}
