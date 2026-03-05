import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    AddKeyframeCommand,
    DeleteKeyframeCommand,
    MoveKeyframeCommand,
    AddTrackCommand,
    DeleteTrackCommand,
} from '../../panels/timeline/TimelineCommands';
import type { TimelineAssetData, TimelineTrackData } from '../../panels/timeline/TimelineKeyframeArea';

function createTestData(): TimelineAssetData {
    return {
        duration: 3.0,
        tracks: [
            {
                type: 'property',
                name: 'Fade',
                channels: [
                    {
                        property: 'color.a',
                        keyframes: [
                            { time: 0.0, value: 0.0 },
                            { time: 1.0, value: 1.0 },
                            { time: 3.0, value: 0.0 },
                        ],
                    },
                    {
                        property: 'position.x',
                        keyframes: [
                            { time: 0.0, value: 0.0 },
                            { time: 3.0, value: 100.0 },
                        ],
                    },
                ],
            },
            {
                type: 'activation',
                name: 'Show',
                ranges: [{ start: 0.5, end: 2.5 }],
            },
        ],
    };
}

describe('TimelineCommands', () => {
    let data: TimelineAssetData;
    let onChanged: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        data = createTestData();
        onChanged = vi.fn();
    });

    describe('AddKeyframeCommand', () => {
        it('should add a keyframe at specified time', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 0.5, value: 0.5 }, onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(4);
            expect(kfs[1]).toEqual({ time: 0.5, value: 0.5 });
        });

        it('should insert keyframe in sorted time order', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 2.0, value: 0.7 }, onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs[2].time).toBe(2.0);
            expect(kfs[3].time).toBe(3.0);
        });

        it('should call onChanged after execute', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 0.5, value: 0.5 }, onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });

        it('should remove keyframe on undo', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 0.5, value: 0.5 }, onChanged);
            cmd.execute();
            cmd.undo();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(3);
            expect(kfs.find((k: any) => k.time === 0.5)).toBeUndefined();
        });

        it('should call onChanged after undo', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 0.5, value: 0.5 }, onChanged);
            cmd.execute();
            onChanged.mockClear();
            cmd.undo();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });

        it('should have correct description', () => {
            const cmd = new AddKeyframeCommand(data, 0, 0, { time: 0.5, value: 0.5 }, onChanged);
            expect(cmd.description).toBe('Add keyframe');
        });
    });

    describe('DeleteKeyframeCommand', () => {
        it('should delete a single keyframe by index', () => {
            const cmd = new DeleteKeyframeCommand(data, 0, 0, [1], onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(2);
            expect(kfs[0].time).toBe(0.0);
            expect(kfs[1].time).toBe(3.0);
        });

        it('should delete multiple keyframes', () => {
            const cmd = new DeleteKeyframeCommand(data, 0, 0, [0, 2], onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(1);
            expect(kfs[0].time).toBe(1.0);
        });

        it('should restore keyframes on undo', () => {
            const cmd = new DeleteKeyframeCommand(data, 0, 0, [1], onChanged);
            cmd.execute();
            cmd.undo();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(3);
            expect(kfs[1].time).toBe(1.0);
            expect(kfs[1].value).toBe(1.0);
        });

        it('should restore multiple deleted keyframes in correct positions', () => {
            const cmd = new DeleteKeyframeCommand(data, 0, 0, [0, 2], onChanged);
            cmd.execute();
            cmd.undo();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs).toHaveLength(3);
            expect(kfs[0].time).toBe(0.0);
            expect(kfs[2].time).toBe(3.0);
        });

        it('should call onChanged', () => {
            const cmd = new DeleteKeyframeCommand(data, 0, 0, [1], onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe('MoveKeyframeCommand', () => {
        it('should move a keyframe to new time', () => {
            const cmd = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.5, onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs[1].time).toBe(1.5);
        });

        it('should restore original time on undo', () => {
            const cmd = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.5, onChanged);
            cmd.execute();
            cmd.undo();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            expect(kfs[1].time).toBe(1.0);
        });

        it('should re-sort keyframes after move', () => {
            const cmd = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 3.5, onChanged);
            cmd.execute();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            const times = kfs.map((k: any) => k.time);
            expect(times).toEqual([0.0, 3.0, 3.5]);
        });

        it('should merge with consecutive move on same keyframe', () => {
            const cmd1 = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.2, onChanged);
            const cmd2 = new MoveKeyframeCommand(data, 0, 0, 1, 1.2, 1.5, onChanged);

            expect(cmd1.canMerge(cmd2)).toBe(true);

            const merged = cmd1.merge(cmd2) as MoveKeyframeCommand;
            expect(merged.newTime).toBe(1.5);
        });

        it('should not merge moves on different keyframes', () => {
            const cmd1 = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.2, onChanged);
            const cmd2 = new MoveKeyframeCommand(data, 0, 0, 0, 0.0, 0.2, onChanged);

            expect(cmd1.canMerge(cmd2)).toBe(false);
        });

        it('should undo to original time even after merge', () => {
            const cmd1 = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.2, onChanged);
            cmd1.execute();

            const cmd2 = new MoveKeyframeCommand(data, 0, 0, 1, 1.2, 1.5, onChanged);
            cmd2.execute();

            const merged = cmd1.merge(cmd2) as MoveKeyframeCommand;
            merged.undo();

            const kfs = (data.tracks[0] as any).channels[0].keyframes;
            const kf = kfs.find((k: any) => k.time === 1.0);
            expect(kf).toBeDefined();
        });

        it('should call onChanged', () => {
            const cmd = new MoveKeyframeCommand(data, 0, 0, 1, 1.0, 1.5, onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe('AddTrackCommand', () => {
        it('should add a new track', () => {
            const newTrack: TimelineTrackData = {
                type: 'property',
                name: 'Scale',
                channels: [{ property: 'scale.x', keyframes: [] }],
            };

            const cmd = new AddTrackCommand(data, newTrack, onChanged);
            cmd.execute();

            expect(data.tracks).toHaveLength(3);
            expect(data.tracks[2].name).toBe('Scale');
        });

        it('should remove track on undo', () => {
            const newTrack: TimelineTrackData = {
                type: 'property',
                name: 'Scale',
                channels: [{ property: 'scale.x', keyframes: [] }],
            };

            const cmd = new AddTrackCommand(data, newTrack, onChanged);
            cmd.execute();
            cmd.undo();

            expect(data.tracks).toHaveLength(2);
        });

        it('should call onChanged', () => {
            const newTrack: TimelineTrackData = {
                type: 'activation',
                name: 'Vis',
                ranges: [],
            };

            const cmd = new AddTrackCommand(data, newTrack, onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe('DeleteTrackCommand', () => {
        it('should delete track at index', () => {
            const cmd = new DeleteTrackCommand(data, 0, onChanged);
            cmd.execute();

            expect(data.tracks).toHaveLength(1);
            expect(data.tracks[0].name).toBe('Show');
        });

        it('should restore track on undo', () => {
            const cmd = new DeleteTrackCommand(data, 0, onChanged);
            cmd.execute();
            cmd.undo();

            expect(data.tracks).toHaveLength(2);
            expect(data.tracks[0].name).toBe('Fade');
            expect(data.tracks[0].type).toBe('property');
        });

        it('should restore track at correct index', () => {
            const cmd = new DeleteTrackCommand(data, 1, onChanged);
            cmd.execute();
            cmd.undo();

            expect(data.tracks).toHaveLength(2);
            expect(data.tracks[1].name).toBe('Show');
        });

        it('should call onChanged', () => {
            const cmd = new DeleteTrackCommand(data, 0, onChanged);
            cmd.execute();
            expect(onChanged).toHaveBeenCalledTimes(1);
        });
    });
});
