import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { GridLayout } from './layouts/GridLayout';
import { PluginName } from '../systemLabels';

export class GridLayoutPlugin implements Plugin {
    name = PluginName.GridLayout;

    build(_app: App): void {
        registerComponent('GridLayout', GridLayout);
    }
}

export const gridLayoutPlugin = new GridLayoutPlugin();
