import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Transform, UINode, UIDisplay, Text, Localization,
    ArrayDataSource, createListView, spawnUIEntity, px, uiPlugin,
    UIPositionType, TextAlign, TextVerticalAlign,
} from 'esengine';
import type { Entity, World, TextData, UIVisualData } from 'esengine';
import { UIVisual } from 'esengine';
import { Item, Player } from '../components';
import { Actions } from '../actions';
import { ITEM_COLOR, PICKUP_RADIUS } from '../config';
import { session } from '../state';

interface Slot {
    kind: string;
    count: number;
}

const TILE = 96;
const COLUMNS = 4;

/** Walking over a pickup takes it. */
export const pickupSystem = defineSystem(
    [Query(Transform, Item), Query(Transform, Player), Commands()],
    (items, players, commands) => {
        for (const [, playerTransform] of players) {
            for (const [entity, transform, item] of items) {
                const dx = transform.position.x - playerTransform.position.x;
                const dy = transform.position.y - playerTransform.position.y;
                if (Math.hypot(dx, dy) > PICKUP_RADIUS) continue;
                session.inventory[item.kind] = (session.inventory[item.kind] ?? 0) + 1;
                commands.despawn(entity);
            }
            return;
        }
    },
    { name: 'PickupSystem' },
);

export const inventoryInputSystem = defineSystem(
    [],
    () => {
        if (Actions.pressed('Pack')) session.inventoryOpen = !session.inventoryOpen;
    },
    { name: 'InventoryInputSystem' },
);

// The pack's grid is built into an authored anchor, and an area switch replaces
// that anchor along with the rest of its scene — so the guard is whether the
// anchor this was built into is still alive, not whether it was ever built.
let built: { anchor: Entity; data: ArrayDataSource<Slot>; shown: Slot[] } | null = null;
const tileLabel = new Map<Entity, Entity>();

function slots(): Slot[] {
    return Object.entries(session.inventory)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({ kind, count }));
}

export const inventoryBuildSystem = defineSystem(
    [GetWorld(), Res(Localization)],
    (world: World, i18n) => {
        if (built && world.valid(built.anchor)) return;
        const anchor = world.findEntityByName('PackGrid');
        if (anchor === null) return;

        const data = new ArrayDataSource<Slot>(slots());
        createListView<Slot>({
            world,
            host: uiPlugin,
            parent: anchor,
            viewportSize: { x: COLUMNS * TILE + (COLUMNS - 1) * 8, y: 2 * TILE + 8 },
            data,
            layout: { columns: COLUMNS, itemSize: { x: TILE, y: TILE }, spacing: { x: 8, y: 8 } },
            item: {
                create: (w, parent) => {
                    const tile = spawnUIEntity({
                        world: w, parent, visual: { color: { r: 1, g: 1, b: 1, a: 1 } },
                    });
                    const label = spawnUIEntity({
                        world: w, parent: tile,
                        node: {
                            position: UIPositionType.Absolute,
                            insetLeft: px(0), insetRight: px(0), insetBottom: px(6), height: px(28),
                        },
                        text: {
                            content: '', fontSize: 24, bold: true,
                            color: { r: 0.08, g: 0.07, b: 0.13, a: 1 },
                            align: TextAlign.Center, verticalAlign: TextVerticalAlign.Middle,
                        },
                    });
                    tileLabel.set(tile, label);
                    return tile;
                },
                bind: (entity, slot) => {
                    const visual = world.get(entity, UIVisual) as UIVisualData;
                    visual.color = ITEM_COLOR[slot.kind] ?? { r: 0.6, g: 0.6, b: 0.6, a: 1 };
                    world.insert(entity, UIVisual, visual);
                    const label = tileLabel.get(entity);
                    if (label === undefined) return;
                    const text = world.get(label, Text) as TextData;
                    text.content = `${i18n.t(`item.${slot.kind}`)} ${slot.count}`;
                    world.insert(label, Text, text);
                },
            },
        });
        built = { anchor, data, shown: slots() };
    },
    { name: 'InventoryBuildSystem' },
);

/** Pushes what Lyra carries into the grid, and shows or hides the pack. */
export const inventorySyncSystem = defineSystem(
    [Query(Mut(UINode)), GetWorld()],
    (nodes, world) => {
        if (!built) return;
        const next = slots();
        const shown = built.shown;
        const changed = next.length !== shown.length
            || next.some((s, i) => s.kind !== shown[i].kind || s.count !== shown[i].count);
        if (changed) {
            built.data.setItems(next);
            built.shown = next;
        }

        const panel = world.findEntityByName('PackPanel');
        if (panel === null) return;
        const display = session.inventoryOpen ? UIDisplay.Flex : UIDisplay.None;
        for (const [entity, node] of nodes) {
            if (entity !== panel) continue;
            if (node.display !== display) node.display = display;
            return;
        }
    },
    { name: 'InventorySyncSystem' },
);
