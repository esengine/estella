// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Creation-default single-sourcing: authoring defaults that differ from
 *        the C++ ctor are authored at the ES_PROPERTY site (editor_default=),
 *        flow through COMPONENT_META.editorDefaults, and are merged into the
 *        registered builtin's _default. Both layers stay observable — defaults
 *        is the runtime ctor truth, _default the authoring truth.
 */
import { describe, it, expect } from 'vitest';
import { Camera, Sprite, ProjectionType } from '../src/ecs/component';
import { COMPONENT_META } from '../src/ecs/component.generated';
import { DEFAULT_SPRITE_SIZE } from '../src/defaults';

describe('editor_default single-source', () => {
    it('Camera authors as an active Orthographic while the ctor stays Perspective/inactive', () => {
        const ctor = COMPONENT_META.Camera.defaults as Record<string, unknown>;
        expect(ctor.projectionType).toBe(ProjectionType.Perspective);
        expect(ctor.orthoSize).toBe(5);
        expect(ctor.isActive).toBe(false);

        const authored = Camera._default;
        expect(authored.projectionType).toBe(ProjectionType.Orthographic);
        expect(authored.orthoSize).toBe(540);
        expect(authored.aspectRatio).toBeCloseTo(1.77);
        expect(authored.isActive).toBe(true);
        expect(authored.showFrustum).toBe(false);
    });

    it('Sprite authors at 100px while the ctor stays {1,1} world units', () => {
        const ctor = COMPONENT_META.Sprite.defaults as { size: { x: number; y: number } };
        expect(ctor.size).toEqual({ x: 1, y: 1 });

        expect(Sprite._default.size).toEqual({ x: 100, y: 100 });
    });

    it('DEFAULT_SPRITE_SIZE derives from the annotation, not a hand copy', () => {
        expect(DEFAULT_SPRITE_SIZE).toEqual({ x: 100, y: 100 });
        const generated = (COMPONENT_META.Sprite.editorDefaults as { size: object }).size;
        expect(DEFAULT_SPRITE_SIZE).toEqual(generated);
        expect(DEFAULT_SPRITE_SIZE).not.toBe(generated);
    });
});
