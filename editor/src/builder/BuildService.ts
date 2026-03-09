/**
 * @file    BuildService.ts
 * @brief   Build service for compiling and packaging projects
 */

import type { BuildConfig, EngineModules } from '../types/BuildTypes';
import { createDefaultEngineModules } from '../types/BuildTypes';
import type { SpineVersion } from '../types/ProjectTypes';
import type { PlatformEmitter } from './PlatformEmitter';
import { buildArtifact } from './ArtifactBuilder';
import { PlayableEmitter } from './PlayableEmitter';
import { WeChatEmitter } from './WeChatEmitter';
import { BuildCache } from './BuildCache';
import { BuildProgressReporter, formatDuration } from './BuildProgress';
import { BuildHistory } from './BuildHistory';
import { getProjectDir } from '../utils/path';
import { getSettingsValue } from '../settings/SettingsRegistry';
import { MAX_COLLISION_LAYERS } from '../settings/collisionLayers';
import { getEditorContext } from '../context/EditorContext';
import { executeHooks } from './BuildHooks';

// =============================================================================
// Types
// =============================================================================

export interface OutputFileEntry {
    path: string;
    size: number;
}

export interface BuildResult {
    success: boolean;
    outputPath?: string;
    outputSize?: number;
    outputFiles?: OutputFileEntry[];
    error?: string;
    duration?: number;
    cached?: boolean;
}

export interface RuntimeBuildConfig {
    sceneTransitionDuration?: number;
    sceneTransitionColor?: string;
    defaultFontFamily?: string;
    canvasScaleMode?: string;
    canvasMatchWidthOrHeight?: number;
    maxDeltaTime?: number;
    maxFixedSteps?: number;
    textCanvasSize?: number;
    assetLoadTimeout?: number;
    assetFailureCooldown?: number;
}

export interface CustomWasmPaths {
    jsPath?: string;
    wasmPath?: string;
}

export interface BuildContext {
    projectPath: string;
    config: BuildConfig;
    spineVersion?: SpineVersion;
    enablePhysics?: boolean;
    physicsGravity?: { x: number; y: number };
    physicsFixedTimestep?: number;
    physicsSubStepCount?: number;
    collisionLayerMasks?: number[];
    runtimeConfig?: RuntimeBuildConfig;
    progress?: BuildProgressReporter;
    cache?: BuildCache;
    customWasm?: CustomWasmPaths;
}

export interface BuildOptions {
    useCache?: boolean;
    progress?: BuildProgressReporter;
}

// =============================================================================
// BuildService
// =============================================================================

export class BuildService {
    private projectPath_: string;
    private cache_: BuildCache;
    private history_: BuildHistory | null;

    constructor(projectPath: string, history?: BuildHistory) {
        this.projectPath_ = projectPath;
        this.cache_ = new BuildCache(getProjectDir(projectPath));
        this.history_ = history || null;
    }

    async build(config: BuildConfig, options?: BuildOptions): Promise<BuildResult> {
        const progress = options?.progress || new BuildProgressReporter();
        const useCache = options?.useCache ?? true;
        const startTime = Date.now();

        console.log(`[BuildService] Starting build for config: ${config.name}`);
        console.log(`[BuildService] Platform: ${config.platform}`);
        console.log(`[BuildService] Scenes: ${config.scenes.join(', ')}`);

        progress.setPhase('preparing');
        progress.log('info', `Building config: ${config.name}`);

        const spineVersionRaw = getSettingsValue<string>('project.spineVersion');
        const spineVersion = spineVersionRaw === 'none' ? undefined : spineVersionRaw as SpineVersion | undefined;
        const enablePhysics = getSettingsValue<boolean>('project.enablePhysics') ?? false;

        const context: BuildContext = {
            projectPath: this.projectPath_,
            config,
            spineVersion,
            enablePhysics,
            physicsGravity: {
                x: getSettingsValue<number>('physics.gravityX') ?? 0,
                y: getSettingsValue<number>('physics.gravityY') ?? -9.81,
            },
            physicsFixedTimestep: getSettingsValue<number>('physics.fixedTimestep') ?? 1 / 60,
            physicsSubStepCount: getSettingsValue<number>('physics.subStepCount') ?? 4,
            collisionLayerMasks: Array.from({ length: MAX_COLLISION_LAYERS }, (_, i) =>
                getSettingsValue<number>(`physics.layerMask${i}`) ?? 0xFFFF
            ),
            runtimeConfig: {
                sceneTransitionDuration: getSettingsValue<number>('runtime.sceneTransitionDuration') ?? 0.3,
                sceneTransitionColor: getSettingsValue<string>('runtime.sceneTransitionColor') ?? '#000000',
                defaultFontFamily: getSettingsValue<string>('runtime.defaultFontFamily') ?? 'Arial',
                canvasScaleMode: getSettingsValue<string>('runtime.canvasScaleMode') ?? 'FixedHeight',
                canvasMatchWidthOrHeight: getSettingsValue<number>('runtime.canvasMatchWidthOrHeight') ?? 0.5,
                maxDeltaTime: getSettingsValue<number>('runtime.maxDeltaTime') ?? 0.25,
                maxFixedSteps: getSettingsValue<number>('runtime.maxFixedSteps') ?? 8,
                textCanvasSize: parseInt(getSettingsValue<string>('runtime.textCanvasSize') ?? '512', 10),
                assetLoadTimeout: getSettingsValue<number>('asset.timeout') ?? 30000,
                assetFailureCooldown: getSettingsValue<number>('asset.failureCooldown') ?? 5000,
            },
            progress,
            cache: useCache ? this.cache_ : undefined,
        };

        try {
            const fs = getEditorContext().fs;
            if (!fs) {
                progress.fail('Native file system not available');
                return { success: false, error: 'Native file system not available' };
            }

            const projectDir = getProjectDir(this.projectPath_);
            const artifact = await buildArtifact(fs, projectDir, config, progress, context.cache);

            let emitter: PlatformEmitter;
            if (config.platform === 'playable') {
                emitter = new PlayableEmitter();
            } else if (config.platform === 'wechat') {
                emitter = new WeChatEmitter();
            } else {
                progress.fail(`Unknown platform: ${config.platform}`);
                return {
                    success: false,
                    error: `Unknown platform: ${config.platform}`,
                };
            }

            if (config.engineModules && !isAllModulesEnabled(config.engineModules)) {
                progress.setPhase('compiling');
                progress.setCurrentTask('Compiling custom WASM...', 0);
                progress.log('info', 'Custom engine modules detected, compiling WASM...');

                const compileResult = await compileCustomWasm(config);
                if (!compileResult.success) {
                    progress.fail(compileResult.error || 'WASM compilation failed');
                    return {
                        success: false,
                        error: compileResult.error || 'WASM compilation failed',
                        duration: Date.now() - startTime,
                    };
                }

                context.customWasm = {
                    jsPath: compileResult.jsPath,
                    wasmPath: compileResult.wasmPath,
                };
                progress.log('info', `Custom WASM compiled (${formatSize(compileResult.wasmSize)})`);
            }

            const hooks = config.hooks ?? [];
            const outputPath = config.playableSettings?.outputPath
                ?? config.wechatSettings?.outputDir
                ?? '';

            if (hooks.length > 0) {
                await executeHooks(hooks, 'pre', projectDir, outputPath, fs, progress);
            }

            const result = await emitter.emit(artifact, context);

            if (result.success && hooks.length > 0) {
                await executeHooks(hooks, 'post', projectDir, result.outputPath ?? outputPath, fs, progress);
            }

            const duration = Date.now() - startTime;
            result.duration = duration;

            if (result.success) {
                progress.complete();
                progress.log('info', `Build completed in ${formatDuration(duration)}`);

                if (useCache && artifact.atlasInputHash) {
                    try {
                        const cacheData = await this.cache_.loadCache(config.id || 'default') || {
                            version: '1.3',
                            configId: config.id || 'default',
                            timestamp: Date.now(),
                            files: {},
                        };

                        cacheData.atlasPages = this.cache_.serializeAtlasPages(artifact.atlasResult.pages);
                        cacheData.atlasInputHash = artifact.atlasInputHash;

                        await this.cache_.saveCache(cacheData);
                    } catch (err) {
                        console.error('Failed to save build cache:', err);
                    }
                }

                if (this.history_) {
                    this.history_.addEntry({
                        configId: config.id,
                        configName: config.name,
                        platform: config.platform,
                        timestamp: Date.now(),
                        duration,
                        status: 'success',
                        outputPath: result.outputPath,
                        outputSize: result.outputSize,
                    });
                    await this.history_.save();
                }
            } else {
                progress.fail(result.error || 'Build failed');

                if (this.history_) {
                    this.history_.addEntry({
                        configId: config.id,
                        configName: config.name,
                        platform: config.platform,
                        timestamp: Date.now(),
                        duration,
                        status: 'failed',
                        error: result.error,
                    });
                    await this.history_.save();
                }
            }

            return result;
        } catch (err) {
            const duration = Date.now() - startTime;
            const errorMsg = err instanceof Error ? err.message : String(err);

            console.error('[BuildService] Build failed:', err);
            progress.fail(errorMsg);

            if (this.history_) {
                this.history_.addEntry({
                    configId: config.id,
                    configName: config.name,
                    platform: config.platform,
                    timestamp: Date.now(),
                    duration,
                    status: 'failed',
                    error: errorMsg,
                });
                await this.history_.save();
            }

            return {
                success: false,
                error: errorMsg,
                duration,
            };
        }
    }

    getCache(): BuildCache {
        return this.cache_;
    }

    getHistory(): BuildHistory | null {
        return this.history_;
    }

    async clearCache(configId?: string): Promise<void> {
        if (configId) {
            await this.cache_.invalidateCache(configId);
        } else {
            await this.cache_.clearAllCaches();
        }
    }
}

// =============================================================================
// Custom WASM compilation
// =============================================================================

interface CompileWasmResult {
    success: boolean;
    jsPath?: string;
    wasmPath?: string;
    wasmSize?: number;
    error?: string;
}

function isAllModulesEnabled(modules: EngineModules): boolean {
    const defaults = createDefaultEngineModules();
    return (Object.keys(defaults) as Array<keyof EngineModules>).every(
        key => modules[key] !== false
    );
}

async function compileCustomWasm(config: BuildConfig): Promise<CompileWasmResult> {
    const { invoke } = await import('@tauri-apps/api/core');

    const modules = config.engineModules ?? createDefaultEngineModules();
    const target = config.platform === 'wechat' ? 'wechat' : 'playable';

    const result = await invoke<{
        success: boolean;
        wasm_path: string | null;
        js_path: string | null;
        wasm_size: number | null;
        error: string | null;
    }>('compile_wasm', {
        options: {
            features: {
                tilemap: modules.tilemap,
                particles: modules.particles,
                timeline: modules.timeline,
                postprocess: modules.postprocess,
                bitmap_text: modules.bitmapText,
                spine: modules.spine,
            },
            target,
            debug: config.defines.includes('DEBUG'),
            optimization: '-O2',
        },
    });

    return {
        success: result.success,
        jsPath: result.js_path ?? undefined,
        wasmPath: result.wasm_path ?? undefined,
        wasmSize: result.wasm_size ?? undefined,
        error: result.error ?? undefined,
    };
}

function formatSize(bytes?: number): string {
    if (bytes == null) return 'unknown';
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}
