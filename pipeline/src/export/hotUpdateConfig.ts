// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  hotUpdateConfig.ts — the hot-update delivery a package carries.
 */
import { loadAssetGroups } from '../assets/cookAssets';
import { activeRemoteRoot } from '../../../sdk/src/asset/assetGroups';

/**
 * Hot-update delivery a package carries: the active build profile's CDN root (an
 * explicit override wins), plus a persistence key so a returning player boots on
 * already-updated content. Only when a CDN root is configured — a project with no
 * remote groups ships nothing extra. Every packaged target asks this one function.
 */
export async function packagedHotUpdate(
  root: string, override?: { remoteRoot?: string; persistUpdateKey?: string },
): Promise<{ remoteRoot?: string; persistUpdateKey?: string } | undefined> {
  const remoteRoot = override?.remoteRoot ?? activeRemoteRoot(await loadAssetGroups(root));
  const persistUpdateKey = override?.persistUpdateKey ?? (remoteRoot ? 'esengine:hotupdate' : undefined);
  return remoteRoot || persistUpdateKey
    ? { ...(remoteRoot ? { remoteRoot } : {}), ...(persistUpdateKey ? { persistUpdateKey } : {}) }
    : undefined;
}

