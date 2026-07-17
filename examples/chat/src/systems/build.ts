import {
    defineSystem, Res, GetWorld,
    UIEvents,
    UIVisual, UINode, Text,
    uiPlugin,
    createListView, createButton, createTextInput,
    ArrayDataSource,
    spawnUIEntity,
    themeColors, px,
    UIPositionType, TextVerticalAlign, TextAlign,
} from 'esengine';
import type {
    Entity, World, Color, UIEventQueue, UIVisualData, TextData,
    ListItemTemplate,
} from 'esengine';

import {
    CHAT_W, CHAT_H, ROW_SPACING, LEFT_GUTTER, RIGHT_GUTTER,
    LABEL_PAD, BUBBLE_VPAD, FONT_SIZE, bubbleMetrics,
    COMPOSER_H, SEND_W, INPUT_W,
    ME_BUBBLE, BOT_BUBBLE, BUBBLE_TEXT,
    botReply, SEED,
    type Message, type Sender,
} from '../config';
import { state } from '../state';

// One row pools BOTH a left (them) and a right (you) bubble; bind() enables the
// sender's side, fills its label, and sizes the bubble to the wrapped text so it
// hugs its content (short messages get a snug bubble, long ones grow to the max).
// The width + horizontal pin are set per-bind via layoutBubble — the same
// insetLeft+width idiom ListView.placeByInset uses for the rows themselves.
interface Side { bubble: Entity; label: Entity; }
const rowSides = new Map<Entity, { me: Side; bot: Side }>();

const LIST_BG: Color = { r: 0.11, g: 0.11, b: 0.13, a: 1 };

export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (state.built) return;
        const messagesSlot = world.findEntityByName('MessagesSlot');
        const composerRow = world.findEntityByName('ComposerRow');
        if (messagesSlot === null || composerRow === null) return;
        state.built = true;

        const c = themeColors();

        const messages = new ArrayDataSource<Message>([]);
        state.messages = messages;

        const makeSide = (w: World, row: Entity, mine: boolean): Side => {
            const bubble = spawnUIEntity({
                world: w, parent: row,
                // Fills the row's (measured) height; width + horizontal pin are set
                // per-bind by layoutBubble once the message's wrap is measured.
                node: {
                    position: UIPositionType.Absolute,
                    insetTop: px(0), insetBottom: px(0),
                },
                visual: { color: mine ? ME_BUBBLE : BOT_BUBBLE, enabled: false },
            });
            const label = spawnUIEntity({
                world: w, parent: bubble,
                node: {
                    position: UIPositionType.Absolute,
                    insetLeft: px(LABEL_PAD), insetRight: px(LABEL_PAD),
                    insetTop: px(BUBBLE_VPAD), insetBottom: px(BUBBLE_VPAD),
                },
                // Always left-aligned: chat text reads L→R regardless of side, so a
                // wrapped message stays flush-left instead of drifting right.
                text: {
                    content: '', fontSize: FONT_SIZE, color: BUBBLE_TEXT,
                    align: TextAlign.Left,
                    verticalAlign: TextVerticalAlign.Middle, wordWrap: true,
                },
            });
            return { bubble, label };
        };

        const rowTemplate: ListItemTemplate<Message> = {
            create: (w, parent) => {
                const row = spawnUIEntity({ world: w, parent });
                rowSides.set(row, { me: makeSide(w, row, true), bot: makeSide(w, row, false) });
                return row;
            },
            bind: (row, msg) => {
                const sides = rowSides.get(row);
                if (!sides) return;
                const mine = msg.from === 'me';
                const on = mine ? sides.me : sides.bot;
                const off = mine ? sides.bot : sides.me;
                setVisible(world, on.bubble, true);
                setVisible(world, off.bubble, false);
                layoutBubble(world, on.bubble, mine, bubbleMetrics(msg).width);
                setText(world, on.label, msg.text);
                setText(world, off.label, '');
            },
        };

        state.list = createListView<Message>({
            host: uiPlugin,
            world, parent: messagesSlot,
            viewportSize: { x: CHAT_W, y: CHAT_H },
            background: { color: LIST_BG },
            data: messages,
            // Rows auto-size to each message's wrapped text (measured layout).
            layout: { itemHeight: (i) => bubbleMetrics(messages.getItem(i)).height, spacing: ROW_SPACING },
            item: rowTemplate,
        });

        // Composer: a fixed-width TextInput + a primary Send button, side by side.
        state.input = createTextInput({
            world, events, parent: composerRow,
            node: { width: px(INPUT_W), height: px(COMPOSER_H) },
            placeholder: 'Type a message and press Enter…',
            fontSize: 14,
            onSubmit: send,
        });

        createButton({
            world, events, parent: composerRow,
            node: { width: px(SEND_W), height: px(COMPOSER_H) },
            states: {
                normal: { color: c.primary },
                hover: { color: c.primary },
                pressed: { color: c.primary },
            },
            text: { content: 'Send', color: c.onPrimary, fontSize: 14 },
            onClick: send,
        });

        for (const m of SEED) append(m.from, m.text);
    },
    { name: 'BuildSystem' },
);

/** Append a message and keep the newest in view. */
function append(from: Sender, text: string): void {
    const messages = state.messages;
    if (!messages) return;
    messages.append([{ id: state.nextId++, from, text }]);
    state.list?.scrollToIndex(messages.getCount() - 1);
}

/** Send the composed text, then let the canned bot answer. */
function send(): void {
    const input = state.input;
    if (!input || !state.messages) return;
    const text = input.getValue().trim();
    if (!text) return;
    append('me', text);
    input.setValue('');
    append('bot', botReply(text, state.botTurn++));
}

/**
 * Size a bubble to `contentW` and pin it to its side of the row: yours hugs the
 * right edge (clearing the scrollbar gutter), theirs the left. Uses insetLeft +
 * width so a narrow bubble stays anchored to its side rather than centered.
 */
function layoutBubble(world: World, bubble: Entity, mine: boolean, contentW: number): void {
    if (!world.valid(bubble) || !world.has(bubble, UINode)) return;
    const n = world.get(bubble, UINode);
    const left = mine ? CHAT_W - contentW - RIGHT_GUTTER : LEFT_GUTTER;
    n.insetLeft = px(left);
    n.width = px(contentW);
    world.insert(bubble, UINode, n);
}

function setVisible(world: World, entity: Entity, on: boolean): void {
    if (!world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    if (v.enabled === on) return;
    v.enabled = on;
    world.insert(entity, UIVisual, v);
}

function setText(world: World, entity: Entity, content: string): void {
    if (!world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    if (t.content === content) return;
    t.content = content;
    world.insert(entity, Text, t);
}
