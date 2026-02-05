/**
 * @file    BatchBuilder.ts
 * @brief   Batch build multiple configurations
 */

import { BuildConfig } from '../types/BuildTypes';
import { BuildService, BuildResult } from './BuildService';
import { BuildProgressReporter, BuildProgress } from './BuildProgress';
import { BuildHistory, BuildHistoryEntry } from './BuildHistory';

// =============================================================================
// Types
// =============================================================================

export interface BatchBuildResult {
    success: boolean;
    results: ConfigBuildResult[];
    totalDuration: number;
    successCount: number;
    failureCount: number;
}

export interface ConfigBuildResult {
    configId: string;
    configName: string;
    result: BuildResult;
    duration: number;
}

export interface BatchBuildProgress {
    totalConfigs: number;
    completedConfigs: number;
    currentConfig: string;
    overallProgress: number;
    configProgresses: Map<string, BuildProgress>;
}

export type BatchProgressListener = (progress: BatchBuildProgress) => void;

// =============================================================================
// BatchBuilder Class
// =============================================================================

export class BatchBuilder {
    private projectPath_: string;
    private buildService_: BuildService;
    private history_: BuildHistory | null;
    private listeners_: Set<BatchProgressListener>;
    private aborted_: boolean;

    constructor(projectPath: string, history?: BuildHistory) {
        this.projectPath_ = projectPath;
        this.buildService_ = new BuildService(projectPath);
        this.history_ = history || null;
        this.listeners_ = new Set();
        this.aborted_ = false;
    }

    onProgress(listener: BatchProgressListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    private notify(progress: BatchBuildProgress): void {
        for (const listener of this.listeners_) {
            listener(progress);
        }
    }

    abort(): void {
        this.aborted_ = true;
    }

    async buildAll(configs: BuildConfig[]): Promise<BatchBuildResult> {
        const startTime = Date.now();
        const results: ConfigBuildResult[] = [];
        this.aborted_ = false;

        const progress: BatchBuildProgress = {
            totalConfigs: configs.length,
            completedConfigs: 0,
            currentConfig: '',
            overallProgress: 0,
            configProgresses: new Map(),
        };

        for (let i = 0; i < configs.length; i++) {
            if (this.aborted_) {
                break;
            }

            const config = configs[i];
            progress.currentConfig = config.name;
            progress.overallProgress = (i / configs.length) * 100;
            this.notify(progress);

            const configStartTime = Date.now();

            try {
                const result = await this.buildService_.build(config);
                const duration = Date.now() - configStartTime;

                results.push({
                    configId: config.id,
                    configName: config.name,
                    result,
                    duration,
                });

                if (this.history_) {
                    this.history_.addEntry({
                        configId: config.id,
                        configName: config.name,
                        platform: config.platform,
                        timestamp: Date.now(),
                        duration,
                        status: result.success ? 'success' : 'failed',
                        outputPath: result.outputPath,
                        error: result.error,
                    });
                }
            } catch (err) {
                const duration = Date.now() - configStartTime;
                const errorMsg = err instanceof Error ? err.message : String(err);

                results.push({
                    configId: config.id,
                    configName: config.name,
                    result: {
                        success: false,
                        error: errorMsg,
                    },
                    duration,
                });

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
                }
            }

            progress.completedConfigs = i + 1;
        }

        const totalDuration = Date.now() - startTime;
        const successCount = results.filter(r => r.result.success).length;
        const failureCount = results.length - successCount;

        progress.overallProgress = 100;
        progress.currentConfig = '';
        this.notify(progress);

        if (this.history_) {
            await this.history_.save();
        }

        return {
            success: failureCount === 0 && !this.aborted_,
            results,
            totalDuration,
            successCount,
            failureCount,
        };
    }

    async buildSelected(configs: BuildConfig[], selectedIds: string[]): Promise<BatchBuildResult> {
        const selectedConfigs = configs.filter(c => selectedIds.includes(c.id));
        return this.buildAll(selectedConfigs);
    }

    async buildPlatform(configs: BuildConfig[], platform: string): Promise<BatchBuildResult> {
        const platformConfigs = configs.filter(c => c.platform === platform);
        return this.buildAll(platformConfigs);
    }
}

// =============================================================================
// Parallel Batch Builder
// =============================================================================

export class ParallelBatchBuilder {
    private projectPath_: string;
    private history_: BuildHistory | null;
    private maxConcurrent_: number;
    private listeners_: Set<BatchProgressListener>;
    private aborted_: boolean;

    constructor(projectPath: string, options?: { history?: BuildHistory; maxConcurrent?: number }) {
        this.projectPath_ = projectPath;
        this.history_ = options?.history || null;
        this.maxConcurrent_ = options?.maxConcurrent || 2;
        this.listeners_ = new Set();
        this.aborted_ = false;
    }

    onProgress(listener: BatchProgressListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    private notify(progress: BatchBuildProgress): void {
        for (const listener of this.listeners_) {
            listener(progress);
        }
    }

    abort(): void {
        this.aborted_ = true;
    }

    async buildAll(configs: BuildConfig[]): Promise<BatchBuildResult> {
        const startTime = Date.now();
        const results: ConfigBuildResult[] = [];
        this.aborted_ = false;

        const progress: BatchBuildProgress = {
            totalConfigs: configs.length,
            completedConfigs: 0,
            currentConfig: '',
            overallProgress: 0,
            configProgresses: new Map(),
        };

        const queue = [...configs];
        const inProgress: Promise<void>[] = [];

        const buildConfig = async (config: BuildConfig): Promise<void> => {
            if (this.aborted_) return;

            const buildService = new BuildService(this.projectPath_);
            const configStartTime = Date.now();

            try {
                const result = await buildService.build(config);
                const duration = Date.now() - configStartTime;

                results.push({
                    configId: config.id,
                    configName: config.name,
                    result,
                    duration,
                });

                if (this.history_) {
                    this.history_.addEntry({
                        configId: config.id,
                        configName: config.name,
                        platform: config.platform,
                        timestamp: Date.now(),
                        duration,
                        status: result.success ? 'success' : 'failed',
                        outputPath: result.outputPath,
                        error: result.error,
                    });
                }
            } catch (err) {
                const duration = Date.now() - configStartTime;
                const errorMsg = err instanceof Error ? err.message : String(err);

                results.push({
                    configId: config.id,
                    configName: config.name,
                    result: {
                        success: false,
                        error: errorMsg,
                    },
                    duration,
                });

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
                }
            }

            progress.completedConfigs++;
            progress.overallProgress = (progress.completedConfigs / progress.totalConfigs) * 100;
            this.notify(progress);
        };

        while (queue.length > 0 || inProgress.length > 0) {
            if (this.aborted_) break;

            while (inProgress.length < this.maxConcurrent_ && queue.length > 0) {
                const config = queue.shift()!;
                const promise = buildConfig(config).then(() => {
                    const index = inProgress.indexOf(promise);
                    if (index !== -1) {
                        inProgress.splice(index, 1);
                    }
                });
                inProgress.push(promise);
            }

            if (inProgress.length > 0) {
                await Promise.race(inProgress);
            }
        }

        await Promise.all(inProgress);

        const totalDuration = Date.now() - startTime;
        const successCount = results.filter(r => r.result.success).length;
        const failureCount = results.length - successCount;

        if (this.history_) {
            await this.history_.save();
        }

        return {
            success: failureCount === 0 && !this.aborted_,
            results,
            totalDuration,
            successCount,
            failureCount,
        };
    }
}
