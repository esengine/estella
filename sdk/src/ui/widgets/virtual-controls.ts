// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { spawnUIEntity, type UINodeInit, type UIVisualInit } from '../core/compose';
import { px, percent } from '../core/dimension';
import { Interactable, makeWidgetInteractable } from '../input/interactable';
import { VirtualJoystick, VirtualJoystickMode, VirtualButton } from '../behavior/virtual-controls';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { createButton, type ButtonOptions } from './button';
export interface VirtualJoystickOptions {
    world: World;
    parent?: Entity;
    node?: UINodeInit;
    inputId?: string;
    mode?: VirtualJoystickMode;
    radius?: number;
    deadZone?: number;
    returnSpeed?: number;
    disabled?: boolean;
    baseVisual?: UIVisualInit;
    handleVisual?: UIVisualInit;
}
export function createVirtualJoystick(options: VirtualJoystickOptions) {
    const { world } = options;
    const radius = Math.max(1, options.radius ?? 50);
    const diameter = radius * 2;
    const mode = options.mode ?? VirtualJoystickMode.Fixed;
    const entity = spawnUIEntity({ world, parent: options.parent,
        node: options.node ?? { width: px(mode === VirtualJoystickMode.Follow ? 240 : diameter), height: px(mode === VirtualJoystickMode.Follow ? 160 : diameter) } });
    makeWidgetInteractable(world, entity, { disabled: options.disabled, focusable: false });
    const colors = themeColors(world);
    const childNode = (size: number): UINodeInit => ({ position: 1, width: px(size), height: px(size),
        insetLeft: percent(50), insetTop: percent(50), marginLeft: px(-size / 2), marginTop: px(-size / 2) });
    const base = spawnUIEntity({ world, parent: entity, node: childNode(diameter), visual: options.baseVisual ?? { color: colors.control } });
    const handle = spawnUIEntity({ world, parent: entity, node: childNode(radius * 0.8), visual: options.handleVisual ?? { color: colors.primary } });
    if (!options.baseVisual) markThemed(world, base, { visual: 'control' });
    if (!options.handleVisual) markThemed(world, handle, { visual: 'primary' });
    world.insert(entity, VirtualJoystick, { inputId: options.inputId ?? 'move', mode, radius,
        deadZone: options.deadZone ?? 0.15, returnSpeed: options.returnSpeed ?? 18, base, handle });
    return { entity, baseEntity: base, handleEntity: handle,
        setDisabled: (disabled: boolean) => {
            if (world.valid(entity)) world.insert(entity, Interactable, { ...world.get(entity, Interactable), enabled: !disabled });
        }, dispose: () => { if (world.valid(entity)) world.despawn(entity); } };
}
export interface VirtualButtonOptions extends ButtonOptions { inputId?: string; value?: number }
export function createVirtualButton(options: VirtualButtonOptions) {
    const handle = createButton({ ...options, focusable: false });
    options.world.insert(handle.entity, VirtualButton, { inputId: options.inputId ?? 'fire', value: options.value ?? 1 });
    return handle;
}
