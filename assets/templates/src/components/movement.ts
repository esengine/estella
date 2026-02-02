import { defineComponent, Type } from 'esengine';

export const Velocity = defineComponent({
    x: Type.f32,
    y: Type.f32
}, { x: 0, y: 0 }, 'Velocity');
