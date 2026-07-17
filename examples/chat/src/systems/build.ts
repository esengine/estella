import {
    defineSystem, Res, GetWorld,
    UIEvents,
    UIVisual, Text,
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
    CHAT_W, CHAT_H, ROW_SPACING, BUBBLE_W, RIGHT_GUTTER,
    LABEL_PAD, BUBBLE_VPAD, bubbleHeight,
    COMPOSER_H, SEND_W, INPUT_W,
    ME_BUBBLE, BOT_BUBBLE, BUBBLE_TEXT,
    botReply, SEED,
    type Message, type Sender,
} from '../config';
import { state } from '../state';

// One row pools BOTH a left (them) and a right (you) bubble, pinned at create
// time; bind() just enables the sender's side and fills its label. Only UIVisual
// + Text are mutated per bind — never layout — so recycling stays cheap.
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
                // Fills the row's (measured) height; width fixed, pinned to a side.
                node: {
                    position: UIPositionType.Absolute,
                    insetLeft: px(mine ? CHAT_W - BUBBLE_W - RIGHT_GUTTER : 12),
                    insetTop: px(0),
                    insetBottom: px(0),
                    width: px(BUBBLE_W),
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
                text: {
                    content: '', fontSize: 14, color: BUBBLE_TEXT,
                    align: mine ? TextAlign.Right : TextAlign.Left,
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
                const on = msg.from === 'me' ? sides.me : sides.bot;
                const off = msg.from === 'me' ? sides.bot : sides.me;
                setVisible(world, on.bubble, true);
                setVisible(world, off.bubble, false);
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
            layout: { itemHeight: (i) => bubbleHeight(messages.getItem(i)), spacing: ROW_SPACING },
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
