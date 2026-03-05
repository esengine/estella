import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinAssetTypes } from '../asset/AssetTypeRegistry';

export const assetInfraPlugin: EditorPlugin = {
    name: 'asset-infra',
    register(ctx: EditorPluginContext) {
        registerBuiltinAssetTypes(ctx.registrar);
    },
};
