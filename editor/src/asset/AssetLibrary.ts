/**
 * @file    AssetLibrary.ts
 * @brief   Backward-compatible re-export from AssetDatabase
 */

export {
    AssetDatabase as AssetLibrary,
    AssetDatabase,
    getAssetDatabase as getAssetLibrary,
    getAssetDatabase,
    resetAssetDatabase as resetAssetLibrary,
    resetAssetDatabase,
    isUUID,
    getComponentRefFields,
    type AssetEntry,
} from './AssetDatabase';
