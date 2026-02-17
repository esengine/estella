import type { App, Plugin } from '../app';
import { registerComponent, Sprite } from '../component';
import type { SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { INVALID_TEXTURE } from '../types';
import { Image, ImageType, FillMethod, FillOrigin } from './Image';
import type { ImageData } from './Image';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';

export class ImagePlugin implements Plugin {
    build(app: App): void {
        registerComponent('Image', Image);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const entities = world.getEntitiesWithComponents([Image]);

                for (const entity of entities) {
                    const image = world.get(entity, Image) as ImageData;

                    if (!world.has(entity, Sprite)) {
                        world.insert(entity, Sprite, {
                            texture: INVALID_TEXTURE,
                            color: { r: 1, g: 1, b: 1, a: 1 },
                            size: { x: 0, y: 0 },
                            uvOffset: { x: 0, y: 0 },
                            uvScale: { x: 1, y: 1 },
                            layer: 0,
                            flipX: false,
                            flipY: false,
                            material: 0,
                        });
                    }

                    const sprite = world.get(entity, Sprite) as SpriteData;

                    sprite.texture = image.texture;
                    sprite.color.r = image.color.r;
                    sprite.color.g = image.color.g;
                    sprite.color.b = image.color.b;
                    sprite.color.a = image.color.a;
                    sprite.layer = image.layer;
                    sprite.material = image.material;

                    if (world.has(entity, UIRect)) {
                        const rect = world.get(entity, UIRect) as UIRectData;
                        sprite.size.x = rect.size.x;
                        sprite.size.y = rect.size.y;
                    }

                    sprite.uvOffset.x = 0;
                    sprite.uvOffset.y = 0;
                    sprite.uvScale.x = 1;
                    sprite.uvScale.y = 1;

                    if (image.imageType === ImageType.Filled) {
                        const amount = Math.max(0, Math.min(1, image.fillAmount));

                        if (image.fillMethod === FillMethod.Horizontal) {
                            if (image.fillOrigin === FillOrigin.Left) {
                                sprite.uvScale.x = amount;
                                sprite.size.x *= amount;
                            } else {
                                sprite.uvOffset.x = 1 - amount;
                                sprite.uvScale.x = amount;
                                sprite.size.x *= amount;
                            }
                        } else {
                            if (image.fillOrigin === FillOrigin.Bottom) {
                                sprite.uvScale.y = amount;
                                sprite.size.y *= amount;
                            } else {
                                sprite.uvOffset.y = 1 - amount;
                                sprite.uvScale.y = amount;
                                sprite.size.y *= amount;
                            }
                        }
                    }

                    world.insert(entity, Sprite, sprite);
                }
            },
            { name: 'ImageSystem' }
        ));
    }
}

export const imagePlugin = new ImagePlugin();
