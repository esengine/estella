// The input map: gameplay code queries named actions ("Move", "Fire") instead
// of physical keys, so keyboard, gamepad and rebound inputs all flow through
// one place. defineInputMap registers the per-frame evaluation system itself.
import {
    defineInputMap, Axis2D, Button, Keys2D, Stick, Key, GpButton, GamepadButton,
} from 'esengine';
import type { Binding } from 'esengine';

export const DEFAULT_FIRE: Binding[] = [Key('Space'), GpButton(GamepadButton.South)];

export const Actions = defineInputMap({
    Move: Axis2D(
        Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'),
        Keys2D('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'),
        Stick('left'),
    ),
    Fire: Button(...DEFAULT_FIRE),
});

/** Storage key for user rebinds (Actions.save / Actions.load). */
export const BINDINGS_KEY = 'input-actions.bindings';

function keyName(code: string): string {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
}

export function formatBinding(b: Binding): string {
    switch (b.kind) {
        case 'key': return keyName(b.code);
        case 'mouse': return `Mouse ${b.button}`;
        case 'gpButton': return `Pad ${GamepadButton[b.button] ?? b.button}`;
        case 'gpAxis': return `Pad axis ${b.axis}`;
        case 'keys1d': return `${keyName(b.neg)}/${keyName(b.pos)}`;
        case 'keys2d': {
            const codes = [b.up, b.down, b.left, b.right];
            if (codes.every((c) => c.startsWith('Arrow'))) return 'Arrows';
            return [b.up, b.left, b.down, b.right].map(keyName).join('');
        }
        case 'stick': return b.stick === 'left' ? 'Left stick' : 'Right stick';
        case 'virtual': return `On-screen ${b.id}`;
    }
}

export function formatBindings(action: string): string {
    return Actions.getBindings(action).map(formatBinding).join(' / ');
}
