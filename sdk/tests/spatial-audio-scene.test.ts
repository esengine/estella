// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spatial-audio-scene.test.ts
 * @brief   A spatial source is heard where it IS, not where it is offset to.
 *
 *          `calculateAttenuation` and `calculatePanning` have been tested as
 *          arithmetic since the day they were written. What nothing drove was
 *          the frame that feeds them: which entity is the listener, and which
 *          transform field a source's place comes from. Audio was the one
 *          subsystem reading `position` — the offset from a parent — while
 *          every other reads `worldPosition`, so a loop parented to a walking
 *          character stayed at the character's origin and nobody could hear it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';
import type { Quat, Vec3 } from '../src/types';

const handles: AudioHandle[] = [];
function playingHandle(): AudioHandle {
    const h = {
        id: handles.length + 1, stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        isPlaying: true, currentTime: 0, duration: 1,
    };
    handles.push(h);
    return h;
}

const backend = {
    name: 'Mock',
    mixer: null,
    isReady: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    ensureResumed: vi.fn().mockResolvedValue(undefined),
    loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 1 }),
    unloadBuffer: vi.fn(),
    play: vi.fn(),
    suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
} as unknown as PlatformAudioBackend;

vi.mock('../src/platform/base', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/platform/base')>()),
    platformCreateAudioBackend: () => backend,
    platformOnMemoryWarning: () => () => {},
}));

/**
 * Transform is a C++ component, and a unit test has no engine behind it. The
 * stand-in carries BOTH pairs of fields, which is the whole point: an assertion
 * cannot tell `position` from `worldPosition` unless the two disagree.
 */
vi.mock('../src/ecs/component', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/ecs/component')>();
    return {
        ...actual,
        WorldTransform: actual.defineComponent('TestPose', {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            worldPosition: { x: 0, y: 0, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        }),
    };
});

const { App } = await import('../src/app/app');
const { AudioPlugin } = await import('../src/audio/AudioPlugin');
const { Audio } = await import('../src/audio/Audio');
const { AudioSource, AudioListener } = await import('../src/audio/AudioComponents');
const { WorldTransform } = await import('../src/ecs/component');
const { AttenuationModel } = await import('../src/audio/SpatialAudio');

interface Pose { position: Vec3; rotation: Quat; worldPosition: Vec3; worldRotation: Quat }
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** A quarter turn about +Y: the listener's right hand swings to face −Z. */
const QUARTER_Y: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

function pose(local: Vec3, world: Vec3, worldRotation: Quat = IDENTITY): Pose {
    return { position: local, rotation: IDENTITY, worldPosition: world, worldRotation };
}

async function appWithClip() {
    const app = App.new();
    app.addPlugin(new AudioPlugin());
    await app.getResource(Audio).preload('hum.wav');
    return app;
}

/** A spatial source that plays itself, as one authored in a scene does. */
const SPATIAL = {
    clip: 'hum.wav', playOnAwake: true, loop: true, spatial: true, volume: 1,
    minDistance: 100, maxDistance: 1000, rolloff: 1,
    attenuationModel: AttenuationModel.Linear,
};

describe('a spatial AudioSource in a scene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        handles.length = 0;
        (backend.play as ReturnType<typeof vi.fn>).mockImplementation(() => playingHandle());
    });

    it('is placed where the world puts it, not where its parent offset says', async () => {
        const app = await appWithClip();
        const ear = app.world.spawn();
        app.world.insert(ear, AudioListener, { enabled: true });
        app.world.insert(ear, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));

        // Authored at its parent's origin and carried 550 units away by it — the
        // shape of every loop attached to a character or a vehicle.
        const source = app.world.spawn();
        app.world.insert(source, AudioSource, SPATIAL);
        app.world.insert(source, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 550, y: 0, z: 0 }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);

        const handle = handles[0]!;
        const volume = (handle.setVolume as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as number;
        // Linear over [100, 1000]: half way out is half gain. Read from `position`
        // the distance is 0 and this is 1 — audible at full volume from anywhere.
        expect(volume).toBeCloseTo(0.5, 2);
    });

    it('is panned by where the listener is facing, in world space', async () => {
        const app = await appWithClip();
        const ear = app.world.spawn();
        app.world.insert(ear, AudioListener, { enabled: true });
        // Turned a quarter turn, so world +X is now BEHIND-right rather than right.
        app.world.insert(ear, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, QUARTER_Y));

        const source = app.world.spawn();
        app.world.insert(source, AudioSource, SPATIAL);
        app.world.insert(source, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -400 }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);

        const pan = (handles[0]!.setPan as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as number;
        // −Z is the turned listener's right, 400 of the 1000 units panning runs
        // over. Unturned, the same source is dead ahead and this is 0.
        expect(pan).toBeCloseTo(0.4, 2);
    });

    it("leaves a non-spatial source's volume alone", async () => {
        const app = await appWithClip();
        const ear = app.world.spawn();
        app.world.insert(ear, AudioListener, { enabled: true });
        app.world.insert(ear, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));

        const source = app.world.spawn();
        app.world.insert(source, AudioSource, { ...SPATIAL, spatial: false });
        app.world.insert(source, WorldTransform, pose({ x: 0, y: 0, z: 0 }, { x: 900, y: 0, z: 0 }));

        await app.tick(1 / 60);
        await app.tick(1 / 60);

        // A UI sound is placeless. Attenuating it would also fight every
        // `setVolume` a script makes, every frame.
        expect(handles[0]!.setVolume).not.toHaveBeenCalled();
        expect(handles[0]!.setPan).not.toHaveBeenCalled();
    });
});
