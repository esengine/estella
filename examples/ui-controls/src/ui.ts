import { Text, UIVisual, UIToggle, UISlider, UIDropdown } from 'esengine';
import type { Color, Entity, TextData, UIVisualData, World } from 'esengine';

// Reading and writing an authored control is reading and writing its component.
// A widget built in code hands back a handle; one dropped in the scene is found
// by name, and its state lives where the scene put it.

export function setText(world: World, entity: Entity | null, content: string): void {
    if (entity === null || !world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
}

export function setColor(world: World, entity: Entity | null, color: Color): void {
    if (entity === null || !world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    v.color = { ...color };
    world.insert(entity, UIVisual, v);
}

/** How much of a Filled visual is painted — what a progress bar's value IS. */
export function setFill(world: World, entity: Entity | null, amount: number): void {
    if (entity === null || !world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    v.fillAmount = amount;
    world.insert(entity, UIVisual, v);
}

export function toggleOn(world: World, entity: Entity | null): boolean {
    if (entity === null || !world.valid(entity) || !world.has(entity, UIToggle)) return false;
    return (world.get(entity, UIToggle) as { isOn: boolean }).isOn;
}

export function sliderValue(world: World, entity: Entity | null): number {
    if (entity === null || !world.valid(entity) || !world.has(entity, UISlider)) return 0;
    return (world.get(entity, UISlider) as { value: number }).value;
}

export function dropdownIndex(world: World, entity: Entity | null): number {
    if (entity === null || !world.valid(entity) || !world.has(entity, UIDropdown)) return 0;
    return (world.get(entity, UIDropdown) as { selectedIndex: number }).selectedIndex;
}
