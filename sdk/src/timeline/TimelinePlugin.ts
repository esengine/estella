import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { defineComponent, Children, Name, getComponent, Transform } from '../component';
import { UIRect } from '../ui/UIRect';
import { isEditor, isPlayMode } from '../env';
import { TrackType, WrapMode, type TimelineAsset } from './TimelineTypes';
import { parseTimelineAsset } from './TimelineLoader';
import { TimelineInstance, advanceTimeline } from './TimelineSystem';
import {
    getAllTimelineInstances,
    getTimelineInstance,
    setTimelineInstance,
    removeTimelineInstance,
    clearTimelineInstances,
} from './TimelineControl';
import { setNestedProperty } from './propertyUtils';
import { redirectPositionToUIRect } from './uiRectRedirect';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    wrapMode: string;
}

export const TimelinePlayer = defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: 'once',
});

const loadedAssets_ = new Map<string, TimelineAsset>();

export function registerTimelineAsset(path: string, asset: TimelineAsset): void {
    loadedAssets_.set(path, asset);
}

export function getTimelineAsset(path: string): TimelineAsset | undefined {
    return loadedAssets_.get(path);
}

function resolveChildEntity(world: any, rootEntity: any, childPath: string): any {
    if (!childPath) return rootEntity;

    const parts = childPath.split('/');
    let current = rootEntity;
    for (const part of parts) {
        const childrenData = world.tryGet(current, Children);
        const childEntities = childrenData?.entities ? Array.from(childrenData.entities as Iterable<any>) : [];
        if (childEntities.length === 0) return null;
        let found = false;
        for (const child of childEntities) {
            const nameData = world.tryGet(child, Name);
            if (nameData?.value === part) {
                current = child;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return current;
}

function applyPropertyTrackResults(world: any, rootEntity: any, instance: TimelineInstance): void {
    const results = instance.evaluatePropertyTracks();
    for (const result of results) {
        const targetEntity = resolveChildEntity(world, rootEntity, result.childPath);
        if (targetEntity == null) continue;

        const componentDef = getComponent(result.component);
        if (!componentDef) continue;
        if (!world.has(targetEntity, componentDef)) continue;

        if (result.component === 'Transform' && world.has(targetEntity, UIRect)) {
            const posValues = new Map<string, number>();
            const nonPosValues = new Map<string, number>();
            for (const [propPath, value] of result.values) {
                if (propPath.startsWith('position.')) {
                    posValues.set(propPath, value);
                } else {
                    nonPosValues.set(propPath, value);
                }
            }

            if (posValues.size > 0) {
                redirectPositionToUIRect(world, targetEntity, posValues);
            }

            if (nonPosValues.size > 0) {
                const data = world.get(targetEntity, componentDef);
                let modified = false;
                for (const [propPath, value] of nonPosValues) {
                    if (setNestedProperty(data, propPath, value)) {
                        modified = true;
                    }
                }
                if (modified) {
                    world.set(targetEntity, componentDef, data);
                }
            }
            continue;
        }

        const data = world.get(targetEntity, componentDef);
        let modified = false;
        for (const [propPath, value] of result.values) {
            if (setNestedProperty(data, propPath, value)) {
                modified = true;
            }
        }

        if (modified) {
            world.set(targetEntity, componentDef, data);
        }
    }
}

export class TimelinePlugin implements Plugin {
    name = 'TimelinePlugin';

    build(app: App): void {
        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                if (isEditor() && !isPlayMode()) return;

                const entities = world.getEntitiesWithComponents([TimelinePlayer]);
                for (const entity of entities) {
                    const playerData = world.get(entity, TimelinePlayer) as TimelinePlayerData;
                    if (!playerData.timeline) continue;

                    let instance = getTimelineInstance(entity);

                    if (!instance) {
                        const asset = loadedAssets_.get(playerData.timeline);
                        if (!asset) continue;
                        instance = new TimelineInstance(asset);
                        setTimelineInstance(entity, instance);
                    }

                    instance.speed = playerData.speed;
                    if (playerData.playing && !instance.playing) {
                        if (instance.currentTime === 0) {
                            instance.play();
                        } else {
                            instance.playing = true;
                        }
                    } else if (!playerData.playing && instance.playing) {
                        instance.pause();
                    }

                    advanceTimeline(instance, time.delta);
                    applyPropertyTrackResults(world, entity, instance);

                    if (!instance.playing && playerData.playing) {
                        playerData.playing = false;
                        world.insert(entity, TimelinePlayer, playerData);
                    }
                }
            },
            { name: 'TimelineSystem' }
        ));
    }

    cleanup(): void {
        clearTimelineInstances();
        loadedAssets_.clear();
    }
}

export const timelinePlugin = new TimelinePlugin();
