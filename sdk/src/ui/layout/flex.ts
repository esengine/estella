// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineBuiltin } from '../../ecs/component';
import type { Vec2 } from '../../types';
import type { Padding } from '../../wasm/wasm.generated';

// -- FlexContainer ------------------------------------------------------------

// The five flex enums, single-sourced from the C++ ES_ENUMs via the generated
// module. Yoga reads the C++ side, so a second spelling of these numbers is a
// layout that is merely wrong rather than an error anything raises.
export {
    FlexDirection, FlexWrap, JustifyContent, AlignItems, AlignContent,
} from '../../wasm/wasm.generated';
import {
    FlexDirection, FlexWrap, JustifyContent, AlignItems, AlignContent,
} from '../../wasm/wasm.generated';

export interface FlexContainerData {
    direction: FlexDirection;
    wrap: FlexWrap;
    justifyContent: JustifyContent;
    alignItems: AlignItems;
    alignContent: AlignContent;
    gap: Vec2;
    padding: Padding;
}

export const FlexContainer = defineBuiltin<FlexContainerData>('FlexContainer', {
    direction: FlexDirection.Row,
    wrap: FlexWrap.NoWrap,
    justifyContent: JustifyContent.Start,
    alignItems: AlignItems.Stretch,
    alignContent: AlignContent.Start,
    gap: { x: 0, y: 0 },
    padding: { left: 0, top: 0, right: 0, bottom: 0 },
});

