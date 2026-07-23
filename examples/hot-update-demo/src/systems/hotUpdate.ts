import { defineSystem, Query, Mut, Res, Assets, Sprite } from 'esengine';
import { HotDisplay } from '../components';

// The texture handle to stamp onto the display sprite after a hot update.
let handle = 0;
let started = false;

export const hotDisplaySystem = defineSystem(
    [Query(Mut(Sprite), HotDisplay), Res(Assets)],
    (query, assets) => {
        if (!started) {
            started = true;
            // The Display sprite references its texture by @uuid in the scene, so it
            // shows the shipped (green) art immediately — the texture lives in a
            // `remote` group but the reference is an ordinary @uuid. On a hot update,
            // applyUpdate invalidates the changed asset by that ref; reload it — now
            // the manifest routes the @uuid to the CDN — and the sprite follows.
            assets.onInvalidate((ref) => {
                void assets.loadTexture(ref).then((tex) => { handle = tex.handle; });
            });
        }
        if (handle !== 0) {
            for (const [, sprite] of query) sprite.texture = handle;
        }
    },
    { name: 'HotDisplaySystem' },
);
