import type { App, Plugin } from '../app';
import { INVALID_TEXTURE, type Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { registerComponent, Sprite, type SpriteData } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { UIRect, type UIRectData } from './UIRect';
import { ensureSprite, getEffectiveWidth, getEffectiveHeight } from './uiHelpers';
import { createSnapshotUtils, type Snapshot } from './uiSnapshot';

interface TextSource {
    text: TextData;
    uiRect: UIRectData | null;
    entity: Entity;
}

const textSnapshot = createSnapshotUtils<TextSource>({
    content: s => s.text.content,
    fontFamily: s => s.text.fontFamily,
    fontSize: s => s.text.fontSize,
    colorR: s => s.text.color.r,
    colorG: s => s.text.color.g,
    colorB: s => s.text.color.b,
    colorA: s => s.text.color.a,
    align: s => s.text.align,
    verticalAlign: s => s.text.verticalAlign,
    wordWrap: s => s.text.wordWrap,
    overflow: s => s.text.overflow,
    lineHeight: s => s.text.lineHeight,
    containerWidth: s => s.uiRect ? getEffectiveWidth(s.uiRect, s.entity) : 0,
    containerHeight: s => s.uiRect ? getEffectiveHeight(s.uiRect, s.entity) : 0,
});

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
        const snapshots = new Map<Entity, Snapshot>();

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                renderer.beginFrame();
                renderer.cleanupOrphaned(e => world.valid(e) && world.has(e, Text));

                for (const entity of snapshots.keys()) {
                    if (!world.valid(entity) || !world.has(entity, Text)) {
                        if (world.valid(entity) && world.has(entity, Sprite)) {
                            const s = world.get(entity, Sprite) as SpriteData;
                            world.insert(entity, Sprite, {
                                texture: INVALID_TEXTURE,
                                color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
                                size: { x: s.size.x, y: s.size.y },
                                uvOffset: { x: s.uvOffset.x, y: s.uvOffset.y },
                                uvScale: { x: s.uvScale.x, y: s.uvScale.y },
                                layer: s.layer,
                                flipX: s.flipX,
                                flipY: s.flipY,
                                material: s.material,
                                enabled: s.enabled,
                            });
                        }
                        snapshots.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([Text]);

                for (const entity of entities) {
                    const text = world.get(entity, Text) as TextData;
                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;
                    const source: TextSource = { text, uiRect, entity };
                    const prev = snapshots.get(entity);

                    if (prev && !textSnapshot.changed(prev, source)) {
                        const hasValidSprite = world.has(entity, Sprite)
                            && (world.get(entity, Sprite) as SpriteData).texture !== INVALID_TEXTURE;
                        if (hasValidSprite) continue;
                    }

                    ensureSprite(world, entity);

                    const effectiveRect = uiRect ? {
                        size: {
                            x: getEffectiveWidth(uiRect, entity),
                            y: getEffectiveHeight(uiRect, entity),
                        },
                    } : null;
                    const result = renderer.renderForEntity(entity, text, effectiveRect);

                    const s = world.get(entity, Sprite) as SpriteData;
                    world.insert(entity, Sprite, {
                        texture: result.textureHandle,
                        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
                        size: { x: result.width, y: result.height },
                        uvOffset: { x: 0, y: 0 },
                        uvScale: { x: 1, y: 1 },
                        layer: s.layer,
                        flipX: s.flipX,
                        flipY: s.flipY,
                        material: s.material,
                        enabled: s.enabled,
                    });

                    snapshots.set(entity, textSnapshot.take(source));
                }
            },
            { name: 'TextSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const textPlugin = new TextPlugin();
