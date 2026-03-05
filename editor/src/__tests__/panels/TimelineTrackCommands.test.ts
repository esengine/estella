import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    AddSpineClipCommand,
    MoveSpineClipCommand,
    ResizeSpineClipCommand,
    DeleteSpineClipCommand,
    AddAudioEventCommand,
    MoveAudioEventCommand,
    DeleteAudioEventCommand,
    AddActivationRangeCommand,
    MoveActivationRangeCommand,
    DeleteActivationRangeCommand,
} from '../../panels/timeline/TimelineTrackCommands';
import type { TimelineAssetData } from '../../panels/timeline/TimelineKeyframeArea';

function createTestData(): TimelineAssetData {
    return {
        duration: 5.0,
        tracks: [
            {
                type: 'spine',
                name: 'Character',
                clips: [
                    { start: 0.0, duration: 1.0, animation: 'idle' },
                    { start: 1.0, duration: 2.0, animation: 'run' },
                ],
            },
            {
                type: 'audio',
                name: 'SFX',
                events: [
                    { time: 0.5, clip: 'whoosh.mp3' },
                    { time: 2.0, clip: 'boom.mp3' },
                ],
            },
            {
                type: 'activation',
                name: 'Particles',
                ranges: [
                    { start: 0.5, end: 2.5 },
                    { start: 3.0, end: 4.5 },
                ],
            },
        ],
    };
}

describe('Spine Clip Commands', () => {
    let data: TimelineAssetData;
    let onChanged: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        data = createTestData();
        onChanged = vi.fn();
    });

    describe('AddSpineClipCommand', () => {
        it('should add a clip to spine track', () => {
            const cmd = new AddSpineClipCommand(data, 0, { start: 3.0, duration: 1.0, animation: 'attack' }, onChanged);
            cmd.execute();

            const clips = (data.tracks[0] as any).clips;
            expect(clips).toHaveLength(3);
            expect(clips[2].animation).toBe('attack');
        });

        it('should insert clip in sorted order by start time', () => {
            const cmd = new AddSpineClipCommand(data, 0, { start: 0.5, duration: 0.5, animation: 'jump' }, onChanged);
            cmd.execute();

            const clips = (data.tracks[0] as any).clips;
            expect(clips[1].animation).toBe('jump');
            expect(clips[2].animation).toBe('run');
        });

        it('should remove clip on undo', () => {
            const cmd = new AddSpineClipCommand(data, 0, { start: 3.0, duration: 1.0, animation: 'attack' }, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[0] as any).clips).toHaveLength(2);
        });

        it('should call onChanged', () => {
            const cmd = new AddSpineClipCommand(data, 0, { start: 3.0, duration: 1.0, animation: 'attack' }, onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe('MoveSpineClipCommand', () => {
        it('should move clip to new start time', () => {
            const cmd = new MoveSpineClipCommand(data, 0, 0, 0.0, 0.5, onChanged);
            cmd.execute();

            expect((data.tracks[0] as any).clips[0].start).toBe(0.5);
        });

        it('should restore on undo', () => {
            const cmd = new MoveSpineClipCommand(data, 0, 0, 0.0, 0.5, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[0] as any).clips[0].start).toBe(0.0);
        });

        it('should merge consecutive moves on same clip', () => {
            const cmd1 = new MoveSpineClipCommand(data, 0, 0, 0.0, 0.2, onChanged);
            const cmd2 = new MoveSpineClipCommand(data, 0, 0, 0.2, 0.5, onChanged);

            expect(cmd1.canMerge(cmd2)).toBe(true);
            const merged = cmd1.merge(cmd2) as MoveSpineClipCommand;
            expect(merged.newStart).toBe(0.5);
        });
    });

    describe('ResizeSpineClipCommand', () => {
        it('should resize clip duration', () => {
            const cmd = new ResizeSpineClipCommand(data, 0, 0, 1.0, 2.0, onChanged);
            cmd.execute();

            expect((data.tracks[0] as any).clips[0].duration).toBe(2.0);
        });

        it('should restore on undo', () => {
            const cmd = new ResizeSpineClipCommand(data, 0, 0, 1.0, 2.0, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[0] as any).clips[0].duration).toBe(1.0);
        });
    });

    describe('DeleteSpineClipCommand', () => {
        it('should delete clip at index', () => {
            const cmd = new DeleteSpineClipCommand(data, 0, 0, onChanged);
            cmd.execute();

            expect((data.tracks[0] as any).clips).toHaveLength(1);
            expect((data.tracks[0] as any).clips[0].animation).toBe('run');
        });

        it('should restore clip on undo', () => {
            const cmd = new DeleteSpineClipCommand(data, 0, 0, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[0] as any).clips).toHaveLength(2);
            expect((data.tracks[0] as any).clips[0].animation).toBe('idle');
        });
    });
});

describe('Audio Event Commands', () => {
    let data: TimelineAssetData;
    let onChanged: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        data = createTestData();
        onChanged = vi.fn();
    });

    describe('AddAudioEventCommand', () => {
        it('should add an audio event', () => {
            const cmd = new AddAudioEventCommand(data, 1, { time: 3.0, clip: 'hit.mp3' }, onChanged);
            cmd.execute();

            expect((data.tracks[1] as any).events).toHaveLength(3);
            expect((data.tracks[1] as any).events[2].clip).toBe('hit.mp3');
        });

        it('should insert in sorted order', () => {
            const cmd = new AddAudioEventCommand(data, 1, { time: 1.0, clip: 'mid.mp3' }, onChanged);
            cmd.execute();

            const events = (data.tracks[1] as any).events;
            expect(events[1].clip).toBe('mid.mp3');
            expect(events[2].clip).toBe('boom.mp3');
        });

        it('should remove on undo', () => {
            const cmd = new AddAudioEventCommand(data, 1, { time: 3.0, clip: 'hit.mp3' }, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[1] as any).events).toHaveLength(2);
        });
    });

    describe('MoveAudioEventCommand', () => {
        it('should move event to new time', () => {
            const cmd = new MoveAudioEventCommand(data, 1, 0, 0.5, 1.5, onChanged);
            cmd.execute();

            expect((data.tracks[1] as any).events[0].time).toBe(1.5);
        });

        it('should restore on undo', () => {
            const cmd = new MoveAudioEventCommand(data, 1, 0, 0.5, 1.5, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[1] as any).events[0].time).toBe(0.5);
        });

        it('should merge consecutive moves', () => {
            const cmd1 = new MoveAudioEventCommand(data, 1, 0, 0.5, 0.8, onChanged);
            const cmd2 = new MoveAudioEventCommand(data, 1, 0, 0.8, 1.2, onChanged);

            expect(cmd1.canMerge(cmd2)).toBe(true);
        });
    });

    describe('DeleteAudioEventCommand', () => {
        it('should delete event at index', () => {
            const cmd = new DeleteAudioEventCommand(data, 1, 0, onChanged);
            cmd.execute();

            expect((data.tracks[1] as any).events).toHaveLength(1);
            expect((data.tracks[1] as any).events[0].clip).toBe('boom.mp3');
        });

        it('should restore on undo', () => {
            const cmd = new DeleteAudioEventCommand(data, 1, 0, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[1] as any).events).toHaveLength(2);
            expect((data.tracks[1] as any).events[0].clip).toBe('whoosh.mp3');
        });
    });
});

describe('Activation Range Commands', () => {
    let data: TimelineAssetData;
    let onChanged: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        data = createTestData();
        onChanged = vi.fn();
    });

    describe('AddActivationRangeCommand', () => {
        it('should add a range', () => {
            const cmd = new AddActivationRangeCommand(data, 2, { start: 4.5, end: 5.0 }, onChanged);
            cmd.execute();

            expect((data.tracks[2] as any).ranges).toHaveLength(3);
        });

        it('should remove on undo', () => {
            const cmd = new AddActivationRangeCommand(data, 2, { start: 4.5, end: 5.0 }, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[2] as any).ranges).toHaveLength(2);
        });
    });

    describe('MoveActivationRangeCommand', () => {
        it('should move range to new start/end', () => {
            const cmd = new MoveActivationRangeCommand(data, 2, 0, 0.5, 2.5, 1.0, 3.0, onChanged);
            cmd.execute();

            const range = (data.tracks[2] as any).ranges[0];
            expect(range.start).toBe(1.0);
            expect(range.end).toBe(3.0);
        });

        it('should restore on undo', () => {
            const cmd = new MoveActivationRangeCommand(data, 2, 0, 0.5, 2.5, 1.0, 3.0, onChanged);
            cmd.execute();
            cmd.undo();

            const range = (data.tracks[2] as any).ranges[0];
            expect(range.start).toBe(0.5);
            expect(range.end).toBe(2.5);
        });

        it('should merge consecutive moves', () => {
            const cmd1 = new MoveActivationRangeCommand(data, 2, 0, 0.5, 2.5, 0.8, 2.8, onChanged);
            const cmd2 = new MoveActivationRangeCommand(data, 2, 0, 0.8, 2.8, 1.0, 3.0, onChanged);

            expect(cmd1.canMerge(cmd2)).toBe(true);
        });
    });

    describe('DeleteActivationRangeCommand', () => {
        it('should delete range at index', () => {
            const cmd = new DeleteActivationRangeCommand(data, 2, 0, onChanged);
            cmd.execute();

            expect((data.tracks[2] as any).ranges).toHaveLength(1);
            expect((data.tracks[2] as any).ranges[0].start).toBe(3.0);
        });

        it('should restore on undo', () => {
            const cmd = new DeleteActivationRangeCommand(data, 2, 0, onChanged);
            cmd.execute();
            cmd.undo();

            expect((data.tracks[2] as any).ranges).toHaveLength(2);
            expect((data.tracks[2] as any).ranges[0].start).toBe(0.5);
        });
    });
});
