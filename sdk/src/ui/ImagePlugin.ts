import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { registerComponent, Sprite } from '../component';
import type { SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Image, ImageType, FillMethod, FillOrigin } from './Image';
import type { ImageData } from './Image';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { ensureSprite, getEffectiveWidth, getEffectiveHeight } from './uiHelpers';
import { createSnapshotUtils, type Snapshot } from './uiSnapshot';

interface ImageSource {
    image: ImageData;
    uiRect: UIRectData | null;
}

const imageSnapshot = createSnapshotUtils<ImageSource>({
    texture: s => s.image.texture,
    colorR: s => s.image.color.r,
    colorG: s => s.image.color.g,
    colorB: s => s.image.color.b,
    colorA: s => s.image.color.a,
    layer: s => s.image.layer,
    material: s => s.image.material,
    imageType: s => s.image.imageType,
    fillMethod: s => s.image.fillMethod,
    fillOrigin: s => s.image.fillOrigin,
    fillAmount: s => s.image.fillAmount,
    tileSizeX: s => s.image.tileSize.x,
    tileSizeY: s => s.image.tileSize.y,
    rectWidth: s => s.uiRect ? getEffectiveWidth(s.uiRect) : 0,
    rectHeight: s => s.uiRect ? getEffectiveHeight(s.uiRect) : 0,
    enabled: s => s.image.enabled,
});

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
                    const source: ImageSource = { image, uiRect };

                    const prev = snapshots.get(entity);
                    if (prev && !imageSnapshot.changed(prev, source)) continue;

                    ensureSprite(world, entity);

                    const sprite = world.get(entity, Sprite) as SpriteData;

                    if (!image.enabled) {
                        sprite.color.a = 0;
                        world.insert(entity, Sprite, sprite);
                        snapshots.set(entity, imageSnapshot.take(source));
                        continue;
                    }

                    sprite.texture = image.texture;
                    sprite.color.r = image.color.r;
                    sprite.color.g = image.color.g;
                    sprite.color.b = image.color.b;
                    sprite.color.a = image.color.a;
                    sprite.layer = image.layer;
                    sprite.material = image.material;

                    if (uiRect) {
                        sprite.size.x = getEffectiveWidth(uiRect);
                        sprite.size.y = getEffectiveHeight(uiRect);
                    }

                    sprite.uvOffset.x = 0;
                    sprite.uvOffset.y = 0;
                    sprite.uvScale.x = 1;
                    sprite.uvScale.y = 1;

                    if (image.imageType === ImageType.Filled) {
                        const amount = Math.max(0, Math.min(1, image.fillAmount));
                        const fullWidth = sprite.size.x;
                        const fullHeight = sprite.size.y;

                        if (image.fillMethod === FillMethod.Horizontal) {
                            if (image.fillOrigin === FillOrigin.Left) {
                                sprite.uvScale.x = amount;
                                sprite.size.x = fullWidth * amount;
                            } else {
                                sprite.uvOffset.x = 1 - amount;
                                sprite.uvScale.x = amount;
                                sprite.size.x = fullWidth * amount;
                            }
                        } else {
                            if (image.fillOrigin === FillOrigin.Bottom) {
                                sprite.uvScale.y = amount;
                                sprite.size.y = fullHeight * amount;
                            } else {
                                sprite.uvOffset.y = 1 - amount;
                                sprite.uvScale.y = amount;
                                sprite.size.y = fullHeight * amount;
                            }
                        }
                    } else if (image.imageType === ImageType.Tiled) {
                        if (image.tileSize.x > 0 && image.tileSize.y > 0) {
                            sprite.uvScale.x = sprite.size.x / image.tileSize.x;
                            sprite.uvScale.y = sprite.size.y / image.tileSize.y;
                        }
                    }

                    world.insert(entity, Sprite, sprite);
                    snapshots.set(entity, imageSnapshot.take(source));
                }
            },
            { name: 'ImageSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const imagePlugin = new ImagePlugin();
