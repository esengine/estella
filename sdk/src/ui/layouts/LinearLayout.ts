import { defineComponent } from '../../component';

export interface LinearLayoutData {
    direction: number;  // 0=Horizontal, 1=Vertical (matches LayoutGroup)
    itemSize: number;
    spacing: number;
    reverseOrder: boolean;
}

export const LinearLayout = defineComponent<LinearLayoutData>('LinearLayout', {
    direction: 1,  // Vertical
    itemSize: 40,
    spacing: 0,
    reverseOrder: false,
});
