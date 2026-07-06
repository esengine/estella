import {
    defineSystem, Query, Mut, Res, GetWorld,
    UIEvents, UICameraInfo, UINode, UIVisual, Text, Name, Draggable, Focusable, px,
} from 'esengine';
import type {
    World, UIEventQueue, UICameraData, Dimension, UIVisualData, TextData, NameData, FocusableData, Entity, Color,
} from 'esengine';

// UINodeData isn't on the public surface; we only read/write these box fields.
interface CardNode {
    position: number;
    insetLeft: Dimension;
    insetTop: Dimension;
    marginLeft: Dimension;
    marginTop: Dimension;
}

// Cards rest in a row; drag one into the drop zone to file it, or back onto the
// row to snap into the nearest slot (swapping the occupant). Focused cards brighten.
// The engine owns dragging (Draggable) + focus; this system owns the resting layout
// and drop/snap, working in the canvas's y-down pixel-inset space (the DragPlugin's).
// The canvas layout box is DYNAMIC (scaleMode Expand grows it with the viewport), so
// every placement derives from the live UICameraInfo box, never the design size.
const CARD_COUNT = 6;
const CARD_W = 100;
const CARD_H = 80;

const SLOT_SPACING = 116;
const ROW_W = (CARD_COUNT - 1) * SLOT_SPACING + CARD_W;
const CARD_ROW_TOP = 168;
const FOCUS_BRIGHTNESS = 0.3;

// Mirrors the DropZone entity (insetTop 100% + marginTop -160, height 120).
const DZ_H = 120;
const DZ_BOTTOM_GAP = 160;
const DROP_SPACING = 112;

interface CardInfo {
    entity: Entity;
    base: Color;
    num: number;
    slot: number;
}

const cards: CardInfo[] = [];
let initialized = false;
const dropped = new Set<Entity>();

// Live layout-box size (UINode px == box units), updated each frame.
let boxW = 0;
let boxH = 0;

function slotLeft(index: number): number {
    return (boxW - ROW_W) / 2 + index * SLOT_SPACING;
}

function dzTop(): number {
    return boxH - DZ_BOTTOM_GAP;
}

function dropLeft(dropIndex: number, total: number): number {
    const centersW = (total - 1) * DROP_SPACING;
    return boxW / 2 - centersW / 2 - CARD_W / 2 + dropIndex * DROP_SPACING;
}

function place(world: World, entity: Entity, left: number, top: number): void {
    if (!world.has(entity, UINode)) return;
    const node = world.get(entity, UINode) as unknown as CardNode;
    node.position = 1; // Absolute
    // Clear the scene's percent-centring margins so our px insets are the
    // absolute top-left (the same space DragPlugin nudges while held).
    node.marginLeft = px(0);
    node.marginTop = px(0);
    node.insetLeft = px(left);
    node.insetTop = px(top);
    world.insert(entity, UINode, node);
}

function tint(world: World, entity: Entity, base: Color, focused: boolean): void {
    if (!world.has(entity, UIVisual)) return;
    const k = focused ? FOCUS_BRIGHTNESS : 0;
    const v = world.get(entity, UIVisual) as UIVisualData;
    v.color = { r: Math.min(1, base.r + k), g: Math.min(1, base.g + k), b: Math.min(1, base.b + k), a: base.a };
    world.insert(entity, UIVisual, v);
}

export const dragFocusSystem = defineSystem(
    [
        Query(Focusable, Draggable, Name),
        Query(Mut(Text), Name),
        Res(UIEvents),
        Res(UICameraInfo),
        GetWorld(),
    ],
    (cardQuery, textQuery, events: UIEventQueue, camera: UICameraData, world: World) => {
        if (!camera.valid) return;
        const w = camera.worldRight - camera.worldLeft;
        const h = camera.worldTop - camera.worldBottom;
        const resized = w !== boxW || h !== boxH;
        boxW = w;
        boxH = h;
        if (boxW <= 0 || boxH <= 0) return;

        if (!initialized) {
            cards.length = 0;
            dropped.clear();
            for (const [entity, , , name] of cardQuery) {
                const n = (name as NameData).value;
                if (!n.startsWith('Card') || n.includes('Label')) continue;
                const num = parseInt(n.replace('Card', ''), 10);
                if (isNaN(num) || num < 1 || num > CARD_COUNT) continue;
                if (!world.has(entity, UIVisual)) continue;
                const color = (world.get(entity, UIVisual) as UIVisualData).color;
                cards.push({ entity, base: { ...color }, num, slot: num - 1 });
            }
            if (cards.length !== CARD_COUNT) { cards.length = 0; return; }
            cards.sort((a, b) => a.num - b.num);
            for (const card of cards) place(world, card.entity, slotLeft(card.slot), CARD_ROW_TOP);
            initialized = true;
            return;
        }

        const dragStart = new Set(events.query('drag_start').map((e) => e.target));
        const dragEnd = new Set(events.query('drag_end').map((e) => e.target));
        for (const e of dragStart) dropped.delete(e);

        // Focus brightening (every card, every frame).
        for (const [entity, focusable] of cardQuery) {
            const card = cards.find((c) => c.entity === entity);
            if (!card) continue;
            tint(world, entity, card.base, (focusable as FocusableData).isFocused);
        }

        // Resolve each just-dropped card to a slot or into the drop zone.
        let layoutDirty = dragStart.size > 0 || resized;
        for (const card of cards) {
            if (!dragEnd.has(card.entity) || !world.has(card.entity, UINode)) continue;
            const node = world.get(card.entity, UINode) as unknown as CardNode;
            const left = node.insetLeft.value;
            const centerY = node.insetTop.value + CARD_H / 2;

            if (centerY >= dzTop() && centerY <= dzTop() + DZ_H) {
                dropped.add(card.entity);
                layoutDirty = true;
                continue;
            }
            if (dropped.delete(card.entity)) layoutDirty = true;

            let target = card.slot;
            let best = Infinity;
            for (let i = 0; i < CARD_COUNT; i++) {
                const d = Math.abs(left - slotLeft(i));
                if (d < best) { best = d; target = i; }
            }
            const occupant = cards.find((c) => c !== card && c.slot === target && !dropped.has(c.entity));
            if (occupant) occupant.slot = card.slot;
            card.slot = target;
            layoutDirty = true;
        }

        if (!layoutDirty) return;

        const droppedList = cards.filter((c) => dropped.has(c.entity));
        for (const card of cards) {
            if (dragStart.has(card.entity)) continue; // don't fight an active drag
            if (dropped.has(card.entity)) {
                place(world, card.entity, dropLeft(droppedList.indexOf(card), droppedList.length), dzTop() + (DZ_H - CARD_H) / 2);
            } else {
                place(world, card.entity, slotLeft(card.slot), CARD_ROW_TOP);
            }
        }

        for (const [, text, name] of textQuery) {
            if ((name as NameData).value !== 'DropZoneLabel') continue;
            const t = text as TextData;
            if (droppedList.length === 0) {
                t.content = 'Drop cards here';
                t.color = { r: 0.5, g: 0.5, b: 0.52, a: 1 };
            } else {
                t.content = 'Holding: ' + droppedList.map((c) => 'Card ' + c.num).join(', ');
                t.color = { r: 0.25, g: 0.56, b: 0.96, a: 1 };
            }
        }
    },
    { name: 'DragFocusSystem' },
);
