import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { FanLayout } from './layouts/FanLayout';
import { PluginName } from '../systemLabels';

export class FanLayoutPlugin implements Plugin {
    name = PluginName.FanLayout;

    build(_app: App): void {
        registerComponent('FanLayout', FanLayout);
    }
}

export const fanLayoutPlugin = new FanLayoutPlugin();
