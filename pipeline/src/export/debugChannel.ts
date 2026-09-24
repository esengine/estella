// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  debugChannel.ts — whether a package carries the line back to the editor.
 */
import type { DebugChannelConfig } from 'esengine';

/**
 * The channel a package is built with, or none. A shipping export that was handed
 * one fails rather than drops it: a caller asking for both has a bug, and a build
 * that dials an editor must never reach a player.
 */
export function packagedDebugChannel(
  opts: { debugChannel?: DebugChannelConfig | null; minify?: boolean },
): DebugChannelConfig | undefined {
  if (!opts.debugChannel) return undefined;
  if (opts.minify) {
    throw new Error('a shipping build never carries a debug channel — export the Development config to debug on a device');
  }
  return { url: opts.debugChannel.url };
}
