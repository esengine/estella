// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { EditorHiddenEntities } from '../../camera/EditorView';
import type { Color, Entity } from '../../types';
import { defineSystem, Schedule } from '../../ecs/system';
import { registerComponent, RuntimeOnly } from '../../ecs/component';
import { TextInput, applyTextInputFilter, type TextInputData } from './text-input';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import type { UIVisualData } from '../core/ui-visual';
import { UIMask, MaskMode } from '../core/ui-mask';
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';
import { Interactable, UIInteraction, type UIInteractionData } from '../input/interactable';
import { UIControlPointers } from '../input/control-pointers';
import { Focusable, FocusManager, FocusManagerState, focusRevisionOf } from '../input/focusable';
import type { FocusableData } from '../input/focusable';
import { isFocusEligible } from '../input/focus-inspection';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { Transform, Sprite, type TransformData, type SpriteData } from '../../ecs/component';
import { ContentRect } from '../core/content-rect';
import { UIEvents, UIEventQueue, UIEventType, type UIEvent } from '../core/events';
import { Res } from '../../ecs/resource';
import { getDefaultContext } from '../../ecs/context';
import { playsInContext } from '../../ecs/env';
import { ensureComponent, getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { spawnUIEntity, identityTransform, buildText } from '../core/compose';
import { px } from '../core/dimension';
import { SdfTextRenderer } from './text-renderer';
import type { ESEngineModule } from '../../wasm';
import { measureWidth, measurePrefixWidths } from './layout';
import { resolveTextFamily } from './font-registry';
import {
    textFieldDisplay, maskedPrefix, fieldSelection, nearestCaretIndex,
    splitLines, caretLineCol, lineSelections, alignOffset,
    type TextFieldDisplay,
} from './text-input-view';
import { uiLayoutToScreen, uiPointerFor, isScreenEntity, uiLayoutRay, uiPointerRay } from '../util/ui-pick';
import { createLocalTransformReader } from '../util/local-transform';
import { isProjectable, projectCameraPoint } from '../util/math';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { platformCreateTextEditor } from '../../platform';
import { renderCanvasOf } from '../../app/surface';
import { framebufferToPointer } from '../../input/pointerProjection';
import type { TextEditorEvent } from '../../platform/types';
import { CURSOR_BLINK_INTERVAL, TEXT_INPUT_LINE_HEIGHT_RATIO } from '../util/constants';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import { log } from '../../util/logger';
import { Localization } from '../../i18n/Localization';
import { registerWorldSceneExportFilter } from '../../scene/worldHooks';

/** Masking bullet for password fields. */
const PASSWORD_CHAR = '●';

/** Selection-highlight fill (a translucent accent drawn behind the text). */
const SELECTION_COLOR = { r: 0.30, g: 0.55, b: 1.0, a: 0.35 };

interface FieldChildren {
    text: Entity;
    sel: Entity | null;
    caret: Entity | null;
    world: boolean;
    fillWrite?: number;
    maskWrite?: number;
}

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

        // The OS surface that holds the value + selection while a field is focused:
        // a hidden textarea on the web, the soft keyboard and its IME on a device.
        // Edit viewports and hosts without an editing surface still draw the committed value.
        const context = getDefaultContext();
        let playing = playsInContext(context);
        const createEditor = () => platformCreateTextEditor(renderCanvasOf(app));
        let editor = playing ? createEditor() : null;
        if (playing && !editor) {
            log.info('ui', 'TextInput: this realm has no text-editing surface — fields render, typing is off');
        }

        // Null on the native core, whose glyphs come from the platform rasterizer
        // rather than the wasm heap — the measurement atlas takes either.
        const module = app.wasmModule as ESEngineModule | null;

        const world = app.world;
        const localTransform = createLocalTransformReader(world);

        // The editable text renders through the shared SDF glyph
        // atlas — a child Text entity (drawn by textPlugin) + a child UIVisual
        // caret quad, composited over the entity's background UIVisual. No more
        // per-entity Canvas2D rasterization / texture upload. `measureRenderer`
        // owns an atlas used only to position the caret (measureWidth); its glyph
        // advances match the child Text's atlas (same font config).
        const childrenOf = new Map<Entity, FieldChildren>();
        let fieldLifetime: symbol | undefined;
        // A later authored write, even to the same value in the same frame, transfers ownership.
        // Only opt in to tracking a component when a field actually creates one.
        let fillChanged: ((entity: Entity, since: number) => boolean) | undefined;
        let maskChanged: ((entity: Entity, since: number) => boolean) | undefined;
        let releaseExportFilter: (() => void) | undefined;
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
            if (world.has(entity, UINode)) return { w: getUINodeWidth(entity, world), h: getUINodeHeight(entity, world), px: 0.5, py: 0.5, world: false };
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
        let editingFocusRevision = -1;
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
            return editingEntity !== null
                && editingFocusRevision === focusRevisionOf(app.getResource(FocusManager))
                && getFocusedTextInput() === editingEntity ? editingEntity : null;
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

        function onEditorEvent(event: TextEditorEvent): void {
            if (!playsInContext(context)) return;
            const focused = getEditingTextInput();
            if (focused === null) {
                // The surface still belongs to the old session. Retire its
                // preedit before the next focus tick can attach another field.
                detachEditor();
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
        }
        function subscribeSurface(): (() => void) | undefined {
            const surface = editor;
            return surface?.subscribe(event => {
                if (surface === editor) onEditorEvent(event);
            });
        }
        let unsubscribe = subscribeSurface();

        function syncRunMode(): void {
            const next = playsInContext(context);
            if (playing === next) return;
            playing = next;
            unsubscribe?.();
            const previous = editingEntity;
            detachEditor();
            if (previous !== null && app.getResource(FocusManager).focusedEntity === previous) {
                app.getResource(FocusManager).blur();
                if (world.valid(previous) && world.has(previous, Focusable)) {
                    world.update(previous, Focusable, focus => { focus.isFocused = false; });
                }
            }
            editor?.dispose();
            editor = playing ? createEditor() : null;
            unsubscribe = subscribeSurface();
            nativeEvents = [];
        }

        this.cleanupListeners_.set(app, () => {
            editingEntity = null;
            nativeEvents = [];
            unsubscribe?.();
            editor?.dispose();
            editor = null;
            localTransform.dispose();
            forgetRetiredFields();
            for (const [entity, ch] of childrenOf) releaseField(entity, ch);
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

        // Intersect the press ray with the field before applying the text's padding, alignment and scroll.
        function caretIndexFromPointer(entity: Entity): number | null {
            const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
            const overlay = app.getResource(ScreenOverlay) as ScreenOverlayData | undefined;
            if (!cam || !overlay) return null;
            const box = boxOf(entity);
            if (!world.has(entity, Transform) || !box || !(box.w > 0)) return null;
            const screen = isScreenEntity(world, entity);
            if (screen ? !overlay.active : !cam.valid) return null;
            let local;
            for (const press of app.getResource(UIControlPointers).pointers.values()) {
                if (press.pressedEntity !== entity) continue;
                const ray = screen ? uiLayoutRay(overlay, press.screenX, press.screenY) : uiPointerRay(cam, press.screenX, press.screenY);
                local = localTransform.rayPoint(entity, ray);
                break;
            }
            if (local === null) return null;
            let boxX: number, boxY: number;
            if (local) {
                boxX = box.px * box.w + local.x;
                boxY = (1 - box.py) * box.h - local.y;
            } else {
                const pointer = uiPointerFor(world, entity, cam, overlay);
                const frame = boxFrame(entity, box);
                boxX = (pointer.x - frame.left) / frame.sx;
                boxY = (frame.top - pointer.y) / frame.sy;
            }
            const ti = world.get(entity, TextInput) as TextInputData;
            const width = box.w;
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
                const lines = splitLines(val);
                const li = Math.max(0, Math.min(Math.floor(boxY / lineH), lines.length - 1));
                const line = lines[li];
                // Each line carries its own alignment offset, so undo THIS line's.
                const textX = boxX - ti.padding
                    - alignOffset(ti.textAlign, innerW, mw(line.text));
                const prefixes = measurePrefixWidths(line.text, atlas, family, ti.fontSize, 0);
                return line.start + nearestCaretIndex(prefixes, textX, line.text);
            }

            const scrollX = scrollXOf.get(entity) ?? 0;
            // The offset the render pass actually drew at, not one recomputed here:
            // a focused field's value can differ from what was last drawn, and a
            // guess about the offset lands the caret on the wrong glyph.
            const ao = alignOffsetOf.get(entity) ?? 0;
            const textX = boxX - ti.padding - ao + scrollX;
            const display = ti.password ? PASSWORD_CHAR.repeat(val.length) : val;
            const prefixes = measurePrefixWidths(display, atlas, family, ti.fontSize, 0);
            return nearestCaretIndex(prefixes, textX, val);
        }

        function activateEditor(entity: Entity): void {
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            composing = false;
            editingEntity = entity;
            editingFocusRevision = focusRevisionOf(app.getResource(FocusManager));
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
            if (!cam || !overlay) return;
            const box = boxOf(entity);
            if (!world.has(entity, Transform) || !box) return;
            const screen = isScreenEntity(world, entity);
            if (screen ? !overlay.active : !cam.valid) return;
            const point = localTransform.worldPoint(entity, caretX - box.px * box.w, (1 - box.py) * box.h - caretBottom);
            if (point === null) return;
            let position = point;
            if (position === undefined) {
                const tr = world.get(entity, Transform);
                const frame = boxFrame(entity, box);
                position = { x: frame.left + caretX * frame.sx, y: frame.top - caretBottom * frame.sy, z: tr.worldPosition.z };
            }
            // Forward through whichever projection actually drew the field.
            const projected = screen ? null : projectCameraPoint(cam, position.x, position.y, position.z);
            if (projected && !isProjectable(projected)) return;
            const scr = projected ?? uiLayoutToScreen(overlay, position.x, position.y);
            if (!Number.isFinite(scr.x) || !Number.isFinite(scr.y)) return;
            const css = framebufferToPointer(app, screen ? overlay.surfaceW : cam.screenW,
                screen ? overlay.surfaceH : cam.screenH, scr.x, scr.y);
            editor!.setCaretAnchor?.(css.x, css.y);
        }

        function resetCursorBlink(): void {
            cursorVisible = true;
            cursorTimer = 0;
        }

        // Native callbacks dispatch immediately. Restore their query records
        // after interaction drains the old frame, without replaying callbacks.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            if (!nativeEvents.length || !playsInContext(context)) return;
            const pending = nativeEvents;
            nativeEvents = [];
            const events = app.getResource(UIEvents) as UIEventQueue;
            for (const event of pending) {
                if (world.valid(event.target) && world.has(event.target, TextInput)) {
                    events.requeue(event);
                }
            }
        }, { name: 'TextInputEventSystem' }), { runAfter: [SystemLabel.UIInteraction] });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(FocusManager)],
            (focusManager: FocusManagerState) => {
                if (!editor) return;
                // Query the missing components so initialized fields stay out
                // of this pass until their component membership changes.
                for (const entity of world.getEntitiesWithComponents([TextInput], [], [Focusable])) {
                    ensureComponent(world, entity, Focusable, { tabIndex: 0, isFocused: false });
                }
                for (const entity of world.getEntitiesWithComponents([TextInput], [], [Interactable])) {
                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });
                }

                const currentFocused = getFocusedTextInput();

                const needsEditor = currentFocused !== null
                    && (editingFocusRevision !== focusRevisionOf(focusManager) || !world.get(currentFocused, TextInput).focused);
                if (currentFocused !== editingEntity || needsEditor) {
                    detachEditor();
                    if (currentFocused !== null) activateEditor(currentFocused);
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
                forgetRetiredFields();
                syncRunMode();
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
                        releaseField(e, ch);
                    }
                }

                const localization = playing && app.hasResource(Localization) ? app.getResource(Localization) : undefined;
                const hidden = playing ? null : app.getResource(EditorHiddenEntities);
                for (const entity of world.getEntitiesWithComponents([TextInput])) {
                    // The edit host projects authored renderers. This system owns the
                    // field's generated glyphs, fill and clip, in both layout domains.
                    const box = hidden?.has(entity) ? null : boxOf(entity);
                    if (!box || box.w <= 0 || box.h <= 0) {
                        const ch = childrenOf.get(entity);
                        if (ch) releaseField(entity, ch);
                        continue;
                    }
                    const w = box.w;
                    const h = box.h;

                    const ti = world.get(entity, TextInput) as TextInputData;
                    const ch = ensureChildren(entity, ti, box);
                    ensureBackground(entity, ti, ch);
                    // While focused, the editing surface is the single source of
                    // truth — caret moves, native shift/Ctrl-A selection, and the
                    // live IME preedit all land there — so a focused field renders
                    // the surface's value + selection; a blurred field renders its
                    // committed component value.
                    const editing = focused === entity;
                    const state = editing && editor ? editor.read() : null;
                    const val = state ? state.value : ti.value;
                    const len = val.length;
                    const sel = state
                        ? fieldSelection(state.selectionStart, state.selectionEnd, state.backward, len)
                        : { lo: 0, hi: 0, caret: Math.max(0, Math.min(ti.cursorPos, len)), hasRange: false };
                    // Keep the component caret in step so a blur/refocus restores it.
                    if (editing && ti.cursorPos !== sel.caret) {
                        world.update(entity, TextInput, (d) => { d.cursorPos = sel.caret; });
                    }

                    const disp = textFieldDisplay(val, ti.password, ti.placeholder, PASSWORD_CHAR, ti.placeholderI18nKey, localization);
                    const family = resolveTextFamily(ti.font, ti.fontFamily);
                    const mw = (s: string): number => s.length ? measureWidth(s, ensureMeasure().atlas, family, ti.fontSize, 0) : 0;
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
                        ao = ti.textAlign === TextAlign.Left ? 0 : alignOffset(ti.textAlign, innerW, mw(disp.text));
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

                    if (ch.sel !== null) syncSelChild(ch.sel, ti, box, sshow, sx, stop, sw);
                    syncTextChild(ch.text, ti, box, disp, innerW, scrollX, ao);
                    // The blinking caret hides while a highlight is drawn.
                    if (ch.caret !== null) syncCaretChild(ch.caret, ti, box, caretX, caretTop, editing && ti.focused && cursorVisible && !sshow);

                    // Anchor the IME at the caret. Not while composing — moving it
                    // mid-composition would yank an open candidate window.
                    if (editing && !composing) {
                        anchorCaret(entity, caretX, caretTop + ti.fontSize);
                    }
                }
            },
            { name: 'TextInputRenderSystem', runWhenPaused: true }
        ));

        function ensureBackground(entity: Entity, ti: TextInputData, ch: FieldChildren): void {
            // Clip the editable text + caret to the field box: a long value scrolls
            // horizontally past the edge and must not spill outside the input.
            if (!world.has(entity, UIMask)) {
                maskChanged ??= world.resolveChangeSequenceMatcher(UIMask, false);
                world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor });
                ch.maskWrite = world.getChangeSequence();
            }
            // A field standing in the world is drawn by the sprite its scene gave it: there is no background of the field's own to keep.
            if (ch.world) return;
            if (!world.has(entity, UIVisual)) {
                fillChanged ??= world.resolveChangeSequenceMatcher(UIVisual, false);
                world.insert(entity, UIVisual, {
                    visualType: UIVisualType.SolidColor, texture: 0,
                    color: { ...ti.backgroundColor },
                    uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
                    sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 },
                    fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true,
                });
                ch.fillWrite = world.getChangeSequence();
                return;
            }
            if (ch.fillWrite === undefined) return;
            if (fillChanged!(entity, ch.fillWrite)) {
                ch.fillWrite = undefined;
                return;
            }
            const bg = world.get(entity, UIVisual) as UIVisualData;
            // Only the field's own generated fill follows its backgroundColor.
            if (bg.visualType !== UIVisualType.SolidColor) return;
            const c = ti.backgroundColor;
            if (!bg.enabled
                || bg.color.r !== c.r || bg.color.g !== c.g || bg.color.b !== c.b || bg.color.a !== c.a) {
                bg.color = { ...c };
                bg.enabled = true;
                world.insert(entity, UIVisual, bg);
                ch.fillWrite = world.getChangeSequence();
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

        function despawnChildren(ch: FieldChildren): void {
            if (ch.sel !== null && world.valid(ch.sel)) world.despawn(ch.sel);
            if (world.valid(ch.text)) world.despawn(ch.text);
            if (ch.caret !== null && world.valid(ch.caret)) world.despawn(ch.caret);
        }

        function forgetRetiredFields(): void {
            if (!childrenOf.size || fieldLifetime === world.entityLifetime) return;
            // A replacement registry can reuse both parent and child handles for new authored entities.
            childrenOf.clear();
            releaseExportFilter?.();
            scrollXOf.clear();
            alignOffsetOf.clear();
            if (editingEntity !== null) {
                editingEntity = null;
                composing = false;
                editor?.blur();
            }
            nativeEvents = [];
        }

        function ownsVisual(entity: Entity, ch: FieldChildren): boolean {
            return ch.fillWrite !== undefined && !fillChanged!(entity, ch.fillWrite);
        }

        function ownsMask(entity: Entity, ch: FieldChildren): boolean {
            return ch.maskWrite !== undefined && !maskChanged!(entity, ch.maskWrite);
        }

        function exportFieldComponent(entity: Entity, component: string): false | void {
            if (component !== UIVisual._name && component !== UIMask._name) return;
            const ch = childrenOf.get(entity);
            if (!ch || fieldLifetime !== world.entityLifetime) return;
            if (component === UIVisual._name ? ownsVisual(entity, ch) : ownsMask(entity, ch)) return false;
        }

        function releaseField(entity: Entity, ch: FieldChildren): void {
            despawnChildren(ch);
            if (world.valid(entity)) {
                if (ownsVisual(entity, ch) && world.has(entity, UIVisual)) world.remove(entity, UIVisual);
                if (ownsMask(entity, ch) && world.has(entity, UIMask)) world.remove(entity, UIMask);
            }
            childrenOf.delete(entity);
            if (!childrenOf.size) releaseExportFilter?.();
            scrollXOf.delete(entity);
            alignOffsetOf.delete(entity);
        }

        function decoration(entity: Entity, ti: TextInputData, box: FieldBox, width: number, color: Color): Entity | null {
            if (!editor) return null;
            if (box.world) {
                const part = spawnWorldPart(entity);
                world.insert(part, Sprite, { layer: layerOf(entity), color: { ...color }, enabled: false });
                return part;
            }
            return spawnUIEntity({
                world, parent: entity,
                node: { position: UIPositionType.Absolute, width: px(width), height: px(ti.fontSize), insetLeft: px(ti.padding), insetTop: px(0) },
                visual: { visualType: UIVisualType.SolidColor, color: { ...color }, enabled: false },
            });
        }

        function ensureChildren(entity: Entity, ti: TextInputData, box: FieldBox): FieldChildren {
            const existing = childrenOf.get(entity);
            if (existing) {
                if (existing.world === box.world && (existing.caret !== null) === (editor !== null) && world.valid(existing.text)
                    && (existing.sel === null || world.valid(existing.sel)) && (existing.caret === null || world.valid(existing.caret))) return existing;
                releaseField(entity, existing);
            }
            // Spawn order is the tree-DFS render order: highlight (behind) < text < caret.
            const sel = decoration(entity, ti, box, 0, SELECTION_COLOR);
            let text: Entity;
            if (box.world) {
                text = spawnWorldPart(entity);
                world.insert(text, Text, buildText({
                    content: '', font: ti.font, fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                    align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                    renderMode: ti.renderMode, layer: layerOf(entity),
                }));
            } else {
                text = spawnUIEntity({
                    world, parent: entity,
                    // Left-anchored by insetLeft (scrolled by the render loop) with an
                    // explicit width — NOT insetRight — so a single-line value can slide
                    // under the Scissor mask instead of being pinned to the box.
                    node: { position: UIPositionType.Absolute, insetLeft: px(ti.padding), insetTop: px(0), insetBottom: px(0), width: px(0) },
                    text: {
                        content: '', font: ti.font, fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                        align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                        renderMode: ti.renderMode,
                    },
                });
            }
            const ch = { sel, text, caret: decoration(entity, ti, box, 2, ti.color), world: box.world };
            world.insert(ch.text, RuntimeOnly);
            if (ch.sel !== null) world.insert(ch.sel, RuntimeOnly);
            if (ch.caret !== null) world.insert(ch.caret, RuntimeOnly);
            if (!childrenOf.size) {
                fieldLifetime = world.entityLifetime;
                releaseExportFilter = registerWorldSceneExportFilter(world, exportFieldComponent);
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
