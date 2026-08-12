import {
    defineSystem, Res, GetWorld,
    UIEvents, Text,
    createButton, themeColors, px,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, TextData,
} from 'esengine';
import { Actions, BINDINGS_KEY, DEFAULT_FIRE, formatBinding, formatBindings } from '../actions';
import { gestureState } from '../state';

let built = false;
let status = '';
const lastText = new Map<Entity, string>();

function setText(world: World, entity: Entity | null, content: string): void {
    if (entity === null || !world.valid(entity) || !world.has(entity, Text)) return;
    if (lastText.get(entity) === content) return;
    lastText.set(entity, content);
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
}

function controlStates(c: ThemeColors): Record<string, { color: Color }> {
    return { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
}

function startRebind(): void {
    if (Actions.isListening()) {
        Actions.cancelListen();
        return;
    }
    status = 'Press any key, mouse button or gamepad button... (click again to cancel)';
    // Mouse is safe to include here: this runs in Update, and the scan runs next
    // frame's PreUpdate — after Last cleared this frame's press edges, so the click
    // that opened the rebind is not the one captured.
    void Actions.rebind('Fire', { keyboard: true, mouse: true, gamepad: true }).then((binding) => {
        if (binding) {
            Actions.save(BINDINGS_KEY);
            status = `Fire is now ${formatBinding(binding)} (saved)`;
        } else {
            status = 'Rebind cancelled.';
        }
    });
}

function resetBindings(): void {
    Actions.cancelListen();
    Actions.setBindings('Fire', DEFAULT_FIRE);
    Actions.save(BINDINGS_KEY);
    status = 'Fire reset to defaults.';
}

function build(world: World, events: UIEventQueue): boolean {
    const row = world.findEntityByName('RebindRow');
    if (row === null) return false;

    status = Actions.load(BINDINGS_KEY)
        ? 'Loaded saved bindings from Storage.'
        : 'Defaults active. Rebind persists via Storage.';

    const c = themeColors();
    createButton({
        world, events, parent: row,
        node: { width: px(120), height: px(28) },
        states: { normal: { color: c.primary }, hover: { color: c.primaryHover }, pressed: { color: c.primaryActive } },
        text: { content: 'Rebind fire', color: c.onPrimary, fontSize: 13 },
        onClick: startRebind,
    });
    createButton({
        world, events, parent: row,
        node: { width: px(80), height: px(28) },
        states: controlStates(c),
        text: { content: 'Reset', color: c.onPrimary, fontSize: 13 },
        onClick: resetBindings,
    });
    return true;
}

export const hudSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (!built) {
            built = build(world, events);
            if (!built) return;
        }

        const move = Actions.axis2d('Move');
        setText(world, world.findEntityByName('MoveLabel'),
            `Move   ${formatBindings('Move')}   (${move.x.toFixed(2)}, ${move.y.toFixed(2)})`);
        setText(world, world.findEntityByName('FireLabel'),
            `Fire   ${formatBindings('Fire')}${Actions.down('Fire') ? '   [FIRING]' : ''}`);
        setText(world, world.findEntityByName('StatusLabel'), status);
        setText(world, world.findEntityByName('GestureStatus'), gestureState.last);
    },
    { name: 'HudSystem' }
);
