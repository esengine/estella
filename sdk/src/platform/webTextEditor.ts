// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    platform/webTextEditor.ts
 * @brief   The web's editing surface: a hidden textarea, behind the platform's
 *          {@link PlatformTextEditor} contract.
 *
 * A browser already has a text field that does everything an editable UI field
 * needs — keyboard layouts, IME composition with its candidate window, native
 * selection gestures, clipboard, undo — so the engine borrows one instead of
 * reimplementing it, keeps it invisible and click-through, and reads its value
 * and selection as the truth while a field is focused. Moving it to the caret is
 * what makes the IME candidate window pop under the text being typed.
 */
import type {
    PlatformCanvas, PlatformTextEditor, TextEditorEvent, TextEditorOptions, TextEditorState,
} from './types';
import { surfacePointerFrame } from './webSurface';

const PARKED_PX = '-9999px';

function createHiddenTextarea(doc: Document | undefined): HTMLTextAreaElement | null {
    if (!doc?.body) return null;
    const textarea = doc.createElement('textarea');
    textarea.style.position = 'fixed';
    // Parked off-screen until a field focuses, then moved to the caret so the IME
    // candidate window anchors there. Invisible and click-through so the on-screen
    // textarea never shows or steals a pointer.
    textarea.style.left = PARKED_PX;
    textarea.style.top = PARKED_PX;
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.style.zIndex = '-1';
    textarea.style.pointerEvents = 'none';
    textarea.style.border = '0';
    textarea.style.padding = '0';
    textarea.tabIndex = -1;
    textarea.dataset.estellaTextEditor = 'true';
    textarea.autocomplete = 'off';
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('spellcheck', 'false');
    doc.body.appendChild(textarea);
    return textarea;
}

export function createWebTextEditor(surface?: PlatformCanvas): PlatformTextEditor | null {
    const canvas = surface && 'localName' in surface && surface.localName === 'canvas'
        ? surface as PlatformCanvas & HTMLCanvasElement : undefined;
    const textarea = createHiddenTextarea(canvas?.ownerDocument ?? globalThis.document);
    if (!textarea) return null;

    const handlers = new Set<(event: TextEditorEvent) => void>();
    const emit = (event: TextEditorEvent): void => {
        for (const handler of handlers) handler(event);
    };
    let composing = false;
    let multiline = false;

    const onInput = (): void => { if (!composing) emit({ kind: 'change' }); };
    const onCompositionStart = (): void => {
        composing = true;
        emit({ kind: 'composition', composing: true });
    };
    // The preedit lives in the textarea's value with the caret after it, and the
    // field reads that live — so an update carries no state, only the news that
    // the composition moved.
    const onCompositionUpdate = (): void => emit({ kind: 'composition', composing: true });
    const onCompositionEnd = (): void => {
        composing = false;
        emit({ kind: 'composition', composing: false });
        emit({ kind: 'change' });
    };
    const onKeyDown = (e: KeyboardEvent): void => {
        if (composing || e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') {
            emit({ kind: 'cancel' });
            return;
        }
        if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            emit({ kind: 'submit' });
            return;
        }
        // Arrows, Home/End, shift-select and Ctrl-A are the textarea's own; the
        // field mirrors its selection each frame. This only reports the motion.
        emit({ kind: 'change' });
    };
    const onBlur = (): void => {
        composing = false;
        emit({ kind: 'blur' });
    };

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionupdate', onCompositionUpdate);
    textarea.addEventListener('compositionend', onCompositionEnd);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('blur', onBlur);

    const park = (): void => {
        if (textarea.style.left !== PARKED_PX) {
            textarea.style.left = PARKED_PX;
            textarea.style.top = PARKED_PX;
        }
    };

    return {
        focus(state: TextEditorState, options: TextEditorOptions): void {
            if (canvas && textarea.ownerDocument !== canvas.ownerDocument) canvas.ownerDocument.body.appendChild(textarea);
            composing = false;
            multiline = options.multiline;
            // No limit is the ABSENCE of the attribute — assigning a negative
            // maxLength is an IndexSizeError, not "unlimited".
            if (options.maxLength > 0) textarea.maxLength = options.maxLength;
            else textarea.removeAttribute('maxlength');
            textarea.value = state.value;
            textarea.selectionStart = state.selectionStart;
            textarea.selectionEnd = state.selectionEnd;
            textarea.focus();
        },
        blur(): void {
            park();
            textarea.blur();
        },
        read(): TextEditorState {
            const value = textarea.value;
            return {
                value,
                selectionStart: textarea.selectionStart ?? value.length,
                selectionEnd: textarea.selectionEnd ?? value.length,
                backward: textarea.selectionDirection === 'backward',
            };
        },
        write(state: TextEditorState): void {
            if (textarea.value !== state.value) textarea.value = state.value;
            textarea.selectionStart = state.selectionStart;
            textarea.selectionEnd = state.selectionEnd;
        },
        setCaretAnchor(left: number, top: number): void {
            if (canvas && textarea.ownerDocument === canvas.ownerDocument) {
                const frame = surfacePointerFrame(canvas);
                left = frame.left + left / frame.scaleX;
                top = frame.top + top / frame.scaleY;
            }
            textarea.style.left = Math.round(left) + 'px';
            textarea.style.top = Math.round(top) + 'px';
        },
        subscribe(handler: (event: TextEditorEvent) => void): () => void {
            handlers.add(handler);
            return () => { handlers.delete(handler); };
        },
        dispose(): void {
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('compositionstart', onCompositionStart);
            textarea.removeEventListener('compositionupdate', onCompositionUpdate);
            textarea.removeEventListener('compositionend', onCompositionEnd);
            textarea.removeEventListener('keydown', onKeyDown);
            textarea.removeEventListener('blur', onBlur);
            textarea.remove();
            handlers.clear();
        },
    };
}
