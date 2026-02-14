export type AssetContentType = 'json' | 'text' | 'binary' | 'image' | 'audio';

export type AddressableAssetType =
    | 'texture' | 'material' | 'spine' | 'bitmap-font'
    | 'prefab' | 'json' | 'text' | 'binary' | 'audio';

export type EditorAssetType =
    | 'texture' | 'material' | 'shader' | 'spine-atlas' | 'spine-skeleton'
    | 'bitmap-font' | 'prefab' | 'json' | 'audio' | 'scene' | 'unknown';

export interface AssetTypeEntry {
    extensions: string[];
    contentType: AssetContentType;
    editorType: EditorAssetType;
    addressableType: AddressableAssetType | null;
    wechatPackInclude: boolean;
    hasTransitiveDeps: boolean;
}

const ASSET_TYPE_REGISTRY: readonly AssetTypeEntry[] = [
    { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], contentType: 'image', editorType: 'texture', addressableType: 'texture', wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['mp3', 'wav', 'ogg'], contentType: 'audio', editorType: 'audio', addressableType: 'audio', wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['esmaterial'], contentType: 'json', editorType: 'material', addressableType: 'material', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esshader'], contentType: 'text', editorType: 'shader', addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['atlas'], contentType: 'text', editorType: 'spine-atlas', addressableType: 'binary', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['skel'], contentType: 'binary', editorType: 'spine-skeleton', addressableType: 'spine', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['json'], contentType: 'json', editorType: 'json', addressableType: 'json', wechatPackInclude: false, hasTransitiveDeps: false },
    { extensions: ['bmfont'], contentType: 'json', editorType: 'bitmap-font', addressableType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['fnt'], contentType: 'text', editorType: 'bitmap-font', addressableType: 'bitmap-font', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esprefab'], contentType: 'json', editorType: 'prefab', addressableType: 'prefab', wechatPackInclude: true, hasTransitiveDeps: true },
    { extensions: ['esscene'], contentType: 'json', editorType: 'scene', addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false },
];

const MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    json: 'application/json',
    atlas: 'text/plain',
    skel: 'application/octet-stream',
    esmaterial: 'application/json',
    esshader: 'text/plain',
    esprefab: 'application/json',
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
