// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    platform/native/textEditor.ts
 * @brief   The device's editing surface — the OS soft keyboard and its IME —
 *          behind the platform's {@link PlatformTextEditor} contract.
 *
 * The keyboard lives on the OS side of the boundary and reports asynchronously
 * (a UI-thread callback, drained into the frame), while a field reads its value
 * synchronously while rendering. So this keeps a MIRROR of the surface's state,
 * refreshed by every push from the host, and answers `read()` from it. The host
 * remains the owner: an edit the app makes goes out through `write` and comes
 * back as a push, so there is one order of events and never two truths.
 */
import type {
    PlatformTextEditor, TextEditorEvent, TextEditorOptions, TextEditorState,
} from '../types';
import type { NativeTextEditorBridge } from './bridge';

export function createNativeTextEditor(bridge: NativeTextEditorBridge): PlatformTextEditor {
    let state: TextEditorState = { value: '', selectionStart: 0, selectionEnd: 0, backward: false };
    let focused = false;
    let composingNow = false;
    const handlers = new Set<(event: TextEditorEvent) => void>();
    const emit = (event: TextEditorEvent): void => {
        for (const handler of handlers) handler(event);
    };

    const unsubscribe = bridge.subscribe((next) => {
        switch (next.kind) {
            case 'state': {
                const composing = next.composing;
                state = {
                    value: next.value,
                    selectionStart: next.selectionStart,
                    selectionEnd: next.selectionEnd,
                    backward: false,   // no platform keyboard reports a selection's direction
                };
                if (composing !== undefined && composing !== composingNow) {
                    composingNow = composing;
                    emit({ kind: 'composition', composing });
                }
                emit({ kind: 'change' });
                break;
            }
            case 'submit':
                emit({ kind: 'submit' });
                break;
            case 'cancel':
                // The keyboard was dismissed (back gesture / done): the field is no
                // longer being edited, which for a UI field means losing focus.
                focused = false;
                emit({ kind: 'blur' });
                break;
        }
    });

    return {
        focus(next: TextEditorState, options: TextEditorOptions): void {
            state = { ...next };
            focused = true;
            bridge.focus(next.value, next.selectionStart, next.selectionEnd,
                         options.multiline, options.maxLength, options.password);
        },
        blur(): void {
            if (!focused) return;
            focused = false;
            bridge.blur();
        },
        read(): TextEditorState {
            return state;
        },
        write(next: TextEditorState): void {
            state = { ...next };
            bridge.write(next.value, next.selectionStart, next.selectionEnd);
        },
        subscribe(handler: (event: TextEditorEvent) => void): () => void {
            handlers.add(handler);
            return () => { handlers.delete(handler); };
        },
        dispose(): void {
            unsubscribe();
            handlers.clear();
            if (focused) bridge.blur();
            focused = false;
        },
    };
}
