import type { EditorPlugin } from './EditorPlugin';
import { registerBuiltinAssetTypes } from '../asset/AssetTypeRegistry';

export const assetInfraPlugin: EditorPlugin = {
    name: 'asset-infra',
    register() {
        registerBuiltinAssetTypes();
    },
};
