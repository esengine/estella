// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Match the source identity already stored by native/tools/mkbc.c and checked
 * by native/host/Runtime.cpp. Artifact extraction and rebuilding an unchanged SDK
 * alter file times, but neither changes which SDK the bytecode contains. */
export function bytecodeMatchesBundle(bytecode, bundle) {
  if (bytecode.length <= 8) return false;
  // generateSdkBundle embeds one leading newline before the UTF-8 bundle.
  let hash = 1469598103934665603n;
  for (const byte of Buffer.concat([Buffer.from('\n'), Buffer.from(bundle)])) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return bytecode.readBigUInt64LE(0) === hash;
}
