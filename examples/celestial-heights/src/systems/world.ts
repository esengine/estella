import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Transform, Camera, FollowTarget, TilemapLayer, RuntimeOnly, Text,
    Nav, navGridFromTilemapLayer, SceneManager, transitionTo,
} from 'esengine';
import { Area, AreaLabel, Player, Gate, NavGridBuilt } from '../components';

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
