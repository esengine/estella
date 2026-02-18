import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { RuntimeConfig } from '../defaults';
import { defineSystem, Schedule } from '../system';
import { registerComponent, Sprite, type SpriteData } from '../component';
import { TextInput, type TextInputData } from './TextInput';
import { UIRect, type UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { UIInteraction, type UIInteractionData } from './UIInteraction';
import { UIEvents, UIEventQueue } from './UIEvents';
import { Res } from '../resource';
import { platformCreateCanvas } from '../platform';
import { ensureSprite, wrapText, nextPowerOf2 } from './uiHelpers';

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

        let focusedEntity: Entity | null = null;
        let composing = false;
        let cursorVisible = true;
        let cursorTimer = 0;
        let lastTime = 0;

        const textareaOrNull = createHiddenTextarea();
        if (!textareaOrNull) {
            return;
        }
        const textarea = textareaOrNull;

        const onInput = () => {
            if (composing || focusedEntity === null) return;
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
            if (focusedEntity === null) return;

            if (e.key === 'Escape') {
                blurCurrent();
                return;
            }

            const ti = world.get(focusedEntity, TextInput) as TextInputData;
            if (e.key === 'Enter' && !ti.multiline) {
                e.preventDefault();
                const events = app.getResource(UIEvents) as UIEventQueue;
                events.emit(focusedEntity, 'submit');
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
            if (focusedEntity !== null && world.valid(focusedEntity) && world.has(focusedEntity, TextInput)) {
                const ti = world.get(focusedEntity, TextInput) as TextInputData;
                ti.focused = false;
                ti.dirty = true;
            }
            focusedEntity = null;
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
        };

        function syncFromTextarea(): void {
            if (focusedEntity === null || !world.valid(focusedEntity)) return;
            const ti = world.get(focusedEntity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            let val = textarea.value;
            if (ti.maxLength > 0 && val.length > ti.maxLength) {
                val = val.substring(0, ti.maxLength);
                textarea.value = val;
            }

            if (val !== ti.value) {
                ti.value = val;
                const events = app.getResource(UIEvents) as UIEventQueue;
                events.emit(focusedEntity, 'change');
            }
            ti.cursorPos = textarea.selectionStart ?? val.length;
            ti.dirty = true;
            resetCursorBlink();
        }

        function focusEntity(entity: Entity): void {
            if (focusedEntity === entity) return;
            blurCurrent();

            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.readOnly) return;

            focusedEntity = entity;
            ti.focused = true;
            ti.dirty = true;

            textarea.value = ti.value;
            textarea.selectionStart = ti.cursorPos;
            textarea.selectionEnd = ti.cursorPos;
            textarea.focus();
            resetCursorBlink();
        }

        function blurCurrent(): void {
            if (focusedEntity !== null && world.valid(focusedEntity) && world.has(focusedEntity, TextInput)) {
                const ti = world.get(focusedEntity, TextInput) as TextInputData;
                ti.focused = false;
                ti.dirty = true;
            }
            focusedEntity = null;
            textarea.blur();
        }

        function resetCursorBlink(): void {
            cursorVisible = true;
            cursorTimer = 0;
        }

        // Focus system
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UIEvents)],
            (events: UIEventQueue) => {
                const textInputEntities = world.getEntitiesWithComponents([TextInput, Interactable]);

                for (const entity of textInputEntities) {
                    if (!world.has(entity, UIInteraction)) continue;
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed) {
                        focusEntity(entity);
                        return;
                    }
                }

                if (focusedEntity !== null) {
                    const allInteractables = world.getEntitiesWithComponents([Interactable]);
                    for (const entity of allInteractables) {
                        if (world.has(entity, TextInput)) continue;
                        if (!world.has(entity, UIInteraction)) continue;
                        const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                        if (interaction.justPressed) {
                            blurCurrent();
                            return;
                        }
                    }
                }
            },
            { name: 'TextInputFocusSystem' }
        ));

        // Render system
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
                lastTime = now;

                if (focusedEntity !== null) {
                    cursorTimer += dt;
                    if (cursorTimer >= 0.5) {
                        cursorTimer -= 0.5;
                        cursorVisible = !cursorVisible;
                        if (focusedEntity !== null && world.valid(focusedEntity) && world.has(focusedEntity, TextInput)) {
                            const ti = world.get(focusedEntity, TextInput) as TextInputData;
                            ti.dirty = true;
                        }
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

            // Background
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

            const lineHeight = Math.ceil(ti.fontSize * 1.2);
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

            // Cursor
            if (ti.focused && cursorVisible) {
                const cursorText = ti.password
                    ? '\u25CF'.repeat(ti.cursorPos)
                    : ti.value.substring(0, ti.cursorPos);

                let cursorX: number;
                let cursorY: number;
                let cursorH: number;

                if (ti.multiline) {
                    const lines = wrapText(ctx, ti.value.substring(0, ti.cursorPos), w - padding * 2);
                    const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
                    cursorX = padding + ctx.measureText(lastLine).width;
                    cursorY = padding + (lines.length - 1) * lineHeight;
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

            // Upload texture
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
