// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resourceShapes.ts
 * @brief   The built-in resources a compiled system can read, and their layout.
 *
 * @details A compiled system reaches a resource by ADDRESS, so it needs a
 *          layout, and a layout needs exactly one author. This is that author:
 *          `resource.ts` builds `Time` from it, the AOT compiler derives offsets
 *          from it, and the runtime mirrors a resource into a block shaped by it.
 *
 *          A member is a SCALAR or a BIT SET. Scalars are the fields a system
 *          reads by name. A bit set is how a SERVICE becomes memory: a method
 *          whose argument is a compile-time key is one bit, so `isKeyDown('KeyW')`
 *          is a load and a mask rather than a call the contract has no way to
 *          make. `methods` is that mapping, and it is the only thing that makes
 *          such a call lowerable.
 *
 *          Order is the layout, in both directions: adding a member moves every
 *          member after it, and adding a key renumbers every key after it.
 *
 *          `fields` carries a value per scalar. For `Time` that value IS the
 *          default the resource is built with; for a service the resource builds
 *          itself, and the value only says which of the two scalar types the
 *          field is. `resource-shape.test.ts` holds the declaration against the
 *          real object either way.
 *
 *          NO IMPORTS. A build tool reads this without pulling in the engine.
 */

/**
 * The keys a compiled system may name, and the bit each one is. `KeyboardEvent.
 * code` values: physical keys, so they do not move with the layout the player
 * types in. A key outside this list is not a lowering failure to work around —
 * the system falls back to its closure and runs interpreted.
 */
export const KEY_CODES: readonly string[] = [
    'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI',
    'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR',
    'KeyS', 'KeyT', 'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
    'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
    'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
    'Semicolon', 'Quote', 'Backquote', 'Comma', 'Period', 'Slash',
    'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
    'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
    'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide',
    'NumpadDecimal', 'NumpadEnter',
    'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen', 'Pause', 'ContextMenu',
];

/** Mouse buttons, where the button NUMBER is the bit: 0 left, 1 middle, 2 right. */
const MOUSE_BUTTON_BITS = 8;

/** A bit set: either a table of names, or a count where the index is the key. */
export interface BitSetSpec {
    readonly keys?: readonly string[];
    readonly count?: number;
}

export interface ResourceSpec {
    /** Scalars, in layout order. The value is the default, and its type. */
    readonly fields: Readonly<Record<string, number | boolean>>;
    /** Bit sets, in layout order after the scalars. */
    readonly bits?: Readonly<Record<string, BitSetSpec>>;
    /** `method(key)` -> which bit set answers it. */
    readonly methods?: Readonly<Record<string, string>>;
}

export const RESOURCE_SHAPES: Readonly<Record<string, ResourceSpec>> = {
    Time: {
        fields: {
            delta: 0,
            elapsed: 0,
            frameCount: 0,
            fixedDelta: 1 / 60,
            fixedAlpha: 0,
            fixedTick: 0,
            scale: 1,
            unscaledDelta: 0,
        },
    },
    /**
     * The edge sets are the ones a call would have RESOLVED, not the raw state:
     * `isKeyPressed` reads a different set inside a fixed step, and the host
     * mirrors whichever one applies. Compiled code reads one bit either way.
     */
    Input: {
        fields: {
            mouseX: 0,
            mouseY: 0,
            scrollDeltaX: 0,
            scrollDeltaY: 0,
            touchAvailable: false,
        },
        bits: {
            keyDown: { keys: KEY_CODES },
            keyPressed: { keys: KEY_CODES },
            keyReleased: { keys: KEY_CODES },
            mouseDown: { count: MOUSE_BUTTON_BITS },
            mousePressed: { count: MOUSE_BUTTON_BITS },
            mouseReleased: { count: MOUSE_BUTTON_BITS },
        },
        methods: {
            isKeyDown: 'keyDown',
            isKeyPressed: 'keyPressed',
            isKeyReleased: 'keyReleased',
            isMouseButtonDown: 'mouseDown',
            isMouseButtonPressed: 'mousePressed',
            isMouseButtonReleased: 'mouseReleased',
        },
    },
    /**
     * The UI surface. `viewProjection` is a Float32Array and is deliberately
     * absent: a member has to have a fixed width, and a system reading it is
     * refused by name rather than handed something else at that offset.
     */
    UICameraInfo: {
        fields: {
            vpX: 0, vpY: 0, vpW: 0, vpH: 0,
            screenW: 0, screenH: 0,
            worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
            worldMouseX: 0, worldMouseY: 0,
            valid: false,
        },
    },
};

/** Names of the resources with a layout — what tells a host shape from a component. */
export const RESOURCE_NAMES: readonly string[] = Object.keys(RESOURCE_SHAPES);

/** One member of a resource's block, in layout order. */
export type ResourceMember =
    | { readonly kind: 'scalar'; readonly name: string; readonly offset: number }
    | { readonly kind: 'bits'; readonly name: string; readonly offset: number; readonly bits: number };

/** A scalar is one f64, so a bit set is padded to the same step. */
const SLOT = 8;

/**
 * `name`'s block, member by member, or null if it has no layout. Scalars first
 * in declaration order, then bit sets: two groups so that adding a key to a set
 * cannot move a scalar, which is the field an offset is most often read at.
 */
export function resourceLayout(name: string): readonly ResourceMember[] | null {
    const spec = RESOURCE_SHAPES[name];
    if (!spec) return null;
    const out: ResourceMember[] = [];
    let at = 0;
    for (const field of Object.keys(spec.fields)) {
        out.push({ kind: 'scalar', name: field, offset: at });
        at += SLOT;
    }
    for (const [set, how] of Object.entries(spec.bits ?? {})) {
        const bits = how.keys ? how.keys.length : (how.count ?? 0);
        out.push({ kind: 'bits', name: set, offset: at, bits });
        at += Math.ceil(bits / 8 / SLOT) * SLOT;
    }
    return out;
}

/** How many bytes `name`'s block takes. */
export function resourceBlockBytes(name: string): number {
    const layout = resourceLayout(name);
    if (!layout) return 0;
    const last = layout[layout.length - 1];
    if (!last) return 0;
    return last.kind === 'scalar' ? last.offset + SLOT
        : last.offset + Math.ceil(last.bits / 8 / SLOT) * SLOT;
}

/** The scalar fields of `name`, in layout order, or null if it has no layout. */
export function resourceFields(name: string): readonly string[] | null {
    const spec = RESOURCE_SHAPES[name];
    return spec ? Object.keys(spec.fields) : null;
}

/**
 * How a host FILLS a bit set: the method to ask, and every key to ask it about.
 * Asking the method rather than reading the state behind it is what keeps the
 * mirror honest — `isKeyPressed` answers from a different set inside a fixed
 * step, and that decision lives in the method.
 */
export function resourceBitSource(
    resource: string, set: string,
): { readonly method: string; readonly keys: readonly (string | number)[] } | null {
    const spec = RESOURCE_SHAPES[resource];
    const method = Object.entries(spec?.methods ?? {}).find(([, s]) => s === set)?.[0];
    const how = spec?.bits?.[set];
    if (!method || !how) return null;
    const keys = how.keys ?? Array.from({ length: how.count ?? 0 }, (_, i) => i);
    return { method, keys };
}

/** Where `resource.method(key)` reads: a byte offset and a bit, or null. */
export function resourceMethodBit(
    resource: string, method: string, key: string | number,
): { readonly offset: number; readonly bit: number } | null {
    const spec = RESOURCE_SHAPES[resource];
    const set = spec?.methods?.[method];
    if (!spec || !set) return null;
    const how = spec.bits?.[set];
    const member = resourceLayout(resource)?.find((m) => m.kind === 'bits' && m.name === set);
    if (!how || !member) return null;
    const index = how.keys
        ? (typeof key === 'string' ? how.keys.indexOf(key) : -1)
        : (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < (how.count ?? 0) ? key : -1);
    if (index < 0) return null;
    return { offset: member.offset + (index >> 3), bit: index & 7 };
}
