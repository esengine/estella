import { getFileExtension } from '../utils/path';

export const ASSET_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
    'mp3', 'wav', 'ogg',
    'atlas', 'skel', 'json',
    'esmaterial', 'esshader',
    'bmfont', 'fnt',
]);

export function getAssetType(path: string): string {
    const ext = getFileExtension(path);
    switch (ext) {
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg':
            return 'texture';
        case 'esmaterial':
            return 'material';
        case 'esshader':
            return 'shader';
        case 'atlas':
            return 'spine-atlas';
        case 'skel':
            return 'spine-skeleton';
        case 'json':
            return 'json';
        case 'bmfont': case 'fnt':
            return 'bitmap-font';
        case 'mp3': case 'wav': case 'ogg':
            return 'audio';
        default:
            return 'unknown';
    }
}

export function looksLikeAssetPath(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (!value.includes('/')) return false;
    const ext = getFileExtension(value);
    return ASSET_EXTENSIONS.has(ext);
}
