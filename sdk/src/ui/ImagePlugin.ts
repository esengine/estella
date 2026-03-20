import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { Image, ImageType, FillMethod, FillOrigin } from './Image';
import type { ImageData } from './Image';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { UIRenderer, UIVisualType } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { getEffectiveWidth, getEffectiveHeight, ensureUIRenderer } from './uiHelpers';
import { SystemLabel, PluginName } from '../systemLabels';

export class ImagePlugin implements Plugin {
    name = PluginName.Image;
    dependencies = [PluginName.UILayout];

    build(app: App): void {
        registerComponent('Image', Image);

        const world = app.world;
        const lastRenderedTick = new Map<Entity, number>();

        world.enableChangeTracking(Image);
        world.enableChangeTracking(UIRect);

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                for (const entity of lastRenderedTick.keys()) {
                    if (!world.valid(entity) || !world.has(entity, Image)) {
                        lastRenderedTick.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([Image]);

                for (const entity of entities) {
                    const image = world.get(entity, Image) as ImageData;
                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;

                    const prevTick = lastRenderedTick.get(entity);
                    if (prevTick !== undefined && world.has(entity, UIRenderer)) {
                        const imageChanged = world.isChangedSince(entity, Image, prevTick);
                        const rectChanged = uiRect && world.isChangedSince(entity, UIRect, prevTick);
                        if (!imageChanged && !rectChanged) continue;
                    }

                    ensureUIRenderer(world, entity);

                    const renderer = world.get(entity, UIRenderer) as UIRendererData;

                    if (!image.enabled) {
                        renderer.enabled = false;
                        world.insert(entity, UIRenderer, renderer);
                        lastRenderedTick.set(entity, world.getWorldTick());
                        continue;
                    }

                    renderer.enabled = true;
                    renderer.texture = image.texture;
                    renderer.color = { r: image.color.r, g: image.color.g, b: image.color.b, a: image.color.a };
                    renderer.material = image.material;

                    renderer.uvOffset = { x: 0, y: 0 };
                    renderer.uvScale = { x: 1, y: 1 };

                    const hasTexture = !!image.texture;
                    if (!hasTexture) {
                        renderer.visualType = UIVisualType.SolidColor;
                    } else if (image.imageType === ImageType.Sliced) {
                        renderer.visualType = UIVisualType.NineSlice;
                    } else {
                        renderer.visualType = UIVisualType.Image;
                    }

                    if (image.imageType === ImageType.Filled) {
                        const amount = Math.max(0, Math.min(1, image.fillAmount));

                        if (image.fillMethod === FillMethod.Horizontal) {
                            if (image.fillOrigin === FillOrigin.Left) {
                                renderer.uvScale = { x: amount, y: 1 };
                            } else {
                                renderer.uvOffset = { x: 1 - amount, y: 0 };
                                renderer.uvScale = { x: amount, y: 1 };
                            }
                        } else {
                            if (image.fillOrigin === FillOrigin.Bottom) {
                                renderer.uvScale = { x: 1, y: amount };
                            } else {
                                renderer.uvOffset = { x: 0, y: 1 - amount };
                                renderer.uvScale = { x: 1, y: amount };
                            }
                        }
                    } else if (image.imageType === ImageType.Tiled) {
                        const w = uiRect ? getEffectiveWidth(uiRect, entity) : 0;
                        const h = uiRect ? getEffectiveHeight(uiRect, entity) : 0;
                        if (image.tileSize.x > 0 && image.tileSize.y > 0) {
                            renderer.uvScale = { x: w / image.tileSize.x, y: h / image.tileSize.y };
                        }
                    }

                    world.insert(entity, UIRenderer, renderer);
                    lastRenderedTick.set(entity, world.getWorldTick());
                }
            },
            { name: 'ImageSystem' }
        ), { runAfter: [SystemLabel.UILayout] });
    }
}

export const imagePlugin = new ImagePlugin();
