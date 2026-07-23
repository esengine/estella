import { defineComponent } from 'esengine';

/** Tag for the entity whose Sprite shows the CDN-delivered texture. `updates`
 *  counts how many hot updates have been applied (handy to read back in tests). */
export const HotDisplay = defineComponent('HotDisplay', {
    updates: 0,
});
