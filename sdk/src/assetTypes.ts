// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type AssetContentType = 'json' | 'text' | 'binary' | 'image' | 'audio';

export type AddressableAssetType = string;

export type EditorAssetType =
    | 'texture' | 'material' | 'shader' | 'spine-atlas' | 'spine-skeleton'
    | 'dragonbones-atlas' | 'dragonbones-skeleton'
    | 'bitmap-font' | 'font' | 'prefab' | 'json' | 'audio' | 'sound-event' | 'world-rules' | 'terrain-layer' | 'terrain-layer-info' | 'physical-material' | 'terrain-tiles' | 'video' | 'scene' | 'anim-clip'
    | 'tilemap' | 'tileset' | 'timeline' | 'mesh'
    | 'unknown';

export interface AssetTypeEntry {
    extensions: string[];
    /**
     * Full lower-case name endings claiming this type, checked BEFORE extensions
     * because they are the more specific claim. For a format whose files are told
     * apart by convention rather than suffix — DragonBones ships `_ske.json`
     * beside `_tex.json`, and `.json` alone cannot see the difference.
     */
    suffixes?: string[];
    contentType: AssetContentType;
    editorType: EditorAssetType;
    wechatPackInclude: boolean;
    hasTransitiveDeps: boolean;
}

const ASSET_TYPE_REGISTRY: readonly AssetTypeEntry[] = [
    { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], contentType: 'image', editorType: 'texture', wechatPackInclude: false, hasTransitiveDeps: false },
    // GPU-compressed texture container (Basis/KTX2). Decoded straight to a
    // compressed GPU format at runtime; large, so it stays out of the WeChat
    // main package (remote CDN, content-addressed).
    // wechatPackInclude: WeChat's fs denies package reads of unlisted custom
    // extensions — KTX2 textures are fs-read (transcoded), not image-decoded.
    { extensions: ['ktx2'], contentType: 'binary', editorType: 'texture', wechatPackInclude: true, hasTransitiveDeps: false },
    // A picture's source, drawn into a texture where it is loaded (asset/textureRecipe.ts).
    { extensions: ['esimage'], contentType: 'json', editorType: 'texture', wechatPackInclude: true, hasTransitiveDeps: false },
    // A sound's or a piece of music's source, named where a clip goes: a clip to whatever loads it (see asset/audioRecipe.ts).
    { extensions: ['essound', 'esmusic'], contentType: 'json', editorType: 'audio', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'webm'], contentType: 'audio', editorType: 'audio', wechatPackInclude: false, hasTransitiveDeps: false },
    // Video container, streamed + decoded by the video system (HTMLVideoElement
    // on web). `webm` stays with audio above to avoid the ambiguity; a .webm
    // video is disambiguated by its `.meta` type. Cooked/copied as binary.
    { extensions: ['mp4', 'm4v', 'mov'], contentType: 'binary', editorType: 'video', wechatPackInclude: false, hasTransitiveDeps: false },
    // MPEG-1 video for the wasm decode path (WeChat / headless). `.esv` is the
    // cook's codec-tagged output; `.mpg` an authored source. fs-read by the
    // decoder, so packaged WeChat reads need the pack-include whitelist.
    { extensions: ['mpg', 'mpeg', 'esv'], contentType: 'binary', editorType: 'video', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['esmaterial'], contentType: 'json', editorType: 'material', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esshader'], contentType: 'text', editorType: 'shader', wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['atlas'], contentType: 'text', editorType: 'spine-atlas', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['skel'], contentType: 'binary', editorType: 'spine-skeleton', wechatPackInclude: true, hasTransitiveDeps: true },
    // DragonBones. The atlas has transitive deps — its `imagePath` names a PNG no
    // component references, so without that flag the cook ships the atlas and culls
    // the image it points at, and the export 404s a texture at runtime.
    { extensions: ['dbbin'], suffixes: ['_ske.json'], contentType: 'binary', editorType: 'dragonbones-skeleton', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: [], suffixes: ['_tex.json'], contentType: 'text', editorType: 'dragonbones-atlas', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['json'], contentType: 'json', editorType: 'json', wechatPackInclude: false, hasTransitiveDeps: false },
    // Input map (defineInputMap / loadInputMapAsset) — data-driven key/gamepad bindings.
    { extensions: ['inputmap'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['bmfont'], contentType: 'json', editorType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['fnt'], contentType: 'text', editorType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    // Outline fonts a game SHIPS (Text.font). Unlike a bitmap font these have no
    // page texture, so no transitive deps — the file IS the asset, handed whole
    // to the platform's text stack.
    { extensions: ['ttf', 'otf', 'woff', 'woff2'], contentType: 'binary', editorType: 'font', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['esprefab'], contentType: 'json', editorType: 'prefab', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esscene'], contentType: 'json', editorType: 'scene', wechatPackInclude: false, hasTransitiveDeps: false },
    // GPU geometry (MeshAssetLoader). Its own channel table makes it
    // self-describing, so it names no other asset; the source it was imported
    // from (.gltf/.glb/.fbx) is not shipped and is deliberately absent here.
    { extensions: ['esmesh'], contentType: 'binary', editorType: 'mesh', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['esanim'], contentType: 'json', editorType: 'anim-clip', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['tmj'], contentType: 'json', editorType: 'tilemap', wechatPackInclude: true, hasTransitiveDeps: true },
    // Tileset palette (TilesetAssetLoader). Fs-read as JSON at runtime — so it
    // needs the WeChat pack whitelist — and it references an atlas texture by
    // @uuid (transitive dep).
    { extensions: ['estileset'], contentType: 'json', editorType: 'tileset', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['estimeline'], contentType: 'json', editorType: 'timeline', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esaudioevent'], contentType: 'json', editorType: 'sound-event', wechatPackInclude: true, hasTransitiveDeps: true },
    // World rules (WorldRulesAssetLoader): biomes, recipes and layers as data, naming the meshes and materials they place by path.
    { extensions: ['esworld'], contentType: 'json', editorType: 'world-rules', wechatPackInclude: true, hasTransitiveDeps: true },
    // Terrain layers (TerrainLayerAssetLoader): one kind of ground, naming the albedo, normal and mask textures it is drawn with.
    { extensions: ['esterrainlayer'], contentType: 'json', editorType: 'terrain-layer', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esterrainlayerinfo'], contentType: 'json', editorType: 'terrain-layer-info', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esphysmat'], contentType: 'json', editorType: 'physical-material', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['esterrain'], contentType: 'json', editorType: 'terrain-tiles', wechatPackInclude: true, hasTransitiveDeps: true },
    // One locale per file. The asset registry publishes its entries into the app's catalog.
    { extensions: ['eslocale'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // State machine (registerFsm / FsmAssetLoader) — data-driven FSM definition.
    { extensions: ['esfsm'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Animation controller (AnimatorControllerDef) — data-driven sprite-anim state machine.
    { extensions: ['esanimator'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Behavior tree (registerBt / BtAssetLoader) — data-driven BT definition.
    { extensions: ['esbt'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Script graph (registerScriptGraph / ScriptGraphAssetLoader) — visual logic.
    { extensions: ['esgraph'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Prefiltered environment: nine irradiance coefficients inline, plus the path
    // of the octahedral atlas they were baked beside — hence the transitive dep,
    // without which the cook ships the document and culls the image it is half of.
    { extensions: ['esenv'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: true },
    // Baked probe grid: the same nine coefficients an `.esenv` carries, at every
    // point of a grid instead of once. No transitive dep — a volume names no image.
    // Binary since version 2 (lightmap/probeFile); a version 1 grid is JSON and loads the same way, as bytes.
    { extensions: ['esprobes'], contentType: 'binary', editorType: 'unknown', wechatPackInclude: true, hasTransitiveDeps: false },
    // A groom (groom/groomFormat.ts): per group, the settings authored in the engine, and the path of the curves file that is its
    // geometry — hence the transitive dep. The curves are fs-read as bytes, so both need the WeChat pack whitelist.
    { extensions: ['esgroom'], contentType: 'json', editorType: 'json', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['escurves'], contentType: 'binary', editorType: 'unknown', wechatPackInclude: true, hasTransitiveDeps: false },
];

const MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ktx2: 'image/ktx2',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    webm: 'audio/webm',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
    esv: 'video/mpeg',
    json: 'application/json',
    atlas: 'text/plain',
    skel: 'application/octet-stream',
    esmaterial: 'application/json',
    esshader: 'text/plain',
    esprefab: 'application/json',
    esmesh: 'application/octet-stream',
    esanim: 'application/json',
    estimeline: 'application/json',
    estileset: 'application/json',
    eslocale: 'application/json',
    esfsm: 'application/json',
    esanimator: 'application/json',
    esbt: 'application/json',
    esenv: 'application/json',
    esprobes: 'application/octet-stream',
    bmfont: 'application/json',
    fnt: 'text/plain',
};

const extToEntry = new Map<string, AssetTypeEntry>();
const allExtensions = new Set<string>();

for (const entry of ASSET_TYPE_REGISTRY) {
    for (const ext of entry.extensions) {
        extToEntry.set(ext, entry);
        allExtensions.add(ext);
    }
}

/**
 * A host whose packer refuses a custom suffix takes the file under `.bin`
 * (exportMiniGame's restage). What it IS is still whatever the real suffix says,
 * so read through that wrapper — but only when a known extension is under it, or
 * a file genuinely named `foo.bin` would read as one with no extension at all.
 */
function extractExtension(extensionOrPath: string): string {
    const lower = extensionOrPath.toLowerCase();
    const last = (v: string): string => {
        const dot = v.lastIndexOf('.');
        return dot >= 0 ? v.substring(dot + 1) : v;
    };

    if (lower.endsWith('.bin')) {
        const under = last(lower.slice(0, -'.bin'.length));
        if (allExtensions.has(under)) return under;
    }
    return last(lower);
}

/**
 * A path with the restage `.bin` wrapper removed, when it wraps an extension this
 * registry knows. Readers that care about a specific format ask this rather than
 * spelling both paths — one place learns what a restaged file looks like.
 */
export function unwrapRestagedPath(path: string): string {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.bin')) return lower;
    const under = lower.slice(0, -'.bin'.length);
    const dot = under.lastIndexOf('.');
    const ext = dot >= 0 ? under.substring(dot + 1) : under;
    return allExtensions.has(ext) ? under : lower;
}

export function getAssetTypeEntry(extensionOrPath: string): AssetTypeEntry | undefined {
    // Suffix first: `foo_ske.json` is a DragonBones skeleton, and letting `.json`
    // answer would classify it as whatever that extension maps to.
    const lower = extensionOrPath.toLowerCase();
    for (const entry of ASSET_TYPE_REGISTRY) {
        if (entry.suffixes?.some((s) => lower.endsWith(s))) return entry;
    }
    return extToEntry.get(extractExtension(extensionOrPath));
}

export function getEditorType(path: string): EditorAssetType {
    return getAssetTypeEntry(path)?.editorType ?? 'unknown';
}

export function isKnownAssetExtension(ext: string): boolean {
    return allExtensions.has(ext.toLowerCase());
}

export function getAllAssetExtensions(): Set<string> {
    return allExtensions;
}

export function looksLikeAssetPath(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (!value.includes('/')) return false;
    return isKnownAssetExtension(extractExtension(value));
}

export function getCustomExtensions(): string[] {
    const result: string[] = [];
    for (const entry of ASSET_TYPE_REGISTRY) {
        if (entry.wechatPackInclude) {
            for (const ext of entry.extensions) {
                result.push(`.${ext}`);
            }
        }
    }
    return result;
}

export function getWeChatPackOptions(): Array<{ type: string; value: string }> {
    return getCustomExtensions().map(ext => ({ type: 'suffix', value: ext }));
}

export function getAssetMimeType(ext: string): string | undefined {
    return MIME_MAP[ext.toLowerCase()];
}

export function isCustomExtension(path: string): boolean {
    const entry = getAssetTypeEntry(path);
    return entry?.wechatPackInclude ?? false;
}
