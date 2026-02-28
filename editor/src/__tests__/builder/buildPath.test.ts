import { describe, it, expect } from 'vitest';
import { toBuildPath } from 'esengine';

describe('toBuildPath', () => {
    it('should convert .esprefab to .json', () => {
        expect(toBuildPath('assets/prefabs/Star.esprefab')).toBe('assets/prefabs/Star.json');
    });

    it('should convert .bmfont to .json', () => {
        expect(toBuildPath('assets/fonts/pixel.bmfont')).toBe('assets/fonts/pixel.json');
    });

    it('should convert .esmaterial to .json', () => {
        expect(toBuildPath('assets/materials/glow.esmaterial')).toBe('assets/materials/glow.json');
    });

    it('should NOT convert standard extensions', () => {
        expect(toBuildPath('assets/textures/player.png')).toBe('assets/textures/player.png');
        expect(toBuildPath('assets/data/config.json')).toBe('assets/data/config.json');
        expect(toBuildPath('assets/audio/bgm.mp3')).toBe('assets/audio/bgm.mp3');
    });

    it('should NOT convert non-JSON custom extensions (spine, fnt)', () => {
        expect(toBuildPath('assets/spine/hero.atlas')).toBe('assets/spine/hero.atlas');
        expect(toBuildPath('assets/spine/hero.skel')).toBe('assets/spine/hero.skel');
        expect(toBuildPath('assets/fonts/pixel.fnt')).toBe('assets/fonts/pixel.fnt');
    });

    it('should handle paths without directory', () => {
        expect(toBuildPath('Star.esprefab')).toBe('Star.json');
    });

    it('should handle deep nested paths', () => {
        expect(toBuildPath('assets/levels/world1/boss.esprefab')).toBe('assets/levels/world1/boss.json');
    });
});

describe('Manifest prefab path conversion', () => {
    it('should use .json path for prefab assets in manifest', () => {
        const prefabPath = 'assets/prefabs/Enemy.esprefab';
        const buildPath = toBuildPath(prefabPath);
        expect(buildPath).toBe('assets/prefabs/Enemy.json');
        expect(buildPath).not.toContain('.esprefab');
    });
});

describe('Prefab nested reference conversion', () => {
    it('should convert nested prefab paths inside prefab data', () => {
        const nestedPath = 'assets/prefabs/EnemyBullet.esprefab';
        expect(toBuildPath(nestedPath)).toBe('assets/prefabs/EnemyBullet.json');
    });
});

describe('Scene entity prefab path conversion', () => {
    it('should convert scene entity prefab.prefabPath via toBuildPath', () => {
        const sceneEntity = {
            prefab: { prefabPath: 'assets/prefabs/Star.esprefab' },
            components: [],
        };
        sceneEntity.prefab.prefabPath = toBuildPath(sceneEntity.prefab.prefabPath);
        expect(sceneEntity.prefab.prefabPath).toBe('assets/prefabs/Star.json');
    });

    it('should convert all prefab instances in a scene', () => {
        const entities = [
            { prefab: { prefabPath: 'assets/prefabs/Star.esprefab' }, components: [] },
            { prefab: { prefabPath: 'assets/prefabs/EnemyA.esprefab' }, components: [] },
            { prefab: { prefabPath: 'assets/prefabs/EnemyB.esprefab' }, components: [] },
        ];
        for (const entity of entities) {
            entity.prefab.prefabPath = toBuildPath(entity.prefab.prefabPath);
        }
        expect(entities[0].prefab.prefabPath).toBe('assets/prefabs/Star.json');
        expect(entities[1].prefab.prefabPath).toBe('assets/prefabs/EnemyA.json');
        expect(entities[2].prefab.prefabPath).toBe('assets/prefabs/EnemyB.json');
    });

    it('should not modify non-prefab component asset refs', () => {
        const textureRef = 'assets/textures/player.png';
        expect(toBuildPath(textureRef)).toBe('assets/textures/player.png');
    });
});
