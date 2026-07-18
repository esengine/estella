// Builds the Save / Load / Clear / Save-as-v1 buttons into the scene-authored
// rows and wires them to the SaveManager. Also applies the raw-Storage color
// preference at startup.
import {
    defineSystem, Res, GetWorld,
    UIEvents, Transform, Sprite,
    createButton, themeColors, px,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, SpriteData,
} from 'esengine';

import { game } from '../state';
import {
    SAVE_VERSION, SLOT, saves, peekEnvelope, writeLegacyV1Save,
    loadAltColorPref, saveAltColorPref,
} from '../save';
import type { SaveData } from '../save';

const PLAYER_BLUE: Color = { r: 0.28, g: 0.54, b: 0.92, a: 1 };
const PLAYER_ORANGE: Color = { r: 0.95, g: 0.56, b: 0.2, a: 1 };
const BTN_H = 32;

export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (game.built) return;

        const saveRow = world.findEntityByName('SaveRow');
        const prefRow = world.findEntityByName('PrefRow');
        if (saveRow === null || prefRow === null) return;
        game.built = true;

        game.altColor = loadAltColorPref();
        applyPlayerColor(world);

        const c = themeColors();

        button(world, events, saveRow, c, true, 'Save', 96, () => doSave(world));
        button(world, events, saveRow, c, false, 'Load', 96, () => doLoad(world));
        button(world, events, saveRow, c, false, 'Clear', 96, () => {
            saves.remove(SLOT);
            game.status = 'Save cleared.';
        });
        button(world, events, saveRow, c, false, 'Save as v1', 118, () => doLegacySave(world));

        button(world, events, prefRow, c, false, 'Toggle', 96, () => {
            game.altColor = !game.altColor;
            saveAltColorPref(game.altColor);
            applyPlayerColor(world);
            game.status = `Color preference stored: ${game.altColor ? 'orange' : 'blue'}.`;
        });
    },
    { name: 'BuildSystem' },
);

function doSave(world: World): void {
    const pos = playerPosition(world);
    if (pos === null) return;
    const data: SaveData = {
        score: game.score,
        player: pos,
        collected: [...game.collected],
    };
    saves.save(SLOT, data);
    const at = saves.savedAt(SLOT);
    game.status = `Saved v${SAVE_VERSION} at ${new Date(at ?? Date.now()).toLocaleTimeString()}.`;
}

function doLoad(world: World): void {
    const envelope = peekEnvelope();
    const data = saves.load<SaveData>(SLOT);
    if (data === null || envelope === undefined) {
        game.status = 'No save found.';
        return;
    }

    game.score = data.score;
    game.collected = new Set(data.collected);
    setPlayerPosition(world, data.player);

    game.status = envelope.version < SAVE_VERSION
        ? `Loaded v${envelope.version} save — migrated to v${SAVE_VERSION}.`
        : `Loaded v${envelope.version} save.`;
}

function doLegacySave(world: World): void {
    const pos = playerPosition(world);
    if (pos === null) return;
    writeLegacyV1Save({ points: game.score, playerX: pos.x, playerY: pos.y });
    game.status = 'Wrote a legacy v1 save — press Load to migrate it.';
}

function playerPosition(world: World): { x: number; y: number } | null {
    const player = world.findEntityByName('Player');
    if (player === null || !world.has(player, Transform)) return null;
    const t = world.get(player, Transform);
    return { x: t.position.x, y: t.position.y };
}

function setPlayerPosition(world: World, pos: { x: number; y: number }): void {
    const player = world.findEntityByName('Player');
    if (player === null || !world.has(player, Transform)) return;
    const t = world.get(player, Transform);
    t.position.x = pos.x;
    t.position.y = pos.y;
    world.insert(player, Transform, t);
}

function applyPlayerColor(world: World): void {
    const player = world.findEntityByName('Player');
    if (player === null || !world.has(player, Sprite)) return;
    const s = world.get(player, Sprite) as SpriteData;
    s.color = { ...(game.altColor ? PLAYER_ORANGE : PLAYER_BLUE) };
    world.insert(player, Sprite, s);
}

function button(
    world: World, events: UIEventQueue, parent: Entity, c: ThemeColors,
    primary: boolean, label: string, width: number, onClick: () => void,
): void {
    const states = primary
        ? { normal: { color: c.primary }, hover: { color: c.primaryHover }, pressed: { color: c.primaryActive } }
        : { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
    createButton({
        world, events, parent,
        node: { width: px(width), height: px(BTN_H) },
        states,
        text: { content: label, color: c.onPrimary, fontSize: 14 },
        onClick,
    });
}
