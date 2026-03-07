import type { App, Plugin } from '../app';
import { type Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { registerComponent } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { UIRect, type UIRectData } from './UIRect';
import { UIRenderer, UIVisualType } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { getEffectiveWidth, getEffectiveHeight, setUIRectSizeNative } from './uiHelpers';
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

function ensureUIRenderer(world: import('../world').World, entity: Entity): void {
    if (!world.has(entity, UIRenderer)) {
        world.insert(entity, UIRenderer, {
            visualType: UIVisualType.None,
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
            material: 0,
            enabled: true,
        });
    }
}

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
                        if (world.valid(entity) && world.has(entity, UIRenderer)) {
                            const r = world.get(entity, UIRenderer) as UIRendererData;
                            r.texture = 0;
                            r.visualType = UIVisualType.None;
                            world.insert(entity, UIRenderer, r);
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
                        const hasValidRenderer = world.has(entity, UIRenderer)
                            && (world.get(entity, UIRenderer) as UIRendererData).texture !== 0;
                        if (hasValidRenderer) continue;
                    }

                    ensureUIRenderer(world, entity);

                    const effectiveRect = uiRect ? {
                        size: {
                            x: getEffectiveWidth(uiRect, entity),
                            y: getEffectiveHeight(uiRect, entity),
                        },
                    } : null;
                    const result = renderer.renderForEntity(entity, text, effectiveRect);
                    const r = world.get(entity, UIRenderer) as UIRendererData;
                    r.texture = result.textureHandle;
                    r.visualType = UIVisualType.Image;
                    r.color = { r: 1, g: 1, b: 1, a: 1 };
                    r.uvOffset = { x: 0, y: 0 };
                    r.uvScale = { x: 1, y: 1 };
                    world.insert(entity, UIRenderer, r);

                    if (uiRect) {
                        setUIRectSizeNative(entity, result.width, result.height);
                    }

                    snapshots.set(entity, textSnapshot.take(source));
                }
            },
            { name: 'TextSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const textPlugin = new TextPlugin();
