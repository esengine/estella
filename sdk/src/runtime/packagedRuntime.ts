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

import type { QualityConfig } from '../render/quality';
import type { SkinCacheConfig } from '../render/skinCache';
import type { DebugChannelConfig } from './debugChannelProtocol';
import { platformReadTextFile, platformLoadImagePixels } from '../platform';
import { ManifestModel, type AddressableManifest } from '../asset/AddressableManifest';
import { Catalog, atlasCatalogFields, type CatalogEntry } from '../asset/Catalog';
import { FileSystemBackend, type Backend } from '../asset/Backend';
import type { ParsedTextureImportSettings } from '../asset/textureImportSettings';
import type { SpineCullingRect } from '../asset/spineImportSettings';
import { Audio } from '../audio/Audio';
import { parseThemeOverrides } from '../ui/theme/tokens';
import { VideoPlayer } from '../video/VideoAPI';
import type { App } from '../app/app';
import type { RuntimeAssetSource } from './runtimeAssets';
import type { RuntimeInitConfig } from './runtimeLoader';
import type { SceneData } from '../scene/scene';
import { registerSideModule } from '../sideModules/registry';
import type { AotModuleConfig } from '../ecs/aot/AotSystems';
import { runtimeProjectSettings, type RuntimeProjectSettings } from './projectSettings';

/** The package omits the default dark theme and encodes overrides as hex colors. */
interface PackagedProjectSettings extends Omit<RuntimeProjectSettings, 'uiThemeOverrides'> {
    uiTheme?: 'light';
    uiThemeColors?: Record<string, string>;
}

/**
 * `game.config.json` — what an export bakes about the project, and the contract
 * between the export pipeline that writes it and every runtime that reads it.
 * One declaration so the two sides cannot drift.
 */
export interface PackagedGameConfig extends PackagedProjectSettings {
    /** External Web distribution SDK selected by this export. */
    webChannel?: 'poki' | 'crazygames' | 'youtube';
    /** Public client encryption key for invited CrazyGames leaderboards; never a server API key. */
    leaderboardEncryptionKey?: string;
    /** Project-relative path of the scene the game boots into. */
    entryScene: string;
    /** Every switchable scene (SceneManager name + cooked path); includes the entry. */
    scenes?: Array<{ name: string; path: string }>;
    /**
     * Scenes the cook cut into cells, each with the manifest describing them.
     * Deliberately not in `scenes`: a cell is content residency brings in, not a
     * place a game switches to.
     */
    worlds?: Array<{ scene: string; manifest: string }>;
    /**
     * The project's own bundled code, as a payload-relative file name. Absent
     * means this build has none — which is how a host tells "no project script"
     * from "the project script failed to load". Guessing between those with a
     * catch runs the empty world and calls it a success.
     */
    scripts?: string;
    /** Bitmask of render layers (0..31) that y-sort within the layer. */
    ySortLayers?: number;
    /** Bitmask of render layers (0..31) that resolve by real depth (2.5D). */
    depthLayers?: number;
    /** Project color space — 'linear' boots the linear-light pipeline. */
    colorSpace?: 'gamma' | 'linear';
    /** The curve the frame applies on the way to the display; absent = none. */
    outputTransform?: 'none' | 'aces' | 'neutral';
    /** Scene-target multisampling the project asked for; absent ⇒ 4. Clamped by
     *  the device, which answers capability and never policy. */
    msaaSamples?: number;
    /** The compute skin cache; absent ⇒ on, every mesh, 128 MB. */
    asyncCompute?: boolean;
    skinCache?: SkinCacheConfig;
    quality?: QualityConfig;
    /** GPU backend the build asks for; absent ⇒ WebGL2. A request for
     *  'webgpu' falls back where the machine cannot serve one. */
    renderBackend?: 'webgl2' | 'webgpu';
    threadedRendering?: boolean;
    /** Offer immersive VR (WebXR): the page shows an Enter VR button where the browser can present, and draws with the
     *  WebGL2 renderer on its own thread, which is the one a headset's layer takes. */
    vr?: boolean;
    /** Project camera fit (design resolution + scale mode) — letterboxes the main
     *  camera without a UI Canvas; absent = no fit. */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** The Steam application id, when this build ships to Steam. Its presence is
     *  what makes the runtime try to bring a Steam client up at all. */
    steamAppId?: number;
    /**
     * The engine binary's size as it arrives in the page, decompressed. A host
     * that compresses states a Content-Length for fewer bytes than a download
     * counts, so the boot bar measures against this instead.
     */
    engineBytes?: number;
    /** The package carries the engine built as plain JavaScript (wasm/esengine.asm.js),
     *  which the page loads where there is no WebAssembly. */
    engineJs?: boolean;
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
    /**
     * Package-relative paths to the compiled systems and their common ABI manifest.
     * Present when the build compiled at least one system.
     */
    aot?: AotModuleConfig;
    /** Where the editor that made this development build listens for it. Never
     *  written by a shipping export. */
    debugChannel?: DebugChannelConfig;
    /** The models this package carries as recipes to bake where it loads: the file listing them, and the worker script that bakes one. */
    modelBakes?: { recipes: string; worker: string };
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
    /** The culling contract shipped for a spine PAIR, for any ref spelling. */
    spineCulling(skeleton: string, atlas: string): SpineCullingRect | undefined;
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
/**
 * The attributes every host creates the engine's WebGL2 context with. WebGL
 * gives no stencil buffer unless asked, and sprite masks draw through one.
 * `preserveDrawingBuffer` is for a harness that reads a composited frame back.
 */
export function glContextAttributes(preserveDrawingBuffer = false): WebGLContextAttributes {
    return {
        alpha: false,
        antialias: true,
        depth: true,
        stencil: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer,
    };
}

export function packagedAppOptions(
    config: Pick<PackagedGameConfig,
        'ySortLayers' | 'depthLayers' | 'colorSpace' | 'outputTransform' | 'screenFit'
        | 'msaaSamples' | 'quality' | 'skinCache' | 'asyncCompute'>,
): {
    ySortLayers?: number;
    depthLayers?: number;
    colorSpace?: 'gamma' | 'linear';
    outputTransform?: 'none' | 'aces' | 'neutral';
    msaaSamples?: number;
    asyncCompute?: boolean;
    skinCache?: SkinCacheConfig;
    quality?: QualityConfig;
    /** GPU backend the build asks for; absent ⇒ WebGL2. A request for
     *  'webgpu' falls back where the machine cannot serve one. */
    renderBackend?: 'webgl2' | 'webgpu';
    screenFit?: PackagedGameConfig['screenFit'];
} {
    return {
        ySortLayers: config.ySortLayers,
        depthLayers: config.depthLayers,
        colorSpace: config.colorSpace,
        outputTransform: config.outputTransform,
        msaaSamples: config.msaaSamples,
        ...(config.asyncCompute !== undefined ? { asyncCompute: config.asyncCompute } : {}),
        ...(config.skinCache ? { skinCache: config.skinCache } : {}),
        quality: config.quality,
        screenFit: config.screenFit,
    };
}

type PackagedBootFields = Pick<PackagedGameConfig, 'uiTheme' | 'steamAppId' | 'screenFit' | 'aot' | 'debugChannel'>;

/**
 * The {@link initRuntime} arguments a packaged config declares — everything
 * applied to a LIVE app rather than baked into its construction. The twin of
 * {@link packagedAppOptions}; between them a host names the config once.
 */
export function packagedRuntimeInit(
    config: PackagedProjectSettings & PackagedBootFields,
): RuntimeProjectSettings & PackagedBootFields {
    return {
        ...runtimeProjectSettings(config),
        uiTheme: config.uiTheme,
        uiThemeOverrides: parseThemeOverrides(config.uiThemeColors),
        steamAppId: config.steamAppId,
        // Also here, not only in packagedAppOptions: the camera fit is baked into
        // the app's construction, but the WINDOW is sized on a live one.
        screenFit: config.screenFit,
        // Here rather than per host: a host that names the fields it knows about
        // is a host the next one never reaches, and this one reached none of the
        // native road until it was asked for by hand.
        aot: config.aot,
        debugChannel: config.debugChannel,
    };
}

export function catalogFromManifest(manifest: AddressableManifest): Catalog | undefined {
    return catalogForModel(ManifestModel.fromJson(manifest));
}

export function catalogForModel(model: ManifestModel): Catalog | undefined {
    const entries: Record<string, CatalogEntry> = Object.create(null);
    let tagged = false;
    for (const { key: uuid, asset } of model.entries()) {
        tagged ||= !!asset.labels?.length;
        const md = asset.metadata;
        const atlasFields = md?.atlasFrame && md.atlasPageWidth && md.atlasPageHeight
            ? atlasCatalogFields(
                { page: md.atlasPage, frame: md.atlasFrame, pageWidth: md.atlasPageWidth, pageHeight: md.atlasPageHeight },
                asset.path,
            )
            : null;
        const tail = asset.streamTail ? { streamTail: asset.streamTail } : {};
        if (atlasFields || asset.streamTail) {
            entries[`@uuid:${uuid}`] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}), ...tail };
        }
        // A texture with a small copy is found by whatever spelling a load uses, the build path among them.
        if (asset.streamTail && model.assetByPath(asset.path) === asset) entries[asset.path] = { type: asset.type, buildPath: asset.path, ...tail };
        if (!asset.address || asset.address === asset.path) continue;
        entries[asset.address] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}), ...tail };
        entries[`/${asset.address}`] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}), ...tail };
    }
    return Object.keys(entries).length || tagged
        ? Catalog.fromJson({ version: 1, entries }).withManifestLabels(model) : undefined;
}

/** Read + index the packaged addressable manifest through the platform's reader. */
export async function loadPackagedAssetIndex(
    manifestPath = 'asset-manifest.json',
): Promise<PackagedAssetIndex> {
    const manifest = JSON.parse(await platformReadTextFile(manifestPath)) as AddressableManifest;
    return indexPackagedManifest(manifest);
}

/** Register the selected document under its own scene name and leave its siblings on disk until requested. */
export async function loadPackagedScenes(
    config: Pick<PackagedGameConfig, 'entryScene' | 'scenes' | 'worlds'>,
    index: Pick<PackagedAssetIndex, 'resolvePath'>, fallbackName: string, requested?: string | null,
): Promise<Pick<RuntimeInitConfig, 'scenes' | 'firstScene'>> {
    const declared = config.scenes ?? [];
    const entry = declared.find(scene => scene.path === config.entryScene) ?? { name: fallbackName, path: config.entryScene };
    const available = [entry, ...declared.filter(scene => scene.name !== entry.name)];
    return loadPackagedSceneList(available, index, requested || entry.name, config.worlds);
}

/** @internal Resolve scene files through the package index and read only the selected scene. */
export async function loadPackagedSceneList(
    available: readonly { name: string; path: string }[],
    index: Pick<PackagedAssetIndex, 'resolvePath'>,
    firstScene: string,
    worldFiles?: PackagedGameConfig['worlds'],
): Promise<Pick<RuntimeInitConfig, 'scenes' | 'firstScene'>> {
    const selected = available.find(scene => scene.name === firstScene);
    if (!selected) throw new Error(`[estella] no scene named "${firstScene}" in this package`);
    const data = JSON.parse(await platformReadTextFile(index.resolvePath(selected.path))) as SceneData;
    const worlds = new Map(worldFiles?.map(world => [world.scene, world.manifest]));
    return {
        firstScene: selected.name,
        scenes: available.map(scene => ({
            name: scene.name,
            ...(scene === selected ? { data } : { path: index.resolvePath(scene.path) }),
            ...(worlds.has(scene.name) ? { worldPath: worlds.get(scene.name) } : {}),
        })),
    };
}

/** {@link loadPackagedAssetIndex} over an already-parsed manifest. */
export function indexPackagedManifest(manifest: AddressableManifest): PackagedAssetIndex {
    const model = ManifestModel.fromJson(manifest);
    return { manifest, model, ...packagedLookups(model) };
}

function packagedLookups(model: ManifestModel): Omit<PackagedAssetIndex, 'manifest' | 'model'> {
    return {
        catalog: catalogForModel(model),
        // A scene spells asset refs `@uuid:<v4>`, while the manifest indexes bare
        // uuids — strip the prefix before looking up, or every `@uuid:` ref falls
        // through as a literal path and 404s.
        resolvePath: (ref) => model.resolvePath(ref),
        // The authored logical path behind any spelling — its uuid, its logical
        // address, or its staged (content-addressed) path. Lets a loader recover the
        // directory a sibling was authored in after the rename hid it.
        addressOf: (ref) => {
            const asset = model.recordForRef(ref)?.asset;
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
        spineCulling: model.spineCullingLookup(),
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
    let active: ReturnType<typeof packagedLookups> = index;
    return {
        backend: options.backend ?? new FileSystemBackend(),
        activateManifest(model, suppliedCatalog) {
            active = model === index.model ? index : packagedLookups(model ?? ManifestModel.empty());
            if (suppliedCatalog && suppliedCatalog !== index.catalog) return suppliedCatalog;
            return active.catalog ?? Catalog.empty();
        },
        decodePixels: options.decodePixels ?? ((path, _flip, maxEdge) => platformLoadImagePixels(path, maxEdge)),
        resolveRef: ref => active.resolvePath(ref),
        resolveAddress: ref => active.addressOf(ref),
        listAssetPaths: () => active.assetPaths(),
        textureImportSettings: ref => active.textureImport(ref),
        spineCulling: (skeleton, atlas) => active.spineCulling(skeleton, atlas),
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
