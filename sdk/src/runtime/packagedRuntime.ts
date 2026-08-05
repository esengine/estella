// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    packagedRuntime.ts
 * @brief   The asset assembly every PACKAGED realm shares — a WeChat mini-game,
 *          a native app: realms that ship cooked content beside the runtime and
 *          read it off the device rather than over HTTP.
 * @details The addressable manifest is the single source: it resolves a ref to a
 *          staged path, and its atlas metadata builds the catalog the loaders
 *          consult for their inner text refs (a material's shader). Everything
 *          here is DOM-free and transport-free — the platform layer decides how
 *          the bytes arrive, so the same code serves both realms.
 */

import { toBuildPath } from '../assetTypes';
import { extractUuid } from '../asset/AssetRegistry';
import { platformReadTextFile, platformLoadImagePixels } from '../platform';
import { ManifestModel, type AddressableManifest } from '../asset/AddressableManifest';
import { Catalog, atlasCatalogFields, type CatalogEntry } from '../asset/Catalog';
import { FileSystemBackend, type Backend } from '../asset/Backend';
import type { ParsedTextureImportSettings } from '../asset/textureImportSettings';
import { Audio } from '../audio/Audio';
import type { AudioProjectConfig } from '../audio/AudioProjectConfig';
import type { PhysicsPluginConfig } from '../physics/PhysicsTypes';
import { parseThemeOverrides, type ThemeOverrides } from '../ui/theme/tokens';
import { VideoPlayer } from '../video/VideoAPI';
import type { App } from '../app/app';
import type { RuntimeAssetSource } from './runtimeAssets';
import { registerSideModule } from '../sideModules/registry';

/**
 * `game.config.json` — what an export bakes about the project, and the contract
 * between the export pipeline that writes it and every runtime that reads it.
 * One declaration so the two sides cannot drift.
 */
export interface PackagedGameConfig {
    /** Project-relative path of the scene the game boots into. */
    entryScene: string;
    /** Every switchable scene (SceneManager name + cooked path); includes the entry. */
    scenes?: Array<{ name: string; path: string }>;
    /** Bitmask of render layers (0..31) that y-sort within the layer. */
    ySortLayers?: number;
    /** Bitmask of render layers (0..31) that resolve by real depth (2.5D). */
    depthLayers?: number;
    /** Project color space — 'linear' boots the linear-light pipeline. */
    colorSpace?: 'gamma' | 'linear';
    /** Project camera fit (design resolution + scale mode) — letterboxes the main
     *  camera without a UI Canvas; absent = no fit. */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** Project widget theme; absent = dark. */
    uiTheme?: 'light';
    /** Project theme color overrides (role → #rrggbbaa hex). */
    uiThemeColors?: Record<string, string>;
    /**
     * Install physics even when the shipped scene shows no bodies — a project
     * that spawns them from script (Project Settings → Physics → Enabled).
     * Absent ⇒ physics installs only when a scene actually uses it.
     */
    physicsEnabled?: boolean;
    /** The physics world the project declared: gravity, solver, collision matrix.
     *  Absent ⇒ the engine's own defaults. */
    physicsConfig?: PhysicsPluginConfig;
    /** Project mixer state: bus volumes, custom buses, effects, duck rules.
     *  Absent ⇒ the default mix. */
    audioConfig?: AudioProjectConfig;
    /** Hot-update delivery: the CDN root `remote`-group assets resolve against +
     *  the storage key an applied update persists under (both optional). */
    hotUpdate?: { remoteRoot?: string; persistUpdateKey?: string };
    /**
     * Optional native modules this project supplied itself, staged beside the
     * engine's own (see `.esengine/modules/<id>/`).
     *
     * The declaration ships rather than being discovered, because discovery is not
     * possible where it matters: a mini-game cannot list a directory and a
     * playable has no directory at all. The export knows what it staged, so it
     * says so, and every transport resolves these ids exactly like a built-in.
     */
    sideModules?: Array<{ id: string; file: string; globalName?: string }>;
}

/** The packaged realm's resolved asset index — manifest, catalog, resolution. */
export interface PackagedAssetIndex {
    manifest: AddressableManifest;
    model: ManifestModel;
    /** Logical → staged mapping for the loaders' inner refs; absent when the
     *  build stages assets under their logical paths (nothing to remap). */
    catalog?: Catalog;
    /** Resolve any ref spelling (`@uuid:`, logical, "/"-rooted) to a staged path. */
    resolvePath(ref: string): string;
    /** The asset's LOGICAL source path for any ref spelling (including its own staged
     *  path), or null when unknown — recovers the authored directory a
     *  content-addressed rename hid. */
    addressOf(ref: string): string | null;
    /** Every staged asset path — content-driven discovery (locale tables). */
    assetPaths(): string[];
    /** How a texture is sampled and 9-sliced, for any ref spelling. */
    textureImport(ref: string): ParsedTextureImportSettings | undefined;
}

/**
 * Build the catalog from an addressable manifest. Content-addressed packs rename
 * physical files, so assets carrying an `address` (their logical source path) get
 * a catalog buildPath. Atlas-packed frames additionally register frame/uv, keyed
 * by every ref spelling a scene can use.
 */
/**
 * Register the project modules this build staged, so `sideModules.acquire(id)`
 * resolves them the way it resolves the engine's own.
 *
 * Every realm calls this after reading its config and before anything acquires —
 * one line each rather than one clever shared boot, because the four realms do
 * not share a boot: the web fetches its config, native reads it off disk, a
 * mini-game requires it, and a playable has it inlined.
 */
export function registerPackagedSideModules(config: Pick<PackagedGameConfig, 'sideModules'>): void {
    for (const m of config.sideModules ?? []) {
        if (!m?.id || !m.file) continue;
        registerSideModule(m.id, m.globalName ? { file: m.file, globalName: m.globalName } : { file: m.file });
    }
}

/**
 * The app options a packaged config declares — everything an App must be built
 * WITH (shaders compile against the colour space; the layer masks are renderer
 * state set before the first frame).
 *
 * Every host projected these by hand and each list was a chance to miss one: the
 * web host was still building its App without the 2.5D depth mask after the
 * export had started shipping it, so a shipped game could carry the setting and
 * ignore it. One projection, so a field added to the config reaches every realm
 * that spreads it.
 */
export function packagedAppOptions(
    config: Pick<PackagedGameConfig, 'ySortLayers' | 'depthLayers' | 'colorSpace' | 'screenFit'>,
): {
    ySortLayers?: number;
    depthLayers?: number;
    colorSpace?: 'gamma' | 'linear';
    screenFit?: PackagedGameConfig['screenFit'];
} {
    return {
        ySortLayers: config.ySortLayers,
        depthLayers: config.depthLayers,
        colorSpace: config.colorSpace,
        screenFit: config.screenFit,
    };
}

/**
 * The {@link initRuntime} arguments a packaged config declares — everything
 * applied to a LIVE app rather than baked into its construction. The twin of
 * {@link packagedAppOptions}; between them a host names the config once.
 */
export function packagedRuntimeInit(
    config: Pick<PackagedGameConfig,
        'physicsEnabled' | 'physicsConfig' | 'audioConfig' | 'uiTheme' | 'uiThemeColors'>,
): {
    physicsEnabled?: boolean;
    physicsConfig?: PhysicsPluginConfig;
    audioConfig?: AudioProjectConfig;
    uiTheme?: 'light';
    uiThemeOverrides?: ThemeOverrides;
} {
    return {
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsConfig,
        audioConfig: config.audioConfig,
        uiTheme: config.uiTheme,
        uiThemeOverrides: parseThemeOverrides(config.uiThemeColors),
    };
}

export function catalogFromManifest(manifest: AddressableManifest): Catalog | undefined {
    const entries: Record<string, CatalogEntry> = {};
    for (const group of Object.values(manifest.groups)) {
        for (const [uuid, asset] of Object.entries(group.assets)) {
            const md = asset.metadata;
            const atlasFields = md?.atlasFrame && md.atlasPageWidth && md.atlasPageHeight
                ? atlasCatalogFields(
                    { page: md.atlasPage, frame: md.atlasFrame, pageWidth: md.atlasPageWidth, pageHeight: md.atlasPageHeight },
                    asset.path,
                )
                : null;
            if (atlasFields) {
                entries[`@uuid:${uuid}`] = { type: asset.type, buildPath: asset.path, ...atlasFields };
            }
            if (!asset.address || asset.address === asset.path) continue;
            entries[asset.address] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}) };
            entries[`/${asset.address}`] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}) };
        }
    }
    return Object.keys(entries).length > 0 ? Catalog.fromJson({ version: 1, entries }) : undefined;
}

/** Read + index the packaged addressable manifest through the platform's reader. */
export async function loadPackagedAssetIndex(
    manifestPath = 'asset-manifest.json',
): Promise<PackagedAssetIndex> {
    const manifest = JSON.parse(await platformReadTextFile(manifestPath)) as AddressableManifest;
    return indexPackagedManifest(manifest);
}

/** {@link loadPackagedAssetIndex} over an already-parsed manifest. */
export function indexPackagedManifest(manifest: AddressableManifest): PackagedAssetIndex {
    const model = ManifestModel.fromJson(manifest);
    return {
        manifest,
        model,
        catalog: catalogFromManifest(manifest),
        // A scene spells asset refs `@uuid:<v4>`, while the manifest indexes bare
        // uuids — strip the prefix before looking up, or every `@uuid:` ref falls
        // through as a literal path and 404s.
        resolvePath: (ref) => model.resolvePath(extractUuid(ref) ?? ref, toBuildPath),
        // The authored logical path behind any spelling — its uuid, its logical
        // address, or its staged (content-addressed) path. Lets a loader recover the
        // directory a sibling was authored in after the rename hid it.
        addressOf: (ref) => {
            const asset = model.assetByKey(extractUuid(ref) ?? ref) ?? model.assetByPath(ref);
            return asset ? (asset.address ?? asset.path) : null;
        },
        // The logical address where there is one (content-addressed packs rename
        // the staged file), else the staged path — either keeps the extension
        // .eslocale discovery filters on.
        assetPaths: () => model.allAssets().map((a) => a.address ?? a.path),
        // Built once per index: a scene preload asks for every texture it uses,
        // and rebuilding the spelling map per ref would walk the whole manifest
        // each time.
        textureImport: model.textureImportLookup(),
    };
}

/** Transport overrides for realms that do not read bytes off a device. */
export interface PackagedAssetSourceOptions {
    /** Where bytes come from; the platform's packaged-file reader by default. */
    backend?: Backend;
    /** Image → RGBA; the platform's decode by default. A cooked web build passes
     *  a fetch+blob decoder instead: drawing a cross-origin image into a canvas
     *  taints it, and getImageData then throws. */
    decodePixels?: RuntimeAssetSource['decodePixels'];
}

/**
 * The asset source a packaged realm runs on: manifest-driven ref resolution over
 * whatever transport the realm has. One construction for every realm that ships
 * cooked content — a mini-game, a native app, a cooked web build — so a fix to
 * how refs or asset listings resolve reaches all three.
 */
export function createPackagedAssetSource(
    index: PackagedAssetIndex,
    options: PackagedAssetSourceOptions = {},
): RuntimeAssetSource {
    return {
        backend: options.backend ?? new FileSystemBackend(),
        decodePixels: options.decodePixels ?? ((path) => platformLoadImagePixels(path)),
        resolveRef: index.resolvePath,
        resolveAddress: index.addressOf,
        listAssetPaths: index.assetPaths,
        textureImportSettings: index.textureImport,
    };
}

/**
 * Route audio and video refs through the same resolver as every other asset.
 * `playSFX` / a video source take plain paths rather than `@uuid:` refs, so
 * without this they would miss the logical→staged mapping a cooked build needs —
 * one resolution channel, not a parallel base-URL scheme per media type.
 */
export function applyAssetRefResolvers(app: App, resolveRef: (ref: string) => string): void {
    if (app.hasResource(Audio)) app.getResource(Audio).setRefResolver(resolveRef);
    if (app.hasResource(VideoPlayer)) app.getResource(VideoPlayer).setRefResolver(resolveRef);
}
