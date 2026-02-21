import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { RuntimeConfig } from '../defaults';
import { defineSystem, Schedule } from '../system';
import { registerComponent, Sprite, type SpriteData } from '../component';
import { TextInput, type TextInputData } from './TextInput';
import { UIRect, type UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { Focusable } from './Focusable';
import { FocusManager, FocusManagerState } from './Focusable';
import { UIEvents, UIEventQueue } from './UIEvents';
import { Res } from '../resource';
import { platformCreateCanvas } from '../platform';
import { ensureSprite, wrapText, nextPowerOf2, ensureComponent } from './uiHelpers';
import { CURSOR_BLINK_INTERVAL, TEXT_INPUT_LINE_HEIGHT_RATIO } from './uiConstants';

export class TextInputPlugin implements Plugin {
    private cleanupListeners_: (() => void) | null = null;

    cleanup(): void {
        if (this.cleanupListeners_) {
            this.cleanupListeners_();
            this.cleanupListeners_ = null;
        }
    }

    build(app: App): void {
        registerComponent('TextInput', TextInput);

        const module = app.wasmModule;
        if (!module) {
            console.warn('TextInputPlugin: No WASM module available');
            return;
        }

        const world = app.world;
        const textureCache = new Map<Entity, number>();
        const canvas = platformCreateCanvas(RuntimeConfig.textCanvasSize, 64);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })! as
            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
            const rm = module!.getResourceManager();
            for (const tex of textureCache.values()) {
                rm.releaseTexture(tex);
            }
            textureCache.clear();
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
        ), { runAfter: ['FocusSystem'] });

        // Render system
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
                        const ti = world.get(focused, TextInput) as TextInputData;
                        ti.dirty = true;
                    }
                }

                const rm = module!.getResourceManager();
                for (const [e, tex] of textureCache) {
                    if (!world.valid(e) || !world.has(e, TextInput)) {
                        rm.releaseTexture(tex);
                        textureCache.delete(e);
                    }
                }
                const entities = world.getEntitiesWithComponents([TextInput, UIRect]);

                for (const entity of entities) {
                    const ti = world.get(entity, TextInput) as TextInputData;
                    if (!ti.dirty) continue;

                    const uiRect = world.get(entity, UIRect) as UIRectData;
                    const w = Math.ceil(uiRect.size.x);
                    const h = Math.ceil(uiRect.size.y);
                    if (w <= 0 || h <= 0) continue;

                    ensureSprite(world, entity);

                    renderTextInput(entity, ti, w, h);
                    ti.dirty = false;
                }
            },
            { name: 'TextInputRenderSystem' }
        ));

        function renderTextInput(entity: Entity, ti: TextInputData, w: number, h: number): void {
            if (canvas.width < w || canvas.height < h) {
                canvas.width = nextPowerOf2(Math.max(canvas.width, w));
                canvas.height = nextPowerOf2(Math.max(canvas.height, h));
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const bg = ti.backgroundColor;
            ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
            ctx.fillRect(0, 0, w, h);

            ctx.save();
            ctx.beginPath();
            ctx.rect(ti.padding, 0, w - ti.padding * 2, h);
            ctx.clip();

            ctx.font = `${ti.fontSize}px ${ti.fontFamily}`;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';

            const isEmpty = ti.value.length === 0;
            const displayText = isEmpty
                ? ti.placeholder
                : ti.password
                    ? '\u25CF'.repeat(ti.value.length)
                    : ti.value;

            const textColor = isEmpty ? ti.placeholderColor : ti.color;
            ctx.fillStyle = `rgba(${Math.round(textColor.r * 255)}, ${Math.round(textColor.g * 255)}, ${Math.round(textColor.b * 255)}, ${textColor.a})`;

            const lineHeight = Math.ceil(ti.fontSize * TEXT_INPUT_LINE_HEIGHT_RATIO);
            const padding = ti.padding;

            if (ti.multiline) {
                const lines = wrapText(ctx, displayText, w - padding * 2);
                let y = padding;
                for (const line of lines) {
                    ctx.fillText(line, padding, y);
                    y += lineHeight;
                }
            } else {
                const textY = (h - ti.fontSize) / 2;
                ctx.fillText(displayText, padding, textY);
            }

            if (ti.focused && cursorVisible) {
                const cursorText = ti.password
                    ? '\u25CF'.repeat(ti.cursorPos)
                    : ti.value.substring(0, ti.cursorPos);

                let cursorX: number;
                let cursorY: number;
                let cursorH: number;

                if (ti.multiline) {
                    const lines = wrapText(ctx, ti.value, w - padding * 2);
                    let charCount = 0;
                    let cursorLine = 0;
                    let cursorCol = 0;
                    for (let i = 0; i < lines.length; i++) {
                        const lineLen = lines[i].length;
                        if (charCount + lineLen >= ti.cursorPos) {
                            cursorLine = i;
                            cursorCol = ti.cursorPos - charCount;
                            break;
                        }
                        charCount += lineLen;
                        if (i < lines.length - 1 && charCount < ti.value.length && ti.value[charCount] === '\n') {
                            charCount++;
                        }
                        cursorLine = i + 1;
                        cursorCol = 0;
                    }
                    const partialLine = cursorLine < lines.length ? lines[cursorLine].substring(0, cursorCol) : '';
                    cursorX = padding + ctx.measureText(partialLine).width;
                    cursorY = padding + cursorLine * lineHeight;
                    cursorH = lineHeight;
                } else {
                    cursorX = padding + ctx.measureText(cursorText).width;
                    cursorY = (h - ti.fontSize) / 2;
                    cursorH = ti.fontSize;
                }

                ctx.fillStyle = `rgba(${Math.round(ti.color.r * 255)}, ${Math.round(ti.color.g * 255)}, ${Math.round(ti.color.b * 255)}, ${ti.color.a})`;
                ctx.fillRect(cursorX, cursorY, 2, cursorH);
            }

            ctx.restore();

            const imageData = ctx.getImageData(0, 0, w, h);
            const pixels = new Uint8Array(imageData.data.buffer);
            const rm = module!.getResourceManager();
            const ptr = module!._malloc(pixels.length);
            module!.HEAPU8.set(pixels, ptr);

            const existingTex = textureCache.get(entity);
            if (existingTex !== undefined) {
                rm.releaseTexture(existingTex);
            }

            const textureHandle = rm.createTexture(w, h, ptr, pixels.length, 1, true);
            textureCache.set(entity, textureHandle);
            module!._free(ptr);

            const sprite = world.get(entity, Sprite) as SpriteData;
            sprite.texture = textureHandle;
            sprite.size.x = w;
            sprite.size.y = h;
            sprite.uvOffset.x = 0;
            sprite.uvOffset.y = 0;
            sprite.uvScale.x = 1;
            sprite.uvScale.y = 1;
            sprite.color = { r: 1, g: 1, b: 1, a: 1 };
            world.insert(entity, Sprite, sprite);
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
