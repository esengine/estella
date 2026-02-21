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
    containerWidth: s => s.uiRect ? getEffectiveWidth(s.uiRect) : 0,
    containerHeight: s => s.uiRect ? getEffectiveHeight(s.uiRect) : 0,
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
                            const sprite = world.get(entity, Sprite) as SpriteData;
                            sprite.texture = INVALID_TEXTURE;
                            world.insert(entity, Sprite, sprite);
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
                    const source: TextSource = { text, uiRect };
                    const prev = snapshots.get(entity);

                    if (prev && !textSnapshot.changed(prev, source)) continue;

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

                    snapshots.set(entity, textSnapshot.take(source));
                }
            },
            { name: 'TextSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const textPlugin = new TextPlugin();
