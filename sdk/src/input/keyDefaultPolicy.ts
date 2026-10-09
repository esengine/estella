// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { InputState } from './input';
const policies = new WeakMap<InputState, (code: string) => boolean>();
/** Internal app-scoped policy; claiming the browser default does not consume game input. */
export function setKeyDefaultPolicy(state: InputState, policy: (code: string) => boolean): () => void {
    policies.set(state, policy);
    return () => { if (policies.get(state) === policy) policies.delete(state); };
}
export function claimsKeyDefault(state: InputState, code: string): boolean {
    return policies.get(state)?.(code) ?? false;
}

// Preserve the modifier at the Tab edge even if keyup arrives before the next frame.
const tabShift = new WeakMap<InputState, boolean>();
export function recordTabModifiers(state: InputState, code: string): void {
    if (code === 'Tab' && !state.keysDown.has(code)) {
        tabShift.set(state, ['Shift', 'ShiftLeft', 'ShiftRight'].some(key => state.isKeyDown(key)));
    }
}
export function tabWasShifted(state: InputState): boolean {
    return tabShift.get(state) ?? ['Shift', 'ShiftLeft', 'ShiftRight'].some(key => state.isKeyDown(key));
}
export function clearTabModifiers(state: InputState): void { tabShift.delete(state); }
