// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectExportOptions.ts — what a project's own settings say an export of
 *        it is, for one target.
 *
 * The Build dialog and the command line each assembled this by hand, and the two
 * lists drifted: a headless package carried no app id, ignored a project's script
 * entry and scenes folder and its ad network, while the dialog dropped the
 * project's engine module choices. Both now start from this one answer and lay
 * only what the person chose for this build on top.
 */
import path from 'node:path';
import type { ExportGameOptions } from './exportGame';
import { readReleaseKey } from './rpk';
import { loadPlayableProfile } from './platformCatalog';
import {
  resolveAppId, resolveLayout, resolveOrientation, resolveScripts,
  type ExportPlatform, type ProjectManifest,
} from '../project/format';
import { BUILTIN_PLATFORMS, isMiniGamePlatform } from '../project/platforms';
import { cookOptionsOf, packagingOptionsOf, runtimeConfigOf } from '../project/runtimeConfig';

/** The part of an export a project's manifest decides; the caller adds where the
 *  engine, templates and output live, and the choices made for this one build. */
export type ProjectExportOptions = Omit<ExportGameOptions,
  'hostsDir' | 'packagesDir' | 'sdkDistDir' | 'wasmDir' | 'outDir'>;

const NATIVE_IDENTITY: Partial<Record<ExportPlatform, 'android' | 'ios' | 'desktop'>> = {
  android: 'android', ios: 'ios', desktop: 'desktop',
};

export async function projectExportOptions(
  root: string, manifest: ProjectManifest, platform: ExportPlatform,
): Promise<ProjectExportOptions> {
  const packaging = manifest.packaging;
  const plat = packaging?.platforms;
  const vendor = (plat as Record<string, { appid?: string } | undefined> | undefined)?.[platform];
  const quickGame = platform === 'quickgame' ? plat?.quickgame : platform === 'huawei' ? plat?.huawei : undefined;
  const identity = NATIVE_IDENTITY[platform];
  return {
    root,
    platform,
    entryScene: manifest.defaultScene ?? '',
    scenesDir: resolveLayout(manifest).scenes,
    scriptsEntry: resolveScripts(manifest).main,
    title: manifest.name || path.basename(root),
    orientation: resolveOrientation(manifest),
    runtime: runtimeConfigOf(manifest),
    ...cookOptionsOf(manifest),
    ...packagingOptionsOf(manifest),
    // A project-defined target is a mini-game variant built on WeChat's, so it
    // ships WeChat's id; a built-in vendor ships only its own.
    miniGameAppid: isMiniGamePlatform(platform) ? vendor?.appid
      : (BUILTIN_PLATFORMS as readonly string[]).includes(platform) ? undefined : plat?.wechat?.appid,
    ...(identity ? { appId: resolveAppId(manifest, identity) } : {}),
    appVersion: manifest.version,
    ...(quickGame ? {
      miniGameVersionCode: quickGame.versionCode,
      miniGameReleaseKey: (await readReleaseKey(root, quickGame.releaseKey)) ?? undefined,
    } : {}),
    androidVersionCode: plat?.android?.versionCode,
    androidAppBundle: plat?.android?.appBundle,
    androidOutput: plat?.android?.output,
    desktopProductName: plat?.desktop?.productName,
    desktopChannel: plat?.desktop?.channel,
    steam: plat?.desktop?.steam,
    ...(platform === 'playable'
      ? { playableAdProfile: (await loadPlayableProfile(root, plat?.playable?.network)) ?? undefined }
      : {}),
    sizeBudgetBytes: packaging?.sizeBudget?.[platform],
  };
}
