// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WeChat MiniGame export — a thin binding of the shared mini-game export
 *        pipeline (exportMiniGame.ts) to the WeChat profile. All of the assembly
 *        logic lives in exportMiniGame; this file only fixes the vendor and
 *        preserves the WeChat-typed public surface exportGame consumes.
 */
import { exportMiniGame } from './exportMiniGame';
import { wechatExportProfile } from './miniGameExportProfile';

export interface ExportWeChatResult {
  ok: boolean;
  platform: 'wechat';
  outDir: string;
  included: number;
  warnings: string[];
  errors: string[];
}

/** Parameters accepted by {@link exportWeChat} — the shared pipeline options. */
export type ExportWeChatOptions = Parameters<typeof exportMiniGame>[1];

/**
 * Export the open project as a WeChat MiniGame into `outDir`. See
 * {@link exportMiniGame} for the full contract; WeChat-specific behavior
 * (config files, WXWebAssembly glue names, es2017 floor, suffix whitelist) is
 * carried by {@link wechatExportProfile}.
 */
export async function exportWeChat(opts: ExportWeChatOptions): Promise<ExportWeChatResult> {
  const res = await exportMiniGame(wechatExportProfile, opts);
  // The wechat profile's id is 'wechat', so the result platform is 'wechat'.
  return res as ExportWeChatResult;
}
