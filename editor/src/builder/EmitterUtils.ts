/**
 * @file    EmitterUtils.ts
 * @brief   Shared utilities for platform emitters (Playable, WeChat)
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildArtifact } from './PlatformEmitter';
import type { BuildContext } from './BuildService';
import type { NativeFS } from '../types/NativeFS';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';
import { joinPath } from '../utils/path';
import { isUUID, getComponentRefFields } from '../asset/AssetLibrary';
import { initializeEsbuild, createBuildVirtualFsPlugin, type SdkModuleLoader } from './ArtifactBuilder';
import { toBuildPath } from 'esengine';

// =============================================================================
// Plugin Analysis
// =============================================================================

const COMPONENT_TO_PLUGIN: Record<string, string> = {
    'Text': 'textPlugin',
    'BitmapText': 'textPlugin',
    'UIRect': 'uiLayoutPlugin',
    'UIMask': 'uiMaskPlugin',
    'Interactable': 'uiInteractionPlugin',
    'Button': 'uiInteractionPlugin',
    'TextInput': 'textInputPlugin',
    'Image': 'imagePlugin',
    'Toggle': 'togglePlugin',
    'ToggleGroup': 'togglePlugin',
    'ProgressBar': 'progressBarPlugin',
    'Slider': 'sliderPlugin',
    'Draggable': 'dragPlugin',
    'ScrollView': 'scrollViewPlugin',
    'Focusable': 'focusPlugin',
    'SafeArea': 'safeAreaPlugin',
    'ListView': 'listViewPlugin',
    'Dropdown': 'dropdownPlugin',
    'LayoutGroup': 'layoutGroupPlugin',
    'AudioSource': 'audioPlugin',
    'ParticleEmitter': 'particlePlugin',
    'Tilemap': 'tilemapPlugin',
    'TilemapLayer': 'tilemapPlugin',
    'PostProcessVolume': 'postProcessPlugin',
};

export function analyzeUsedPlugins(artifact: BuildArtifact): string[] {
    const plugins = new Set<string>();
    let hasUI = false;

    for (const sceneData of artifact.scenes.values()) {
        const entities = (sceneData as any).entities as Array<{
            components: Array<{ type: string }>;
        }> | undefined;
        if (!entities) continue;

        for (const entity of entities) {
            for (const comp of entity.components) {
                const plugin = COMPONENT_TO_PLUGIN[comp.type];
                if (plugin) {
                    plugins.add(plugin);
                    hasUI = true;
                }
            }
        }
    }

    if (hasUI) {
        plugins.add('uiRenderOrderPlugin');
    }

    return Array.from(plugins);
}

// =============================================================================
// Defines
// =============================================================================

export function buildDefinesMap(defines: string[]): Record<string, string> {
    const result: Record<string, string> = {
        'process.env.EDITOR': 'false',
    };
    for (const def of defines) {
        result[`process.env.${def}`] = 'true';
    }
    return result;
}

// =============================================================================
// Physics Config
// =============================================================================

export function generatePhysicsConfig(context: BuildContext): string {
    return JSON.stringify({
        gravity: context.physicsGravity ?? { x: 0, y: -9.81 },
        fixedTimestep: context.physicsFixedTimestep ?? 1 / 60,
        subStepCount: context.physicsSubStepCount ?? 4,
        collisionLayerMasks: context.collisionLayerMasks,
    });
}

// =============================================================================
// Script Compilation
// =============================================================================

export interface CompileOptions {
    entryContent: string;
    resolveDir: string;
    minify: boolean;
    sdkResolver: SdkModuleLoader;
    preferEsmEntry?: boolean;
}

export async function compileUserScripts(
    fs: NativeFS,
    projectDir: string,
    context: BuildContext,
    options: CompileOptions,
): Promise<string> {
    const defines = buildDefinesMap(context.config.defines);

    await initializeEsbuild();

    const plugin = createBuildVirtualFsPlugin(
        fs,
        projectDir,
        options.sdkResolver,
        options.preferEsmEntry ?? true,
    );

    const result = await esbuild.build({
        stdin: {
            contents: options.entryContent,
            loader: 'ts',
            resolveDir: options.resolveDir,
        },
        bundle: true,
        format: 'iife',
        write: false,
        platform: 'browser',
        target: 'es2020',
        treeShaking: true,
        minify: options.minify,
        define: defines,
        plugins: [plugin],
    });

    const output = result.outputFiles?.[0]?.text;
    if (!output) {
        throw new Error('esbuild produced no output');
    }
    return output;
}

// =============================================================================
// Scene UUID Resolution (for emitters that process scenes post-artifact)
// =============================================================================

export function resolveSceneUUIDs(sceneData: Record<string, unknown>, artifact: BuildArtifact): void {
    const entities = sceneData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
        prefab?: { prefabPath: string };
    }> | undefined;
    if (!entities) return;

    for (const entity of entities) {
        if (entity.prefab && typeof entity.prefab.prefabPath === 'string') {
            if (isUUID(entity.prefab.prefabPath)) {
                const path = artifact.assetLibrary.getPath(entity.prefab.prefabPath);
                if (path) entity.prefab.prefabPath = toBuildPath(path);
            } else {
                entity.prefab.prefabPath = toBuildPath(entity.prefab.prefabPath);
            }
        }
        for (const comp of entity.components || []) {
            const refFields = getComponentRefFields(comp.type);
            if (!refFields || !comp.data) continue;
            for (const field of refFields) {
                const value = comp.data[field];
                if (typeof value === 'string' && isUUID(value)) {
                    const path = artifact.assetLibrary.getPath(value);
                    if (path) comp.data[field] = toBuildPath(path);
                }
            }
        }
    }

    const textureMetadata = sceneData.textureMetadata as Record<string, unknown> | undefined;
    if (textureMetadata) {
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(textureMetadata)) {
            if (isUUID(key)) {
                const path = artifact.assetLibrary.getPath(key);
                resolved[path ?? key] = value;
            } else {
                resolved[key] = value;
            }
        }
        sceneData.textureMetadata = resolved;
    }
}

// =============================================================================
// User Script Imports
// =============================================================================

export async function collectUserScriptImports(
    fs: NativeFS,
    projectDir: string,
): Promise<{ imports: string; hasSrcDir: boolean }> {
    const scriptsPath = joinPath(projectDir, 'src');
    const hasSrcDir = await fs.exists(scriptsPath);

    let imports = '';
    if (hasSrcDir) {
        const scripts = await findTsFiles(fs, scriptsPath, EDITOR_ONLY_DIRS);
        imports = scripts.map(p => `import "${p}";`).join('\n');
    }

    return { imports, hasSrcDir };
}
