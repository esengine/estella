import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Transform, Camera, FollowTarget, TilemapLayer, RuntimeOnly,
    Nav, navGridFromTilemapLayer, SceneManager, transitionTo,
} from 'esengine';
import { Player, Gate, NavGridBuilt } from '../components';

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

/** Walking into a gate hands the game to the next area. */
export const gateSystem = defineSystem(
    [Query(Transform, Gate), Query(Transform, Player), Res(SceneManager)],
    (gates, players, scenes) => {
        if (scenes.isTransitioning()) return;
        for (const [, gateTransform, gate] of gates) {
            if (!gate.toScene) continue;
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
