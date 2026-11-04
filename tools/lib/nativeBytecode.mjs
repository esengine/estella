// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The identity Runtime.cpp keys its compile caches by, and native/tools/mkbc.c
 * stores ahead of shipped bytecode: FNV-1a 64 of what the host compiles, which is
 * the bundle behind one leading newline (generateSdkBundle embeds it that way). */
export function bundleIdentity(bundle) {
  let hash = 1469598103934665603n;
  for (const byte of Buffer.concat([Buffer.from('\n'), Buffer.from(bundle)])) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return hash;
}

/** The same identity, as the 16 hex digits a template manifest records. */
export function bundleIdentityHex(bundle) {
  return bundleIdentity(bundle).toString(16).padStart(16, '0');
}

/** Match the source identity already stored by native/tools/mkbc.c and checked
 * by native/host/Runtime.cpp. Artifact extraction and rebuilding an unchanged SDK
 * alter file times, but neither changes which SDK the bytecode contains. */
export function bytecodeMatchesBundle(bytecode, bundle) {
  if (bytecode.length <= 8) return false;
  return bytecode.readBigUInt64LE(0) === bundleIdentity(bundle);
}

/**
 * Whether the host in @p templateDir embeds @p bundle — whichever engine it runs.
 * A template records the identity of the SDK it embeds (`sdkBundle` in
 * template.json); an older one is read off its QuickJS bytecode, which carries the
 * same identity. A V8 template has no bytecode, so without the manifest field
 * there is nothing to answer with.
 *
 * @returns {boolean | null} null when the template cannot say.
 */
export function templateEmbedsBundle(templateDir, bundle) {
  const manifest = path.join(templateDir, 'template.json');
  if (existsSync(manifest)) {
    const recorded = JSON.parse(readFileSync(manifest, 'utf8')).sdkBundle;
    if (typeof recorded === 'string') return recorded === bundleIdentityHex(bundle);
  }
  const bytecode = path.join(templateDir, 'esengine.native.qjsbc');
  return existsSync(bytecode) ? bytecodeMatchesBundle(readFileSync(bytecode), bundle) : null;
}
