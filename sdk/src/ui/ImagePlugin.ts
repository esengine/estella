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
import { getEffectiveWidth, getEffectiveHeight } from './uiHelpers';
import { createSnapshotUtils, type Snapshot } from './uiSnapshot';

interface ImageSource {
    image: ImageData;
    uiRect: UIRectData | null;
    entity: Entity;
}

const imageSnapshot = createSnapshotUtils<ImageSource>({
    texture: s => s.image.texture,
    colorR: s => s.image.color.r,
    colorG: s => s.image.color.g,
    colorB: s => s.image.color.b,
    colorA: s => s.image.color.a,
    material: s => s.image.material,
    imageType: s => s.image.imageType,
    fillMethod: s => s.image.fillMethod,
    fillOrigin: s => s.image.fillOrigin,
    fillAmount: s => s.image.fillAmount,
    tileSizeX: s => s.image.tileSize.x,
    tileSizeY: s => s.image.tileSize.y,
    rectWidth: s => s.uiRect ? getEffectiveWidth(s.uiRect, s.entity) : 0,
    rectHeight: s => s.uiRect ? getEffectiveHeight(s.uiRect, s.entity) : 0,
    enabled: s => s.image.enabled,
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

export class ImagePlugin implements Plugin {
    build(app: App): void {
        registerComponent('Image', Image);

        const world = app.world;
        const snapshots = new Map<Entity, Snapshot>();

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                for (const entity of snapshots.keys()) {
                    if (!world.valid(entity) || !world.has(entity, Image)) {
                        snapshots.delete(entity);
                    }
                }

                const entities = world.getEntitiesWithComponents([Image]);

                for (const entity of entities) {
                    const image = world.get(entity, Image) as ImageData;
                    const uiRect = world.has(entity, UIRect)
                        ? world.get(entity, UIRect) as UIRectData
                        : null;
                    const source: ImageSource = { image, uiRect, entity };

                    const prev = snapshots.get(entity);
                    if (prev && world.has(entity, UIRenderer) && !imageSnapshot.changed(prev, source)) continue;

                    ensureUIRenderer(world, entity);

                    const renderer = world.get(entity, UIRenderer) as UIRendererData;

                    if (!image.enabled) {
                        renderer.enabled = false;
                        world.insert(entity, UIRenderer, renderer);
                        snapshots.set(entity, imageSnapshot.take(source));
                        continue;
                    }

                    renderer.enabled = true;
                    renderer.texture = image.texture;
                    renderer.color = { r: image.color.r, g: image.color.g, b: image.color.b, a: image.color.a };
                    renderer.material = image.material;

                    renderer.uvOffset = { x: 0, y: 0 };
                    renderer.uvScale = { x: 1, y: 1 };

                    if (image.imageType === ImageType.Sliced) {
                        renderer.visualType = UIVisualType.NineSlice;
                    } else {
                        renderer.visualType = UIVisualType.Image;
                    }

                    if (image.imageType === ImageType.Filled) {
                        const amount = Math.max(0, Math.min(1, image.fillAmount));
                        const w = uiRect ? getEffectiveWidth(uiRect, entity) : 0;
                        const h = uiRect ? getEffectiveHeight(uiRect, entity) : 0;

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
                    snapshots.set(entity, imageSnapshot.take(source));
                }
            },
            { name: 'ImageSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const imagePlugin = new ImagePlugin();
