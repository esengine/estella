// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type AssetContentType = 'json' | 'text' | 'binary' | 'image' | 'audio';

export type AddressableAssetType =
    | 'texture' | 'material' | 'spine' | 'bitmap-font'
    | 'prefab' | 'json' | 'text' | 'binary' | 'audio';

export type EditorAssetType =
    | 'texture' | 'material' | 'shader' | 'spine-atlas' | 'spine-skeleton'
    | 'dragonbones-atlas' | 'dragonbones-skeleton'
    | 'bitmap-font' | 'prefab' | 'json' | 'audio' | 'video' | 'scene' | 'anim-clip'
    | 'tilemap' | 'tileset' | 'timeline'
    | 'unknown';

export type AssetBuildTransform = (content: string, context: unknown) => string;

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
    addressableType: AddressableAssetType | null;
    wechatPackInclude: boolean;
    hasTransitiveDeps: boolean;
    buildTransform?: AssetBuildTransform;
}

const ASSET_TYPE_REGISTRY: readonly AssetTypeEntry[] = [
    { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], contentType: 'image', editorType: 'texture', addressableType: 'texture', wechatPackInclude: false, hasTransitiveDeps: false },
    // GPU-compressed texture container (Basis/KTX2). Decoded straight to a
    // compressed GPU format at runtime; large, so it stays out of the WeChat
    // main package (remote CDN, content-addressed).
    // wechatPackInclude: WeChat's fs denies package reads of unlisted custom
    // extensions — KTX2 textures are fs-read (transcoded), not image-decoded.
    { extensions: ['ktx2'], contentType: 'binary', editorType: 'texture', addressableType: 'texture', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'webm'], contentType: 'audio', editorType: 'audio', addressableType: 'audio', wechatPackInclude: false, hasTransitiveDeps: false },
    // Video container, streamed + decoded by the video system (HTMLVideoElement
    // on web). `webm` stays with audio above to avoid the ambiguity; a .webm
    // video is disambiguated by its `.meta` type. Cooked/copied as binary.
    { extensions: ['mp4', 'm4v', 'mov'], contentType: 'binary', editorType: 'video', addressableType: 'binary', wechatPackInclude: false, hasTransitiveDeps: false },
    // MPEG-1 video for the wasm decode path (WeChat / headless). `.esv` is the
    // cook's codec-tagged output; `.mpg` an authored source. fs-read by the
    // decoder, so packaged WeChat reads need the pack-include whitelist.
    { extensions: ['mpg', 'mpeg', 'esv'], contentType: 'binary', editorType: 'video', addressableType: 'binary', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['esmaterial'], contentType: 'json', editorType: 'material', addressableType: 'material', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esshader'], contentType: 'text', editorType: 'shader', addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['atlas'], contentType: 'text', editorType: 'spine-atlas', addressableType: 'binary', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['skel'], contentType: 'binary', editorType: 'spine-skeleton', addressableType: 'spine', wechatPackInclude: true, hasTransitiveDeps: true },
    // DragonBones. The atlas has transitive deps — its `imagePath` names a PNG no
    // component references, so without that flag the cook ships the atlas and culls
    // the image it points at, and the export 404s a texture at runtime.
    { extensions: ['dbbin'], suffixes: ['_ske.json'], contentType: 'binary', editorType: 'dragonbones-skeleton', addressableType: 'binary', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: [], suffixes: ['_tex.json'], contentType: 'text', editorType: 'dragonbones-atlas', addressableType: 'binary', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['json'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: false, hasTransitiveDeps: false },
    // Input map (defineInputMap / loadInputMapAsset) — data-driven key/gamepad bindings.
    { extensions: ['inputmap'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    { extensions: ['bmfont'], contentType: 'json', editorType: 'bitmap-font', addressableType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['fnt'], contentType: 'text', editorType: 'bitmap-font', addressableType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esprefab'], contentType: 'json', editorType: 'prefab', addressableType: 'prefab', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esscene'], contentType: 'json', editorType: 'scene', addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['esanim'], contentType: 'json', editorType: 'anim-clip', addressableType: null, wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['tmj'], contentType: 'json', editorType: 'tilemap', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: true },
    // Tileset palette (TilesetAssetLoader). Fs-read as JSON at runtime — so it
    // needs the WeChat pack whitelist — and it references an atlas texture by
    // @uuid (transitive dep).
    { extensions: ['estileset'], contentType: 'json', editorType: 'tileset', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['estimeline'], contentType: 'json', editorType: 'timeline', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: true },
    // Locale string table (LocaleAssetLoader → Localization.addCatalog) — one locale per file.
    { extensions: ['eslocale'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // State machine (registerFsm / FsmAssetLoader) — data-driven FSM definition.
    { extensions: ['esfsm'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Animation controller (AnimatorControllerDef) — data-driven sprite-anim state machine.
    { extensions: ['esanimator'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
    // Behavior tree (registerBt / BtAssetLoader) — data-driven BT definition.
    { extensions: ['esbt'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: true, hasTransitiveDeps: false },
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
    esanim: 'application/json',
    estimeline: 'application/json',
    estileset: 'application/json',
    eslocale: 'application/json',
    esfsm: 'application/json',
    esanimator: 'application/json',
    esbt: 'application/json',
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

function extractExtension(extensionOrPath: string): string {
    const dotIndex = extensionOrPath.lastIndexOf('.');
    return dotIndex >= 0 ? extensionOrPath.substring(dotIndex + 1).toLowerCase() : extensionOrPath.toLowerCase();
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

export function getAddressableType(path: string): AddressableAssetType | null {
    return getAssetTypeEntry(path)?.addressableType ?? null;
}

export function getAddressableTypeByEditorType(editorType: string): AddressableAssetType | null {
    for (const entry of ASSET_TYPE_REGISTRY) {
        if (entry.editorType === editorType) {
            return entry.addressableType;
        }
    }
    if (editorType === 'text') return 'text';
    if (editorType === 'binary') return 'binary';
    return 'binary';
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

export function toBuildPath(path: string): string {
    const entry = getAssetTypeEntry(path);
    if (!entry || !entry.wechatPackInclude) return path;
    if (entry.contentType !== 'json') return path;
    const dotIndex = path.lastIndexOf('.');
    return dotIndex >= 0 ? path.substring(0, dotIndex) + '.json' : path;
}

export function registerAssetBuildTransform(editorType: EditorAssetType, transform: AssetBuildTransform): void {
    for (const entry of ASSET_TYPE_REGISTRY) {
        if (entry.editorType === editorType) {
            (entry as AssetTypeEntry).buildTransform = transform;
        }
    }
}

export function getAssetBuildTransform(extensionOrPath: string): AssetBuildTransform | undefined {
    return getAssetTypeEntry(extensionOrPath)?.buildTransform;
}
