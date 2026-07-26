// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assetGroups.ts
 * @brief   The project's asset-delivery configuration model + resolver.
 *
 * `.esengine/asset-groups.json` is the SINGLE authored source for *which assets
 * ship where*: any folder can be marked a delivery group (local / subpackage /
 * remote-CDN), decoupling the delivery decision from a magic folder NAME. Build
 * profiles carry the CDN root per environment (dev / prod). This module is the
 * pure model + resolver shared by BOTH the cook (staging + manifest) and the
 * editor Play realm (its addressable manifest) — one implementation, so the two
 * can never disagree about what group an asset is in.
 *
 * Pure and dependency-free (no fs / DOM); the fs load lives in the cook / editor.
 */
import type { BundleMode } from './AddressableManifest';

/** The user-facing delivery modes for a group, as a runtime list so callers
 *  (the editor's Delivery menu / badges) enumerate them from one source instead
 *  of hand-repeating the members. `subpackage` maps to the manifest's `lazy`
 *  bundle mode; `local`/`remote` map to themselves. */
export const ASSET_GROUP_MODES = ['local', 'subpackage', 'remote'] as const;

export type AssetGroupMode = typeof ASSET_GROUP_MODES[number];

/** One authored group: every asset under `folder` (recursively) joins it. */
export interface AssetGroupDef {
    /** Project-relative folder whose assets belong to this group. */
    folder: string;
    mode: AssetGroupMode;
    /**
     * Ship every asset in this folder whether or not a scene references it.
     *
     * A build cooks what it can REACH from the entry scenes, which is right for
     * anything a scene names — and blind to anything named only in code: a path
     * built at runtime, a texture in rich-text markup, a clip picked by id. This
     * is where a project says so, rather than discovering at run time on a device
     * that the file was culled. (Unity's Resources folder and Unreal's additional
     * cook directories are the same declaration.)
     *
     * Off by default: reachability is what keeps a build from shipping the whole
     * project.
     */
    alwaysInclude?: boolean;
}

/** A build environment's variables — currently just the CDN root remote groups
 *  are served from (dev vs prod differ; the export bakes the active one in). */
export interface BuildProfile {
    remoteRoot?: string;
}

/** The whole `.esengine/asset-groups.json` document. */
export interface AssetGroupsConfig {
    version: string;
    /** groupName → definition. */
    groups?: Record<string, AssetGroupDef>;
    /** Which profile is active for a build (key into `profiles`). */
    activeProfile?: string;
    profiles?: Record<string, BuildProfile>;
}

/** The group + delivery an asset resolves to (delivery is the manifest's typed
 *  {@link BundleMode}, so cook staging / manifest / runtime all speak one type). */
export interface ResolvedAssetGroup {
    name: string;
    delivery: BundleMode;
    /** See {@link AssetGroupDef.alwaysInclude}. */
    alwaysInclude: boolean;
}

/** Map a user-facing mode to the manifest bundle mode (`subpackage` → `lazy`). */
export function modeToDelivery(mode: AssetGroupMode): BundleMode {
    return mode === 'subpackage' ? 'lazy' : mode;
}

const SUBPACKAGE_RE = /^subpackages\/([^/]+)\//;
const REMOTE_RE = /^remote\/([^/]+)\//;

/**
 * The delivery group an asset belongs to, in priority order:
 *   1. An explicit `config.groups` entry whose `folder` is (the longest) prefix
 *      of the asset's path — the modern, name-decoupled configuration.
 *   2. The legacy folder-name convention (`subpackages/<name>/` → lazy,
 *      `remote/<name>/` → remote) — kept as a zero-config default / back-compat.
 *   3. `main` / `local` — the eagerly-shipped default.
 *
 * Pure: `config` is the parsed document (or null when the project has none).
 * The SINGLE resolver the cook and the editor Play realm both call.
 */
export function resolveAssetGroup(
    projectRelPath: string,
    config: AssetGroupsConfig | null | undefined,
): ResolvedAssetGroup {
    const path = projectRelPath.replace(/\\/g, '/');

    if (config?.groups) {
        let best: { name: string; def: AssetGroupDef; len: number } | null = null;
        for (const [name, def] of Object.entries(config.groups)) {
            const folder = def.folder.replace(/\\/g, '/').replace(/\/+$/, '');
            if (folder === '' ) continue;
            if (path === folder || path.startsWith(`${folder}/`)) {
                if (!best || folder.length > best.len) best = { name, def, len: folder.length };
            }
        }
        if (best) {
            return {
                name: best.name,
                delivery: modeToDelivery(best.def.mode),
                alwaysInclude: best.def.alwaysInclude === true,
            };
        }
    }

    const sub = SUBPACKAGE_RE.exec(path);
    if (sub) return { name: sub[1], delivery: 'lazy', alwaysInclude: false };
    const rem = REMOTE_RE.exec(path);
    if (rem) return { name: rem[1], delivery: 'remote', alwaysInclude: false };

    return { name: 'main', delivery: 'local', alwaysInclude: false };
}

/** The CDN root of the active build profile (the value the export bakes into the
 *  shipped `game.config.json` so `remote`-group assets resolve against it).
 *  Undefined when no profile / no root is set. */
export function activeRemoteRoot(config: AssetGroupsConfig | null | undefined): string | undefined {
    const active = config?.activeProfile;
    if (!active) return undefined;
    const root = config?.profiles?.[active]?.remoteRoot;
    return root && root.trim() !== '' ? root.replace(/\/+$/, '') : undefined;
}

const normFolder = (folder: string): string => folder.replace(/\\/g, '/').replace(/\/+$/, '');

/** The delivery mode a config assigns to `folder` directly — `local` when the
 *  folder has no group of its own (parent-folder groups don't count here; this is
 *  the per-folder authoring state, for a menu check / badge). */
export function folderGroupMode(config: AssetGroupsConfig | null | undefined, folder: string): AssetGroupMode {
    const norm = normFolder(folder);
    for (const def of Object.values(config?.groups ?? {})) {
        if (normFolder(def.folder) === norm) return def.mode;
    }
    return 'local';
}

/**
 * A copy of `config` with `folder` assigned delivery `mode` — the pure authoring
 * mutation the editor writes to `.esengine/asset-groups.json`. `local` removes any
 * group for the folder; otherwise the group name is the folder's last path segment
 * (deduped against existing names).
 */
export function withFolderGroup(
    config: AssetGroupsConfig | null | undefined,
    folder: string,
    mode: AssetGroupMode,
): AssetGroupsConfig {
    const norm = normFolder(folder);
    const groups: Record<string, AssetGroupDef> = { ...(config?.groups ?? {}) };
    for (const [name, def] of Object.entries(groups)) {
        if (normFolder(def.folder) === norm) delete groups[name];
    }
    if (norm !== '' && mode !== 'local') {
        const base = norm.split('/').pop() || 'group';
        let name = base;
        let i = 2;
        while (groups[name]) name = `${base}${i++}`;
        groups[name] = { folder: norm, mode };
    }
    return { version: '1.0', ...config, groups };
}

/** A copy of `config` with the active build profile's CDN root set (creating the
 *  profile — default `dev` — and making it active). Pure. */
export function withActiveRemoteRoot(
    config: AssetGroupsConfig | null | undefined,
    remoteRoot: string,
): AssetGroupsConfig {
    const active = config?.activeProfile ?? 'dev';
    const profiles: Record<string, BuildProfile> = { ...(config?.profiles ?? {}) };
    profiles[active] = { ...profiles[active], remoteRoot };
    return { version: '1.0', ...config, activeProfile: active, profiles };
}
