import { defineResource, type PrefabOverride } from 'esengine';

export const HALF_HEIGHT = 540;
export const HALF_WIDTH = 300;
export const PLAYER_START_Y = -420;
export const SPAWN_Y = HALF_HEIGHT + 60;
export const DESTROY_Y = -(HALF_HEIGHT + 60);

export const PLAYER_SIZE = 64;
export const ENEMY_A_SIZE = 48;
export const ENEMY_B_SIZE = 56;
export const BULLET_PLAYER_W = 8;
export const BULLET_PLAYER_H = 24;
export const BULLET_ENEMY_W = 8;
export const BULLET_ENEMY_H = 20;
export const EXPLOSION_SIZE = 64;
export const STAR_SIZE = 4;

export const SHOOT_COOLDOWN = 0.15;
export const ENEMY_SPAWN_INTERVAL_BASE = 1.2;
export const ENEMY_SPAWN_INTERVAL_MIN = 0.3;
export const DIFFICULTY_RAMP_RATE = 0.02;

export const PREFAB_ENEMY_A = 'assets/prefabs/EnemyA.esprefab';
export const PREFAB_ENEMY_B = 'assets/prefabs/EnemyB.esprefab';
export const PREFAB_PLAYER_BULLET = 'assets/prefabs/PlayerBullet.esprefab';
export const PREFAB_ENEMY_BULLET = 'assets/prefabs/EnemyBullet.esprefab';
export const PREFAB_EXPLOSION = 'assets/prefabs/Explosion.esprefab';
export const PREFAB_STAR = 'assets/prefabs/Star.esprefab';

export function positionOverride(x: number, y: number): PrefabOverride {
    return {
        prefabEntityId: 0,
        type: 'property',
        componentType: 'Transform',
        propertyName: 'position',
        value: { x, y, z: 0 },
    };
}

export function propOverride(componentType: string, propertyName: string, value: unknown): PrefabOverride {
    return {
        prefabEntityId: 0,
        type: 'property',
        componentType,
        propertyName,
        value,
    };
}

export interface GameStateData {
    score: number;
    gameOver: boolean;
    spawnTimer: number;
    difficulty: number;
    shootCooldown: number;
}

export const GameState = defineResource<GameStateData>({
    score: 0,
    gameOver: false,
    spawnTimer: 0,
    difficulty: 1,
    shootCooldown: 0,
}, 'GameState');
