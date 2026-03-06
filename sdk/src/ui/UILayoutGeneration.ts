import { defineResource } from '../resource';

export interface UILayoutGenerationData {
    generation: number;
}

export const UILayoutGeneration = defineResource<UILayoutGenerationData>({ generation: 0 }, 'UILayoutGeneration');
