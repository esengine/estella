import { describe, it, expect, beforeEach } from 'vitest';
import { AssetDatabase, isUUID } from '../../asset/AssetDatabase';
import type { NativeFS, FileStats, DirectoryEntry } from '../../types/NativeFS';

function createMockFS(files: Record<string, string> = {}): NativeFS {
    const store = new Map<string, string>(Object.entries(files));
    return {
        readFile: async (path: string) => store.get(path) ?? null,
        writeFile: async (path: string, content: string) => { store.set(path, content); return true; },
        exists: async (path: string) => store.has(path),
        listDirectory: async () => [],
        listDirectoryDetailed: async (): Promise<DirectoryEntry[]> => [],
        createDirectory: async () => true,
        copyFile: async () => true,
        getFileStats: async (): Promise<FileStats | null> => ({ size: 100, modified: new Date(), created: null }),
    } as unknown as NativeFS;
}

describe('AssetDatabase utilities', () => {
    describe('isUUID', () => {
        it('should recognize valid UUIDs', () => {
            expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
            expect(isUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
            expect(isUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
        });

        it('should recognize uppercase UUIDs', () => {
            expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
        });

        it('should reject invalid UUIDs', () => {
            expect(isUUID('not-a-uuid')).toBe(false);
            expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false);
            expect(isUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
            expect(isUUID('550e8400-e29b-41d4-a716-4466554400000')).toBe(false);
            expect(isUUID('550e8400e29b41d4a716446655440000')).toBe(false);
            expect(isUUID('')).toBe(false);
        });

        it('should reject UUIDs with invalid characters', () => {
            expect(isUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
            expect(isUUID('550e8400-e29b-41d4-a716-44665544000 ')).toBe(false);
        });

        it('should reject UUIDs with wrong structure', () => {
            expect(isUUID('550e84000-e29b-41d4-a716-44665544000')).toBe(false);
            expect(isUUID('550e840-e29b-41d4-a716-446655440000')).toBe(false);
        });
    });
});

describe('AssetDatabase', () => {
    let db: AssetDatabase;

    beforeEach(() => {
        db = new AssetDatabase();
    });

    describe('uninitialized state', () => {
        it('returns undefined for unknown UUID', () => {
            expect(db.getPath('nonexistent-uuid')).toBeUndefined();
        });

        it('returns undefined for unknown path', () => {
            expect(db.getUuid('nonexistent/path.png')).toBeUndefined();
        });

        it('has zero entries', () => {
            expect(db.entryCount).toBe(0);
        });

        it('getEntry returns undefined', () => {
            expect(db.getEntry('any-uuid')).toBeUndefined();
        });

        it('getEntryByPath returns undefined', () => {
            expect(db.getEntryByPath('any/path')).toBeUndefined();
        });

        it('returns empty labels', () => {
            expect(db.getAllLabels()).toEqual([]);
        });

        it('returns empty groups', () => {
            expect(db.getAllGroups()).toEqual([]);
        });
    });

    describe('ensureMeta', () => {
        it('throws when not initialized', async () => {
            await expect(db.ensureMeta('assets/test.png')).rejects.toThrow('AssetDatabase not initialized');
        });

        it('creates new meta file for unknown asset', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/test.png');

            expect(isUUID(uuid)).toBe(true);
            expect(db.getPath(uuid)).toBe('assets/test.png');
            expect(db.getUuid('assets/test.png')).toBe(uuid);
        });

        it('returns existing UUID for already registered path', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid1 = await db.ensureMeta('assets/test.png');
            const uuid2 = await db.ensureMeta('assets/test.png');

            expect(uuid1).toBe(uuid2);
        });

        it('reads existing meta file', async () => {
            const meta = JSON.stringify({
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                version: '2.0',
                type: 'texture',
                labels: [],
                address: null,
                importer: {},
                platformOverrides: {},
            });
            const fs = createMockFS({
                '/project/assets/sprite.png.meta': meta,
            });
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/sprite.png');

            expect(uuid).toBe('550e8400-e29b-41d4-a716-446655440000');
        });
    });

    describe('UUID / path bidirectional lookup', () => {
        it('maintains consistent mapping', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid1 = await db.ensureMeta('assets/a.png');
            const uuid2 = await db.ensureMeta('assets/b.png');

            expect(db.getPath(uuid1)).toBe('assets/a.png');
            expect(db.getPath(uuid2)).toBe('assets/b.png');
            expect(db.getUuid('assets/a.png')).toBe(uuid1);
            expect(db.getUuid('assets/b.png')).toBe(uuid2);
        });

        it('entryCount reflects registered assets', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            expect(db.entryCount).toBe(0);

            await db.ensureMeta('assets/a.png');
            expect(db.entryCount).toBe(1);

            await db.ensureMeta('assets/b.png');
            expect(db.entryCount).toBe(2);
        });
    });

    describe('entry access', () => {
        it('getEntry returns full entry data', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/sprite.png');
            const entry = db.getEntry(uuid);

            expect(entry).toBeDefined();
            expect(entry!.uuid).toBe(uuid);
            expect(entry!.path).toBe('assets/sprite.png');
        });

        it('getEntryByPath returns entry', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/sprite.png');
            const entry = db.getEntryByPath('assets/sprite.png');

            expect(entry).toBeDefined();
            expect(entry!.uuid).toBe(uuid);
        });

        it('getAllEntries iterates all entries', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            await db.ensureMeta('assets/a.png');
            await db.ensureMeta('assets/b.png');
            await db.ensureMeta('assets/c.png');

            const entries = [...db.getAllEntries()];
            expect(entries.length).toBe(3);
        });
    });

    describe('address lookup', () => {
        it('sets and retrieves address', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/hero.png');
            await db.updateMeta(uuid, { address: 'hero-sprite' });

            expect(db.getUuidByAddress('hero-sprite')).toBe(uuid);
        });

        it('getEntryByAddress returns entry', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/hero.png');
            await db.updateMeta(uuid, { address: 'hero-sprite' });

            const entry = db.getEntryByAddress('hero-sprite');
            expect(entry).toBeDefined();
            expect(entry!.uuid).toBe(uuid);
        });

        it('changing address removes old mapping', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/hero.png');
            await db.updateMeta(uuid, { address: 'old-address' });
            await db.updateMeta(uuid, { address: 'new-address' });

            expect(db.getUuidByAddress('old-address')).toBeUndefined();
            expect(db.getUuidByAddress('new-address')).toBe(uuid);
        });

        it('setting address to null removes mapping', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/hero.png');
            await db.updateMeta(uuid, { address: 'test-address' });
            await db.updateMeta(uuid, { address: null });

            expect(db.getUuidByAddress('test-address')).toBeUndefined();
        });
    });

    describe('label queries', () => {
        it('assigns and queries labels', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/hero.png');
            await db.updateMeta(uuid, { labels: new Set(['character', 'player']) });

            const characterUuids = db.getUuidsByLabel('character');
            expect(characterUuids.has(uuid)).toBe(true);

            const playerUuids = db.getUuidsByLabel('player');
            expect(playerUuids.has(uuid)).toBe(true);
        });

        it('getAllLabels returns all unique labels', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid1 = await db.ensureMeta('assets/a.png');
            const uuid2 = await db.ensureMeta('assets/b.png');
            await db.updateMeta(uuid1, { labels: new Set(['character', 'sprite']) });
            await db.updateMeta(uuid2, { labels: new Set(['enemy', 'sprite']) });

            const allLabels = db.getAllLabels();
            expect(allLabels).toContain('character');
            expect(allLabels).toContain('enemy');
            expect(allLabels).toContain('sprite');
        });

        it('changing labels removes old label index entries', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { labels: new Set(['old-label']) });

            expect(db.getUuidsByLabel('old-label').has(uuid)).toBe(true);

            await db.updateMeta(uuid, { labels: new Set(['new-label']) });

            expect(db.getUuidsByLabel('old-label').has(uuid)).toBe(false);
            expect(db.getUuidsByLabel('new-label').has(uuid)).toBe(true);
        });

        it('returns empty set for unknown label', () => {
            const result = db.getUuidsByLabel('nonexistent');
            expect(result.size).toBe(0);
        });
    });

    describe('group queries', () => {
        it('updates group and queries by group', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { group: 'ui' });

            const uiUuids = db.getUuidsByGroup('ui');
            expect(uiUuids.has(uuid)).toBe(true);
        });

        it('changing group removes from old group', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { group: 'old-group' });
            await db.updateMeta(uuid, { group: 'new-group' });

            expect(db.getUuidsByGroup('old-group').has(uuid)).toBe(false);
            expect(db.getUuidsByGroup('new-group').has(uuid)).toBe(true);
        });

        it('returns empty set for unknown group', () => {
            const result = db.getUuidsByGroup('nonexistent');
            expect(result.size).toBe(0);
        });

        it('getAllGroups returns registered groups', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { group: 'ui' });

            expect(db.getAllGroups()).toContain('ui');
        });
    });

    describe('unregister', () => {
        it('removes entry by path', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/to-remove.png');
            expect(db.entryCount).toBe(1);

            db.unregister('assets/to-remove.png');

            expect(db.entryCount).toBe(0);
            expect(db.getPath(uuid)).toBeUndefined();
            expect(db.getUuid('assets/to-remove.png')).toBeUndefined();
        });

        it('cleans up address index on unregister', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { address: 'test-addr' });

            db.unregister('assets/a.png');

            expect(db.getUuidByAddress('test-addr')).toBeUndefined();
        });

        it('cleans up label index on unregister', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { labels: new Set(['test-label']) });

            db.unregister('assets/a.png');

            expect(db.getUuidsByLabel('test-label').has(uuid)).toBe(false);
        });

        it('cleans up group index on unregister', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { group: 'test-group' });

            db.unregister('assets/a.png');

            expect(db.getUuidsByGroup('test-group').has(uuid)).toBe(false);
        });

        it('no-op for unknown path', () => {
            db.unregister('nonexistent/path.png');
            expect(db.entryCount).toBe(0);
        });
    });

    describe('updatePath', () => {
        it('updates path while preserving UUID', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/old-name.png');
            db.updatePath('assets/old-name.png', 'assets/new-name.png');

            expect(db.getPath(uuid)).toBe('assets/new-name.png');
            expect(db.getUuid('assets/new-name.png')).toBe(uuid);
            expect(db.getUuid('assets/old-name.png')).toBeUndefined();
        });

        it('no-op for unknown path', () => {
            db.updatePath('nonexistent/old.png', 'nonexistent/new.png');
            expect(db.entryCount).toBe(0);
        });
    });

    describe('importer settings', () => {
        it('updates importer settings', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/sprite.png');
            await db.updateMeta(uuid, {
                importer: { sliceBorder: { left: 10, right: 10, top: 10, bottom: 10 } },
            });

            const entry = db.getEntry(uuid);
            expect(entry!.importer).toEqual({ sliceBorder: { left: 10, right: 10, top: 10, bottom: 10 } });
        });

        it('getSliceBorder returns null for non-texture', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/data.json');
            expect(db.getSliceBorder(uuid)).toBeNull();
        });

        it('getSliceBorder returns null for unknown UUID', () => {
            expect(db.getSliceBorder('nonexistent')).toBeNull();
        });
    });

    describe('platformOverrides', () => {
        it('updates platform overrides', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/sprite.png');
            await db.updateMeta(uuid, {
                platformOverrides: {
                    wechat: { maxSize: 512 },
                },
            });

            const entry = db.getEntry(uuid);
            expect(entry!.platformOverrides).toEqual({ wechat: { maxSize: 512 } });
        });
    });

    describe('index consistency', () => {
        it('maintains consistency after multiple operations', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid1 = await db.ensureMeta('assets/a.png');
            const uuid2 = await db.ensureMeta('assets/b.png');
            const uuid3 = await db.ensureMeta('assets/c.png');

            await db.updateMeta(uuid1, { labels: new Set(['shared']), address: 'addr-a', group: 'ui' });
            await db.updateMeta(uuid2, { labels: new Set(['shared']), address: 'addr-b', group: 'ui' });
            await db.updateMeta(uuid3, { labels: new Set(['unique']), address: 'addr-c', group: 'audio' });

            expect(db.getUuidsByLabel('shared').size).toBe(2);
            expect(db.getUuidsByGroup('ui').size).toBe(2);

            db.unregister('assets/a.png');

            expect(db.getUuidsByLabel('shared').size).toBe(1);
            expect(db.getUuidsByGroup('ui').size).toBe(1);
            expect(db.getUuidByAddress('addr-a')).toBeUndefined();
            expect(db.getUuidByAddress('addr-b')).toBe(uuid2);

            db.updatePath('assets/b.png', 'assets/b-renamed.png');

            expect(db.getUuid('assets/b-renamed.png')).toBe(uuid2);
            expect(db.getPath(uuid2)).toBe('assets/b-renamed.png');
            expect(db.getUuidByAddress('addr-b')).toBe(uuid2);
            expect(db.getUuidsByLabel('shared').has(uuid2)).toBe(true);
        });

        it('re-initialization clears all state', async () => {
            const fs = createMockFS();
            await db.initialize('/project', fs);

            const uuid = await db.ensureMeta('assets/a.png');
            await db.updateMeta(uuid, { labels: new Set(['test']), address: 'addr' });

            expect(db.entryCount).toBe(1);

            await db.initialize('/project2', fs);

            expect(db.entryCount).toBe(0);
            expect(db.getPath(uuid)).toBeUndefined();
            expect(db.getUuidByAddress('addr')).toBeUndefined();
            expect(db.getUuidsByLabel('test').size).toBe(0);
        });
    });
});
