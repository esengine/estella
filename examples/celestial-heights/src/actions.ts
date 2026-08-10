import {
    defineInputMap, Axis2D, Button, Keys2D, Stick, Key, GpButton, GamepadButton, Virtual,
} from 'esengine';

/**
 * Gameplay asks for named actions, never for keys — which is what makes the
 * settings menu able to rebind them and a gamepad able to answer them. The map
 * registers its own per-frame evaluation.
 */
export const Actions = defineInputMap({
    Move: Axis2D(
        Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'),
        Keys2D('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'),
        Stick('left'),
        Virtual('move'),
    ),
    Attack: Button(Key('Space'), GpButton(GamepadButton.West), Virtual('touch.Attack')),
    Pause: Button(Key('Escape'), GpButton(GamepadButton.Start)),
    Pack: Button(Key('Tab'), GpButton(GamepadButton.North)),
    Language: Button(Key('KeyL')),
    Save: Button(Key('F5')),
    Load: Button(Key('F9')),
});

/** Where the player's own bindings live; `Actions.save/load` own the format. */
export const BINDINGS_KEY = 'celestial-heights.bindings';
