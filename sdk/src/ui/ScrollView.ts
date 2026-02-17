import { defineComponent } from '../component';

export interface ScrollViewData {
    contentEntity: number;
    horizontalEnabled: boolean;
    verticalEnabled: boolean;
    contentWidth: number;
    contentHeight: number;
    scrollX: number;
    scrollY: number;
    inertia: boolean;
    decelerationRate: number;
}

export const ScrollView = defineComponent<ScrollViewData>('ScrollView', {
    contentEntity: 0,
    horizontalEnabled: false,
    verticalEnabled: true,
    contentWidth: 0,
    contentHeight: 0,
    scrollX: 0,
    scrollY: 0,
    inertia: true,
    decelerationRate: 0.135,
});
