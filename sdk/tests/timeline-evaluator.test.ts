import { describe, it, expect } from 'vitest';
import {
    evaluateChannel,
    applyWrapMode,
    sampleTimeline,
    type SampleDeps,
} from '../src/timeline/TimelineEvaluator';
import {
    WrapMode,
    TrackType,
    InterpType,
    type PropertyChannel,
    type TimelineAsset,
} from '../src/timeline/TimelineTypes';

function ch(keyframes: PropertyChannel['keyframes'], property = 'value'): PropertyChannel {
    return { property, keyframes };
}

describe('evaluateChannel', () => {
    it('returns 0 for an empty channel and the lone value for one keyframe', () => {
        expect(evaluateChannel(ch([]), 1)).toBe(0);
        expect(evaluateChannel(ch([{ time: 0, value: 7, inTangent: 0, outTangent: 0 }]), 5)).toBe(7);
    });

    it('clamps to the endpoints outside the keyframe range', () => {
        const c = ch([
            { time: 1, value: 10, inTangent: 0, outTangent: 0 },
            { time: 3, value: 30, inTangent: 0, outTangent: 0 },
        ]);
        expect(evaluateChannel(c, 0)).toBe(10);
        expect(evaluateChannel(c, 5)).toBe(30);
    });

    it('interpolates linearly', () => {
        const c = ch([
            { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
            { time: 2, value: 100, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
        ]);
        expect(evaluateChannel(c, 1)).toBeCloseTo(50, 5);
    });

    it('holds the previous value with Step interpolation', () => {
        const c = ch([
            { time: 0, value: 5, inTangent: 0, outTangent: 0, interpolation: InterpType.Step },
            { time: 2, value: 99, inTangent: 0, outTangent: 0, interpolation: InterpType.Step },
        ]);
        expect(evaluateChannel(c, 1.9)).toBe(5);
        expect(evaluateChannel(c, 2)).toBe(99);
    });

    it('eases (easeIn = t^2 at the midpoint)', () => {
        const c = ch([
            { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.EaseIn },
            { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: InterpType.EaseIn },
        ]);
        expect(evaluateChannel(c, 0.5)).toBeCloseTo(0.25, 5);
    });

    it('hermite passes through both keyframes', () => {
        const c = ch([
            { time: 0, value: 0, inTangent: 1, outTangent: 1, interpolation: InterpType.Hermite },
            { time: 1, value: 10, inTangent: 1, outTangent: 1, interpolation: InterpType.Hermite },
        ]);
        expect(evaluateChannel(c, 0)).toBeCloseTo(0, 5);
        expect(evaluateChannel(c, 1)).toBeCloseTo(10, 5);
    });
});

describe('applyWrapMode', () => {
    it('Once clamps and stops past the end', () => {
        expect(applyWrapMode(5, 2, WrapMode.Once)).toEqual({ time: 2, stopped: true });
        expect(applyWrapMode(1, 2, WrapMode.Once)).toEqual({ time: 1, stopped: false });
    });
    it('Loop wraps with fmod', () => {
        expect(applyWrapMode(5, 2, WrapMode.Loop)).toEqual({ time: 1, stopped: false });
    });
    it('PingPong reflects in the second half', () => {
        expect(applyWrapMode(3, 2, WrapMode.PingPong).time).toBeCloseTo(1, 5);
    });
});

// A minimal mock world keyed by a sentinel component "definition" object.
function mockDeps(store: Map<string, any>, defs: Record<string, object>): SampleDeps {
    return {
        world: {
            has: (_e, def) => store.has((def as any).__name),
            get: (_e, def) => store.get((def as any).__name),
            set: (_e, def, data) => store.set((def as any).__name, data),
        },
        getComponent: (name) => defs[name],
        resolveChild: (root, childPath) => (childPath ? null : root),
    };
}

describe('sampleTimeline', () => {
    it('applies a property track to the resolved component', () => {
        const defs = { Transform: { __name: 'Transform' } };
        const store = new Map<string, any>([
            ['Transform', { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } }],
        ]);
        const asset: TimelineAsset = {
            version: '1.1',
            type: 'timeline',
            duration: 2,
            wrapMode: WrapMode.Once,
            tracks: [{
                type: TrackType.Property,
                name: 'Move',
                childPath: '',
                component: 'Transform',
                channels: [ch([
                    { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                    { time: 2, value: 100, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                ], 'position.x')],
            }],
        };

        sampleTimeline(asset, 1, 1 as Entity, mockDeps(store, defs));
        expect(store.get('Transform').position.x).toBeCloseTo(50, 5);
    });

    it('skipChannel omits muted channels', () => {
    const defs = { Transform: { __name: 'Transform' } };
    const store = new Map<string, any>([
      ['Transform', { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } }],
    ]);
    const asset: TimelineAsset = {
      version: '1.1', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
      tracks: [{
        type: TrackType.Property, name: 'Move', childPath: '', component: 'Transform',
        channels: [
          ch([{ time: 0, value: 11, inTangent: 0, outTangent: 0 }], 'position.x'),
          ch([{ time: 0, value: 22, inTangent: 0, outTangent: 0 }], 'position.y'),
        ],
      }],
    };
    sampleTimeline(asset, 0, 1 as Entity, mockDeps(store, defs), {
      skipChannel: (_cp, _comp, prop) => prop === 'position.y',
    });
    expect(store.get('Transform').position.x).toBe(11);
    expect(store.get('Transform').position.y).toBe(0); // muted → untouched
  });

  it('rotation.z writes a half-angle quaternion (matches the C++ runtime)', () => {
        const defs = { Transform: { __name: 'Transform' } };
        const store = new Map<string, any>([
            ['Transform', { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } }],
        ]);
        const angle = Math.PI / 2; // 90°
        const asset: TimelineAsset = {
            version: '1.1',
            type: 'timeline',
            duration: 1,
            wrapMode: WrapMode.Once,
            tracks: [{
                type: TrackType.Property,
                name: 'Spin',
                childPath: '',
                component: 'Transform',
                channels: [ch([{ time: 0, value: angle, inTangent: 0, outTangent: 0 }], 'rotation.z')],
            }],
        };

        sampleTimeline(asset, 0, 1 as Entity, mockDeps(store, defs));
        const q = store.get('Transform').rotation;
        expect(q.w).toBeCloseTo(Math.cos(angle / 2), 5);
        expect(q.z).toBeCloseTo(Math.sin(angle / 2), 5);
        expect(q.x).toBe(0);
        expect(q.y).toBe(0);
    });
});
