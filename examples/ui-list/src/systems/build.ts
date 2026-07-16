import {
    defineSystem, Res, GetWorld,
    UIEvents,
    Text, UIVisual,
    uiPlugin,
    createListView, createButton,
    ArrayDataSource,
    spawnUIEntity,
    themeColors, px,
    UIPositionType, TextVerticalAlign,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, TextData, UIVisualData,
    ListItemTemplate,
} from 'esengine';

import {
    LIST_W, LIST_H, GRID_W, GRID_H,
    ROW_H, ROW_SPACING, CONTACTS,
    GRID_COLUMNS, TILE, TILE_SPACING, TILES,
    CONTROL_H,
    makeContact, hueColor,
    type Contact,
} from '../config';
import { state } from '../state';

// Recycled item entities → their bind targets. Populated once per pooled
// entity in create(); bind() only mutates components, so it stays idempotent.
const rowParts = new Map<Entity, { stripe: Entity; label: Entity }>();
const tileParts = new Map<Entity, { label: Entity }>();

const ZEBRA_EVEN: Color = { r: 0.20, g: 0.20, b: 0.23, a: 1 };
const ZEBRA_ODD: Color = { r: 0.23, g: 0.23, b: 0.27, a: 1 };

export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (state.list) return;

        const listSlot = world.findEntityByName('ListSlot');
        const gridSlot = world.findEntityByName('GridSlot');
        const buttonsRow = world.findEntityByName('ButtonsRow');
        if (listSlot === null || gridSlot === null || buttonsRow === null) return;

        state.statsLabel = world.findEntityByName('StatsLabel');
        const c = themeColors();

        // ── Contacts: a 500-row vertical list over ~10 recycled entities ──
        const contacts = new ArrayDataSource<Contact>(
            Array.from({ length: CONTACTS }, (_, i) => makeContact(i)),
        );
        state.nextId = CONTACTS;
        state.contacts = contacts;

        const rowTemplate: ListItemTemplate<Contact> = {
            create: (w, parent) => {
                const row = spawnUIEntity({ world: w, parent, visual: { color: ZEBRA_EVEN } });
                const stripe = spawnUIEntity({
                    world: w, parent: row,
                    node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0), insetBottom: px(0), width: px(4) },
                    visual: { color: c.primary },
                });
                const label = spawnUIEntity({
                    world: w, parent: row,
                    node: { position: UIPositionType.Absolute, insetLeft: px(14), insetRight: px(8), insetTop: px(0), insetBottom: px(0) },
                    text: { content: '', fontSize: 13, color: c.onPrimary, align: 0, verticalAlign: TextVerticalAlign.Middle },
                });
                rowParts.set(row, { stripe, label });
                return row;
            },
            bind: (row, contact, index) => {
                const parts = rowParts.get(row);
                if (!parts) return;
                setColor(world, row, index % 2 === 0 ? ZEBRA_EVEN : ZEBRA_ODD);
                setColor(world, parts.stripe, hueColor(contact.id));
                setText(world, parts.label, `#${String(contact.id).padStart(3, '0')}  ${contact.name}`);
            },
        };

        state.list = createListView<Contact>({
            host: uiPlugin,
            world, parent: listSlot,
            viewportSize: { x: LIST_W, y: LIST_H },
            background: { color: { r: 0.11, g: 0.11, b: 0.13, a: 1 } },
            data: contacts,
            layout: { itemHeight: ROW_H, spacing: ROW_SPACING },
            item: rowTemplate,
        });

        // ── Tiles: a 120-item, 4-column grid over one screen of entities ──
        const tileTemplate: ListItemTemplate<number> = {
            create: (w, parent) => {
                const tile = spawnUIEntity({ world: w, parent, visual: { color: ZEBRA_EVEN } });
                const label = spawnUIEntity({
                    world: w, parent: tile,
                    node: { fill: true },
                    text: { content: '', fontSize: 14, bold: true, color: { r: 1, g: 1, b: 1, a: 0.9 } },
                });
                tileParts.set(tile, { label });
                return tile;
            },
            bind: (tile, value) => {
                const parts = tileParts.get(tile);
                if (!parts) return;
                setColor(world, tile, hueColor(value, 0.36));
                setText(world, parts.label, String(value));
            },
        };

        state.grid = createListView<number>({
            host: uiPlugin,
            world, parent: gridSlot,
            viewportSize: { x: GRID_W, y: GRID_H },
            background: { color: { r: 0.11, g: 0.11, b: 0.13, a: 1 } },
            data: Array.from({ length: TILES }, (_, i) => i),
            layout: { columns: GRID_COLUMNS, itemSize: { x: TILE, y: TILE }, spacing: { x: TILE_SPACING, y: TILE_SPACING } },
            item: tileTemplate,
        });

        // ── Controls: live data mutation + programmatic scrolling ──
        const button = (label: string, width: number, onClick: () => void) =>
            createButton({
                world, events, parent: buttonsRow,
                node: { width: px(width), height: px(CONTROL_H) },
                states: controlStates(c),
                text: { content: label, color: c.onPrimary, fontSize: 13 },
                onClick,
            });

        button('+ Append row', 110, () => {
            contacts.append([makeContact(state.nextId++)]);
            state.list?.scrollToIndex(contacts.getCount() - 1);
        });
        button('− Remove first', 110, () => {
            if (contacts.getCount() > 0) contacts.remove(0);
        });
        button('Top', 70, () => state.list?.scrollToIndex(0));
        button('End', 70, () => state.list?.scrollToIndex(contacts.getCount() - 1));
    },
    { name: 'BuildSystem' },
);

function controlStates(c: ThemeColors): Record<string, { color: Color }> {
    return { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
}

function setText(world: World, entity: Entity, content: string): void {
    if (!world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    if (t.content === content) return;
    t.content = content;
    world.insert(entity, Text, t);
}

function setColor(world: World, entity: Entity, color: Color): void {
    if (!world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    v.color = { ...color };
    world.insert(entity, UIVisual, v);
}
