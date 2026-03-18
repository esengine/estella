import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinAssetTypes } from '../asset/AssetTypeRegistry';
import { AssetEventBus } from '../events/AssetEventBus';
import { EditorEventBus } from '../events/EditorEventBus';
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
    ASSET_DATABASE, PLAY_MODE_SERVICE, EDITOR_EVENT_BUS,
    SELECTION_STORE,
} from '../container/tokens';

export const assetInfraPlugin: EditorPlugin = {
    name: 'asset-infra',
    register(ctx: EditorPluginContext) {
        const bus = new EditorEventBus();
        ctx.registrar.provide(ASSET_EVENT_BUS, 'default', new AssetEventBus());
        ctx.registrar.provide(EDITOR_EVENT_BUS, 'default', bus);
        ctx.registrar.provide(ASSET_DEP_GRAPH, 'default', new AssetDependencyGraph());
        ctx.registrar.provide(IMPORTER_REGISTRY, 'default', createImporterRegistry());
        ctx.registrar.provide(GLOBAL_PATH_RESOLVER, 'default', new AssetPathResolver());
        const store = new EditorStore(bus);
        ctx.registrar.provide(EDITOR_STORE, 'default', store);
        ctx.registrar.provide(SELECTION_STORE, 'default', store.selection_);
        ctx.registrar.provide(SHARED_RENDER_CTX, 'default', new SharedRenderContext());
        ctx.registrar.provide(ASSET_DATABASE, 'default', new AssetDatabase());
        ctx.registrar.provide(PLAY_MODE_SERVICE, 'default', new PlayModeService());
        registerBuiltinAssetTypes(ctx.registrar);
    },
};
