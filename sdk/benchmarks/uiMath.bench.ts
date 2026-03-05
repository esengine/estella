import { bench, describe } from 'vitest';
import {
    invertMatrix4,
    screenToWorld,
    worldToScreen,
    pointInWorldRect,
    pointInOBB,
    intersectRects,
    createInvVPCache,
} from '../src/ui/uiMath';

const identityMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

const orthoMatrix = new Float32Array([
    0.002, 0, 0, 0,
    0, 0.003, 0, 0,
    0, 0, -0.002, 0,
    -1, -1, -1, 1,
]);

const resultMatrix = new Float32Array(16);

describe('uiMath - Matrix operations', () => {
    bench('invertMatrix4 (identity)', () => {
        invertMatrix4(identityMatrix, resultMatrix);
    });

    bench('invertMatrix4 (ortho projection)', () => {
        invertMatrix4(orthoMatrix, resultMatrix);
    });

    bench('invertMatrix4 x100 (no result reuse)', () => {
        for (let i = 0; i < 100; i++) {
            invertMatrix4(orthoMatrix);
        }
    });

    bench('invertMatrix4 x100 (result reuse)', () => {
        for (let i = 0; i < 100; i++) {
            invertMatrix4(orthoMatrix, resultMatrix);
        }
    });
});

describe('uiMath - Coordinate transforms', () => {
    const invVP = new Float32Array(16);
    invertMatrix4(orthoMatrix, invVP);

    bench('screenToWorld x1000', () => {
        for (let i = 0; i < 1000; i++) {
            screenToWorld(400 + i * 0.1, 300, invVP, 0, 0, 800, 600);
        }
    });

    bench('worldToScreen x1000', () => {
        for (let i = 0; i < 1000; i++) {
            worldToScreen(i * 0.5, 100, orthoMatrix, 0, 0, 800, 600);
        }
    });
});

describe('uiMath - Hit testing', () => {
    bench('pointInWorldRect x10000', () => {
        for (let i = 0; i < 10000; i++) {
            pointInWorldRect(
                50 + (i % 100), 50,
                100, 100, 200, 150,
                0.5, 0.5,
            );
        }
    });

    bench('pointInOBB x10000', () => {
        for (let i = 0; i < 10000; i++) {
            pointInOBB(
                50 + (i % 100), 50,
                100, 100, 200, 150,
                0.5, 0.5,
                0.3826834, 0.9238795,
            );
        }
    });

    bench('pointInWorldRect vs pointInOBB ratio (AABB, no rotation)', () => {
        for (let i = 0; i < 10000; i++) {
            pointInOBB(
                50 + (i % 100), 50,
                100, 100, 200, 150,
                0.5, 0.5,
                0, 1,
            );
        }
    });
});

describe('uiMath - Rect intersection', () => {
    bench('intersectRects x10000', () => {
        for (let i = 0; i < 10000; i++) {
            intersectRects(
                { x: 0, y: 0, w: 800, h: 600 },
                { x: 100 + (i % 50), y: 100, w: 200, h: 150 },
            );
        }
    });
});

describe('uiMath - InvVP cache', () => {
    const cache = createInvVPCache();

    bench('cache hit (same VP) x1000', () => {
        cache.update(orthoMatrix);
        for (let i = 0; i < 1000; i++) {
            cache.update(orthoMatrix);
            cache.getInverse(orthoMatrix);
        }
    });

    bench('cache miss (changing VP) x100', () => {
        const vp = new Float32Array(orthoMatrix);
        for (let i = 0; i < 100; i++) {
            vp[0] = 0.002 + i * 0.0001;
            cache.update(vp);
            cache.getInverse(vp);
        }
    });
});
