// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AudioProjectConfig } from '../audio/AudioProjectConfig';
import type { RuntimeBuildConfig } from '../defaults';
import type { Physics2DPluginConfig } from '../physics/PhysicsTypes';
import type { Physics3DWorldConfig } from '../physics3d/worldConfig';
import type { Physics3DBackend } from '../sideModules/registry';
import type { ThemeOverrides } from '../ui/theme/tokens';

/** Settings applied to a running game before its first scene, including editor Play. */
export interface RuntimeProjectSettings {
    /** Install 2D physics even when all bodies are spawned by game code. */
    physicsEnabled?: boolean;
    /** The 2D world, including gravity, solver settings and collision layers. */
    physicsConfig?: Physics2DPluginConfig;
    /** Defaults to Jolt. */
    physics3dBackend?: Physics3DBackend;
    /** Scene units per metre and gravity. */
    physics3dWorld?: Partial<Physics3DWorldConfig>;
    /** Project mixer buses, effects and ducking rules. */
    audioConfig?: AudioProjectConfig;
    /** Timing, asset timeouts and cache budgets, applied before the first load. */
    runtime?: RuntimeBuildConfig;
    /** Defaults to the dark widget theme. */
    uiTheme?: 'dark' | 'light';
    /** Color and type overrides applied over the base theme. */
    uiThemeOverrides?: ThemeOverrides;
    /** Allowed achievement IDs. An omitted or empty list allows free-form IDs. */
    achievements?: string[];
}

/** Select gameplay settings from a host's boot arguments. Asset transport and platform services belong to the host. */
export function runtimeProjectSettings(config: RuntimeProjectSettings): RuntimeProjectSettings {
    return {
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsConfig,
        physics3dBackend: config.physics3dBackend,
        physics3dWorld: config.physics3dWorld,
        audioConfig: config.audioConfig,
        runtime: config.runtime,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
        achievements: config.achievements,
    } satisfies Record<keyof RuntimeProjectSettings, unknown>;
}
