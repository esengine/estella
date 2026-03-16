import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { FanLayout } from './layouts/FanLayout';

export class FanLayoutPlugin implements Plugin {
    name = 'fanLayout';

    build(_app: App): void {
        registerComponent('FanLayout', FanLayout);
    }
}

export const fanLayoutPlugin = new FanLayoutPlugin();
