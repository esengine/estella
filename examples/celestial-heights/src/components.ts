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

/**
 * The one enemy a run ends on. `phase` is written from its health rather than
 * by whatever last hit it, so the brain, the HUD bar and the arena all read the
 * same number and a reloaded fight resumes in the phase the health says.
 */
export const Boss = defineComponent('Boss', {
    phase: 0,
});

/**
 * Calls help. Like every other attack in this game the brain only sets
 * `pending`; a system with the prefab server does the spawning, because a
 * behaviour tree decides and does not reach for engine resources.
 */
export const Summoner = defineComponent('Summoner', {
    prefab: '',
    /** How many arrive per call. */
    count: 2,
    /** Calls left in the fight — help is a phase, not an attrition strategy. */
    remaining: 3,
    cooldown: 9,
    cooldownLeft: 0,
    pending: false,
});

/**
 * A telegraphed charge: wind up in place, then cross the arena. `state` is
 * 0 idle / 1 winding up / 2 dashing — the wind-up is what makes it dodgeable
 * rather than an unfair teleport.
 */
export const Charge = defineComponent('Charge', {
    windup: 0.7,
    dashSpeed: 900,
    dashTime: 0.55,
    cooldown: 6,
    cooldownLeft: 0,
    pending: false,
    state: 0,
    timer: 0,
    dirX: 0,
    dirY: 0,
});

/**
 * What an area says about itself. Every area scene carries exactly one, which is
 * how the shared HUD — a scene of its own, loaded once and never swapped — can
 * report where Lyra is without an area having to reach into it.
 */
export const Area = defineComponent('Area', {
    nameKey: '',
});

/** The HUD line that names the current area, filled in from {@link Area}. */
export const AreaLabel = defineTag('AreaLabel');

/**
 * A way out of an area. `toScene` is the packaged scene name, e.g. `main`.
 * A gate that asks for something stays shut until the pack holds that many of
 * `requires` — which is what makes an area worth walking around rather than
 * straight through.
 */
export const Gate = defineComponent('Gate', {
    toScene: '',
    radius: 90,
    requires: '',
    requiresCount: 0,
});

/**
 * A place an area's enemies come from. An area declares where and how many
 * rather than carrying a copy of the wisp per enemy: eleven authored entities
 * per body is what makes a room expensive to populate, and a room nobody wants
 * to populate is a game that stays a demo.
 */
export const Spawner = defineComponent('Spawner', {
    prefab: '',
    count: 3,
    /** How far from the marker they are placed, in world units. */
    radius: 220,
});

/** Set once a spawner has placed its bodies, so it does so exactly once. */
export const Spawned = defineTag('Spawned');

/** Set once a tilemap's navigation grid has been derived from its tiles. */
export const NavGridBuilt = defineTag('NavGridBuilt');

/** The HUD bar that reports Lyra's health; its `UIVisual` fill follows her. */
export const VitalityMeter = defineTag('VitalityMeter');

/** The panel shown while the game is paused. */
export const PauseOverlay = defineTag('PauseOverlay');

/**
 * The on-screen controls, and the layer holding them. Shown once the game has
 * been touched at all: a thumb is the only input a phone has, and a stick drawn
 * over a keyboard player's world is clutter they never asked for.
 */
export const TouchLayer = defineTag('TouchLayer');

/** The stick's base — dragged, and the drag is where the movement comes from. */
export const TouchStick = defineTag('TouchStick');

/** The part of the stick that follows the thumb. */
export const TouchKnob = defineTag('TouchKnob');

/** An on-screen button, naming the action it stands for. */
export const TouchButton = defineComponent('TouchButton', {
    action: '',
});

/** The screen shown for the couple of seconds a run takes to end and restart. */
export const FallenOverlay = defineTag('FallenOverlay');

/** The HUD's boss bar: shown only while there is a boss to report on. */
export const BossPanel = defineTag('BossPanel');

/** The filled part of that bar. */
export const BossMeter = defineTag('BossMeter');

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
