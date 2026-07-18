import { defineComponent } from 'esengine';

export const ShipControl = defineComponent('ShipControl', {
    speed: 260,
    flash: 0,
});

export const Bullet = defineComponent('Bullet', {
    lifetime: 0.7,
    speed: 480,
});
