// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getAssetTypeEntry,
    getEditorType,
    isKnownAssetExtension,
} from '../src/assetTypes';
import {
    parseAnimClipData,
    parseAnimClipAsset,
    serializeAnimClip,
    createAnimClip,
    extractAnimClipTexturePaths,
    animClipSheetCols,
    animClipSheetRows,
    animClipCellRect,
    animClipDrivesPivot,
    animClipFramePivot,
    ANIM_CLIP_FORMAT_VERSION,
    DEFAULT_ANIM_CLIP_PIVOT,
    type AnimClipAssetData,
    type AnimClipSheetData,
} from '../src/animation/AnimClipLoader';
import {
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    type AssetFieldType,
} from '../src/scene/scene';
import { defineComponent } from '../src/ecs/component';

function ensureSpriteAnimator() {
    defineComponent('SpriteAnimator', {
        clip: '',
        speed: 1.0,
        playing: true,
        loop: true,
        enabled: true,
        currentFrame: 0,
        frameTimer: 0,
    }, {
        assetFields: [{ field: 'clip', type: 'anim-clip' }],
    });
}

// =============================================================================
// Asset Type Registration
// =============================================================================

describe('.esanim asset type', () => {
    it('should be a known asset extension', () => {
        expect(isKnownAssetExtension('esanim')).toBe(true);
    });

    it('should have contentType json', () => {
        const entry = getAssetTypeEntry('test.esanim');
        expect(entry).toBeDefined();
        expect(entry!.contentType).toBe('json');
    });

    it('should have editorType anim-clip', () => {
        expect(getEditorType('walk.esanim')).toBe('anim-clip');
    });

    it('should include in wechat pack', () => {
        const entry = getAssetTypeEntry('clip.esanim');
        expect(entry!.wechatPackInclude).toBe(true);
    });

    it('should have transitive deps', () => {
        const entry = getAssetTypeEntry('clip.esanim');
        expect(entry!.hasTransitiveDeps).toBe(true);
    });
});

// =============================================================================
// AnimClip JSON Parsing
// =============================================================================

describe('parseAnimClipData', () => {
    it('should parse valid clip data', () => {
        const json: AnimClipAssetData = {
            version: '1.0',
            type: 'animation-clip',
            fps: 12,
            loop: true,
            frames: [
                { texture: 'assets/walk_01.png' },
                { texture: 'assets/walk_02.png' },
            ],
        };

        const clip = parseAnimClipData('walk.esanim', json, new Map([
            ['assets/walk_01.png', 10],
            ['assets/walk_02.png', 20],
        ]));

        expect(clip.name).toBe('walk.esanim');
        expect(clip.fps).toBe(12);
        expect(clip.loop).toBe(true);
        expect(clip.frames).toHaveLength(2);
        expect(clip.frames[0].texture).toBe(10);
        expect(clip.frames[1].texture).toBe(20);
    });

    it('should use 0 handle for missing textures', () => {
        const json: AnimClipAssetData = {
            version: '1.0',
            type: 'animation-clip',
            fps: 8,
            loop: false,
            frames: [
                { texture: 'assets/missing.png' },
            ],
        };

        const clip = parseAnimClipData('clip.esanim', json, new Map());

        expect(clip.frames[0].texture).toBe(0);
    });

    it('should default fps to 12 if not specified', () => {
        const json = {
            version: '1.0',
            type: 'animation-clip',
            frames: [{ texture: 'a.png' }],
        } as AnimClipAssetData;

        const clip = parseAnimClipData('test.esanim', json, new Map());
        expect(clip.fps).toBe(12);
    });

    it('should default loop to true if not specified', () => {
        const json = {
            version: '1.0',
            type: 'animation-clip',
            frames: [{ texture: 'a.png' }],
        } as AnimClipAssetData;

        const clip = parseAnimClipData('test.esanim', json, new Map());
        expect(clip.loop).toBe(true);
    });

    it('should register clip field in COMPONENT_ASSET_FIELDS', () => {
        ensureSpriteAnimator();
        const fields = getComponentAssetFields('SpriteAnimator');
        expect(fields).toContain('clip');
    });

    it('should have anim-clip asset field type', () => {
        ensureSpriteAnimator();
        const descriptors = getComponentAssetFieldDescriptors('SpriteAnimator');
        const clipDesc = descriptors.find(d => d.field === 'clip');
        expect(clipDesc).toBeDefined();
        expect(clipDesc!.type).toBe('anim-clip' as AssetFieldType);
    });

    it('should extract texture paths from clip data', () => {
        const json: AnimClipAssetData = {
            version: '1.0',
            type: 'animation-clip',
            fps: 10,
            loop: true,
            frames: [
                { texture: 'assets/a.png' },
                { texture: 'assets/b.png' },
                { texture: 'assets/a.png' },
            ],
        };

        const paths = extractAnimClipTexturePaths(json);
        expect(paths).toContain('assets/a.png');
        expect(paths).toContain('assets/b.png');
        expect(paths.length).toBe(2); // deduplicated
    });
});

// =============================================================================
// Sheet grid (format 1.2)
// =============================================================================

const SHEET: AnimClipSheetData = {
    texture: '@uuid:sheet',
    cellWidth: 32,
    cellHeight: 48,
    margin: 2,
    spacing: 1,
    pageWidth: 134,   // 2 + 4*(32+1) = 134 → exactly 4 columns
    pageHeight: 100,  // 2 + 2*(48+1) = 100 → exactly 2 rows
};

describe('sheet grid math', () => {
    it('derives columns and rows honoring margin and spacing', () => {
        expect(animClipSheetCols(SHEET)).toBe(4);
        expect(animClipSheetRows(SHEET)).toBe(2);
    });

    it('computes row-major cell rects', () => {
        expect(animClipCellRect(SHEET, 0)).toEqual({ x: 2, y: 2, width: 32, height: 48 });
        expect(animClipCellRect(SHEET, 3)).toEqual({ x: 2 + 3 * 33, y: 2, width: 32, height: 48 });
        expect(animClipCellRect(SHEET, 4)).toEqual({ x: 2, y: 2 + 49, width: 32, height: 48 });
    });

    it('clamps out-of-range cells to the last valid cell', () => {
        expect(animClipCellRect(SHEET, 99)).toEqual(animClipCellRect(SHEET, 7));
        expect(animClipCellRect(SHEET, -5)).toEqual(animClipCellRect(SHEET, 0));
    });
});

describe('parseAnimClipData with sheet cells', () => {
    const data: AnimClipAssetData = {
        version: '1.2',
        type: 'animation-clip',
        fps: 10,
        loop: true,
        sheet: SHEET,
        frames: [{ cell: 0 }, { cell: 5, duration: 0.2 }],
    };

    it('resolves all cell frames to the shared sheet texture handle', () => {
        const clip = parseAnimClipData('run.esanim', data, new Map([['@uuid:sheet', 7]]));
        expect(clip.frames[0].texture).toBe(7);
        expect(clip.frames[1].texture).toBe(7);
        expect(clip.frames[1].duration).toBe(0.2);
    });

    it('derives flipY-space uv from the cell rect', () => {
        const clip = parseAnimClipData('run.esanim', data, new Map([['@uuid:sheet', 7]]));
        // cell 5 = row 1, col 1 → rect x=35, y=51
        const f = clip.frames[1];
        expect(f.uvOffset!.x).toBeCloseTo(35 / 134);
        expect(f.uvOffset!.y).toBeCloseTo(1 - (51 + 48) / 100);
        expect(f.uvScale!.x).toBeCloseTo(32 / 134);
        expect(f.uvScale!.y).toBeCloseTo(48 / 100);
    });

    it('supports mixing cell frames with per-texture frames', () => {
        const mixed: AnimClipAssetData = {
            ...data,
            frames: [{ cell: 1 }, { texture: 'assets/pow.png' }],
        };
        const clip = parseAnimClipData('mix.esanim', mixed, new Map([
            ['@uuid:sheet', 7],
            ['assets/pow.png', 9],
        ]));
        expect(clip.frames[0].texture).toBe(7);
        expect(clip.frames[0].uvOffset).toBeDefined();
        expect(clip.frames[1].texture).toBe(9);
        expect(clip.frames[1].uvOffset).toBeUndefined();
    });

    it('includes the sheet texture in extracted paths', () => {
        const paths = extractAnimClipTexturePaths(data);
        expect(paths).toEqual(['@uuid:sheet']);
    });
});

// =============================================================================
// Frame anchors (format 1.4)
// =============================================================================

describe('frame anchor resolution', () => {
    const base: AnimClipAssetData = {
        version: ANIM_CLIP_FORMAT_VERSION,
        type: 'animation-clip',
        fps: 10,
        loop: true,
        sheet: SHEET,
        frames: [{ cell: 0 }, { cell: 1 }],
    };

    it('reports a clip with no anchors anywhere as not driving pivot', () => {
        expect(animClipDrivesPivot(base)).toBe(false);
        expect(animClipFramePivot(base, base.frames[0])).toBeNull();
    });

    it('drives pivot from a clip-wide anchor, inherited by every frame', () => {
        const data = { ...base, pivot: { x: 0.5, y: 0 } };
        expect(animClipDrivesPivot(data)).toBe(true);
        expect(animClipFramePivot(data, data.frames[0])).toEqual({ x: 0.5, y: 0 });
        expect(animClipFramePivot(data, data.frames[1])).toEqual({ x: 0.5, y: 0 });
    });

    it('prefers a frame override over the clip-wide anchor', () => {
        const data = {
            ...base,
            pivot: { x: 0.5, y: 0 },
            frames: [{ cell: 0 }, { cell: 1, pivot: { x: 0.3, y: 0.2 } }],
        };
        expect(animClipFramePivot(data, data.frames[0])).toEqual({ x: 0.5, y: 0 });
        expect(animClipFramePivot(data, data.frames[1])).toEqual({ x: 0.3, y: 0.2 });
    });

    it('centers the frames a partially-anchored clip left unset (no stale override)', () => {
        // One frame anchored, no clip default: the plain frames must resolve to the
        // Sprite default rather than keeping the anchored frame's value.
        const data = { ...base, frames: [{ cell: 0 }, { cell: 1, pivot: { x: 0.3, y: 0.2 } }] };
        expect(animClipDrivesPivot(data)).toBe(true);
        expect(animClipFramePivot(data, data.frames[0])).toEqual(DEFAULT_ANIM_CLIP_PIVOT);
    });

    it('never hands back the authored anchor object', () => {
        const data = { ...base, pivot: { x: 0.5, y: 0 } };
        const resolved = animClipFramePivot(data, data.frames[0])!;
        resolved.x = 0.9;
        expect(data.pivot.x).toBe(0.5);
    });
});

describe('parseAnimClipData anchor bake', () => {
    const handles = new Map([['@uuid:sheet', 7]]);

    it('bakes a resolved anchor onto every frame of an anchoring clip', () => {
        const clip = parseAnimClipData('run.esanim', {
            version: ANIM_CLIP_FORMAT_VERSION,
            type: 'animation-clip',
            fps: 10,
            loop: true,
            pivot: { x: 0.5, y: 0 },
            sheet: SHEET,
            frames: [{ cell: 0 }, { cell: 1, pivot: { x: 0.4, y: 0.1 } }],
        }, handles);

        expect(clip.frames[0].pivot).toEqual({ x: 0.5, y: 0 });
        expect(clip.frames[1].pivot).toEqual({ x: 0.4, y: 0.1 });
    });

    it('bakes anchors on per-texture frames as well', () => {
        const clip = parseAnimClipData('mix.esanim', {
            version: ANIM_CLIP_FORMAT_VERSION,
            type: 'animation-clip',
            fps: 10,
            loop: true,
            frames: [{ texture: 'a.png', pivot: { x: 0.5, y: 0 } }],
        }, new Map([['a.png', 3]]));

        expect(clip.frames[0].texture).toBe(3);
        expect(clip.frames[0].pivot).toEqual({ x: 0.5, y: 0 });
    });

    it('leaves every frame anchor-free when the clip authors none', () => {
        const clip = parseAnimClipData('run.esanim', {
            version: ANIM_CLIP_FORMAT_VERSION,
            type: 'animation-clip',
            fps: 10,
            loop: true,
            sheet: SHEET,
            frames: [{ cell: 0 }, { cell: 1 }],
        }, handles);

        expect(clip.frames.every(f => f.pivot === undefined)).toBe(true);
    });
});

describe('parseAnimClipAsset (tolerant parse)', () => {
    it('normalizes a well-formed sheet clip round-trip through serializeAnimClip', () => {
        const clip = createAnimClip('@uuid:sheet', 32, 48, 134, 100);
        clip.frames.push({ cell: 0 }, { cell: 1, duration: 0.25 });
        const parsed = parseAnimClipAsset(JSON.parse(JSON.stringify(serializeAnimClip(clip))));
        expect(parsed).toEqual(clip);
    });

    it('drops cell frames when there is no sheet section', () => {
        const parsed = parseAnimClipAsset({ frames: [{ cell: 3 }, { texture: 'a.png' }] });
        expect(parsed.frames).toEqual([{ texture: 'a.png' }]);
    });

    it('drops frames with neither texture nor cell', () => {
        const parsed = parseAnimClipAsset({ frames: [{}, null, { duration: 0.5 }] });
        expect(parsed.frames).toEqual([]);
    });

    it('keeps legacy atlasFrame frames intact', () => {
        const af = { x: 1, y: 2, width: 3, height: 4, pageWidth: 10, pageHeight: 20 };
        const parsed = parseAnimClipAsset({ frames: [{ texture: 'a.png', atlasFrame: af }] });
        expect(parsed.frames[0].atlasFrame).toEqual(af);
    });

    it('round-trips clip-wide and per-frame anchors', () => {
        const clip = createAnimClip('@uuid:sheet', 32, 48, 134, 100);
        clip.pivot = { x: 0.5, y: 0 };
        clip.frames.push({ cell: 0 }, { cell: 1, pivot: { x: 0.4, y: 0.05 } });
        const parsed = parseAnimClipAsset(JSON.parse(JSON.stringify(serializeAnimClip(clip))));
        expect(parsed).toEqual(clip);
    });

    it('keeps anchors on per-texture frames too', () => {
        const parsed = parseAnimClipAsset({
            frames: [{ texture: 'a.png', pivot: { x: 0.5, y: 0 } }],
        });
        expect(parsed.frames[0].pivot).toEqual({ x: 0.5, y: 0 });
    });

    it('drops malformed anchors instead of half-applying them', () => {
        const parsed = parseAnimClipAsset({
            pivot: { x: 0.5 },
            frames: [
                { texture: 'a.png', pivot: { x: 'low', y: 0 } },
                { texture: 'b.png', pivot: { x: NaN, y: 0 } },
                { texture: 'c.png', pivot: null },
            ],
        });
        expect(parsed.pivot).toBeUndefined();
        expect(parsed.frames.every(f => f.pivot === undefined)).toBe(true);
    });

    it('keeps anchors outside 0–1 (Sprite.pivot allows them)', () => {
        const parsed = parseAnimClipAsset({ pivot: { x: -0.25, y: 1.5 }, frames: [] });
        expect(parsed.pivot).toEqual({ x: -0.25, y: 1.5 });
    });

    it('stamps the current format version on save', () => {
        const parsed = parseAnimClipAsset({ version: '1.2', frames: [{ texture: 'a.png' }] });
        expect(parsed.version).toBe('1.2'); // read back as authored
        expect(serializeAnimClip(parsed).version).toBe(ANIM_CLIP_FORMAT_VERSION);
    });

    it('defaults fps/loop and fills sheet defaults', () => {
        const parsed = parseAnimClipAsset({ sheet: { texture: 't.png' }, frames: [] });
        expect(parsed.fps).toBe(12);
        expect(parsed.loop).toBe(true);
        expect(parsed.sheet).toEqual({
            texture: 't.png', cellWidth: 32, cellHeight: 32,
            margin: 0, spacing: 0, pageWidth: 1, pageHeight: 1,
        });
    });
});
