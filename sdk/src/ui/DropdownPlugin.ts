import type { App, Plugin } from '../app';
import { registerComponent, Transform, Name, Sprite } from '../component';
import type { SpriteData, TransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import type { Entity } from '../types';
import { Dropdown } from './Dropdown';
import type { DropdownData } from './Dropdown';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UIEvents, UIEventQueue } from './UIEvents';
import { Text, TextAlign, TextVerticalAlign, TextOverflow } from './text';
import type { TextData } from './text';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Input } from '../input';
import type { InputState } from '../input';
import { isEditor, isPlayMode } from '../env';
import { INVALID_TEXTURE } from '../types';
import { ensureComponent } from './uiHelpers';
import { DROPDOWN_ITEM_HEIGHT, DROPDOWN_FONT_SIZE, DROPDOWN_HIGHLIGHT_COLOR } from './uiConstants';

interface DropdownState {
    optionEntities: Entity[];
    textEntities: Entity[];
    highlightIndex: number;
    ddWidth: number;
    ddLayer: number;
}

export class DropdownPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Dropdown', Dropdown);

        const world = app.world;
        const dropdownStates = new Map<Entity, DropdownState>();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents)],
            (input: InputState, events: UIEventQueue) => {
                for (const [e] of dropdownStates) {
                    if (!world.valid(e)) dropdownStates.delete(e);
                }

                const editorSceneView = isEditor() && !isPlayMode();
                const entities = world.getEntitiesWithComponents([Dropdown]);
                for (const entity of entities) {
                    const dropdown = world.get(entity, Dropdown) as DropdownData;

                    let state = dropdownStates.get(entity);
                    if (!state) {
                        state = { optionEntities: [], textEntities: [], highlightIndex: -1, ddWidth: 0, ddLayer: 0 };
                        dropdownStates.set(entity, state);
                        normalizeListTransform(dropdown.listEntity);
                        if (!dropdown.isOpen) {
                            setListVisible(dropdown.listEntity, false);
                        }
                        initDropdownAppearance(entity);
                    }

                    if (editorSceneView) continue;

                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });

                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.justPressed) {
                        if (dropdown.isOpen) {
                            closeDropdown(entity, dropdown, state);
                        } else {
                            openDropdown(entity, dropdown, state);
                        }
                    }

                    if (dropdown.isOpen) {
                        for (let i = 0; i < state.optionEntities.length; i++) {
                            const optEntity = state.optionEntities[i];
                            if (!world.valid(optEntity) || !world.has(optEntity, UIInteraction)) continue;
                            const optInteraction = world.get(optEntity, UIInteraction) as UIInteractionData;
                            if (optInteraction.justPressed) {
                                selectOption(entity, dropdown, state, i, events);
                                break;
                            }
                        }

                        let hoveredIndex = -1;
                        for (let i = 0; i < state.optionEntities.length; i++) {
                            const optEntity = state.optionEntities[i];
                            if (!world.valid(optEntity) || !world.has(optEntity, UIInteraction)) continue;
                            const optInteraction = world.get(optEntity, UIInteraction) as UIInteractionData;
                            if (optInteraction.hovered) {
                                hoveredIndex = i;
                                break;
                            }
                        }
                        if (hoveredIndex >= 0 && hoveredIndex !== state.highlightIndex) {
                            state.highlightIndex = hoveredIndex;
                            updateHighlight(state);
                        }

                        if (input.isKeyPressed('ArrowDown')) {
                            if (state.highlightIndex >= dropdown.options.length - 1) {
                                state.highlightIndex = 0;
                            } else {
                                state.highlightIndex++;
                            }
                            updateHighlight(state);
                        } else if (input.isKeyPressed('ArrowUp')) {
                            if (state.highlightIndex <= 0) {
                                state.highlightIndex = dropdown.options.length - 1;
                            } else {
                                state.highlightIndex--;
                            }
                            updateHighlight(state);
                        } else if (input.isKeyPressed('Enter') && state.highlightIndex >= 0) {
                            selectOption(entity, dropdown, state, state.highlightIndex, events);
                        } else if (input.isKeyPressed('Escape')) {
                            closeDropdown(entity, dropdown, state);
                        }

                        if (input.isMouseButtonPressed(0)) {
                            if (!interaction?.hovered && !isAnyOptionHovered(state)) {
                                closeDropdown(entity, dropdown, state);
                            }
                        }
                    }

                    syncLabel(dropdown);
                }
            },
            { name: 'DropdownSystem' }
        ), { runAfter: ['UIInteractionSystem'] });

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => {
                for (const [entity, state] of dropdownStates) {
                    if (!world.valid(entity)) continue;
                    const dropdown = world.get(entity, Dropdown) as DropdownData;
                    if (!dropdown.isOpen) continue;

                    const textLayer = state.ddLayer + 3;
                    for (const te of state.textEntities) {
                        if (!world.valid(te) || !world.has(te, Sprite)) continue;
                        const s = world.get(te, Sprite) as SpriteData;
                        if (s.layer !== textLayer) {
                            world.insert(te, Sprite, {
                                texture: s.texture,
                                color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
                                size: { x: s.size.x, y: s.size.y },
                                uvOffset: { x: s.uvOffset.x, y: s.uvOffset.y },
                                uvScale: { x: s.uvScale.x, y: s.uvScale.y },
                                layer: textLayer,
                                flipX: s.flipX,
                                flipY: s.flipY,
                                material: s.material,
                                enabled: s.enabled,
                            });
                        }
                    }
                }
            },
            { name: 'DropdownPostSystem' }
        ), { runAfter: ['UIRenderOrderSystem'] });

        function normalizeListTransform(listEntity: Entity): void {
            if (listEntity === 0 || !world.valid(listEntity)) return;
            if (!world.has(listEntity, Transform)) return;
            const t = world.get(listEntity, Transform) as TransformData;
            if (t.scale.x === 0 && t.scale.y === 0 && t.scale.z === 0) {
                world.insert(listEntity, Transform, {
                    position: { x: t.position.x, y: t.position.y, z: t.position.z },
                    rotation: { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z, w: t.rotation.w },
                    scale: { x: 1, y: 1, z: 1 },
                });
            }
        }

        function initDropdownAppearance(entity: Entity): void {
            if (world.has(entity, Sprite)) {
                const s = world.get(entity, Sprite) as SpriteData;
                if (s.color.r === 1 && s.color.g === 1 && s.color.b === 1 && s.color.a === 1) {
                    world.insert(entity, Sprite, {
                        texture: s.texture,
                        color: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
                        size: { x: s.size.x, y: s.size.y },
                        uvOffset: { x: s.uvOffset.x, y: s.uvOffset.y },
                        uvScale: { x: s.uvScale.x, y: s.uvScale.y },
                        layer: s.layer,
                        flipX: s.flipX,
                        flipY: s.flipY,
                        material: s.material,
                        enabled: s.enabled,
                    });
                }
            }
        }

        function openDropdown(entity: Entity, dropdown: DropdownData, state: DropdownState): void {
            dropdown.isOpen = true;
            state.highlightIndex = dropdown.selectedIndex;

            const listEntity = dropdown.listEntity;
            if (listEntity === 0 || !world.valid(listEntity)) return;

            setListVisible(listEntity, true);
            destroyOptions(state);

            const ddSprite = world.get(entity, Sprite) as SpriteData;
            const ddWidth = ddSprite.size.x;
            const ddHeight = ddSprite.size.y;
            const ddLayer = ddSprite.layer;
            state.ddWidth = ddWidth;
            state.ddLayer = ddLayer;
            const totalHeight = dropdown.options.length * DROPDOWN_ITEM_HEIGHT;

            world.insert(listEntity, UIRect, {
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 0 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: ddWidth, y: totalHeight },
                pivot: { x: 0.5, y: 0.5 },
            });
            world.insert(listEntity, Transform, {
                position: { x: 0, y: -(ddHeight + totalHeight) / 2, z: 0 },
                rotation: { w: 1, x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            });
            world.insert(listEntity, Sprite, {
                texture: INVALID_TEXTURE,
                color: { r: 1, g: 1, b: 1, a: 1 },
                size: { x: ddWidth, y: totalHeight },
                uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 },
                layer: ddLayer + 1,
                flipX: false,
                flipY: false,
                material: 0,
                enabled: true,
            });

            for (let i = 0; i < dropdown.options.length; i++) {
                const optEntity = world.spawn();
                const optY = totalHeight / 2 - (i + 0.5) * DROPDOWN_ITEM_HEIGHT;
                world.insert(optEntity, Name, { value: `Option_${i}` });
                world.insert(optEntity, UIRect, {
                    anchorMin: { x: 0, y: 1 },
                    anchorMax: { x: 1, y: 1 },
                    offsetMin: { x: 0, y: -i * DROPDOWN_ITEM_HEIGHT },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: ddWidth, y: DROPDOWN_ITEM_HEIGHT },
                    pivot: { x: 0.5, y: 0.5 },
                });
                world.insert(optEntity, Transform, {
                    position: { x: 0, y: optY, z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                });
                world.insert(optEntity, Sprite, {
                    texture: INVALID_TEXTURE,
                    color: { r: 0.95, g: 0.95, b: 0.95, a: 1 },
                    size: { x: ddWidth, y: DROPDOWN_ITEM_HEIGHT },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: ddLayer + 2,
                    flipX: false,
                    flipY: false,
                    material: 0,
                    enabled: true,
                });
                world.insert(optEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
                world.setParent(optEntity, listEntity);
                state.optionEntities.push(optEntity);

                const textEntity = world.spawn();
                world.insert(textEntity, Transform, {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                });
                world.insert(textEntity, Text, {
                    content: dropdown.options[i],
                    fontSize: DROPDOWN_FONT_SIZE,
                    fontFamily: 'Arial',
                    color: { r: 0, g: 0, b: 0, a: 1 },
                    align: TextAlign.Left,
                    verticalAlign: TextVerticalAlign.Middle,
                    wordWrap: false,
                    overflow: TextOverflow.Clip,
                    lineHeight: 1.2,
                });
                world.insert(textEntity, UIRect, {
                    anchorMin: { x: 0, y: 0 },
                    anchorMax: { x: 1, y: 1 },
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: ddWidth, y: DROPDOWN_ITEM_HEIGHT },
                    pivot: { x: 0.5, y: 0.5 },
                });
                world.setParent(textEntity, optEntity);
                state.textEntities.push(textEntity);
            }

            updateHighlight(state);
        }

        function closeDropdown(_entity: Entity, dropdown: DropdownData, state: DropdownState): void {
            dropdown.isOpen = false;
            destroyOptions(state);
            setListVisible(dropdown.listEntity, false);
        }

        function selectOption(
            entity: Entity,
            dropdown: DropdownData,
            state: DropdownState,
            index: number,
            events: UIEventQueue,
        ): void {
            dropdown.selectedIndex = index;
            closeDropdown(entity, dropdown, state);
            events.emit(entity, 'change');
        }

        function syncLabel(dropdown: DropdownData): void {
            const labelEntity = dropdown.labelEntity;
            if (labelEntity === 0 || !world.valid(labelEntity)) return;
            if (!world.has(labelEntity, Text)) return;

            const t = world.get(labelEntity, Text) as TextData;
            let newColor = { r: t.color.r, g: t.color.g, b: t.color.b, a: t.color.a };
            let newContent = t.content;
            let changed = false;

            if (newColor.r === 1 && newColor.g === 1 && newColor.b === 1 && newColor.a === 1) {
                newColor = { r: 0, g: 0, b: 0, a: 1 };
                changed = true;
            }

            if (dropdown.selectedIndex >= 0 && dropdown.selectedIndex < dropdown.options.length) {
                const selectedText = dropdown.options[dropdown.selectedIndex];
                if (newContent !== selectedText) {
                    newContent = selectedText;
                    changed = true;
                }
            }

            if (changed) {
                world.insert(labelEntity, Text, {
                    content: newContent,
                    fontSize: t.fontSize,
                    fontFamily: t.fontFamily,
                    color: newColor,
                    align: t.align,
                    verticalAlign: t.verticalAlign,
                    wordWrap: t.wordWrap,
                    overflow: t.overflow,
                    lineHeight: t.lineHeight,
                });
            }
        }

        function destroyOptions(state: DropdownState): void {
            for (const textEntity of state.textEntities) {
                if (world.valid(textEntity)) {
                    world.despawn(textEntity);
                }
            }
            for (const optEntity of state.optionEntities) {
                if (world.valid(optEntity)) {
                    world.despawn(optEntity);
                }
            }
            state.optionEntities = [];
            state.textEntities = [];
        }

        function setListVisible(entity: Entity, visible: boolean): void {
            if (entity === 0 || !world.valid(entity)) return;
            if (world.has(entity, Interactable)) {
                world.insert(entity, Interactable, { enabled: visible, blockRaycast: true, raycastTarget: true });
            }
            if (world.has(entity, Sprite)) {
                const s = world.get(entity, Sprite) as SpriteData;
                world.insert(entity, Sprite, {
                    texture: s.texture,
                    color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
                    size: { x: s.size.x, y: s.size.y },
                    uvOffset: { x: s.uvOffset.x, y: s.uvOffset.y },
                    uvScale: { x: s.uvScale.x, y: s.uvScale.y },
                    layer: s.layer,
                    flipX: s.flipX,
                    flipY: s.flipY,
                    material: s.material,
                    enabled: visible,
                });
            }
        }

        function updateHighlight(state: DropdownState): void {
            for (let i = 0; i < state.optionEntities.length; i++) {
                const optEntity = state.optionEntities[i];
                if (!world.valid(optEntity) || !world.has(optEntity, Sprite)) continue;
                const color = i === state.highlightIndex
                    ? { ...DROPDOWN_HIGHLIGHT_COLOR }
                    : { r: 0.95, g: 0.95, b: 0.95, a: 1 };
                world.insert(optEntity, Sprite, {
                    texture: INVALID_TEXTURE,
                    color,
                    size: { x: state.ddWidth, y: DROPDOWN_ITEM_HEIGHT },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: state.ddLayer + 2,
                    flipX: false,
                    flipY: false,
                    material: 0,
                    enabled: true,
                });
            }
        }

        function isAnyOptionHovered(state: DropdownState): boolean {
            for (const optEntity of state.optionEntities) {
                if (!world.valid(optEntity) || !world.has(optEntity, UIInteraction)) continue;
                const optInteraction = world.get(optEntity, UIInteraction) as UIInteractionData;
                if (optInteraction.hovered) return true;
            }
            return false;
        }
    }
}

export const dropdownPlugin = new DropdownPlugin();
