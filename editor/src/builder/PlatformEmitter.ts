/**
 * @file    PlatformEmitter.ts
 * @brief   Platform-specific build output emitters
 */

import type { BuildResult, BuildContext } from './BuildService';
import type { AtlasResult } from './TextureAtlas';
import type { CompiledMaterial } from './MaterialCompiler';
import type { AssetDatabase } from '../asset/AssetDatabase';

// =============================================================================
// Types
// =============================================================================

export interface BuildArtifact {
    scenes: Map<string, Record<string, unknown>>;
    assetPaths: Set<string>;
    atlasResult: AtlasResult;
    packedPaths: Set<string>;
    compiledMaterials: CompiledMaterial[];
    assetLibrary: AssetDatabase;
}

export interface PlatformEmitter {
    emit(artifact: BuildArtifact, context: BuildContext): Promise<BuildResult>;
}
