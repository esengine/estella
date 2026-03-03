import { defineEvent, defineResource } from 'esengine';

export interface SpawnRequest {
    x: number;
    y: number;
    color: { r: number; g: number; b: number };
}

export interface CollectEvent {
    points: number;
}

export const SpawnRequestEvent = defineEvent<SpawnRequest>('SpawnRequest');
export const CollectEventDef = defineEvent<CollectEvent>('CollectEvent');

export interface ScoreData {
    value: number;
}

export const Score = defineResource<ScoreData>({ value: 0 }, 'Score');
