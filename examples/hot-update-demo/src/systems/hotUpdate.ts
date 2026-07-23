import { defineSystem, Query, Mut, Res, Assets, Sprite } from 'esengine';
import { HotDisplay } from '../components';

// The texture handle currently loaded from the `cdn` remote group. The system
// stamps it onto the display sprite every frame, so when a hot update reloads
// the group into a NEW handle, the sprite follows automatically.
let cdnHandle = 0;
let started = false;

export const hotDisplaySystem = defineSystem(
    [Query(Mut(Sprite), HotDisplay), Res(Assets)],
    (query, assets) => {
        if (!started) {
            started = true;
            // Load the single texture in the `cdn` remote group. Re-run on every
            // hot update: after applyUpdate the manifest points `cdn` at the new
            // content-addressed url, so this fetches the fresh bytes.
            const load = (): void => {
                void assets.loadGroup('cdn').then((bundle) => {
                    const tex = [...bundle.textures.values()][0];
                    if (tex) cdnHandle = tex.handle;
                });
            };
            load();
            // A hot update (checkForUpdate → applyUpdate) fires onInvalidate.
            assets.onInvalidate(load);
        }
        if (cdnHandle !== 0) {
            for (const [, sprite] of query) sprite.texture = cdnHandle;
        }
    },
    { name: 'HotDisplaySystem' },
);
