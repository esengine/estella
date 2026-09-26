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
  EXPORT_PROFILE_FIELDS, resolveAppId, resolveLayout, resolveOrientation, resolveScripts,
  type ExportPlatform, type ProjectManifest, type ProjectPackaging,
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

/**
 * The project as one of its export profiles describes it: the profile's settings
 * laid over the project's, its target's slice merged field by field so a profile
 * that names only a test appid keeps the project's version code.
 */
export function withExportProfile(manifest: ProjectManifest, name: string): ProjectManifest {
  const profiles = manifest.packaging?.profiles ?? {};
  const profile = profiles[name];
  if (!profile) {
    const known = Object.keys(profiles);
    throw new Error(`no export profile "${name}" — ${known.length ? `this project has ${known.join(', ')}` : 'this project defines none'}`);
  }
  const packaging = manifest.packaging ?? {};
  const target = profile.platform as keyof NonNullable<ProjectPackaging['platforms']>;
  const slice = { ...packaging.platforms?.[target], ...profile.platforms?.[target] };
  const overrides = Object.fromEntries(EXPORT_PROFILE_FIELDS
    .filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]]));
  return {
    ...manifest,
    packaging: {
      ...packaging,
      ...overrides,
      platform: profile.platform,
      platforms: { ...packaging.platforms, ...(Object.keys(slice).length > 0 ? { [target]: slice } : {}) },
    },
  };
}

export async function projectExportOptions(
  root: string, source: ProjectManifest, platform: ExportPlatform, profileName?: string,
): Promise<ProjectExportOptions> {
  const profile = profileName ? source.packaging?.profiles?.[profileName] : undefined;
  const manifest = profileName ? withExportProfile(source, profileName) : source;
  if (profile && profile.platform !== platform) {
    throw new Error(`export profile "${profileName}" is for ${profile.platform}, not ${platform}`);
  }
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
    ...(profile ? {
      profile: profileName,
      ...(profile.config ? { minify: profile.config === 'shipping' } : {}),
      ...(profile.remoteRoot !== undefined ? { hotUpdate: { remoteRoot: profile.remoteRoot } } : {}),
    } : {}),
  };
}
