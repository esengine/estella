import { describe, it, expect } from 'vitest';
import {
    getAssetTypeEntry,
    getEditorType,
    getAddressableType,
    getAddressableTypeByEditorType,
    isKnownAssetExtension,
    getAllAssetExtensions,
    looksLikeAssetPath,
    getCustomExtensions,
    getWeChatPackOptions,
    getAssetMimeType,
    isCustomExtension,
    toBuildPath,
} from '../src/assetTypes';

describe('getAssetTypeEntry', () => {
    it('should resolve by extension', () => {
        const entry = getAssetTypeEntry('png');
        expect(entry).toBeDefined();
        expect(entry!.editorType).toBe('texture');
    });

    it('should resolve by full path', () => {
        const entry = getAssetTypeEntry('assets/hero.png');
        expect(entry).toBeDefined();
        expect(entry!.contentType).toBe('image');
    });

    it('should be case-insensitive', () => {
        expect(getAssetTypeEntry('PNG')).toBeDefined();
        expect(getAssetTypeEntry('assets/file.JPG')).toBeDefined();
    });

    it('should return undefined for unknown extension', () => {
        expect(getAssetTypeEntry('xyz')).toBeUndefined();
    });

    it('should handle all known types', () => {
        const types = [
            ['png', 'texture'], ['mp3', 'audio'], ['esmaterial', 'material'],
            ['esshader', 'shader'], ['atlas', 'spine-atlas'], ['skel', 'spine-skeleton'],
            ['json', 'json'], ['bmfont', 'bitmap-font'], ['fnt', 'bitmap-font'],
            ['esprefab', 'prefab'], ['esscene', 'scene'], ['esanim', 'anim-clip'],
        ] as const;
        for (const [ext, editorType] of types) {
            expect(getAssetTypeEntry(ext)?.editorType).toBe(editorType);
        }
    });
});

describe('getEditorType', () => {
    it('should return editor type for known extension', () => {
        expect(getEditorType('hero.png')).toBe('texture');
        expect(getEditorType('bgm.mp3')).toBe('audio');
    });

    it('should return unknown for unrecognized path', () => {
        expect(getEditorType('file.xyz')).toBe('unknown');
    });
});

describe('getAddressableType', () => {
    it('should return addressable type', () => {
        expect(getAddressableType('hero.png')).toBe('texture');
        expect(getAddressableType('data.json')).toBe('json');
    });

    it('should return null for non-addressable types', () => {
        expect(getAddressableType('shader.esshader')).toBeNull();
        expect(getAddressableType('level.esscene')).toBeNull();
    });

    it('should return null for unknown', () => {
        expect(getAddressableType('file.xyz')).toBeNull();
    });
});

describe('getAddressableTypeByEditorType', () => {
    it('should return addressable type for known editor types', () => {
        expect(getAddressableTypeByEditorType('texture')).toBe('texture');
        expect(getAddressableTypeByEditorType('audio')).toBe('audio');
    });

    it('should return text for text editor type', () => {
        expect(getAddressableTypeByEditorType('text')).toBe('text');
    });

    it('should return binary for binary editor type', () => {
        expect(getAddressableTypeByEditorType('binary')).toBe('binary');
    });

    it('should return binary for unknown editor type', () => {
        expect(getAddressableTypeByEditorType('totally-unknown')).toBe('binary');
    });
});

describe('isKnownAssetExtension', () => {
    it('should return true for known extensions', () => {
        expect(isKnownAssetExtension('png')).toBe(true);
        expect(isKnownAssetExtension('mp3')).toBe(true);
        expect(isKnownAssetExtension('esanim')).toBe(true);
    });

    it('should be case-insensitive', () => {
        expect(isKnownAssetExtension('PNG')).toBe(true);
    });

    it('should return false for unknown extensions', () => {
        expect(isKnownAssetExtension('xyz')).toBe(false);
    });
});

describe('getAllAssetExtensions', () => {
    it('should return a non-empty set', () => {
        const exts = getAllAssetExtensions();
        expect(exts.size).toBeGreaterThan(0);
        expect(exts.has('png')).toBe(true);
    });
});

describe('looksLikeAssetPath', () => {
    it('should return true for asset-like paths', () => {
        expect(looksLikeAssetPath('assets/hero.png')).toBe(true);
        expect(looksLikeAssetPath('sounds/bgm.mp3')).toBe(true);
    });

    it('should return false for non-string values', () => {
        expect(looksLikeAssetPath(42)).toBe(false);
        expect(looksLikeAssetPath(null)).toBe(false);
    });

    it('should return false for paths without slash', () => {
        expect(looksLikeAssetPath('hero.png')).toBe(false);
    });

    it('should return false for unknown extensions', () => {
        expect(looksLikeAssetPath('assets/file.xyz')).toBe(false);
    });
});

describe('getCustomExtensions', () => {
    it('should return dotted extensions for wechat pack', () => {
        const exts = getCustomExtensions();
        expect(exts).toContain('.esmaterial');
        expect(exts).toContain('.esprefab');
        expect(exts).toContain('.esanim');
    });

    it('should not include non-packable extensions', () => {
        const exts = getCustomExtensions();
        expect(exts).not.toContain('.png');
        expect(exts).not.toContain('.json');
    });
});

describe('getWeChatPackOptions', () => {
    it('should return suffix-type options', () => {
        const options = getWeChatPackOptions();
        expect(options.length).toBeGreaterThan(0);
        for (const opt of options) {
            expect(opt.type).toBe('suffix');
            expect(opt.value).toMatch(/^\./);
        }
    });
});

describe('getAssetMimeType', () => {
    it('should return MIME for known extensions', () => {
        expect(getAssetMimeType('png')).toBe('image/png');
        expect(getAssetMimeType('mp3')).toBe('audio/mpeg');
        expect(getAssetMimeType('json')).toBe('application/json');
    });

    it('should return undefined for unknown', () => {
        expect(getAssetMimeType('xyz')).toBeUndefined();
    });
});

describe('isCustomExtension', () => {
    it('should return true for wechat-packable paths', () => {
        expect(isCustomExtension('file.esmaterial')).toBe(true);
        expect(isCustomExtension('file.esprefab')).toBe(true);
    });

    it('should return false for non-packable paths', () => {
        expect(isCustomExtension('file.png')).toBe(false);
        expect(isCustomExtension('file.json')).toBe(false);
    });

    it('should return false for unknown', () => {
        expect(isCustomExtension('file.xyz')).toBe(false);
    });
});

describe('toBuildPath', () => {
    it('should convert json-content custom extension to .json', () => {
        expect(toBuildPath('data/item.esmaterial')).toBe('data/item.json');
        expect(toBuildPath('data/hero.esprefab')).toBe('data/hero.json');
    });

    it('should not convert non-json content types', () => {
        expect(toBuildPath('spine/char.atlas')).toBe('spine/char.atlas');
    });

    it('should not convert non-packable files', () => {
        expect(toBuildPath('assets/hero.png')).toBe('assets/hero.png');
    });

    it('should pass through unknown extensions', () => {
        expect(toBuildPath('file.xyz')).toBe('file.xyz');
    });
});
