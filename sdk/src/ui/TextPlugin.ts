/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Query, Mut } from '../query';
import { Sprite, type SpriteData } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { defineResource, Res } from '../resource';

// =============================================================================
// TextRenderer Resource
// =============================================================================

export interface TextRendererData {
    renderer: TextRenderer | null;
}

export const TextRendererRes = defineResource<TextRendererData>(
    { renderer: null },
    'TextRenderer'
);

// =============================================================================
// Text Plugin
// =============================================================================

export class TextPlugin implements Plugin {
    build(app: App): void {
        const module = app.wasmModule;
        if (!module) {
            console.warn('TextPlugin: No WASM module available');
            return;
        }

        const renderer = new TextRenderer(module);

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [],
            () => {
                // Initialization if needed
            }
        ));

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Query(Text, Mut(Sprite))],
            (query) => {
                for (const [entity, text, sprite] of query) {
                    const textData = text as TextData;
                    const spriteData = sprite as SpriteData;

                    if (!textData.dirty) continue;

                    const result = renderer.renderForEntity(entity, textData);
                    console.log(`Text texture size: ${result.width}x${result.height}`);

                    spriteData.texture = result.textureHandle;
                    spriteData.size = { x: result.width, y: result.height };
                    spriteData.color = { x: 1, y: 1, z: 1, w: 1 };
                    spriteData.uvOffset = { x: 0, y: 0 };
                    spriteData.uvScale = { x: 1, y: 1 };

                    textData.dirty = false;
                }
            }
        ));
    }
}

export const textPlugin = new TextPlugin();
