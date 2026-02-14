import {
    getEditorType,
    getAddressableTypeByEditorType,
    getAllAssetExtensions,
    looksLikeAssetPath,
    type AddressableAssetType,
} from 'esengine';

export type { AddressableAssetType };
export { looksLikeAssetPath };

export const ASSET_EXTENSIONS = getAllAssetExtensions();

export function getAssetType(path: string): string {
    return getEditorType(path);
}

export function toAddressableType(editorType: string): AddressableAssetType | null {
    return getAddressableTypeByEditorType(editorType);
}
