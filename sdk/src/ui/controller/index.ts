// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/index.ts
 * @brief   Barrel for the Controller + Gear layer.
 */
export {
    UIController,
    INTERACTION_CONTROLLER,
    INTERACTION_PAGES,
    interactionController,
    controllerState,
    findControllerOwner,
    getControllerPage,
    setControllerPage,
    type ControllerState,
    type UIControllerData,
} from './ui-controller';

export {
    UIGear,
    gearBinding,
    type GearValue,
    type GearTween,
    type GearBinding,
    type UIGearData,
} from './ui-gear';

export {
    createInteractionControllerDriverSystem,
    createGearApplySystem,
    readFieldPath,
    writeFieldPath,
    isLerpable,
    lerpGearValue,
} from './gear-apply';

export { UIControllerPlugin, uiControllerPlugin } from './plugin';
