import { describe, it, expect, beforeEach } from 'vitest';
import {
    getAssetTypeEntry,
    getEditorType,
    isKnownAssetExtension,
} from '../src/assetTypes';
import {
    registerAnimClip,
    getAnimClip,
    clearAnimClips,
} from '../src/animation/SpriteAnimator';
import {
    parseAnimClipData,
    extractAnimClipTexturePaths,
    type AnimClipAssetData,
} from '../src/animation/AnimClipLoader';
import {
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    type AssetFieldType,
} from '../src/scene';

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
    beforeEach(() => {
        clearAnimClips();
    });

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
        const fields = getComponentAssetFields('SpriteAnimator');
        expect(fields).toContain('clip');
    });

    it('should have anim-clip asset field type', () => {
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
