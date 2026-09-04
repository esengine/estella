import { defineEvent, defineResource } from 'esengine';

export interface SpawnRequest {
    x: number;
    y: number;
    color: { r: number; g: number; b: number };
}

export interface CollectEvent {
    points: number;
}

export const SpawnRequestEvent = defineEvent<SpawnRequest>(
    'SpawnRequest', { x: 0, y: 0, color: { r: 0, g: 0, b: 0 } });
export const CollectEventDef = defineEvent<CollectEvent>('CollectEvent', { points: 0 });

export interface ScoreData {
    value: number;
}

export const Score = defineResource<ScoreData>({ value: 0 }, 'Score');
