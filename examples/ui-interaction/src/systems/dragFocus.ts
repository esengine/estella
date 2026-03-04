import {
    defineSystem, Query, Mut, Res,
    UIEvents, UIRect, Image, Text, Name, Draggable, Focusable,
} from 'esengine';
import type {
    UIEventQueue, UIRectData, ImageData, TextData, NameData,
    FocusableData, Entity,
} from 'esengine';

const CARD_COUNT = 6;
const SLOT_SPACING = 120;
const FIRST_SLOT_X = -350;
const CARD_ROW_Y = -40;
const FOCUS_BRIGHTNESS = 0.3;
const DROP_ZONE_SPACING = 110;
const CANVAS_HEIGHT = 600;
const DROP_ZONE_OFFSET_Y = 40;
const DROP_ZONE_SIZE_Y = 120;
const DROP_ZONE_MIN_Y = -CANVAS_HEIGHT / 2 + DROP_ZONE_OFFSET_Y;
const DROP_ZONE_MAX_Y = DROP_ZONE_MIN_Y + DROP_ZONE_SIZE_Y;
const DROP_ZONE_CENTER_Y = (DROP_ZONE_MIN_Y + DROP_ZONE_MAX_Y) / 2;
const DROP_ZONE_SNAP_Y = DROP_ZONE_CENTER_Y;

interface CardInfo {
    entity: Entity;
    originalColor: { r: number; g: number; b: number; a: number };
    cardNumber: number;
    slotIndex: number;
}

const cards: CardInfo[] = [];
let initialized = false;
const droppedEntities = new Set<Entity>();

function getSlotX(index: number): number {
    return FIRST_SLOT_X + index * SLOT_SPACING;
}

function getDropX(dropIndex: number, totalDropped: number): number {
    const totalWidth = (totalDropped - 1) * DROP_ZONE_SPACING;
    return -totalWidth / 2 + dropIndex * DROP_ZONE_SPACING;
}

export const dragFocusSystem = defineSystem(
    [
        Query(Mut(UIRect), Mut(Image), Focusable, Draggable, Name),
        Query(Mut(Text), Name),
        Res(UIEvents),
    ],
    (cardQuery, textQuery, events: UIEventQueue) => {
        if (!initialized) {
            cards.length = 0;
            droppedEntities.clear();
            for (const [entity, _rect, image, _foc, _drag, name] of cardQuery) {
                const n = (name as NameData).value;
                if (!n.startsWith('Card') || n.includes('Label')) continue;
                const num = parseInt(n.replace('Card', ''), 10);
                if (isNaN(num) || num < 1 || num > CARD_COUNT) continue;
                cards.push({
                    entity,
                    originalColor: { r: image.color.r, g: image.color.g, b: image.color.b, a: image.color.a },
                    cardNumber: num,
                    slotIndex: num - 1,
                });
            }
            if (cards.length === CARD_COUNT) {
                cards.sort((a, b) => a.cardNumber - b.cardNumber);
                initialized = true;
            } else {
                cards.length = 0;
            }
            return;
        }

        const dragStartEntities = new Set(events.query('drag_start').map(e => e.entity));
        const dragEndEntities = new Set(events.query('drag_end').map(e => e.entity));

        for (const e of dragStartEntities) {
            droppedEntities.delete(e);
        }

        const snapQueue: Array<{ card: CardInfo; ox: number; oy: number }> = [];

        for (const [entity, rect, image, focusable] of cardQuery) {
            const card = cards.find(c => c.entity === entity);
            if (!card) continue;

            const base = card.originalColor;
            if ((focusable as FocusableData).isFocused) {
                image.color.r = Math.min(1, base.r + FOCUS_BRIGHTNESS);
                image.color.g = Math.min(1, base.g + FOCUS_BRIGHTNESS);
                image.color.b = Math.min(1, base.b + FOCUS_BRIGHTNESS);
            } else {
                image.color.r = base.r;
                image.color.g = base.g;
                image.color.b = base.b;
            }

            if (dragEndEntities.has(entity)) {
                snapQueue.push({ card, ox: rect.offsetMin.x, oy: rect.offsetMin.y });
            }
        }

        let layoutDirty = dragStartEntities.size > 0;

        for (const { card, ox, oy } of snapQueue) {
            const inDropZone = oy >= DROP_ZONE_MIN_Y && oy <= DROP_ZONE_MAX_Y;

            if (inDropZone) {
                droppedEntities.add(card.entity);
                layoutDirty = true;
                continue;
            }

            if (droppedEntities.delete(card.entity)) {
                layoutDirty = true;
            }

            let targetSlot = card.slotIndex;
            let bestDist = Infinity;
            for (let i = 0; i < CARD_COUNT; i++) {
                const d = Math.abs(ox - getSlotX(i));
                if (d < bestDist) {
                    bestDist = d;
                    targetSlot = i;
                }
            }

            const occupant = cards.find(
                c => c !== card && c.slotIndex === targetSlot && !droppedEntities.has(c.entity)
            );
            if (occupant) {
                occupant.slotIndex = card.slotIndex;
            }
            card.slotIndex = targetSlot;
            layoutDirty = true;
        }

        if (layoutDirty) {
            const droppedList = cards.filter(c => droppedEntities.has(c.entity));
            const droppedCount = droppedList.length;

            for (const [entity, rect] of cardQuery) {
                if (dragStartEntities.has(entity)) continue;
                const card = cards.find(c => c.entity === entity);
                if (!card) continue;

                if (droppedEntities.has(entity)) {
                    const dropIdx = droppedList.indexOf(card);
                    rect.offsetMin.x = getDropX(dropIdx, droppedCount);
                    rect.offsetMin.y = DROP_ZONE_SNAP_Y;
                } else {
                    rect.offsetMin.x = getSlotX(card.slotIndex);
                    rect.offsetMin.y = CARD_ROW_Y;
                }
            }

            for (const [, text, name] of textQuery) {
                if ((name as NameData).value !== 'DropZoneLabel') continue;
                if (droppedCount === 0) {
                    (text as TextData).content = 'Drop Zone';
                    (text as TextData).color = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
                } else {
                    const labels = droppedList.map(c => `Card ${c.cardNumber}`);
                    (text as TextData).content = `Dropped: ${labels.join(', ')}`;
                    (text as TextData).color = { r: 0.2, g: 1, b: 0.4, a: 1 };
                }
            }
        }
    },
    { name: 'DragFocusSystem' }
);
