/**
 * @file    EmitterUtils.ts
 * @brief   Shared utilities for platform emitters (Playable, WeChat)
 */

import type { BuildArtifact } from './PlatformEmitter';
import type { BuildContext } from './BuildService';
import type { EngineModules } from '../types/BuildTypes';
import type { NativeFS } from '../types/NativeFS';
import type { SdkModuleLoader } from '../scripting/types';
import { ScriptCompiler } from '../scripting/ScriptCompiler';
import { joinPath } from '../utils/path';
import { isUUID, getComponentRefFields } from '../asset/AssetLibrary';
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
// Engine Module → Plugin Mapping
// =============================================================================

const MODULE_PLUGIN_MAP: Record<keyof EngineModules, string[]> = {
    particles: ['particlePlugin'],
    tilemap: ['tilemapPlugin'],
    timeline: ['timelinePlugin'],
    postprocess: ['postProcessPlugin'],
    bitmapText: [],
    spine: [],
};

export function filterPluginsByModules(plugins: string[], modules?: EngineModules): string[] {
    if (!modules) return plugins;

    const disabled = new Set<string>();
    for (const [mod, pluginNames] of Object.entries(MODULE_PLUGIN_MAP)) {
        if (!modules[mod as keyof EngineModules]) {
            for (const p of pluginNames) disabled.add(p);
        }
    }

    return plugins.filter(p => !disabled.has(p));
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
    const compiler = new ScriptCompiler();
    return compiler.compile(fs, projectDir, options.entryContent, {
        format: 'iife',
        sdk: { type: 'loader', load: options.sdkResolver, preferEsmEntry: options.preferEsmEntry ?? true },
        minify: options.minify,
        defines: buildDefinesMap(context.config.defines),
    });
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
    const compiler = new ScriptCompiler();
    const scriptsPath = joinPath(projectDir, 'src');
    const hasSrcDir = await fs.exists(scriptsPath);

    const plugins = await compiler.discoverPlugins(fs, projectDir, 'main');
    const scripts = hasSrcDir ? await compiler.discoverScripts(fs, projectDir) : [];
    const imports = compiler.buildEntry(plugins, scripts);

    return { imports, hasSrcDir: hasSrcDir || plugins.length > 0 };
}
