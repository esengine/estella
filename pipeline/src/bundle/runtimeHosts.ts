// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  runtimeHosts.ts — the browser-realm hosts an export bundles, named once.
 *
 * An export re-bundles every host by name from ONE directory: the sources in
 * `pipeline/src/runtime`, or the tree an editor prebuilds from them (a packaged
 * app ships no sources, and esbuild cannot read app.asar). The prebuild takes its
 * entries from this list as well, so a host the exporter asks for is a host the
 * editor ships — two lists kept by hand disagree without either failing to build.
 */
import path from 'node:path';
import { ESENGINE_EXTERNAL } from './esengineResolve';

// `douyinPlatformProfile` is not a host but travels the same way: a built-in
// vendor's runtime profile is a module the generated entry imports, so the
// editor has to ship it for the same reason it ships the hosts.
export const RUNTIME_HOSTS = [
  'gameHost', 'playableHost', 'playableLoader', 'douyinPlatformProfile', 'kuaishouPlatformProfile',
] as const;

export type RuntimeHost = (typeof RUNTIME_HOSTS)[number];

/**
 * The esbuild entry for `host` in `hostsDir`. Extensionless on purpose: the sources
 * are `.ts` and a prebuilt tree `.js`, and esbuild resolves either.
 */
export function runtimeHostEntry(hostsDir: string, host: RuntimeHost): string {
  return path.join(hostsDir, host);
}

/** esbuild options that prebuild every runtime host from `sourceDir` into `outdir`. */
export function runtimeHostPrebuild(sourceDir: string, outdir: string) {
  return {
    entryPoints: RUNTIME_HOSTS.map((host) => ({ in: path.join(sourceDir, `${host}.ts`), out: host })),
    outdir,
    bundle: true,
    format: 'esm' as const,
    platform: 'browser' as const,
    target: 'es2020',
    external: ESENGINE_EXTERNAL,
  };
}
