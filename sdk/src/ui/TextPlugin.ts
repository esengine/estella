/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { registerComponent, Sprite, type SpriteData } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { UIRect, type UIRectData } from './UIRect';
import { ensureSprite } from './uiHelpers';

interface TextSnapshot {
    content: string;
    fontFamily: string;
    fontSize: number;
    colorR: number;
    colorG: number;
    colorB: number;
    colorA: number;
    align: number;
    verticalAlign: number;
    wordWrap: boolean;
    overflow: number;
    lineHeight: number;
    containerWidth: number;
    containerHeight: number;
}

function takeSnapshot(text: TextData, uiRect?: UIRectData | null): TextSnapshot {
    return {
        content: text.content,
        fontFamily: text.fontFamily,
        fontSize: text.fontSize,
        colorR: text.color.r,
        colorG: text.color.g,
        colorB: text.color.b,
        colorA: text.color.a,
        align: text.align,
        verticalAlign: text.verticalAlign,
        wordWrap: text.wordWrap,
        overflow: text.overflow,
        lineHeight: text.lineHeight,
        containerWidth: uiRect ? uiRect.size.x : 0,
        containerHeight: uiRect ? uiRect.size.y : 0,
    };
}

function snapshotChanged(snap: TextSnapshot, text: TextData, uiRect?: UIRectData | null): boolean {
    return snap.content !== text.content
        || snap.fontFamily !== text.fontFamily
        || snap.fontSize !== text.fontSize
        || snap.colorR !== text.color.r
        || snap.colorG !== text.color.g
        || snap.colorB !== text.color.b
        || snap.colorA !== text.color.a
        || snap.align !== text.align
        || snap.verticalAlign !== text.verticalAlign
        || snap.wordWrap !== text.wordWrap
        || snap.overflow !== text.overflow
        || snap.lineHeight !== text.lineHeight
        || snap.containerWidth !== (uiRect ? uiRect.size.x : 0)
        || snap.containerHeight !== (uiRect ? uiRect.size.y : 0);
}

// =============================================================================
// Text Plugin
// =============================================================================

export class TextPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Text', Text);

        const module = app.wasmModule;
        if (!module) {
            console.warn('TextPlugin: No WASM module available');
            return;
        }

        const renderer = new TextRenderer(module);
        const world = app.world;
        const snapshots = new Map<Entity, TextSnapshot>();

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                renderer.cleanupOrphaned(e => world.valid(e) && world.has(e, Text));

                for (const entity of snapshots.keys()) {
                    if (!world.valid(entity) || !world.has(entity, Text)) {
                        snapshots.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([Text]);

                for (const entity of entities) {
                    const text = world.get(entity, Text) as TextData;
                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;
                    const prev = snapshots.get(entity);

                    if (prev && !snapshotChanged(prev, text, uiRect)) continue;

                    ensureSprite(world, entity);

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

                    snapshots.set(entity, takeSnapshot(text, uiRect));
                }
            },
            { name: 'TextSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const textPlugin = new TextPlugin();
