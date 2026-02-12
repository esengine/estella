/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

import type { App, Plugin } from '../app';
import { INVALID_TEXTURE } from '../types';
import { defineSystem, Schedule } from '../system';
import { Sprite, type SpriteData } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { UIRect, type UIRectData } from './UIRect';

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
        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                renderer.cleanupOrphaned(e => world.valid(e) && world.has(e, Text));
                const entities = world.getEntitiesWithComponents([Text]);

                for (const entity of entities) {
                    const text = world.get(entity, Text) as TextData;
                    if (!text.dirty) continue;

                    if (!world.has(entity, Sprite)) {
                        world.insert(entity, Sprite, {
                            texture: INVALID_TEXTURE,
                            size: { x: 0, y: 0 },
                            color: { r: 1, g: 1, b: 1, a: 1 },
                            anchor: { x: 0.5, y: 0.5 },
                            flip: { x: false, y: false }
                        });
                    }

                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;
                    const result = renderer.renderForEntity(entity, text, uiRect);

                    const sprite = world.get(entity, Sprite) as SpriteData;
                    sprite.texture = result.textureHandle;
                    sprite.size.x = result.width;
                    sprite.size.y = result.height;
                    sprite.uvOffset.x = 0;
                    sprite.uvOffset.y = 0;
                    sprite.uvScale.x = 1;
                    sprite.uvScale.y = 1;
                    world.insert(entity, Sprite, sprite);

                    text.dirty = false;
                }
            }
        ));
    }
}

export const textPlugin = new TextPlugin();
