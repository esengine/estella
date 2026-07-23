// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app';
import type { Entity } from '../../types';
import { defineSystem, Schedule } from '../../system';
import { registerComponent } from '../../component';
import { TextInput, type TextInputData } from './text-input';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import type { UIVisualData } from '../core/ui-visual';
import { UIMask, MaskMode } from '../core/ui-mask';
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';
import { Interactable, UIInteraction, type UIInteractionData } from '../input/interactable';
import { Focusable, FocusManager, FocusManagerState } from '../input/focusable';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { Transform, type TransformData } from '../../component';
import { UIEvents, UIEventQueue } from '../core/events';
import { Res } from '../../resource';
import { playModeOnly } from '../../env';
import { ensureComponent, getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { spawnUIEntity } from '../core/compose';
import { px } from '../core/dimension';
import { SdfTextRenderer } from './text-renderer';
import { measureWidth } from './layout';
import { textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex, type TextFieldDisplay } from './text-input-view';
import { CURSOR_BLINK_INTERVAL } from '../util/constants';
import { SystemLabel, PluginName } from '../../systemLabels';
import { log } from '../../logger';

/** Masking bullet for password fields. */
const PASSWORD_CHAR = '●';

/** Selection-highlight fill (a translucent accent drawn behind the text). */
const SELECTION_COLOR = { r: 0.30, g: 0.55, b: 1.0, a: 0.35 };

export class TextInputPlugin implements Plugin {
    name = PluginName.TextInput;
    dependencies = [PluginName.Focus];

    private cleanupListeners_: (() => void) | null = null;

    cleanup(): void {
        if (this.cleanupListeners_) {
            this.cleanupListeners_();
            this.cleanupListeners_ = null;
        }
    }

    build(app: App): void {
        registerComponent('TextInput', TextInput);

        if (!playModeOnly()) return;

        const moduleOrNull = app.wasmModule;
        if (!moduleOrNull) {
            log.warn('ui', 'TextInputPlugin: No WASM module available');
            return;
        }
        const module = moduleOrNull;

        const world = app.world;

        // The editable text renders through the shared SDF glyph
        // atlas — a child Text entity (drawn by textPlugin) + a child UIVisual
        // caret quad, composited over the entity's background UIVisual. No more
        // per-entity Canvas2D rasterization / texture upload. `measureRenderer`
        // owns an atlas used only to position the caret (measureWidth); its glyph
        // advances match the child Text's atlas (same font config).
        const childrenOf = new Map<Entity, { sel: Entity; text: Entity; caret: Entity }>();
        // The render system's horizontal scroll per field, read by click-to-caret
        // (Update) to map a pointer x back to a character index under the scroll.
        const scrollXOf = new Map<Entity, number>();
        let measureRenderer: SdfTextRenderer | null = null;
        const ensureMeasure = (): SdfTextRenderer => {
            if (!measureRenderer) measureRenderer = new SdfTextRenderer(module);
            return measureRenderer;
        };

        let composing = false;
        let cursorVisible = true;
        let cursorTimer = 0;
        let lastTime = 0;

        const textareaOrNull = createHiddenTextarea();
        if (!textareaOrNull) {
            return;
        }
        const textarea = textareaOrNull;

        function getFocusedTextInput(): Entity | null {
            const fm = app.getResource(FocusManager) as FocusManagerState | null;
            if (!fm || fm.focusedEntity === null) return null;
            const entity = fm.focusedEntity;
            if (!world.valid(entity) || !world.has(entity, TextInput)) return null;
            return entity;
        }

        const onInput = () => {
            if (composing || getFocusedTextInput() === null) return;
            syncFromTextarea();
        };

        const onCompositionStart = () => {
            composing = true;
            resetCursorBlink();
        };

        // While composing, the browser holds the preedit inside the textarea
        // value with the caret after it. The render loop reads that live (see
        // below), so no state is copied here — this only keeps the caret solid
        // and the field marked dirty as the preedit changes each keystroke.
        const onCompositionUpdate = () => {
            const focused = getFocusedTextInput();
            if (focused !== null) {
                (world.get(focused, TextInput) as TextInputData).dirty = true;
            }
            resetCursorBlink();
        };

        const onCompositionEnd = () => {
            composing = false;
            syncFromTextarea();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const focused = getFocusedTextInput();
            if (focused === null) return;

            if (e.key === 'Escape') {
                blurCurrent();
                return;
            }

            const ti = world.get(focused, TextInput) as TextInputData;
            if (e.key === 'Enter' && !ti.multiline) {
                e.preventDefault();
                const events = app.getResource(UIEvents) as UIEventQueue;
                events.emit(focused, 'submit');
                blurCurrent();
                return;
            }

            // Caret movement + selection (arrows, Home/End, Shift-select, Ctrl-A)
            // are handled natively by the focused textarea — the render loop
            // mirrors its selection each frame — so nothing to intercept here.
            // A keystroke that moves the caret should re-show it solid.
            resetCursorBlink();
        };

        const onBlur = () => {
            const focused = getFocusedTextInput();
            if (focused !== null) {
                const ti = world.get(focused, TextInput) as TextInputData;
                ti.focused = false;
                ti.dirty = true;
                const fm = app.getResource(FocusManager) as FocusManagerState;
                fm.blur();
            }
        };

        textarea.addEventListener('input', onInput);
        textarea.addEventListener('compositionstart', onCompositionStart);
        textarea.addEventListener('compositionupdate', onCompositionUpdate);
        textarea.addEventListener('compositionend', onCompositionEnd);
        textarea.addEventListener('keydown', onKeyDown);
        textarea.addEventListener('blur', onBlur);

        this.cleanupListeners_ = () => {
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('compositionstart', onCompositionStart);
            textarea.removeEventListener('compositionupdate', onCompositionUpdate);
            textarea.removeEventListener('compositionend', onCompositionEnd);
            textarea.removeEventListener('keydown', onKeyDown);
            textarea.removeEventListener('blur', onBlur);
            textarea.remove();
            for (const ch of childrenOf.values()) {
                if (world.valid(ch.sel)) world.despawn(ch.sel);
                if (world.valid(ch.text)) world.despawn(ch.text);
                if (world.valid(ch.caret)) world.despawn(ch.caret);
            }
            childrenOf.clear();
        };

        function syncFromTextarea(): void {
            const focused = getFocusedTextInput();
            if (focused === null) return;
            const ti = world.get(focused, TextInput) as TextInputData;
            if (ti.readOnly) return;

            let val = textarea.value;
            if (ti.maxLength > 0 && val.length > ti.maxLength) {
                val = val.substring(0, ti.maxLength);
                textarea.value = val;
            }

            if (val !== ti.value) {
                ti.value = val;
                const events = app.getResource(UIEvents) as UIEventQueue;
                events.emit(focused, 'change');
            }
            ti.cursorPos = textarea.selectionStart ?? val.length;
            ti.dirty = true;
            resetCursorBlink();
        }

        // Map the current pointer to a caret index inside `entity` (single-line):
        // pointer world-x → the field's local text space (undo the box center,
        // padding and horizontal scroll) → nearest character boundary. null when
        // it can't be resolved (no camera / multiline / zero-width).
        function caretIndexFromPointer(entity: Entity): number | null {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            if (!cam || !cam.valid) return null;
            if (!world.has(entity, Transform) || !world.has(entity, UINode)) return null;
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.multiline) return null;
            const width = getUINodeWidth(entity);
            if (width <= 0) return null;
            // The layout centers the box on its Transform (pivot 0.5), so the left
            // edge is half a width to the left; text starts `padding` in, scrolled.
            const tr = world.get(entity, Transform) as TransformData;
            const fieldLeft = tr.worldPosition.x - width / 2;
            const scrollX = scrollXOf.get(entity) ?? 0;
            const textX = cam.worldMouseX - fieldLeft - ti.padding + scrollX;
            // Focused ⇒ the textarea is the source of truth for the value.
            const val = textarea.value;
            const atlas = ensureMeasure().atlas;
            const prefixes: number[] = [];
            for (let i = 0; i <= val.length; i++) {
                prefixes.push(measureWidth(maskedPrefix(val, i, ti.password, PASSWORD_CHAR), atlas, ti.fontFamily, ti.fontSize, 0));
            }
            return nearestCaretIndex(prefixes, textX);
        }

        function activateTextarea(entity: Entity): void {
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            ti.focused = true;
            ti.dirty = true;

            textarea.value = ti.value;
            textarea.selectionStart = ti.cursorPos;
            textarea.selectionEnd = ti.cursorPos;
            textarea.focus();
            resetCursorBlink();
        }

        function blurCurrent(): void {
            const focused = getFocusedTextInput();
            if (focused !== null) {
                const ti = world.get(focused, TextInput) as TextInputData;
                ti.focused = false;
                ti.dirty = true;
            }
            const fm = app.getResource(FocusManager) as FocusManagerState;
            fm.blur();
            textarea.blur();
        }

        function resetCursorBlink(): void {
            cursorVisible = true;
            cursorTimer = 0;
        }

        let prevFocusedTextInput: Entity | null = null;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(FocusManager)],
            (focusManager: FocusManagerState) => {
                const textInputEntities = world.getEntitiesWithComponents([TextInput]);
                for (const entity of textInputEntities) {
                    ensureComponent(world, entity, Focusable, { tabIndex: 0, isFocused: false });
                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });
                }

                const currentFocused = getFocusedTextInput();

                if (currentFocused !== prevFocusedTextInput) {
                    if (prevFocusedTextInput !== null && world.valid(prevFocusedTextInput) && world.has(prevFocusedTextInput, TextInput)) {
                        const ti = world.get(prevFocusedTextInput, TextInput) as TextInputData;
                        ti.focused = false;
                        ti.dirty = true;
                        textarea.blur();
                    }

                    if (currentFocused !== null) {
                        activateTextarea(currentFocused);
                    }

                    prevFocusedTextInput = currentFocused;
                }

                // Click-to-caret: a pointer press inside the focused field moves
                // the caret to the character boundary nearest the pointer (runs
                // after the focus change above, so it overrides the restored caret
                // on the same click that focused the field).
                if (currentFocused !== null && world.has(currentFocused, UIInteraction)) {
                    const inter = world.get(currentFocused, UIInteraction) as UIInteractionData;
                    if (inter.justPressed) {
                        const idx = caretIndexFromPointer(currentFocused);
                        if (idx !== null) {
                            textarea.selectionStart = idx;
                            textarea.selectionEnd = idx;
                            const ti = world.get(currentFocused, TextInput) as TextInputData;
                            ti.cursorPos = idx;
                            ti.dirty = true;
                            resetCursorBlink();
                        }
                    }
                }
            },
            { name: 'TextInputFocusSystem' }
        ), { runAfter: [SystemLabel.Focus] });

        // Render system — composite the input from SDF child entities (a child
        // Text drawn by textPlugin + a child caret quad) over the entity's
        // background UIVisual. Tree-DFS render order layers bg < text < caret. No
        // Canvas2D, no per-entity texture.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                let dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
                lastTime = now;
                dt = Math.min(dt, 0.1);

                const focused = getFocusedTextInput();
                if (focused !== null) {
                    cursorTimer += dt;
                    if (cursorTimer >= CURSOR_BLINK_INTERVAL) {
                        cursorTimer -= CURSOR_BLINK_INTERVAL;
                        cursorVisible = !cursorVisible;
                    }
                }

                // Reap the child entities of removed inputs.
                for (const [e, ch] of childrenOf) {
                    if (!world.valid(e) || !world.has(e, TextInput)) {
                        if (world.valid(ch.sel)) world.despawn(ch.sel);
                        if (world.valid(ch.text)) world.despawn(ch.text);
                        if (world.valid(ch.caret)) world.despawn(ch.caret);
                        childrenOf.delete(e);
                    }
                }

                for (const entity of world.getEntitiesWithComponents([TextInput, UINode])) {
                    const ti = world.get(entity, TextInput) as TextInputData;
                    const w = getUINodeWidth(entity);
                    const h = getUINodeHeight(entity);
                    if (w <= 0 || h <= 0) continue;

                    ensureBackground(entity, ti);
                    const ch = ensureChildren(entity, ti);
                    // While focused, the hidden textarea is the single source of
                    // truth for editing — caret moves, native Shift/Ctrl-A
                    // selection, and the live IME preedit all land there — so a
                    // focused field renders the textarea's value + selection; a
                    // blurred field renders its committed component value.
                    const editing = focused === entity;
                    const val = editing ? textarea.value : ti.value;
                    const len = val.length;
                    const sel = editing
                        ? fieldSelection(
                            textarea.selectionStart ?? len,
                            textarea.selectionEnd ?? len,
                            textarea.selectionDirection === 'backward',
                            len)
                        : { lo: 0, hi: 0, caret: Math.max(0, Math.min(ti.cursorPos, len)), hasRange: false };
                    // Keep the component caret in step so a blur/refocus restores it.
                    if (editing && ti.cursorPos !== sel.caret) ti.cursorPos = sel.caret;

                    const disp = textFieldDisplay(val, ti.password, ti.placeholder, PASSWORD_CHAR);
                    const atlas = ensureMeasure().atlas;
                    const measure = (i: number): number =>
                        measureWidth(maskedPrefix(val, i, ti.password, PASSWORD_CHAR), atlas, ti.fontFamily, ti.fontSize, 0);
                    const caretRaw = measure(sel.caret);
                    // Single-line fields scroll horizontally to keep the caret in view;
                    // multiline wraps within the box and clips (no h-scroll).
                    const innerW = Math.max(0, w - 2 * ti.padding);
                    const scrollX = ti.multiline ? 0 : Math.max(0, caretRaw - innerW);
                    scrollXOf.set(entity, scrollX);

                    // Selection highlight (single-line only): a quad spanning the
                    // masked range, drawn behind the text. A multiline selection
                    // spans lines and is left to a later pass.
                    const showSel = sel.hasRange && !ti.multiline;
                    const selLo = showSel ? measure(sel.lo) : 0;
                    const selHi = showSel ? measure(sel.hi) : 0;
                    syncSelChild(ch.sel, ti, h, showSel, ti.padding + selLo - scrollX, selHi - selLo);

                    syncTextChild(ch.text, ti, disp, innerW, scrollX);
                    // The blinking caret hides while a range is selected (the
                    // highlight stands in), matching a native field.
                    syncCaretChild(ch.caret, ti, h, ti.padding + caretRaw - scrollX,
                        ti.focused && cursorVisible && !sel.hasRange);
                }
            },
            { name: 'TextInputRenderSystem' }
        ));

        function ensureBackground(entity: Entity, ti: TextInputData): void {
            // Clip the editable text + caret to the field box: a long value scrolls
            // horizontally past the edge and must not spill outside the input.
            if (!world.has(entity, UIMask)) {
                world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor });
            }
            if (!world.has(entity, UIVisual)) {
                world.insert(entity, UIVisual, {
                    visualType: UIVisualType.SolidColor, texture: 0,
                    color: { ...ti.backgroundColor },
                    uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
                    sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 },
                    fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true,
                });
                return;
            }
            const bg = world.get(entity, UIVisual) as UIVisualData;
            const c = ti.backgroundColor;
            if (bg.visualType !== UIVisualType.SolidColor || !bg.enabled
                || bg.color.r !== c.r || bg.color.g !== c.g || bg.color.b !== c.b || bg.color.a !== c.a) {
                bg.visualType = UIVisualType.SolidColor;
                bg.color = { ...c };
                bg.enabled = true;
                world.insert(entity, UIVisual, bg);
            }
        }

        function ensureChildren(entity: Entity, ti: TextInputData): { sel: Entity; text: Entity; caret: Entity } {
            const existing = childrenOf.get(entity);
            if (existing && world.valid(existing.sel) && world.valid(existing.text) && world.valid(existing.caret)) return existing;
            const pad = px(ti.padding);
            // Spawn order is the tree-DFS render order: highlight (behind) < text < caret.
            const sel = spawnUIEntity({
                world, parent: entity,
                node: { position: UIPositionType.Absolute, width: px(0), height: px(ti.fontSize), insetLeft: pad, insetTop: px(0) },
                visual: { visualType: UIVisualType.SolidColor, color: { ...SELECTION_COLOR }, enabled: false },
            });
            const text = spawnUIEntity({
                world, parent: entity,
                // Left-anchored by insetLeft (scrolled by the render loop) with an
                // explicit width — NOT insetRight — so a single-line value can slide
                // under the Scissor mask instead of being pinned to the box.
                node: { position: UIPositionType.Absolute, insetLeft: pad, insetTop: px(0), insetBottom: px(0), width: px(0) },
                text: {
                    content: '', fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                    align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                    renderMode: ti.renderMode,
                },
            });
            const caret = spawnUIEntity({
                world, parent: entity,
                node: { position: UIPositionType.Absolute, width: px(2), height: px(ti.fontSize), insetLeft: px(ti.padding), insetTop: px(0) },
                visual: { visualType: UIVisualType.SolidColor, color: ti.color, enabled: false },
            });
            const ch = { sel, text, caret };
            childrenOf.set(entity, ch);
            return ch;
        }

        function syncSelChild(selEntity: Entity, ti: TextInputData, boxH: number, show: boolean, x: number, width: number): void {
            const w = Math.max(0, width);
            const top = Math.max(0, (boxH - ti.fontSize) / 2);
            const node = world.get(selEntity, UINode) as UINodeData;
            if (node.insetLeft.value !== x || node.insetTop.value !== top || node.width.value !== w || node.height.value !== ti.fontSize) {
                node.insetLeft = px(x);
                node.insetTop = px(top);
                node.width = px(w);
                node.height = px(ti.fontSize);
                world.insert(selEntity, UINode, node);
            }
            const v = world.get(selEntity, UIVisual) as UIVisualData;
            const on = show && w > 0;
            if (v.enabled !== on) {
                v.enabled = on;
                world.insert(selEntity, UIVisual, v);
            }
        }

        function syncTextChild(textEntity: Entity, ti: TextInputData, disp: TextFieldDisplay, innerW: number, scrollX: number): void {
            const t = world.get(textEntity, Text) as TextData;
            const show = disp.text;
            const col = disp.isPlaceholder ? ti.placeholderColor : ti.color;
            if (t.content !== show || t.fontFamily !== ti.fontFamily || t.fontSize !== ti.fontSize
                || t.wordWrap !== ti.multiline || t.renderMode !== ti.renderMode
                || t.color.r !== col.r || t.color.g !== col.g || t.color.b !== col.b || t.color.a !== col.a) {
                t.content = show;
                t.fontFamily = ti.fontFamily;
                t.fontSize = ti.fontSize;
                t.wordWrap = ti.multiline;
                t.renderMode = ti.renderMode;
                t.color = { ...col };
                world.insert(textEntity, Text, t);
            }
            // Slide the text box by the scroll offset; width = the inner box (a
            // single line overflows it rightward and the Scissor mask clips).
            const node = world.get(textEntity, UINode) as UINodeData;
            const left = ti.padding - scrollX;
            if (node.insetLeft.value !== left || node.width.value !== innerW) {
                node.insetLeft = px(left);
                node.width = px(innerW);
                world.insert(textEntity, UINode, node);
            }
        }

        function syncCaretChild(caretEntity: Entity, ti: TextInputData, boxH: number, caretX: number, show: boolean): void {
            const caretTop = Math.max(0, (boxH - ti.fontSize) / 2);
            const node = world.get(caretEntity, UINode) as UINodeData;
            if (node.insetLeft.value !== caretX || node.insetTop.value !== caretTop || node.height.value !== ti.fontSize) {
                node.insetLeft = px(caretX);
                node.insetTop = px(caretTop);
                node.height = px(ti.fontSize);
                world.insert(caretEntity, UINode, node);
            }
            const v = world.get(caretEntity, UIVisual) as UIVisualData;
            if (v.enabled !== show || v.color.r !== ti.color.r || v.color.g !== ti.color.g || v.color.b !== ti.color.b) {
                v.enabled = show;
                v.color = { ...ti.color };
                world.insert(caretEntity, UIVisual, v);
            }
        }
    }
}

function createHiddenTextarea(): HTMLTextAreaElement | null {
    if (typeof document === 'undefined' || !document.body) {
        return null;
    }
    const textarea = document.createElement('textarea');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.style.zIndex = '-1';
    textarea.autocomplete = 'off';
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('spellcheck', 'false');
    document.body.appendChild(textarea);
    return textarea;
}

export const textInputPlugin = new TextInputPlugin();
