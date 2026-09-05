import { defineComponent, defineTag } from 'esengine';

/** The one the player is. Marks whose health and position the run tracks. */
export const Runner = defineTag('Runner');

/** A shard the archive wants back. Three of them open the gate. */
export const Core = defineComponent('Core', {
    taken: false,
    /** Radians of spin, so a taken core can stop turning. */
    spin: 0,
});

/** The door the run ends at. */
export const Gate = defineComponent('Gate', {
    open: false,
});

/** Something E does something to, once the runner is close enough. */
export const Reachable = defineComponent('Reachable', {
    radius: 120,
    prompt: '',
});

/** A floor that costs health to stand on. Axis-aligned about its own origin. */
export const Hazard = defineComponent('Hazard', {
    halfX: 100,
    halfZ: 100,
    damagePerSecond: 30,
});

/** Where a death puts the runner back. Armed once it is walked past. */
export const Checkpoint = defineComponent('Checkpoint', {
    /** Z the runner must reach for this to become the one it returns to. */
    armZ: 0,
    reached: false,
});

export const HealthMeter = defineTag('HealthMeter');
export const ObjectiveText = defineTag('ObjectiveText');
export const PromptText = defineTag('PromptText');
export const OverlayText = defineTag('OverlayText');
