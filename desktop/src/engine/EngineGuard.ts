// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { ABI_LAYOUT_HASH } from 'esengine';

/**
 * Build-consistency guard for the engine wasm the editor loads.
 *
 * The editor links the `esengine` TS SDK at compile time but loads the wasm
 * binary (`public/wasm/esengine.{js,wasm}`) separately at runtime. Nothing in
 * the bundler ties those two artifacts together, so a stale or wrong-variant
 * wasm can sit next to a newer SDK. The engine's own bridge handshake reads the
 * wasm's `getAbiLayoutHash()` and *fatally* rejects a true layout mismatch — but
 * only at runtime, only for layout (not build variant), and only once the heavy
 * instantiate has run.
 *
 * This guard is the cheap, early, *advisory* complement: it reads a build
 * manifest stamped beside the wasm at sync time and surfaces drift (ABI hash,
 * variant) and provenance (git sha, build time) *before* instantiation. It is
 * intentionally non-fatal — a manifest can be stale if a binary was hand-copied
 * without re-running the sync, and we must never block a genuinely-fine boot on
 * stale metadata. The authoritative fatal check stays in the runtime handshake,
 * which reads the real binary.
 */

const MANIFEST_URL = '/wasm/wasm.manifest.json';

/** The wasm build variant the editor expects (web is the only one with a GL/web glue path). */
const EDITOR_TARGET = 'web';

export interface WasmManifest {
  /** Manifest schema version (for forward-compat). */
  schema: number;
  /** ABI layout hash the wasm was built against (== the SDK's ABI_LAYOUT_HASH at build time). */
  abiHash: string;
  /** Build variant the synced binary came from (web | wechat | playable). */
  editorTarget?: string;
  /** Variants present in the wasm dir at sync time. */
  variants?: string[];
  /** Short git sha of the build, for provenance. */
  gitSha?: string;
  /** ISO timestamp the binary was built/synced, for provenance. */
  builtAt?: string;
}

export type GuardLevel = 'ok' | 'warn';

export interface GuardResult {
  level: GuardLevel;
  /** One-line summary for the console / status. */
  message: string;
  manifest: WasmManifest | null;
}

const provenance = (m: WasmManifest): string =>
  `variant=${m.editorTarget ?? '?'} abi=${m.abiHash} git=${m.gitSha ?? '?'} builtAt=${m.builtAt ?? '?'}`;

/**
 * Pure evaluation of a (maybe-null) manifest against the SDK's expected ABI and
 * variant. No I/O — unit-testable. Never returns a fatal level by design.
 */
export function evaluateManifest(manifest: WasmManifest | null): GuardResult {
  if (!manifest) {
    return {
      level: 'ok',
      manifest: null,
      message:
        'engine wasm: no build manifest (legacy / hand-copied binary). ' +
        'ABI is still verified fatally by the runtime bridge handshake.',
    };
  }
  if (manifest.abiHash !== ABI_LAYOUT_HASH) {
    return {
      level: 'warn',
      manifest,
      message:
        `engine wasm ABI drift: manifest says the binary was built for ABI ${manifest.abiHash}, ` +
        `but this SDK expects ${ABI_LAYOUT_HASH}. If boot then fails with an ABI error, rebuild + ` +
        `resync the wasm (syncToDesktop). The manifest may also be stale if the binary was ` +
        `hand-copied. [${provenance(manifest)}]`,
    };
  }
  const target = manifest.editorTarget ?? EDITOR_TARGET;
  if (target !== EDITOR_TARGET) {
    return {
      level: 'warn',
      manifest,
      message:
        `engine wasm variant drift: public/wasm is the '${target}' build but the editor expects ` +
        `'${EDITOR_TARGET}'. Feature flags differ; behavior may be wrong. [${provenance(manifest)}]`,
    };
  }
  return { level: 'ok', manifest, message: `engine wasm ok — ${provenance(manifest)}` };
}

/**
 * Fetch the manifest and evaluate it. Network/parse failures degrade to the
 * "no manifest" (ok) path so a missing manifest never blocks boot.
 */
export async function checkEngineBuild(): Promise<GuardResult> {
  let manifest: WasmManifest | null = null;
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok) manifest = (await res.json()) as WasmManifest;
  } catch {
    manifest = null;
  }
  return evaluateManifest(manifest);
}
