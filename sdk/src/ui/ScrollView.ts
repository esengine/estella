import { defineComponent } from '../component';
import type { Entity } from '../types';

export interface ScrollViewData {
    contentEntity: Entity;
    horizontalEnabled: boolean;
    verticalEnabled: boolean;
    contentWidth: number;
    contentHeight: number;
    scrollX: number;
    scrollY: number;
    inertia: boolean;
    decelerationRate: number;
    elastic: boolean;
    wheelSensitivity: number;
}

export const ScrollView = defineComponent<ScrollViewData>('ScrollView', {
    contentEntity: 0 as Entity,
    horizontalEnabled: false,
    verticalEnabled: true,
    contentWidth: 0,
    contentHeight: 0,
    scrollX: 0,
    scrollY: 0,
    inertia: true,
    decelerationRate: 0.135,
    elastic: true,
    wheelSensitivity: 0.1,
}, { entityFields: ['contentEntity'] });
