import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Transform, Camera, FollowTarget, TilemapLayer, RuntimeOnly, Text, Sprite, Prefabs,
    Nav, navGridFromTilemapLayer, SceneManager, transitionTo,
} from 'esengine';
import type { NavGrid } from 'esengine';
import { Area, AreaLabel, Player, Gate, NavGridBuilt, Spawner, Spawned } from '../components';
import { session } from '../state';

/**
 * Points the camera at whoever is playing. The camera is authored per area and
 * the player is spawned by the same scene, so the entity id is not knowable
 * until the scene is live — and it changes again on every area switch.
 */
export const cameraBindSystem = defineSystem(
    [Query(Mut(FollowTarget), Camera), Query(Transform, Player), GetWorld()],
    (cameras, players, world) => {
        for (const [, follow] of cameras) {
            if (follow.target >= 0 && world.has(follow.target as never, Player)) continue;
            for (const [player] of players) {
                follow.target = player;
                break;
            }
        }
    },
    { name: 'CameraBindSystem' },
);

/**
 * Derives navigation from the painted terrain, once per tilemap. The solid tile
 * ids are the tileset's own — the same ones the layer turns into colliders —
 * so what blocks a wisp and what blocks the player cannot drift apart.
 */
export const navFromTerrainSystem = defineSystem(
    [Query(Transform, TilemapLayer).without(NavGridBuilt), Res(Nav), Commands()],
    (layers, nav, commands) => {
        for (const [entity, transform, layer] of layers) {
            const cell = layer.cellSize.x;
            if (!cell) continue;
            const width = Math.round((-transform.position.x * 2) / cell);
            const height = Math.round((transform.position.y * 2) / cell);
            if (width <= 0 || height <= 0) continue;
            nav.setGrid(navGridFromTilemapLayer(entity, {
                width,
                height,
                cellSize: cell,
                // A nav grid counts up from its bottom-left cell centre, while the
                // Transform names the tilemap's top-left corner.
                origin: {
                    x: transform.position.x + cell / 2,
                    y: transform.position.y - height * cell + cell / 2,
                },
                blockedTileIds: SOLID_TILES,
            }));
            commands.entity(entity).insert(NavGridBuilt, {}).insert(RuntimeOnly, {});
        }
    },
    { name: 'NavFromTerrainSystem' },
);

/** Tiles that stop movement — mirrors `collision` in assets/tilesets/heights.estileset. */
const SOLID_TILES = [4, 5, 6];

/** The scene that holds the HUD, the pause panel and the pack. */
const HUD_SCENE = 'hud';

let hudArriving = false;

/**
 * Brings the HUD up beside whichever area is playing. An area switch retires
 * only the scene it replaces, so a HUD loaded additively is authored once and
 * survives every gate — rather than being copied into each area's scene, where
 * the copies drift apart the moment one of them is edited.
 */
export const hudSystem = defineSystem(
    [Res(SceneManager)],
    (scenes) => {
        if (hudArriving || scenes.isLoaded(HUD_SCENE)) return;
        hudArriving = true;
        void scenes.loadAdditive(HUD_SCENE).finally(() => { hudArriving = false; });
    },
    { name: 'HudSystem' },
);

/** Tells the shared HUD which area it is reporting on. */
export const areaLabelSystem = defineSystem(
    [Query(Mut(Text), AreaLabel), Query(Area)],
    (labels, areas) => {
        for (const [, area] of areas) {
            for (const [, text] of labels) {
                if (text.i18nKey !== area.nameKey) text.i18nKey = area.nameKey;
            }
            return;
        }
    },
    { name: 'AreaLabelSystem' },
);

/** Whether the pack holds what a gate asks for. */
export function gateIsOpen(gate: { requires: string; requiresCount: number }): boolean {
    if (!gate.requires || gate.requiresCount <= 0) return true;
    return (session.inventory[gate.requires] ?? 0) >= gate.requiresCount;
}

/** Walking into an open gate hands the game to the next area. */
export const gateSystem = defineSystem(
    [Query(Transform, Gate), Query(Transform, Player), Res(SceneManager)],
    (gates, players, scenes) => {
        if (scenes.isTransitioning()) return;
        for (const [, gateTransform, gate] of gates) {
            if (!gate.toScene || !gateIsOpen(gate)) continue;
            for (const [, playerTransform] of players) {
                const dx = playerTransform.position.x - gateTransform.position.x;
                const dy = playerTransform.position.y - gateTransform.position.y;
                if (Math.hypot(dx, dy) > gate.radius) continue;
                void transitionTo(scenes, gate.toScene, { type: 'fade', duration: 0.35 });
                return;
            }
        }
    },
    { name: 'GateSystem' },
);

/** A shut gate reads as shut, so nobody walks into it twice wondering why. */
export const gateLookSystem = defineSystem(
    [Query(Mut(Sprite), Gate)],
    (gates) => {
        for (const [, sprite, gate] of gates) {
            const open = gateIsOpen(gate);
            sprite.color.r = open ? 0.545 : 0.404;
            sprite.color.g = open ? 0.902 : 0.376;
            sprite.color.b = open ? 0.918 : 0.463;
        }
    },
    { name: 'GateLookSystem' },
);

/**
 * Places an area's enemies from its spawner markers, once each. They are
 * instances of the same wisp prefab Vesper calls, so an area's population and a
 * boss's reinforcements cannot describe different creatures.
 */
export const spawnerSystem = defineSystem(
    [Query(Transform, Spawner).without(Spawned), Res(Prefabs), Res(Nav), Commands()],
    (spawners, prefabs, nav, commands) => {
        // Nothing may be placed before the terrain has said where the ground is:
        // the grid is derived from the tilemap by a system that runs just ahead
        // of this one, but not on the frame the area arrives.
        if (!nav.hasGrid()) return;
        const grid = nav.grid;
        for (const [entity, transform, spawner] of spawners) {
            commands.entity(entity).insert(Spawned, {}).insert(RuntimeOnly, {});
            if (!spawner.prefab) continue;
            for (let i = 0; i < spawner.count; i++) {
                // A ring, foreshortened like everything else on this plane, so a
                // marker reads as a group holding a place rather than a stack.
                const angle = (Math.PI * 2 * i) / spawner.count + entity * 0.37;
                const at = standable(grid, {
                    x: transform.position.x + Math.cos(angle) * spawner.radius,
                    y: transform.position.y + Math.sin(angle) * spawner.radius * 0.6,
                });
                void prefabs.instantiate(spawner.prefab, {
                    overrides: [{
                        type: 'property',
                        componentType: 'Transform',
                        propertyName: 'position',
                        value: { x: at.x, y: at.y, z: 0 },
                    }],
                });
            }
        }
    },
    { name: 'SpawnerSystem' },
);

/**
 * The nearest place on the ring that is actually ground. A body dropped inside
 * a pillar is not merely stuck: line of sight is a raycast, so it never sees
 * the player, never chases and never swings — an enemy that is scenery.
 */
function standable(grid: NavGrid | null, at: { x: number; y: number }): { x: number; y: number } {
    if (!grid) return at;
    const cell = grid.worldToCell(at);
    if (grid.isWalkable(cell.x, cell.y)) return at;
    const near = grid.nearestWalkable(cell.x, cell.y, 6);
    return near ? grid.cellToWorld(near.x, near.y) : at;
}
