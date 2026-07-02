import { defineComponent } from 'esengine';

// A tiny platformer character that walks + jumps on the tilemap's collidable
// tiles. Units are PIXELS: the scene runs pixel-space physics (a Canvas with
// pixelsPerUnit = 1), so the tilemap's per-tile colliders line up 1:1 with the
// character's collider.
export const Player = defineComponent('Player', {
    speed: 170,      // px/s horizontal
    jumpForce: 420,  // px/s launch velocity
});
