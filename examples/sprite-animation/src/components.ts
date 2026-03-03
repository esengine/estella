import { defineComponent } from 'esengine';

export const AnimSwitcher = defineComponent('AnimSwitcher', {
    walkClip: 'assets/animations/walk.esanim',
    idleClip: 'assets/animations/idle.esanim',
    isWalking: true,
    switchTimer: 3,
});
