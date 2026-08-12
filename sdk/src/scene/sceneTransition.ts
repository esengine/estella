// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneTransition.ts
 * @brief   Convenience wrapper for scene transitions
 */

import type { App } from '../app/app';
import type { Color } from '../types';
import { SceneManager, SceneManagerState } from './sceneManager';

/** A cross-scene fade: how long, and what colour it passes through.
 *  @beta */
export interface TransitionConfig {
    duration: number;
    type: 'fade';
    color?: Color;
}

/**
 * Pass the App from host code, or the `Res(SceneManager)` state from inside a
 * system.
 *
 * @beta
 */
export async function transitionTo(
    host: App | SceneManagerState,
    targetScene: string,
    config: TransitionConfig,
): Promise<void> {
    const manager = host instanceof SceneManagerState ? host : host.getResource(SceneManager);
    await manager.switchTo(targetScene, {
        transition: config.type,
        duration: config.duration,
        color: config.color,
    });
}
