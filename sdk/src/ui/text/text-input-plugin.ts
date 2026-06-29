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
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';
import { Interactable } from '../input/interactable';
import { Focusable, FocusManager, FocusManagerState } from '../input/focusable';
import { UIEvents, UIEventQueue } from '../core/events';
import { Res } from '../../resource';
import { playModeOnly } from '../../env';
import { ensureComponent, getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { spawnUIEntity } from '../widgets/helpers';
import { px } from '../core/dimension';
import { SdfTextRenderer } from './text-renderer';
import { measureWidth } from './layout';
import { CURSOR_BLINK_INTERVAL } from '../util/constants';
import { SystemLabel, PluginName } from '../../systemLabels';
import { log } from '../../logger';

/** Masking bullet for password fields. */
const PASSWORD_CHAR = '●';

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
        const childrenOf = new Map<Entity, { text: Entity; caret: Entity }>();
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

            let newPos = ti.cursorPos;
            if (e.key === 'ArrowLeft') {
                newPos = Math.max(0, ti.cursorPos - 1);
            } else if (e.key === 'ArrowRight') {
                newPos = Math.min(ti.value.length, ti.cursorPos + 1);
            } else if (e.key === 'Home') {
                newPos = 0;
            } else if (e.key === 'End') {
                newPos = ti.value.length;
            }

            if (newPos !== ti.cursorPos) {
                ti.cursorPos = newPos;
                textarea.selectionStart = newPos;
                textarea.selectionEnd = newPos;
                ti.dirty = true;
                resetCursorBlink();
            }
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
        textarea.addEventListener('compositionend', onCompositionEnd);
        textarea.addEventListener('keydown', onKeyDown);
        textarea.addEventListener('blur', onBlur);

        this.cleanupListeners_ = () => {
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('compositionstart', onCompositionStart);
            textarea.removeEventListener('compositionend', onCompositionEnd);
            textarea.removeEventListener('keydown', onKeyDown);
            textarea.removeEventListener('blur', onBlur);
            textarea.remove();
            for (const ch of childrenOf.values()) {
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
                        if (world.valid(ch.text)) world.despawn(ch.text);
                        if (world.valid(ch.caret)) world.despawn(ch.caret);
                        childrenOf.delete(e);
                    }
                }

                for (const entity of world.getEntitiesWithComponents([TextInput, UINode])) {
                    const ti = world.get(entity, TextInput) as TextInputData;
                    const h = getUINodeHeight(entity);
                    if (getUINodeWidth(entity) <= 0 || h <= 0) continue;

                    ensureBackground(entity, ti);
                    const ch = ensureChildren(entity, ti);
                    syncTextChild(ch.text, ti);
                    syncCaretChild(ch.caret, ti, h);
                }
            },
            { name: 'TextInputRenderSystem' }
        ));

        /** Visible string: placeholder when empty, bullets when password. */
        const displayString = (ti: TextInputData): string =>
            ti.value.length === 0 ? ti.placeholder
                : ti.password ? PASSWORD_CHAR.repeat(ti.value.length)
                    : ti.value;

        function ensureBackground(entity: Entity, ti: TextInputData): void {
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

        function ensureChildren(entity: Entity, ti: TextInputData): { text: Entity; caret: Entity } {
            const existing = childrenOf.get(entity);
            if (existing && world.valid(existing.text) && world.valid(existing.caret)) return existing;
            const pad = px(ti.padding);
            const text = spawnUIEntity({
                world, parent: entity,
                node: { position: UIPositionType.Absolute, insetLeft: pad, insetTop: px(0), insetRight: pad, insetBottom: px(0) },
                text: {
                    content: '', fontFamily: ti.fontFamily, fontSize: ti.fontSize,
                    align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: ti.multiline,
                },
            });
            const caret = spawnUIEntity({
                world, parent: entity,
                node: { position: UIPositionType.Absolute, width: px(2), height: px(ti.fontSize), insetLeft: px(ti.padding), insetTop: px(0) },
                visual: { visualType: UIVisualType.SolidColor, color: ti.color, enabled: false },
            });
            const ch = { text, caret };
            childrenOf.set(entity, ch);
            return ch;
        }

        function syncTextChild(textEntity: Entity, ti: TextInputData): void {
            const t = world.get(textEntity, Text) as TextData;
            const show = displayString(ti);
            const col = ti.value.length === 0 ? ti.placeholderColor : ti.color;
            if (t.content !== show || t.fontFamily !== ti.fontFamily || t.fontSize !== ti.fontSize
                || t.wordWrap !== ti.multiline
                || t.color.r !== col.r || t.color.g !== col.g || t.color.b !== col.b || t.color.a !== col.a) {
                t.content = show;
                t.fontFamily = ti.fontFamily;
                t.fontSize = ti.fontSize;
                t.wordWrap = ti.multiline;
                t.color = { ...col };
                world.insert(textEntity, Text, t);
            }
        }

        function syncCaretChild(caretEntity: Entity, ti: TextInputData, boxH: number): void {
            const cursorText = ti.password
                ? PASSWORD_CHAR.repeat(ti.cursorPos)
                : ti.value.substring(0, ti.cursorPos);
            const caretX = ti.padding + measureWidth(cursorText, ensureMeasure().atlas, ti.fontFamily, ti.fontSize, 0);
            const caretTop = Math.max(0, (boxH - ti.fontSize) / 2);
            const node = world.get(caretEntity, UINode) as UINodeData;
            if (node.insetLeft.value !== caretX || node.insetTop.value !== caretTop || node.height.value !== ti.fontSize) {
                node.insetLeft = px(caretX);
                node.insetTop = px(caretTop);
                node.height = px(ti.fontSize);
                world.insert(caretEntity, UINode, node);
            }
            const v = world.get(caretEntity, UIVisual) as UIVisualData;
            const show = ti.focused && cursorVisible;
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
