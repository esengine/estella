// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import type { Entity } from '../../types';
import { defineSystem, Schedule } from '../../ecs/system';
import { registerComponent } from '../../ecs/component';
import { TextInput, type TextInputData } from './text-input';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import type { UIVisualData } from '../core/ui-visual';
import { UIMask, MaskMode } from '../core/ui-mask';
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';
import { Interactable, UIInteraction, type UIInteractionData } from '../input/interactable';
import { Focusable, FocusManager, FocusManagerState } from '../input/focusable';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { Transform, type TransformData } from '../../ecs/component';
import { UIEvents, UIEventQueue } from '../core/events';
import { Res } from '../../ecs/resource';
import { playModeOnly } from '../../util/env';
import { ensureComponent, getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { spawnUIEntity } from '../core/compose';
import { px } from '../core/dimension';
import { SdfTextRenderer } from './text-renderer';
import type { ESEngineModule } from '../../wasm';
import { measureWidth } from './layout';
import {
    textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex,
    splitLines, caretLineCol, lineSelections, imeAnchorCss, type TextFieldDisplay,
} from './text-input-view';
import { uiWorldToScreen } from '../util/ui-pick';
import { platformCreateTextEditor, platformDevicePixelRatio } from '../../platform';
import { CURSOR_BLINK_INTERVAL, TEXT_INPUT_LINE_HEIGHT_RATIO } from '../util/constants';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import { log } from '../../util/logger';

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

        // The OS surface that holds the value + selection while a field is focused:
        // a hidden textarea on the web, the soft keyboard and its IME on a device.
        // A realm without one (headless) renders fields but cannot type into them.
        const editor = platformCreateTextEditor();
        if (!editor) {
            log.info('ui', 'TextInput: this realm has no text-editing surface — fields render, typing is off');
            return;
        }

        // Null on the native core, whose glyphs come from the platform rasterizer
        // rather than the wasm heap — the measurement atlas takes either.
        const module = app.wasmModule as ESEngineModule | null;

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

        function getFocusedTextInput(): Entity | null {
            const fm = app.getResource(FocusManager) as FocusManagerState | null;
            if (!fm || fm.focusedEntity === null) return null;
            const entity = fm.focusedEntity;
            if (!world.valid(entity) || !world.has(entity, TextInput)) return null;
            return entity;
        }

        const unsubscribe = editor.subscribe((event) => {
            const focused = getFocusedTextInput();
            switch (event.kind) {
                case 'change':
                    if (!composing && focused !== null) syncFromEditor();
                    break;
                case 'composition':
                    // The preedit sits in the surface's value with the caret after
                    // it, and the render loop reads that live — so nothing is copied
                    // here. This keeps the caret solid and the field dirty while the
                    // composition moves, and commits it when it ends.
                    composing = event.composing;
                    if (focused !== null) (world.get(focused, TextInput) as TextInputData).dirty = true;
                    if (!event.composing && focused !== null) syncFromEditor();
                    resetCursorBlink();
                    break;
                case 'submit':
                    if (focused !== null) {
                        (app.getResource(UIEvents) as UIEventQueue).emit(focused, 'submit');
                        blurCurrent();
                    }
                    break;
                case 'cancel':
                    if (focused !== null) blurCurrent();
                    break;
                case 'blur':
                    if (focused !== null) {
                        const ti = world.get(focused, TextInput) as TextInputData;
                        ti.focused = false;
                        ti.dirty = true;
                        (app.getResource(FocusManager) as FocusManagerState).blur();
                    }
                    break;
            }
        });

        this.cleanupListeners_ = () => {
            unsubscribe();
            editor.dispose();
            for (const ch of childrenOf.values()) {
                if (world.valid(ch.sel)) world.despawn(ch.sel);
                if (world.valid(ch.text)) world.despawn(ch.text);
                if (world.valid(ch.caret)) world.despawn(ch.caret);
            }
            childrenOf.clear();
        };

        function syncFromEditor(): void {
            const focused = getFocusedTextInput();
            if (focused === null) return;
            const ti = world.get(focused, TextInput) as TextInputData;
            if (ti.readOnly) return;

            const state = editor!.read();
            let val = state.value;
            if (ti.maxLength > 0 && val.length > ti.maxLength) {
                val = val.substring(0, ti.maxLength);
                editor!.write({ ...state, value: val, selectionStart: val.length, selectionEnd: val.length });
            }

            if (val !== ti.value) {
                ti.value = val;
                const events = app.getResource(UIEvents) as UIEventQueue;
                events.emit(focused, 'change');
            }
            ti.cursorPos = Math.min(state.selectionStart, val.length);
            ti.dirty = true;
            resetCursorBlink();
        }

        // Map the current pointer to a caret index inside `entity`: pointer
        // world-x → the field's local text space (undo the box center, padding and
        // horizontal scroll) → nearest character boundary. Multiline also maps the
        // pointer world-y to a \n-broken line first. null when it can't be resolved
        // (no camera / no box).
        function caretIndexFromPointer(entity: Entity): number | null {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            if (!cam || !cam.valid) return null;
            if (!world.has(entity, Transform) || !world.has(entity, UINode)) return null;
            const ti = world.get(entity, TextInput) as TextInputData;
            const width = getUINodeWidth(entity);
            if (width <= 0) return null;
            // The layout centers the box on its Transform (pivot 0.5): left edge is
            // half a width to the left, top edge half a height above (world y-up).
            const tr = world.get(entity, Transform) as TransformData;
            const fieldLeft = tr.worldPosition.x - width / 2;
            const val = editor!.read().value;   // focused ⇒ the surface is the value source
            const atlas = ensureMeasure().atlas;
            const mw = (s: string): number => measureWidth(s, atlas, ti.fontFamily, ti.fontSize, 0);

            if (ti.multiline) {
                const height = getUINodeHeight(entity);
                const lineH = ti.fontSize * TEXT_INPUT_LINE_HEIGHT_RATIO;
                const fieldTop = tr.worldPosition.y + height / 2;
                const localY = fieldTop - cam.worldMouseY; // y-down from the box top
                const lines = splitLines(val);
                const li = Math.max(0, Math.min(Math.floor(localY / lineH), lines.length - 1));
                const line = lines[li];
                const textX = cam.worldMouseX - fieldLeft - ti.padding;
                const prefixes: number[] = [];
                for (let i = 0; i <= line.text.length; i++) prefixes.push(mw(line.text.slice(0, i)));
                return line.start + nearestCaretIndex(prefixes, textX);
            }

            const scrollX = scrollXOf.get(entity) ?? 0;
            const textX = cam.worldMouseX - fieldLeft - ti.padding + scrollX;
            const prefixes: number[] = [];
            for (let i = 0; i <= val.length; i++) {
                prefixes.push(mw(maskedPrefix(val, i, ti.password, PASSWORD_CHAR)));
            }
            return nearestCaretIndex(prefixes, textX);
        }

        function activateEditor(entity: Entity): void {
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            ti.focused = true;
            ti.dirty = true;

            editor!.focus(
                { value: ti.value, selectionStart: ti.cursorPos, selectionEnd: ti.cursorPos, backward: false },
                { multiline: ti.multiline, maxLength: ti.maxLength, password: ti.password },
            );
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
            editor!.blur();
        }

        /** Put the surface's caret anchor at the caret's on-screen position, so the
         *  OS IME pops its candidate window just under the text being typed rather
         *  than in a screen corner. `caretBottom` is the caret's bottom edge in
         *  field-local px (y-down from the box top). */
        function anchorCaret(entity: Entity, caretX: number, caretBottom: number): void {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            if (!cam || !cam.valid || !world.has(entity, Transform)) return;
            const tr = world.get(entity, Transform) as TransformData;
            const w = getUINodeWidth(entity);
            const h = getUINodeHeight(entity);
            // Box is centered on its Transform (pivot 0.5): left/top edges from it.
            const worldX = (tr.worldPosition.x - w / 2) + caretX;
            const worldY = (tr.worldPosition.y + h / 2) - caretBottom; // world y-up
            const scr = uiWorldToScreen(cam, worldX, worldY);
            const css = imeAnchorCss(scr.x, scr.y, cam.screenH, platformDevicePixelRatio());
            editor!.setCaretAnchor?.(css.left, css.top);
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
                        editor.blur();
                    }

                    if (currentFocused !== null) {
                        activateEditor(currentFocused);
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
                            editor.write({ ...editor.read(), selectionStart: idx, selectionEnd: idx, backward: false });
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
                    // While focused, the editing surface is the single source of
                    // truth — caret moves, native shift/Ctrl-A selection, and the
                    // live IME preedit all land there — so a focused field renders
                    // the surface's value + selection; a blurred field renders its
                    // committed component value.
                    const editing = focused === entity;
                    const state = editing ? editor.read() : null;
                    const val = state ? state.value : ti.value;
                    const len = val.length;
                    const sel = state
                        ? fieldSelection(state.selectionStart, state.selectionEnd, state.backward, len)
                        : { lo: 0, hi: 0, caret: Math.max(0, Math.min(ti.cursorPos, len)), hasRange: false };
                    // Keep the component caret in step so a blur/refocus restores it.
                    if (editing && ti.cursorPos !== sel.caret) ti.cursorPos = sel.caret;

                    const disp = textFieldDisplay(val, ti.password, ti.placeholder, PASSWORD_CHAR);
                    const atlas = ensureMeasure().atlas;
                    const mw = (s: string): number => measureWidth(s, atlas, ti.fontFamily, ti.fontSize, 0);
                    const innerW = Math.max(0, w - 2 * ti.padding);
                    const vCenter = Math.max(0, (h - ti.fontSize) / 2);

                    // caret + a single highlight rect, placed the same way for both
                    // field kinds: single-line scrolls horizontally and centers
                    // vertically; multiline stacks lines from the top (no h-scroll)
                    // and positions the caret on its \n-broken line. A selection that
                    // spans multiple visual lines shows the caret only for now.
                    let caretX: number, caretTop: number, scrollX: number;
                    let sshow = false, sx = 0, stop = 0, sw = 0;
                    if (ti.multiline) {
                        const lineH = ti.fontSize * TEXT_INPUT_LINE_HEIGHT_RATIO;
                        scrollX = 0;
                        const lc = caretLineCol(val, sel.caret);
                        caretX = ti.padding + mw(val.slice(lc.lineStart, sel.caret));
                        caretTop = lc.line * lineH;
                        // Highlight a selection that stays on one visual line; a
                        // multi-line range shows the caret only for now.
                        const rows = sel.hasRange ? lineSelections(val, sel.lo, sel.hi) : [];
                        if (rows.length === 1) {
                            const line = splitLines(val)[rows[0].line];
                            sx = ti.padding + mw(line.text.slice(0, rows[0].from));
                            sw = mw(line.text.slice(rows[0].from, rows[0].to));
                            stop = rows[0].line * lineH;
                            sshow = true;
                        }
                    } else {
                        const caretRaw = mw(maskedPrefix(val, sel.caret, ti.password, PASSWORD_CHAR));
                        scrollX = Math.max(0, caretRaw - innerW);
                        caretX = ti.padding + caretRaw - scrollX;
                        caretTop = vCenter;
                        if (sel.hasRange) {
                            const lo = mw(maskedPrefix(val, sel.lo, ti.password, PASSWORD_CHAR));
                            sx = ti.padding + lo - scrollX;
                            sw = mw(maskedPrefix(val, sel.hi, ti.password, PASSWORD_CHAR)) - lo;
                            stop = vCenter;
                            sshow = true;
                        }
                    }
                    scrollXOf.set(entity, scrollX);

                    syncSelChild(ch.sel, ti, sshow, sx, stop, sw);
                    syncTextChild(ch.text, ti, disp, innerW, scrollX);
                    // The blinking caret hides while a highlight is drawn.
                    syncCaretChild(ch.caret, ti, caretX, caretTop, ti.focused && cursorVisible && !sshow);

                    // Anchor the IME at the caret. Not while composing — moving it
                    // mid-composition would yank an open candidate window.
                    if (editing && !composing) {
                        anchorCaret(entity, caretX, caretTop + ti.fontSize);
                    }
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

        function syncSelChild(selEntity: Entity, ti: TextInputData, show: boolean, x: number, top: number, width: number): void {
            const w = Math.max(0, width);
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
            // Multiline stacks lines from the top so caret line math lines up;
            // single-line centers the one line in the box.
            const vAlign = ti.multiline ? TextVerticalAlign.Top : TextVerticalAlign.Middle;
            if (t.content !== show || t.fontFamily !== ti.fontFamily || t.fontSize !== ti.fontSize
                || t.wordWrap !== ti.multiline || t.renderMode !== ti.renderMode || t.verticalAlign !== vAlign
                || t.color.r !== col.r || t.color.g !== col.g || t.color.b !== col.b || t.color.a !== col.a) {
                t.content = show;
                t.fontFamily = ti.fontFamily;
                t.fontSize = ti.fontSize;
                t.wordWrap = ti.multiline;
                t.verticalAlign = vAlign;
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

        function syncCaretChild(caretEntity: Entity, ti: TextInputData, caretX: number, caretTop: number, show: boolean): void {
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

export const textInputPlugin = new TextInputPlugin();
