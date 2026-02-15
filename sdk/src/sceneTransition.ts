/**
 * @file    sceneTransition.ts
 * @brief   Convenience wrapper for scene transitions
 */

import type { App } from './app';
import type { Color } from './types';
import { SceneManager } from './sceneManager';

export interface TransitionConfig {
    duration: number;
    type: 'fade';
    color?: Color;
}

export async function transitionTo(
    app: App,
    targetScene: string,
    config: TransitionConfig,
): Promise<void> {
    const manager = app.getResource(SceneManager);
    await manager.switchTo(targetScene, {
        transition: config.type,
        duration: config.duration,
        color: config.color,
    });
}
