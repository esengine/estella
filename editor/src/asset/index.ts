/**
 * @file    index.ts
 * @brief   Asset module exports
 */

export { AssetPathResolver } from './AssetPathResolver';
export type { PathValidationResult } from './AssetPathResolver';

export { AssetLoader } from './AssetLoader';
export type { LoadResult } from './AssetLoader';

export { EditorAssetServer } from './EditorAssetServer';

export {
    AssetDependencyGraph,
    getDependencyGraph,
    resetDependencyGraph,
} from './AssetDependencyGraph';

export {
    AssetDatabase,
    AssetDatabase as AssetLibrary,
    getAssetDatabase,
    getAssetDatabase as getAssetLibrary,
    resetAssetDatabase,
    resetAssetDatabase as resetAssetLibrary,
    isUUID,
    getComponentRefFields,
    type AssetEntry,
} from './AssetDatabase';

export {
    AssetGroupService,
    type AssetGroupDef,
    type AssetGroupsConfig,
    type BundleMode,
} from './AssetGroup';

export {
    AssetDependencyAnalyzer,
    collectReferencedAssets,
    registerRefScanner,
    type AssetRefScanner,
    type DependencyGraph,
} from './AssetDependencyAnalyzer';

export {
    getImporterRegistry,
    type AssetImporter,
    type ImporterField,
    type ImporterFieldType,
} from './ImporterRegistry';

export {
    type AssetMeta,
    type TextureImporterSettings,
    type AudioImporterSettings,
    type ImporterSettings,
    createDefaultMeta,
    upgradeMeta,
    serializeMeta,
    getDefaultImporterForType,
    createDefaultTextureImporter,
    createDefaultAudioImporter,
} from './ImporterTypes';

import { AssetPathResolver } from './AssetPathResolver';
import { getEditorContainer } from '../container/EditorContainer';
import { GLOBAL_PATH_RESOLVER } from '../container/tokens';

export function getGlobalPathResolver(): AssetPathResolver {
    return getEditorContainer().get(GLOBAL_PATH_RESOLVER, 'default')!;
}
