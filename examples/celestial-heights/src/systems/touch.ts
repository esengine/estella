import {
    defineSystem, Query, Mut, Res, Input, Transform, UINode, UIDisplay,
    DragState, UIInteraction,
} from 'esengine';
import { TouchButton, TouchKnob, TouchLayer, TouchStick } from '../components';
import { session } from '../state';

/** How far the knob travels from the base's centre, in design pixels. */
const STICK_TRAVEL = 90;

/**
 * Reveals the controls once the game has been touched, and never hides them
 * again. Asking "is this a touch device" is a question about hardware; whether
 * someone is playing with a thumb is a question about what they just did.
 */
export const touchLayerSystem = defineSystem(
    [Query(Mut(UINode), TouchLayer), Res(Input)],
    (layers, input) => {
        // Asked of the device, not of what has happened: controls that appear
        // after the first touch make the first touch land on nothing.
        if (input.touchAvailable || input.touches.size > 0) session.touched = true;
        const display = session.touched ? UIDisplay.Flex : UIDisplay.None;
        for (const [, node] of layers) {
            if (node.display !== display) node.display = display;
        }
    },
    { name: 'TouchLayerSystem' },
);

/**
 * Turns the on-screen stick into the same `Move` the keyboard and the gamepad
 * produce. The engine's drag gives a world-space delta from where the thumb
 * went down, which is what a stick is; the knob is drawn from the same number,
 * so what is under the thumb and what the game reads cannot disagree.
 */
export const touchStickSystem = defineSystem(
    [Query(DragState, TouchStick), Query(Mut(Transform), TouchKnob), Res(Input)],
    (sticks, knobs, input) => {
        if (!session.touched) return;
        let x = 0;
        let y = 0;
        for (const [, drag] of sticks) {
            if (!drag.isDragging) break;
            x = drag.totalDeltaWorld.x / STICK_TRAVEL;
            y = drag.totalDeltaWorld.y / STICK_TRAVEL;
            const over = Math.hypot(x, y);
            if (over > 1) { x /= over; y /= over; }
            break;
        }
        input.setVirtual('move', x, y);
        for (const [, transform] of knobs) {
            transform.position.x = x * STICK_TRAVEL;
            transform.position.y = y * STICK_TRAVEL;
        }
    },
    { name: 'TouchStickSystem' },
);

/** Turns an on-screen button into the action it names. */
export const touchButtonSystem = defineSystem(
    [Query(UIInteraction, TouchButton), Res(Input)],
    (buttons, input) => {
        if (!session.touched) return;
        for (const [, interaction, button] of buttons) {
            if (button.action) input.setVirtual(`touch.${button.action}`, interaction.pressed ? 1 : 0);
        }
    },
    { name: 'TouchButtonSystem' },
);
