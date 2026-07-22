// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Single-source guard for component asset fields. The former AssetFieldRegistry
// hand-mirrored this data in a second table; it was deleted and every consumer
// (scene asset discovery + handle write-back) now reads the ONE source — each
// ComponentDef's `assetFields` / `discoverAssets`. These assertions lock the
// builtins that write-back depends on, so a C++ ES_PROPERTY change (or a TS def
// edit) that drops a texture/material/font field fails here instead of silently
// producing a white sprite at runtime.
import { describe, it, expect } from 'vitest';
import {
    Sprite, BitmapText, SpineAnimation, ParticleEmitter, TilemapLayer,
    getComponent,
} from '../src/component';
import { UIVisual } from '../src/ui/core/ui-visual';
import { SpriteAnimator } from '../src/animation/SpriteAnimator';
import { AudioSource } from '../src/audio/AudioComponents';
import { Video } from '../src/video/VideoComponents';
import { Tilemap } from '../src/tilemap/components';
import { TimelinePlayer } from '../src/timeline/TimelinePlugin';

describe('component asset fields (single source)', () => {
    it('builtins carry the asset fields handle write-back keys off', () => {
        expect(Sprite.assetFields).toEqual([
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ]);
        expect(UIVisual.assetFields).toEqual([
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ]);
        expect(BitmapText.assetFields).toEqual([{ field: 'font', type: 'font' }]);
        expect(SpineAnimation.assetFields).toEqual([{ field: 'material', type: 'material' }]);
        expect(ParticleEmitter.assetFields).toEqual([
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ]);
    });

    it('TS components declare their asset fields on the def', () => {
        expect(SpriteAnimator.assetFields).toEqual([{ field: 'clip', type: 'anim-clip' }]);
        expect(AudioSource.assetFields).toEqual([{ field: 'clip', type: 'audio' }]);
        expect(Video.assetFields).toEqual([{ field: 'source', type: 'video' }]);
        expect(Tilemap.assetFields).toEqual([{ field: 'source', type: 'tilemap' }]);
        expect(TimelinePlayer.assetFields).toEqual([{ field: 'timeline', type: 'timeline' }]);
    });

    it('TilemapLayer is the single-source model: assetFields for write-back, discoverAssets for the .estileset out-of-band ref', () => {
        // Write-back only sees the copied atlas texture (a real ABI field).
        expect(TilemapLayer.assetFields).toEqual([{ field: 'tileset', type: 'texture' }]);
        // Discovery is authoritative via the callback, which also surfaces the
        // out-of-band tileset ref that has no ABI field.
        expect(typeof TilemapLayer.discoverAssets).toBe('function');
        const refs = TilemapLayer.discoverAssets!({
            tileset: 'atlas.png',
            tilesetAsset: '@uuid:abc',
        } as never);
        expect(refs).toContainEqual({ type: 'texture', path: 'atlas.png' });
        expect(refs).toContainEqual({ type: 'tileset', path: '@uuid:abc' });
    });

    it('the write-back source resolves through the component registry', () => {
        expect(getComponent('Sprite')?.assetFields).toBe(Sprite.assetFields);
    });
});
