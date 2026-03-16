import type { App, Plugin } from '../app';
import { type Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { registerComponent } from '../component';
import { Text, type TextData } from './text';
import { TextRenderer } from './TextRenderer';
import { UIRect, type UIRectData } from './UIRect';
import { UIRenderer, UIVisualType } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { getEffectiveWidth, getEffectiveHeight, setUIRectSizeNative, ensureUIRenderer } from './uiHelpers';
import { getImageResolver, type DefaultImageResolver } from './ImageResolver';
import { parseRichText } from './RichTextParser';
import { SystemLabel, PluginName } from '../systemLabels';

export class TextPlugin implements Plugin {
    name = 'text';
    dependencies = [PluginName.UILayout];

    build(app: App): void {
        registerComponent('Text', Text);

        const module = app.wasmModule;
        if (!module) {
            console.warn('TextPlugin: No WASM module available');
            return;
        }

        const renderer = new TextRenderer(module);
        const world = app.world;
        const lastRenderedTick = new Map<Entity, number>();
        const lastContainerSize = new Map<Entity, string>();

        world.enableChangeTracking(Text);
        world.enableChangeTracking(UIRect);

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const resolver = getImageResolver();
                renderer.setImageResolver(resolver);
                if (resolver && 'retryFailed' in resolver) {
                    (resolver as DefaultImageResolver).retryFailed();
                }
                renderer.beginFrame();
                renderer.cleanupOrphaned(e => world.valid(e) && world.has(e, Text));

                for (const entity of lastRenderedTick.keys()) {
                    if (!world.valid(entity) || !world.has(entity, Text)) {
                        if (world.valid(entity) && world.has(entity, UIRenderer)) {
                            const r = world.get(entity, UIRenderer) as UIRendererData;
                            r.texture = 0;
                            r.visualType = UIVisualType.None;
                            world.insert(entity, UIRenderer, r);
                        }
                        lastRenderedTick.delete(entity);
                        lastContainerSize.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([Text]);
                for (const entity of entities) {
                    const text = world.get(entity, Text) as TextData;
                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;

                    const prevTick = lastRenderedTick.get(entity);
                    const hasValidRenderer = world.has(entity, UIRenderer)
                        && (world.get(entity, UIRenderer) as UIRendererData).texture !== 0;

                    const pendingForImage = resolver && resolver.pendingEntities.has(entity);
                    if (pendingForImage) resolver!.pendingEntities.delete(entity);

                    if (prevTick !== undefined && hasValidRenderer && !pendingForImage) {
                        const textChanged = world.isChangedSince(entity, Text, prevTick);
                        if (!textChanged) {
                            const containerKey = uiRect
                                ? `${getEffectiveWidth(uiRect, entity)}|${getEffectiveHeight(uiRect, entity)}`
                                : '';
                            const prevKey = lastContainerSize.get(entity) ?? '';
                            if (containerKey === prevKey) continue;
                            if (!text.wordWrap) {
                                lastContainerSize.set(entity, containerKey);
                                continue;
                            }
                        }
                    }

                    if (text.richText && resolver && 'trackEntity' in resolver) {
                        const runs = parseRichText(text.content);
                        const srcs: string[] = [];
                        for (const run of runs) {
                            if (run.type === 'image') srcs.push(run.src);
                        }
                        if (srcs.length > 0) {
                            (resolver as DefaultImageResolver).trackEntity(entity, srcs);
                        }
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

                    const tick = world.getWorldTick();
                    lastRenderedTick.set(entity, tick);
                    const containerKey = uiRect
                        ? `${getEffectiveWidth(uiRect, entity)}|${getEffectiveHeight(uiRect, entity)}`
                        : '';
                    lastContainerSize.set(entity, containerKey);
                }
            },
            { name: 'TextSystem' }
        ), { runAfter: [SystemLabel.UILayout] });
    }
}

export const textPlugin = new TextPlugin();
