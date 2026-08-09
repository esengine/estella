import { defineEvent, type Entity } from 'esengine';

/**
 * Everything that hurts anything goes through here, so invulnerability frames,
 * death and (later) hit reactions exist once instead of once per attacker.
 */
export const DamageDealt = defineEvent<{
    target: Entity;
    amount: number;
    /** Where the blow came from, for knockback and hit sparks. */
    fromX: number;
    fromY: number;
}>('DamageDealt');

export const Died = defineEvent<{ entity: Entity; isPlayer: boolean }>('Died');
