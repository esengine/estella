import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform, Name, Sprite } from '../component';
import type { SpriteData } from '../component';
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
import { UIMask } from './UIMask';
import { Input } from '../input';
import type { InputState } from '../input';
import { ensureComponent } from './uiHelpers';
import { DROPDOWN_ITEM_HEIGHT, DROPDOWN_FONT_SIZE, DROPDOWN_HIGHLIGHT_COLOR } from './uiConstants';

interface DropdownState {
    optionEntities: Entity[];
    highlightIndex: number;
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

                const entities = world.getEntitiesWithComponents([Dropdown]);
                for (const entity of entities) {
                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });

                    const dropdown = world.get(entity, Dropdown) as DropdownData;
                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    let state = dropdownStates.get(entity);
                    if (!state) {
                        state = { optionEntities: [], highlightIndex: -1 };
                        dropdownStates.set(entity, state);
                    }

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
        ));

        function openDropdown(entity: Entity, dropdown: DropdownData, state: DropdownState): void {
            dropdown.isOpen = true;
            state.highlightIndex = dropdown.selectedIndex;

            const listEntity = dropdown.listEntity;
            if (listEntity === 0 || !world.valid(listEntity)) return;

            setListVisible(listEntity, true);
            if (!world.has(listEntity, UIMask)) {
                world.insert(listEntity, UIMask, { enabled: true, mode: 'scissor' });
            }
            destroyOptions(state);

            const listRect = world.has(listEntity, UIRect)
                ? world.get(listEntity, UIRect) as UIRectData
                : null;
            const listWidth = listRect ? listRect.size.x : 160;

            for (let i = 0; i < dropdown.options.length; i++) {
                const optEntity = world.spawn();
                world.insert(optEntity, Name, { value: `Option_${i}` });
                world.insert(optEntity, UIRect, {
                    anchorMin: { x: 0, y: 1 },
                    anchorMax: { x: 1, y: 1 },
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 0, y: 0 },
                    size: { x: listWidth, y: DROPDOWN_ITEM_HEIGHT },
                    pivot: { x: 0.5, y: 1 },
                });
                world.insert(optEntity, LocalTransform, {
                    position: { x: 0, y: -(i * DROPDOWN_ITEM_HEIGHT), z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                });
                world.insert(optEntity, Text, {
                    content: dropdown.options[i],
                    fontSize: DROPDOWN_FONT_SIZE,
                    fontFamily: 'Arial',
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    align: TextAlign.Left,
                    verticalAlign: TextVerticalAlign.Middle,
                    wordWrap: false,
                    overflow: TextOverflow.Clip,
                    lineHeight: 1.2,
                });
                world.insert(optEntity, Sprite, {
                    texture: 0,
                    color: { r: 1, g: 1, b: 1, a: 0 },
                    size: { x: listWidth, y: DROPDOWN_ITEM_HEIGHT },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: 0,
                    flipX: false,
                    flipY: false,
                    material: 0,
                    enabled: true,
                });
                world.insert(optEntity, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
                world.setParent(optEntity, listEntity);
                state.optionEntities.push(optEntity);
            }

            if (listRect) {
                listRect.size.y = dropdown.options.length * DROPDOWN_ITEM_HEIGHT;
                world.insert(listEntity, UIRect, listRect);
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

            const text = world.get(labelEntity, Text) as TextData;
            const selectedText = dropdown.selectedIndex >= 0 && dropdown.selectedIndex < dropdown.options.length
                ? dropdown.options[dropdown.selectedIndex]
                : '';

            if (text.content !== selectedText) {
                text.content = selectedText;
                world.insert(labelEntity, Text, text);
            }
        }

        function destroyOptions(state: DropdownState): void {
            for (const optEntity of state.optionEntities) {
                if (world.valid(optEntity)) {
                    world.despawn(optEntity);
                }
            }
            state.optionEntities = [];
        }

        function setListVisible(entity: Entity, visible: boolean): void {
            if (entity === 0 || !world.valid(entity)) return;
            if (world.has(entity, Interactable)) {
                const inter = world.get(entity, Interactable) as InteractableData;
                inter.enabled = visible;
                world.insert(entity, Interactable, inter);
            }
            if (world.has(entity, Sprite)) {
                const sprite = world.get(entity, Sprite) as SpriteData;
                sprite.enabled = visible;
                world.insert(entity, Sprite, sprite);
            }
        }

        function updateHighlight(state: DropdownState): void {
            for (let i = 0; i < state.optionEntities.length; i++) {
                const optEntity = state.optionEntities[i];
                if (!world.valid(optEntity) || !world.has(optEntity, Sprite)) continue;
                const sprite = world.get(optEntity, Sprite) as SpriteData;
                if (i === state.highlightIndex) {
                    sprite.color = { ...DROPDOWN_HIGHLIGHT_COLOR };
                } else {
                    sprite.color = { r: 1, g: 1, b: 1, a: 0 };
                }
                world.insert(optEntity, Sprite, sprite);
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
