// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import type { Entity } from '../../types';
import { defineSystem, Schedule } from '../../ecs/system';
import { registerComponent } from '../../ecs/component';
import { TextInput, applyTextInputFilter, type TextInputData } from './text-input';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import type { UIVisualData } from '../core/ui-visual';
import { UIMask, MaskMode } from '../core/ui-mask';
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';
import { Interactable, UIInteraction, type UIInteractionData } from '../input/interactable';
import { Focusable, FocusManager, FocusManagerState } from '../input/focusable';
import type { FocusableData } from '../input/focusable';
import { isFocusEligible } from '../input/focus-inspection';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { Transform, Sprite, type TransformData, type SpriteData } from '../../ecs/component';
import { ContentRect } from '../core/content-rect';
import { UIEvents, UIEventQueue, UIEventType, type UIEvent } from '../core/events';
import { Res } from '../../ecs/resource';
import { playModeOnly } from '../../ecs/env';
import { ensureComponent, getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { spawnUIEntity, identityTransform, buildText } from '../core/compose';
import { px } from '../core/dimension';
import { SdfTextRenderer } from './text-renderer';
import type { ESEngineModule } from '../../wasm';
import { measureWidth, measurePrefixWidths } from './layout';
import { resolveTextFamily } from './font-registry';
import {
    textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex,
    splitLines, caretLineCol, lineSelections, imeAnchorCss, alignOffset,
    type TextFieldDisplay,
} from './text-input-view';
import { uiWorldToScreen, uiLayoutToScreen, uiPointerFor, isScreenEntity } from '../util/ui-pick';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { platformCreateTextEditor, platformDevicePixelRatio } from '../../platform';
import { CURSOR_BLINK_INTERVAL, TEXT_INPUT_LINE_HEIGHT_RATIO } from '../util/constants';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import { log } from '../../util/logger';
import { Localization } from '../../i18n/Localization';

/** Masking bullet for password fields. */
const PASSWORD_CHAR = '●';

/** Selection-highlight fill (a translucent accent drawn behind the text). */
const SELECTION_COLOR = { r: 0.30, g: 0.55, b: 1.0, a: 0.35 };

export class TextInputPlugin implements Plugin {
    name = PluginName.TextInput;
    dependencies = [PluginName.Focus];

    private cleanupListeners_ = new Map<App, () => void>();

    cleanup(app?: App): void {
        if (app) {
            const cleanup = this.cleanupListeners_.get(app);
            this.cleanupListeners_.delete(app);
            cleanup?.();
        } else {
            const cleanups = [...this.cleanupListeners_.values()];
            this.cleanupListeners_.clear();
            for (const cleanup of cleanups) cleanup();
        }
    }

    build(app: App): void {
        this.cleanup(app);
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
        // And the alignment offset it drew at, for the same reason: a click in a
        // centred field lands on the glyph that is there, not on the one that
        // would have been there had the value been left-aligned.
        const alignOffsetOf = new Map<Entity, number>();
        let measureRenderer: SdfTextRenderer | null = null;
        const ensureMeasure = (): SdfTextRenderer => {
            if (!measureRenderer) measureRenderer = new SdfTextRenderer(module, { metricsOnly: true });
            return measureRenderer;
        };

        /**
         * The rectangle a field occupies, whichever kind of node it is on. A field laid out by the UI tree has a `UINode` (a CSS box centred on
         * its transform); one standing in the world — an imported scene's input, a hand-built HUD — has a `ContentRect`, a size and the point of
         * it the transform sits on. Everything below is written against this, so the editing, the caret, the selection and the click-to-caret
         * are one implementation for both.
         */
        interface FieldBox {
            w: number;
            h: number;
            /** Where the transform sits in the box, as a fraction from its left and from its bottom. */
            px: number;
            py: number;
            /** Laid out in world space (a `ContentRect`), not by the UI tree. */
            world: boolean;
        }
        function boxOf(entity: Entity): FieldBox | null {
            if (world.has(entity, UINode)) return { w: getUINodeWidth(entity), h: getUINodeHeight(entity), px: 0.5, py: 0.5, world: false };
            const rect = world.tryGet(entity, ContentRect);
            return rect ? { w: rect.size.x, h: rect.size.y, px: rect.pivot.x, py: rect.pivot.y, world: true } : null;
        }
        /** The box's left edge and top edge in the world, and the scale local units have there. */
        function boxFrame(entity: Entity, box: FieldBox): { left: number; top: number; sx: number; sy: number } {
            const tr = world.get(entity, Transform) as TransformData;
            const sx = box.world ? (tr.worldScale?.x || 1) : 1;
            const sy = box.world ? (tr.worldScale?.y || 1) : 1;
            return { left: tr.worldPosition.x - box.px * box.w * sx, top: tr.worldPosition.y + (1 - box.py) * box.h * sy, sx, sy };
        }

        let composing = false;
        let editingEntity: Entity | null = null;
        let nativeEvents: UIEvent[] = [];
        let cursorVisible = true;
        let cursorTimer = 0;
        let lastTime = 0;

        function getFocusedTextInput(): Entity | null {
            const fm = app.getResource(FocusManager) as FocusManagerState | null;
            if (!fm || fm.focusedEntity === null) return null;
            const entity = fm.focusedEntity;
            if (!world.valid(entity) || !world.has(entity, TextInput)) return null;
            if (world.get(entity, TextInput).readOnly) return null;
            return isFocusEligible(world, entity) ? entity : null;
        }

        function getEditingTextInput(): Entity | null {
            return editingEntity !== null && getFocusedTextInput() === editingEntity ? editingEntity : null;
        }

        function detachEditor(): void {
            const owner = editingEntity;
            editingEntity = null;
            composing = false;
            if (owner === null) return;
            if (world.valid(owner) && world.has(owner, TextInput) && world.get(owner, TextInput).focused) {
                world.update(owner, TextInput, ti => { ti.focused = false; });
            }
            editor!.blur();
        }

        const unsubscribe = editor.subscribe((event) => {
            const focused = getEditingTextInput();
            if (focused === null) {
                // A hidden field or an opened modal can invalidate the owner
                // between frames. Retire its preedit even if eligibility returns
                // before the next focus tick; never detach a newly assigned field.
                if (editingEntity !== null
                    && (app.getResource(FocusManager) as FocusManagerState).focusedEntity === editingEntity) {
                    detachEditor();
                }
                return;
            }
            switch (event.kind) {
                case 'change':
                    if (!composing && focused !== null) syncFromEditor();
                    break;
                case 'composition':
                    // The preedit sits in the surface's value with the caret after
                    // it, and the render loop reads that live — so nothing is copied
                    // here, and the commit at the end is what writes the field.
                    composing = event.composing;
                    if (!event.composing && focused !== null) syncFromEditor();
                    resetCursorBlink();
                    break;
                case 'submit':
                    if (focused !== null) {
                        nativeEvents.push((app.getResource(UIEvents) as UIEventQueue).emit(focused, 'submit'));
                        if (getEditingTextInput() === focused) blurCurrent();
                    }
                    break;
                case 'cancel':
                    if (focused !== null) blurCurrent();
                    break;
                case 'blur':
                    editingEntity = null;
                    composing = false;
                    if (focused !== null) {
                        world.update(focused, TextInput, (ti) => { ti.focused = false; });
                        (app.getResource(FocusManager) as FocusManagerState).blur();
                        // The manager only holds "who has focus"; the entity holds
                        // it too. Clearing one and not the other leaves a control
                        // that believes it is focused while nothing is.
                        if (world.valid(focused) && world.has(focused, Focusable)) {
                            const f = world.get(focused, Focusable) as FocusableData;
                            f.isFocused = false;
                            world.insert(focused, Focusable, f);
                            (app.getResource(UIEvents) as UIEventQueue).emit(focused, UIEventType.Blur);
                        }
                    }
                    break;
            }
        });

        this.cleanupListeners_.set(app, () => {
            editingEntity = null;
            nativeEvents = [];
            unsubscribe();
            editor.dispose();
            for (const ch of childrenOf.values()) {
                if (world.valid(ch.sel)) world.despawn(ch.sel);
                if (world.valid(ch.text)) world.despawn(ch.text);
                if (world.valid(ch.caret)) world.despawn(ch.caret);
            }
            childrenOf.clear();
            const renderer = measureRenderer;
            measureRenderer = null;
            renderer?.dispose();
        });

        function syncFromEditor(): void {
            const focused = getEditingTextInput();
            if (focused === null) return;
            const ti = world.get(focused, TextInput) as TextInputData;
            if (ti.readOnly) return;

            const state = editor!.read();
            let val = applyTextInputFilter(state.value, ti.inputFilter);
            if (val !== state.value) {
                // The caret stays after the same kept characters, where the removed ones were before it.
                const caret = applyTextInputFilter(state.value.slice(0, state.selectionStart), ti.inputFilter).length;
                const rest = { value: val, selectionStart: caret, selectionEnd: caret, backward: false };
                editor!.write(rest);
                state.value = val;
                state.selectionStart = caret;
                state.selectionEnd = caret;
            }
            if (ti.maxLength > 0 && val.length > ti.maxLength) {
                val = val.substring(0, ti.maxLength);
                // maxLength counts UTF-16 units, but a cut between a surrogate
                // pair must reject the whole character rather than store half.
                const tail = val.charCodeAt(val.length - 1);
                const next = state.value.charCodeAt(val.length);
                if (tail >= 0xd800 && tail <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
                    val = val.slice(0, -1);
                }
                editor!.write({ ...state, value: val, selectionStart: val.length, selectionEnd: val.length });
            }

            const valueChanged = val !== ti.value;
            world.update(focused, TextInput, (d) => {
                d.value = val;
                d.cursorPos = Math.min(state.selectionStart, val.length);
            });
            if (valueChanged) {
                nativeEvents.push((app.getResource(UIEvents) as UIEventQueue).emit(focused, 'change'));
            }
            resetCursorBlink();
        }

        // Map the current pointer to a caret index inside `entity`: pointer
        // world-x → the field's local text space (undo the box center, padding and
        // horizontal scroll) → nearest character boundary. Multiline also maps the
        // pointer world-y to a \n-broken line first. null when it can't be resolved
        // (no camera / no box).
        function caretIndexFromPointer(entity: Entity): number | null {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            const overlay = app.getResource(ScreenOverlay) as ScreenOverlayData | undefined;
            if (!cam || !overlay || (!cam.valid && !overlay.active)) return null;
            const box = boxOf(entity);
            if (!world.has(entity, Transform) || !box) return null;
            // The pointer in the FIELD's domain: every subtraction below is a
            // pointer minus a transform, and the two have to be in one space.
            const pointer = uiPointerFor(world, entity, cam, overlay);
            const ti = world.get(entity, TextInput) as TextInputData;
            const width = box.w;
            if (width <= 0) return null;
            // Left edge and top edge of the box in the world (y-up), and the scale between the world and the box's own units.
            const frame = boxFrame(entity, box);
            const fieldLeft = frame.left;
            const val = editor!.read().value;   // focused ⇒ the surface is the value source
            const atlas = ensureMeasure().atlas;
            // The family the child Text will actually rasterize with. The caret is
            // placed by measuring, so measuring with a different font than the one on
            // screen puts it between the wrong glyphs.
            const family = resolveTextFamily(ti.font, ti.fontFamily);
            const mw = (s: string): number => measureWidth(s, atlas, family, ti.fontSize, 0);

            const innerW = Math.max(0, width - 2 * ti.padding);

            if (ti.multiline) {
                const lineH = ti.fontSize * TEXT_INPUT_LINE_HEIGHT_RATIO;
                const localY = (frame.top - pointer.y) / frame.sy; // y-down from the box top
                const lines = splitLines(val);
                const li = Math.max(0, Math.min(Math.floor(localY / lineH), lines.length - 1));
                const line = lines[li];
                // Each line carries its own alignment offset, so undo THIS line's.
                const textX = (pointer.x - fieldLeft) / frame.sx - ti.padding
                    - alignOffset(ti.textAlign, innerW, mw(line.text));
                const prefixes = measurePrefixWidths(line.text, atlas, family, ti.fontSize, 0);
                return line.start + nearestCaretIndex(prefixes, textX, line.text);
            }

            const scrollX = scrollXOf.get(entity) ?? 0;
            // The offset the render pass actually drew at, not one recomputed here:
            // a focused field's value can differ from what was last drawn, and a
            // guess about the offset lands the caret on the wrong glyph.
            const ao = alignOffsetOf.get(entity) ?? 0;
            const textX = (pointer.x - fieldLeft) / frame.sx - ti.padding - ao + scrollX;
            const display = ti.password ? PASSWORD_CHAR.repeat(val.length) : val;
            const prefixes = measurePrefixWidths(display, atlas, family, ti.fontSize, 0);
            return nearestCaretIndex(prefixes, textX, val);
        }

        function activateEditor(entity: Entity): void {
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            composing = false;
            editingEntity = entity;
            world.update(entity, TextInput, (d) => { d.focused = true; });

            editor!.focus(
                { value: ti.value, selectionStart: ti.cursorPos, selectionEnd: ti.cursorPos, backward: false },
                { multiline: ti.multiline, maxLength: ti.maxLength, password: ti.password },
            );
            resetCursorBlink();
        }

        function blurCurrent(): void {
            const focused = getFocusedTextInput();
            if (focused !== null) {
                world.update(focused, TextInput, (ti) => { ti.focused = false; });
            }
            const fm = app.getResource(FocusManager) as FocusManagerState;
            fm.blur();
            // The field lost focus, so it says so, as a control does when a press elsewhere takes it.
            if (focused !== null && world.valid(focused) && world.has(focused, Focusable)) {
                const f = world.get(focused, Focusable) as FocusableData;
                f.isFocused = false;
                world.insert(focused, Focusable, f);
                (app.getResource(UIEvents) as UIEventQueue).emit(focused, UIEventType.Blur);
            }
            editingEntity = null;
            composing = false;
            editor!.blur();
        }

        /** Put the surface's caret anchor at the caret's on-screen position, so the
         *  OS IME pops its candidate window just under the text being typed rather
         *  than in a screen corner. `caretBottom` is the caret's bottom edge in
         *  field-local px (y-down from the box top). */
        function anchorCaret(entity: Entity, caretX: number, caretBottom: number): void {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            const overlay = app.getResource(ScreenOverlay) as ScreenOverlayData | undefined;
            if (!cam || !overlay || (!cam.valid && !overlay.active)) return;
            const box = boxOf(entity);
            if (!world.has(entity, Transform) || !box) return;
            const screen = isScreenEntity(world, entity);
            const frame = boxFrame(entity, box);
            const worldX = frame.left + caretX * frame.sx;
            const worldY = frame.top - caretBottom * frame.sy; // world y-up
            // Forward through whichever projection actually drew the field.
            const scr = screen
                ? uiLayoutToScreen(overlay, worldX, worldY)
                : uiWorldToScreen(cam, worldX, worldY);
            const surfaceH = screen ? overlay.surfaceH : cam.screenH;
            const css = imeAnchorCss(scr.x, scr.y, surfaceH, platformDevicePixelRatio());
            editor!.setCaretAnchor?.(css.left, css.top);
        }

        function resetCursorBlink(): void {
            cursorVisible = true;
            cursorTimer = 0;
        }

        // Native callbacks dispatch immediately. Restore their query records
        // after interaction drains the old frame, without replaying callbacks.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            if (nativeEvents.length === 0) return;
            const pending = nativeEvents;
            nativeEvents = [];
            const events = app.getResource(UIEvents) as UIEventQueue;
            for (const event of pending) {
                if (world.valid(event.target) && world.has(event.target, TextInput)) {
                    events.requeue(event);
                }
            }
        }, { name: 'TextInputEventSystem' }), { runAfter: [SystemLabel.UIInteraction] });

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

                // `prevFocusedTextInput` shadows the focus manager, and the OS
                // editing surface can blur out from under both of them — the
                // browser moving DOM focus, a click that leaves the canvas — by
                // writing straight to the manager, which this system never sees.
                // Land that after this system has run for the frame and the shadow
                // still names the field, so clicking THE SAME FIELD again read as
                // "no change" and the editor was never re-attached: the field took
                // focus, showed no caret, and swallowed every keystroke. Only
                // clicking a different field first got it back.
                //
                // So the field's own `focused` flag decides whether its editor is
                // live, and a focused field that says it has none gets one. One
                // fact, asked of the thing that holds it, instead of a copy that
                // can go stale.
                const missingEditor = currentFocused !== null
                    && !(world.get(currentFocused, TextInput) as TextInputData).focused;

                if (currentFocused !== prevFocusedTextInput || missingEditor) {
                    // Only a field that really lost focus is blurred. Re-attaching
                    // an editor to the field that already has focus must not blur
                    // the surface on its way in.
                    if (prevFocusedTextInput !== null && prevFocusedTextInput !== currentFocused) {
                        if (world.valid(prevFocusedTextInput) && world.has(prevFocusedTextInput, TextInput)) {
                            world.update(prevFocusedTextInput, TextInput, (ti) => { ti.focused = false; });
                        }
                        detachEditor();
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
                            world.update(currentFocused, TextInput, (ti) => { ti.cursorPos = idx; });
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

                const focused = getEditingTextInput();
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
                        scrollXOf.delete(e);
                        alignOffsetOf.delete(e);
                    }
                }

                for (const entity of world.getEntitiesWithComponents([TextInput])) {
                    const ti = world.get(entity, TextInput) as TextInputData;
                    const box = boxOf(entity);
                    if (!box || box.w <= 0 || box.h <= 0) continue;
                    const w = box.w;
                    const h = box.h;

                    ensureBackground(entity, ti, box);
                    const ch = ensureChildren(entity, ti, box);
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
                    if (editing && ti.cursorPos !== sel.caret) {
                        world.update(entity, TextInput, (d) => { d.cursorPos = sel.caret; });
                    }

                    const disp = textFieldDisplay(val, ti.password, ti.placeholder, PASSWORD_CHAR,
                        ti.placeholderI18nKey, app.hasResource(Localization) ? app.getResource(Localization) : undefined);
                    const atlas = ensureMeasure().atlas;
                    const family = resolveTextFamily(ti.font, ti.fontFamily);
                    const mw = (s: string): number => measureWidth(s, atlas, family, ti.fontSize, 0);
                    const innerW = Math.max(0, w - 2 * ti.padding);
                    const vCenter = Math.max(0, (h - ti.fontSize) / 2);

                    // caret + a single highlight rect, placed the same way for both
                    // field kinds: single-line scrolls horizontally and centers
                    // vertically; multiline stacks lines from the top (no h-scroll)
                    // and positions the caret on its \n-broken line. A selection that
                    // spans multiple visual lines shows the caret only for now.
                    let caretX: number, caretTop: number, scrollX: number, ao: number;
                    let sshow = false, sx = 0, stop = 0, sw = 0;
                    if (ti.multiline) {
                        const lineH = ti.fontSize * TEXT_INPUT_LINE_HEIGHT_RATIO;
                        scrollX = 0;
                        // Every line aligns in the box on its own, so the child Text
                        // does it and there is nothing to shift the whole block by.
                        // The caret follows its own line's offset.
                        ao = 0;
                        const lc = caretLineCol(val, sel.caret);
                        const lineOf = (i: number): string => splitLines(val)[i]?.text ?? '';
                        const lineAo = (i: number): number => alignOffset(ti.textAlign, innerW, mw(lineOf(i)));
                        caretX = ti.padding + lineAo(lc.line) + mw(val.slice(lc.lineStart, sel.caret));
                        caretTop = lc.line * lineH;
                        // Highlight a selection that stays on one visual line; a
                        // multi-line range shows the caret only for now.
                        const rows = sel.hasRange ? lineSelections(val, sel.lo, sel.hi) : [];
                        if (rows.length === 1) {
                            const line = splitLines(val)[rows[0].line];
                            sx = ti.padding + lineAo(rows[0].line) + mw(line.text.slice(0, rows[0].from));
                            sw = mw(line.text.slice(rows[0].from, rows[0].to));
                            stop = rows[0].line * lineH;
                            sshow = true;
                        }
                    } else {
                        const caretRaw = mw(maskedPrefix(val, sel.caret, ti.password, PASSWORD_CHAR));
                        scrollX = Math.max(0, caretRaw - innerW);
                        ao = alignOffset(ti.textAlign, innerW, mw(disp.text));
                        caretX = ti.padding + ao + caretRaw - scrollX;
                        caretTop = vCenter;
                        if (sel.hasRange) {
                            const lo = mw(maskedPrefix(val, sel.lo, ti.password, PASSWORD_CHAR));
                            sx = ti.padding + ao + lo - scrollX;
                            sw = mw(maskedPrefix(val, sel.hi, ti.password, PASSWORD_CHAR)) - lo;
                            stop = vCenter;
                            sshow = true;
                        }
                    }
                    scrollXOf.set(entity, scrollX);
                    alignOffsetOf.set(entity, ao);

                    syncSelChild(ch.sel, ti, box, sshow, sx, stop, sw);
                    syncTextChild(ch.text, ti, box, disp, innerW, scrollX, ao);
                    // The blinking caret hides while a highlight is drawn.
                    syncCaretChild(ch.caret, ti, box, caretX, caretTop, editing && ti.focused && cursorVisible && !sshow);

                    // Anchor the IME at the caret. Not while composing — moving it
                    // mid-composition would yank an open candidate window.
                    if (editing && !composing) {
                        anchorCaret(entity, caretX, caretTop + ti.fontSize);
                    }
                }
            },
            { name: 'TextInputRenderSystem' }
        ));

        function ensureBackground(entity: Entity, ti: TextInputData, box: FieldBox): void {
            // Clip the editable text + caret to the field box: a long value scrolls
            // horizontally past the edge and must not spill outside the input.
            if (!world.has(entity, UIMask)) {
                world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor });
            }
            // A field standing in the world is drawn by the sprite its scene gave it: there is no background of the field's own to keep.
            if (box.world) return;
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
            // A visual that is not a plain fill was put there on purpose — the
            // 9-sliced frame every skinned input field in every UI pack is drawn
            // with. `backgroundColor` is the fallback for a field nobody skinned,
            // so it stops at the fill it owns instead of flattening the art every
            // frame. A field authored with a frame keeps its frame.
            if (bg.visualType !== UIVisualType.SolidColor) return;
            const c = ti.backgroundColor;
            if (!bg.enabled
                || bg.color.r !== c.r || bg.color.g !== c.g || bg.color.b !== c.b || bg.color.a !== c.a) {
                bg.color = { ...c };
                bg.enabled = true;
                world.insert(entity, UIVisual, bg);
            }
        }

        /** The sorting layer a world field draws on, so what it adds sorts with it (a tree-ordered layer stacks the children in place). */
        function layerOf(entity: Entity): number {
            return world.tryGet(entity, Sprite)?.layer ?? world.tryGet(entity, Text)?.layer ?? 0;
        }

        /** A world entity under @p parent with a top-left-anchored rectangle, which is how the field's parts are placed from its top-left. */
        function spawnWorldPart(parent: Entity): Entity {
            const e = world.spawn();
            world.insert(e, Transform, identityTransform());
            world.insert(e, ContentRect, { size: { x: 0, y: 0 }, pivot: { x: 0, y: 1 } });
            world.setParent(e, parent);
            return e;
        }

        function ensureChildren(entity: Entity, ti: TextInputData, box: FieldBox): { sel: Entity; text: Entity; caret: Entity } {
            const existing = childrenOf.get(entity);
            if (existing && world.valid(existing.sel) && world.valid(existing.text) && world.valid(existing.caret)) return existing;
            // Spawn order is the tree-DFS render order: highlight (behind) < text < caret.
            let ch: { sel: Entity; text: Entity; caret: Entity };
            if (box.world) {
                const layer = layerOf(entity);
                const sel = spawnWorldPart(entity);
                world.insert(sel, Sprite, { layer, color: { ...SELECTION_COLOR }, enabled: false } as Partial<SpriteData> as SpriteData);
                const text = spawnWorldPart(entity);
                world.insert(text, Text, buildText({
                    content: '', font: ti.font, fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                    align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                    renderMode: ti.renderMode, layer,
                }));
                const caret = spawnWorldPart(entity);
                world.insert(caret, Sprite, { layer, color: { ...ti.color }, enabled: false } as Partial<SpriteData> as SpriteData);
                ch = { sel, text, caret };
            } else {
                const pad = px(ti.padding);
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
                        content: '', font: ti.font, fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                        align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                        renderMode: ti.renderMode,
                    },
                });
                const caret = spawnUIEntity({
                    world, parent: entity,
                    node: { position: UIPositionType.Absolute, width: px(2), height: px(ti.fontSize), insetLeft: px(ti.padding), insetTop: px(0) },
                    visual: { visualType: UIVisualType.SolidColor, color: ti.color, enabled: false },
                });
                ch = { sel, text, caret };
            }
            childrenOf.set(entity, ch);
            return ch;
        }

        /**
         * Put a part of the field at (@p left, @p top) from the box's top-left, @p width by @p height. A UI field's parts are absolutely
         * positioned UI nodes; a world field's are top-left-anchored rectangles placed by their transform from the field's own origin.
         */
        function placePart(part: Entity, box: FieldBox, left: number, top: number, width: number, height: number | null): void {
            if (!box.world) {
                const node = world.get(part, UINode) as UINodeData;
                // `height` null: the node is sized by its insets (the text spans top to bottom) and keeps what it has.
                if (node.insetLeft.value !== left || node.insetTop.value !== top || node.width.value !== width || (height !== null && node.height.value !== height)) {
                    node.insetLeft = px(left);
                    node.insetTop = px(top);
                    node.width = px(width);
                    if (height !== null) node.height = px(height);
                    world.insert(part, UINode, node);
                }
                return;
            }
            const worldHeight = height ?? box.h;
            const x = -box.px * box.w + left;
            const y = (1 - box.py) * box.h - top;
            const tr = world.get(part, Transform) as TransformData;
            if (tr.position.x !== x || tr.position.y !== y) {
                tr.position = { x, y, z: 0 };
                world.insert(part, Transform, tr);
            }
            const rect = world.get(part, ContentRect);
            if (rect.size.x !== width || rect.size.y !== worldHeight) world.insert(part, ContentRect, { ...rect, size: { x: width, y: worldHeight } });
        }

        /** Show or hide a solid-colour part (the highlight, the caret) and give it its colour. */
        function paintPart(part: Entity, box: FieldBox, on: boolean, color: { r: number; g: number; b: number; a: number }, withColor: boolean): void {
            if (!box.world) {
                const v = world.get(part, UIVisual) as UIVisualData;
                if (v.enabled !== on || (withColor && (v.color.r !== color.r || v.color.g !== color.g || v.color.b !== color.b))) {
                    v.enabled = on;
                    if (withColor) v.color = { ...color };
                    world.insert(part, UIVisual, v);
                }
                return;
            }
            const sp = world.get(part, Sprite) as SpriteData;
            if (sp.enabled !== on || (withColor && (sp.color.r !== color.r || sp.color.g !== color.g || sp.color.b !== color.b))) {
                world.insert(part, Sprite, { ...sp, enabled: on, ...(withColor ? { color: { ...color } } : {}) });
            }
        }

        function syncSelChild(selEntity: Entity, ti: TextInputData, box: FieldBox, show: boolean, x: number, top: number, width: number): void {
            const w = Math.max(0, width);
            placePart(selEntity, box, x, top, w, ti.fontSize);
            paintPart(selEntity, box, show && w > 0, SELECTION_COLOR, false);
        }

        function syncTextChild(textEntity: Entity, ti: TextInputData, box: FieldBox, disp: TextFieldDisplay, innerW: number, scrollX: number, ao: number): void {
            const t = world.get(textEntity, Text) as TextData;
            const show = disp.text;
            const col = disp.isPlaceholder ? ti.placeholderColor : ti.color;
            // Multiline stacks lines from the top so caret line math lines up;
            // single-line centers the one line in the box.
            const vAlign = ti.multiline ? TextVerticalAlign.Top : TextVerticalAlign.Middle;
            // Multiline aligns per line, which only the text layout can do, so it
            // owns the alignment there. A single line is aligned by the offset the
            // caret and the hit-test share, so its box stays Left.
            const hAlign = ti.multiline ? ti.textAlign : TextAlign.Left;
            if (t.content !== show || t.font !== ti.font || t.fontFamily !== ti.fontFamily || t.fontSize !== ti.fontSize
                || t.wordWrap !== ti.multiline || t.renderMode !== ti.renderMode || t.verticalAlign !== vAlign
                || t.align !== hAlign
                || t.color.r !== col.r || t.color.g !== col.g || t.color.b !== col.b || t.color.a !== col.a) {
                t.content = show;
                t.font = ti.font;
                t.fontFamily = ti.fontFamily;
                t.fontSize = ti.fontSize;
                t.wordWrap = ti.multiline;
                t.verticalAlign = vAlign;
                t.align = hAlign;
                t.renderMode = ti.renderMode;
                t.color = { ...col };
                world.insert(textEntity, Text, t);
            }
            // Slide the text box by the alignment offset and the scroll; width = the
            // inner box (a single line overflows it rightward and the Scissor mask
            // clips). A UI node takes its height from its insets, a world rectangle needs it said.
            placePart(textEntity, box, ti.padding + ao - scrollX, 0, innerW, null);
        }

        function syncCaretChild(caretEntity: Entity, ti: TextInputData, box: FieldBox, caretX: number, caretTop: number, show: boolean): void {
            placePart(caretEntity, box, caretX, caretTop, 2, ti.fontSize);
            paintPart(caretEntity, box, show, ti.color, true);
        }
    }
}

export const textInputPlugin = new TextInputPlugin();
