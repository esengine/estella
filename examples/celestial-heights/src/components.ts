import { defineComponent, defineTag } from 'esengine';

// The project's declaration entry: user component/tag definitions only, no
// systems. The editor extracts schemas from here so the inspector knows their
// fields without running project code.

/** Lyra. `speed` is world units per second on the ground plane. */
export const Player = defineComponent('Player', {
    speed: 380,
});

/** Anything the player fights. */
export const Enemy = defineTag('Enemy');

/** A way out of an area. `toScene` is the packaged scene name, e.g. `main`. */
export const Gate = defineComponent('Gate', {
    toScene: '',
    radius: 90,
});

/** Set once a tilemap's navigation grid has been derived from its tiles. */
export const NavGridBuilt = defineTag('NavGridBuilt');

/** The HUD bar that reports Lyra's health; its `UIVisual` fill follows her. */
export const VitalityMeter = defineTag('VitalityMeter');

/** The panel shown while the game is paused. */
export const PauseOverlay = defineTag('PauseOverlay');

/** The HUD line that announces an unlock, since no local store draws one. */
export const AchievementToast = defineTag('AchievementToast');

/** A pickup lying in the world. `kind` keys into ITEM_COLOR and the locale table. */
export const Item = defineComponent('Item', {
    kind: '',
});

/**
 * Where the actor is facing, as a unit vector. Melee arcs and animation both
 * read it, so it is written once per actor rather than derived twice from
 * whatever moved them.
 */
export const Facing = defineComponent('Facing', {
    x: 1,
    y: 0,
});

export const Health = defineComponent('Health', {
    current: 100,
    max: 100,
    /** Seconds of invulnerability a hit grants, so one swing lands once. */
    invulnerability: 0.35,
    /** Counts down; > 0 means further damage is ignored. */
    invulnerable: 0,
});

/**
 * The filled part of a floating health bar. It is a child of the actor it
 * reports on, so the bar follows without anyone having to copy a position.
 */
export const HealthBarFill = defineComponent('HealthBarFill', {
    /** Bar width at full health, in world units. */
    width: 72,
});

/**
 * One melee attack, for whoever swings it. Input and the wisps' behaviour tree
 * both only set `pending`, and one resolver turns that into an overlap query, an
 * arc test and damage — so `hits`, the mask of what a swing can reach, is the
 * only thing separating Lyra's sword from a wisp's touch.
 */
export const MeleeAttack = defineComponent('MeleeAttack', {
    damage: 25,
    /** Swing radius in world units. */
    reach: 96,
    /** Full width of the swing arc, centred on `Facing`, in degrees. */
    arcDegrees: 120,
    /** Seconds between swings. */
    cooldown: 0.45,
    /** Counts down; a swing is only allowed at 0. */
    cooldownLeft: 0,
    /** Set by whoever wants to swing; cleared by the resolver. */
    pending: false,
    /** Collision bits this attack can hit. */
    hits: 0,
});
