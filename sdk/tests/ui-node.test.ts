// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { UINode } from '../src/ui/core/ui-node';
import { UIInteraction } from '../src/ui/input/interactable';
import { DimensionUnit } from '../src/ui/core/dimension';
import { getComponent } from '../src/ecs/component';
import { COMPONENT_META } from '../src/ecs/component.generated';

describe('UINode (REARCH_GUI F3)', () => {
    it('is a registered, non-transient builtin', () => {
        expect(UINode._builtin).toBe(true);
        expect(UINode.transient).toBe(false);
        expect(getComponent('UINode')).toBe(UINode);
    });

    // The sibling case, and the one that proves the C++ annotation reaches the
    // registry: UIInteraction is per-frame pointer state that scene save must
    // omit, declared `ES_COMPONENT(transient)` and nowhere else.
    it('UIInteraction is transient, declared in C++ rather than at the TS call site', () => {
        expect(COMPONENT_META.UIInteraction?.transient).toBe(true);
        expect(UIInteraction.transient).toBe(true);
        expect(getComponent('UIInteraction')).toBe(UIInteraction);
    });

    it('defaults: size auto, margins 0px, CSS flex defaults', () => {
        const d = UINode._default;
        expect(d.width).toEqual({ value: 0, unit: DimensionUnit.Auto });
        expect(d.height.unit).toBe(DimensionUnit.Auto);
        expect(d.flexGrow).toBe(0);
        expect(d.flexShrink).toBe(1);
        expect(d.flexBasis.unit).toBe(DimensionUnit.Auto);
        expect(d.marginLeft).toEqual({ value: 0, unit: DimensionUnit.Px });
    });

    it('TS defaults match the C++-generated COMPONENT_META (codegen agreement)', () => {
        expect(UINode._default).toEqual(COMPONENT_META.UINode.defaults);
    });
});
