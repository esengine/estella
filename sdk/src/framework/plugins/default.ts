/**
 * @file    default.ts
 * @brief   Default plugins for common functionality (Time, Input)
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { App, Plugin } from '../app';
import { Time, Input, InputState } from '../resource';

// =============================================================================
// Time Plugin
// =============================================================================

export const TimePlugin: Plugin = {
    build(app: App): void {
        app.initResource(Time);
    }
};

// =============================================================================
// Input Plugin
// =============================================================================

export const InputPlugin: Plugin = {
    build(app: App): void {
        const inputState: InputState = {
            keysDown: new Set(),
            keysPressed: new Set(),
            keysReleased: new Set(),
            mouseX: 0,
            mouseY: 0,
            mouseButtons: new Set()
        };

        app.insertResource(Input, inputState);

        if (typeof window !== 'undefined') {
            setupInputListeners(app, inputState);
        }
    }
};

function setupInputListeners(app: App, state: InputState): void {
    window.addEventListener('keydown', (e) => {
        if (!state.keysDown.has(e.code)) {
            state.keysPressed.add(e.code);
        }
        state.keysDown.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
        state.keysDown.delete(e.code);
        state.keysReleased.add(e.code);
    });

    window.addEventListener('mousemove', (e) => {
        state.mouseX = e.clientX;
        state.mouseY = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
        state.mouseButtons.add(e.button);
    });

    window.addEventListener('mouseup', (e) => {
        state.mouseButtons.delete(e.button);
    });
}

// =============================================================================
// Frame Cleanup Plugin
// =============================================================================

export const FrameCleanupPlugin: Plugin = {
    build(app: App): void {
        // Clear per-frame input state at the end of each frame
        // This would need access to the input resource
    }
};

// =============================================================================
// Default Plugins Bundle
// =============================================================================

export const DefaultPlugins: Plugin = {
    build(app: App): void {
        app.addPlugin(TimePlugin);
        app.addPlugin(InputPlugin);
    }
};
