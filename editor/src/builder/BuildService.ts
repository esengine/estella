/**
 * @file    BuildService.ts
 * @brief   Build service for compiling and packaging projects
 */

import type { BuildConfig } from '../types/BuildTypes';
import { PlayableBuilder } from './PlayableBuilder';
import { WeChatBuilder } from './WeChatBuilder';

// =============================================================================
// Types
// =============================================================================

export interface BuildResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

export interface BuildContext {
    projectPath: string;
    config: BuildConfig;
}

// =============================================================================
// BuildService
// =============================================================================

export class BuildService {
    private projectPath_: string;

    constructor(projectPath: string) {
        this.projectPath_ = projectPath;
    }

    async build(config: BuildConfig): Promise<BuildResult> {
        console.log(`[BuildService] Starting build for config: ${config.name}`);
        console.log(`[BuildService] Platform: ${config.platform}`);
        console.log(`[BuildService] Scenes: ${config.scenes.join(', ')}`);

        const context: BuildContext = {
            projectPath: this.projectPath_,
            config,
        };

        try {
            if (config.platform === 'playable') {
                const builder = new PlayableBuilder(context);
                return await builder.build();
            } else if (config.platform === 'wechat') {
                const builder = new WeChatBuilder(context);
                return await builder.build();
            } else {
                return {
                    success: false,
                    error: `Unknown platform: ${config.platform}`,
                };
            }
        } catch (err) {
            console.error('[BuildService] Build failed:', err);
            return {
                success: false,
                error: String(err),
            };
        }
    }
}
