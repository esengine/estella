import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { GridLayout } from './layouts/GridLayout';

export class GridLayoutPlugin implements Plugin {
    build(_app: App): void {
        registerComponent('GridLayout', GridLayout);
    }
}

export const gridLayoutPlugin = new GridLayoutPlugin();
