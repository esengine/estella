/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Sprite, type SpriteData } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';

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
                const entities = world.getEntitiesWithComponents([Text]);

                for (const entity of entities) {
                    const text = world.get(entity, Text) as TextData;
                    if (!text.dirty) continue;

                    if (!world.has(entity, Sprite)) {
                        world.insert(entity, Sprite, {
                            texture: 0,
                            size: { x: 0, y: 0 },
                            color: { x: 1, y: 1, z: 1, w: 1 },
                            anchor: { x: 0.5, y: 0.5 },
                            flip: { x: false, y: false }
                        });
                    }

                    const result = renderer.renderForEntity(entity, text);

                    const sprite = world.get(entity, Sprite) as SpriteData;
                    sprite.texture = result.textureHandle;
                    sprite.size = { x: result.width, y: result.height };
                    sprite.uvOffset = { x: 0, y: 0 };
                    sprite.uvScale = { x: 1, y: 1 };
                    world.insert(entity, Sprite, sprite);

                    text.dirty = false;
                }
            }
        ));
    }
}

export const textPlugin = new TextPlugin();
