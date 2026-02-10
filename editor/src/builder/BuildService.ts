/**
 * @file    BuildService.ts
 * @brief   Build service for compiling and packaging projects
 */

import type { BuildConfig } from '../types/BuildTypes';
import type { SpineVersion } from '../types/ProjectTypes';
import { PlayableBuilder } from './PlayableBuilder';
import { WeChatBuilder } from './WeChatBuilder';
import { BuildCache } from './BuildCache';
import { BuildProgressReporter, formatDuration } from './BuildProgress';
import { BuildHistory } from './BuildHistory';
import { getProjectDir } from '../utils/path';
import { loadProjectConfig } from '../launcher/ProjectService';

// =============================================================================
// Types
// =============================================================================

export interface BuildResult {
    success: boolean;
    outputPath?: string;
    outputSize?: number;
    error?: string;
    duration?: number;
    cached?: boolean;
}

export interface BuildContext {
    projectPath: string;
    config: BuildConfig;
    spineVersion?: SpineVersion;
    progress?: BuildProgressReporter;
    cache?: BuildCache;
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

        const projectConfig = await loadProjectConfig(this.projectPath_);
        const spineVersion = projectConfig?.spineVersion;

        const context: BuildContext = {
            projectPath: this.projectPath_,
            config,
            spineVersion,
            progress,
            cache: useCache ? this.cache_ : undefined,
        };

        try {
            let result: BuildResult;

            if (config.platform === 'playable') {
                const builder = new PlayableBuilder(context);
                result = await builder.build();
            } else if (config.platform === 'wechat') {
                const builder = new WeChatBuilder(context);
                result = await builder.build();
            } else {
                progress.fail(`Unknown platform: ${config.platform}`);
                return {
                    success: false,
                    error: `Unknown platform: ${config.platform}`,
                };
            }

            const duration = Date.now() - startTime;
            result.duration = duration;

            if (result.success) {
                progress.complete();
                progress.log('info', `Build completed in ${formatDuration(duration)}`);

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
