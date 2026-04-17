import { describe, it, expect, beforeEach } from 'vitest';
import {
    AssetRegistry,
    UUID_REF_PREFIX,
    UUID_V4_REGEX,
    isUuidRef,
    extractUuid,
    makeUuidRef,
    type AssetEntry,
    type AssetManifest,
} from '../src/asset/AssetRegistry';

const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-3333-4333-8333-cccccccccccc';

function textureEntry(uuid: string, path: string): AssetEntry {
    return { uuid, path, type: 'texture', importer: { maxSize: 2048 } };
}

describe('AssetRegistry ref helpers', () => {
    it('UUID_V4_REGEX matches the expected shape', () => {
        expect(UUID_V4_REGEX.test(UUID_A)).toBe(true);
        expect(UUID_V4_REGEX.test('not-a-uuid')).toBe(false);
        expect(UUID_V4_REGEX.test('aaaa-1111-4111-8111-aaaaaaaaaaaa')).toBe(false);
    });

    it('isUuidRef accepts canonical and bare forms', () => {
        expect(isUuidRef(`${UUID_REF_PREFIX}${UUID_A}`)).toBe(true);
        expect(isUuidRef(UUID_A)).toBe(true);
        expect(isUuidRef('@uuid:garbage')).toBe(false);
        expect(isUuidRef('assets/player.png')).toBe(false);
        expect(isUuidRef('not-a-uuid-at-all')).toBe(false);
        expect(isUuidRef(null)).toBe(false);
        expect(isUuidRef(123)).toBe(false);
    });

    it('extractUuid returns the lower-cased UUID for both forms', () => {
        expect(extractUuid(`${UUID_REF_PREFIX}${UUID_A}`)).toBe(UUID_A);
        expect(extractUuid(`${UUID_REF_PREFIX}${UUID_A.toUpperCase()}`)).toBe(UUID_A);
        expect(extractUuid(UUID_A)).toBe(UUID_A);
        expect(extractUuid(UUID_A.toUpperCase())).toBe(UUID_A);
        expect(extractUuid('assets/player.png')).toBeNull();
        expect(extractUuid(null)).toBeNull();
    });

    it('makeUuidRef builds a canonical ref string', () => {
        expect(makeUuidRef(UUID_A)).toBe(`${UUID_REF_PREFIX}${UUID_A}`);
        expect(makeUuidRef(UUID_A.toUpperCase())).toBe(`${UUID_REF_PREFIX}${UUID_A}`);
        expect(() => makeUuidRef('not-a-uuid')).toThrow();
    });
});

describe('AssetRegistry CRUD', () => {
    let reg: AssetRegistry;

    beforeEach(() => {
        reg = new AssetRegistry();
    });

    it('addEntry and resolveUuid roundtrip', () => {
        reg.addEntry(textureEntry(UUID_A, 'assets/player.png'));
        const entry = reg.resolveUuid(UUID_A);
        expect(entry).not.toBeNull();
        expect(entry!.path).toBe('assets/player.png');
        expect(entry!.type).toBe('texture');
        expect(entry!.importer).toEqual({ maxSize: 2048 });
    });

    it('uuidToPath and pathToUuid are inverses', () => {
        reg.addEntry(textureEntry(UUID_A, 'assets/player.png'));
        expect(reg.uuidToPath(UUID_A)).toBe('assets/player.png');
        expect(reg.pathToUuid('assets/player.png')).toBe(UUID_A);
    });

    it('UUID case is normalized to lower', () => {
        reg.addEntry(textureEntry(UUID_A.toUpperCase(), 'assets/player.png'));
        expect(reg.uuidToPath(UUID_A)).toBe('assets/player.png');
        expect(reg.uuidToPath(UUID_A.toUpperCase())).toBe('assets/player.png');
    });

    it('re-adding the same UUID with a new path updates the path index', () => {
        reg.addEntry(textureEntry(UUID_A, 'assets/old/player.png'));
        reg.addEntry(textureEntry(UUID_A, 'assets/new/player.png'));

        expect(reg.size).toBe(1);
        expect(reg.uuidToPath(UUID_A)).toBe('assets/new/player.png');
        expect(reg.pathToUuid('assets/old/player.png')).toBeNull();
        expect(reg.pathToUuid('assets/new/player.png')).toBe(UUID_A);
    });

    it('removeByUuid drops both indexes', () => {
        reg.addEntry(textureEntry(UUID_A, 'assets/player.png'));
        expect(reg.removeByUuid(UUID_A)).toBe(true);
        expect(reg.removeByUuid(UUID_A)).toBe(false);
        expect(reg.resolveUuid(UUID_A)).toBeNull();
        expect(reg.pathToUuid('assets/player.png')).toBeNull();
    });

    it('rejects invalid UUID shape', () => {
        expect(() => reg.addEntry({ uuid: 'not-a-uuid', path: 'a.png', type: 'texture' })).toThrow();
    });

    it('rejects missing path', () => {
        expect(() => reg.addEntry({ uuid: UUID_A, path: '', type: 'texture' })).toThrow();
    });

    it('getAllByType filters by meta.type', () => {
        reg.addEntry(textureEntry(UUID_A, 'a.png'));
        reg.addEntry(textureEntry(UUID_B, 'b.png'));
        reg.addEntry({ uuid: UUID_C, path: 'music.wav', type: 'audio' });

        expect(reg.getAllByType('texture')).toHaveLength(2);
        expect(reg.getAllByType('audio')).toHaveLength(1);
        expect(reg.getAllByType('shader')).toHaveLength(0);
    });

    it('entries() returns a snapshot of all entries', () => {
        reg.addEntry(textureEntry(UUID_A, 'a.png'));
        reg.addEntry(textureEntry(UUID_B, 'b.png'));
        const all = reg.entries();
        expect(all).toHaveLength(2);
        expect(all.map(e => e.uuid).sort()).toEqual([UUID_A, UUID_B].sort());
    });

    it('clear() drops everything', () => {
        reg.addEntry(textureEntry(UUID_A, 'a.png'));
        reg.addEntry(textureEntry(UUID_B, 'b.png'));
        reg.clear();
        expect(reg.size).toBe(0);
        expect(reg.resolveUuid(UUID_A)).toBeNull();
    });
});

describe('AssetRegistry.loadManifest', () => {
    it('accepts a well-formed manifest', () => {
        const reg = new AssetRegistry();
        const manifest: AssetManifest = {
            version: '1.0',
            entries: [
                textureEntry(UUID_A, 'a.png'),
                textureEntry(UUID_B, 'b.png'),
            ],
        };
        reg.loadManifest(manifest);
        expect(reg.size).toBe(2);
    });

    it('rejects unsupported manifest version', () => {
        const reg = new AssetRegistry();
        const bad = { version: '2.0', entries: [] } as unknown as AssetManifest;
        expect(() => reg.loadManifest(bad)).toThrow(/version/);
    });
});

describe('AssetRegistry.resolveRef', () => {
    let reg: AssetRegistry;

    beforeEach(() => {
        reg = new AssetRegistry();
        reg.addEntry(textureEntry(UUID_A, 'assets/player.png'));
    });

    it('resolves @uuid: refs to the current path', () => {
        expect(reg.resolveRef(makeUuidRef(UUID_A))).toBe('assets/player.png');
    });

    it('returns null for an unknown UUID ref', () => {
        expect(reg.resolveRef(makeUuidRef(UUID_B))).toBeNull();
    });

    it('returns legacy path strings untouched (backward compat)', () => {
        expect(reg.resolveRef('assets/other.png')).toBe('assets/other.png');
    });

    it('resolves after a path move via re-add', () => {
        const ref = makeUuidRef(UUID_A);
        expect(reg.resolveRef(ref)).toBe('assets/player.png');
        reg.addEntry(textureEntry(UUID_A, 'assets/renamed/player.png'));
        expect(reg.resolveRef(ref)).toBe('assets/renamed/player.png');
    });
});
