import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinAssetTypes } from '../asset/AssetTypeRegistry';
import { AssetEventBus } from '../events/AssetEventBus';
import { AssetDependencyGraph } from '../asset/AssetDependencyGraph';
import { createImporterRegistry } from '../asset/ImporterRegistry';
import { AssetPathResolver } from '../asset/AssetPathResolver';
import { EditorStore } from '../store/EditorStore';
import { SharedRenderContext } from '../renderer/SharedRenderContext';
import { AssetDatabase } from '../asset/AssetDatabase';
import { PlayModeService } from '../services/PlayModeService';
import {
    ASSET_EVENT_BUS, ASSET_DEP_GRAPH, IMPORTER_REGISTRY,
    GLOBAL_PATH_RESOLVER, EDITOR_STORE, SHARED_RENDER_CTX,
    ASSET_DATABASE, PLAY_MODE_SERVICE,
} from '../container/tokens';

export const assetInfraPlugin: EditorPlugin = {
    name: 'asset-infra',
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(ASSET_EVENT_BUS, 'default', new AssetEventBus());
        ctx.registrar.provide(ASSET_DEP_GRAPH, 'default', new AssetDependencyGraph());
        ctx.registrar.provide(IMPORTER_REGISTRY, 'default', createImporterRegistry());
        ctx.registrar.provide(GLOBAL_PATH_RESOLVER, 'default', new AssetPathResolver());
        ctx.registrar.provide(EDITOR_STORE, 'default', new EditorStore());
        ctx.registrar.provide(SHARED_RENDER_CTX, 'default', new SharedRenderContext());
        ctx.registrar.provide(ASSET_DATABASE, 'default', new AssetDatabase());
        ctx.registrar.provide(PLAY_MODE_SERVICE, 'default', new PlayModeService());
        registerBuiltinAssetTypes(ctx.registrar);
    },
};
