// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Emitter } from './ecs/emitter';

export enum ScreenOrientation {
    Portrait = 'portrait',
    Landscape = 'landscape',
}

/** Event payloads for {@link ScreenInfo.on}. */
export interface ScreenInfoEvents {
    resize: [width: number, height: number];
    orientationchange: [orientation: ScreenOrientation];
}

export class ScreenInfo {
    width = 0;
    height = 0;
    dpr = 1;
    orientation: ScreenOrientation = ScreenOrientation.Portrait;

    private events_ = new Emitter<ScreenInfoEvents>();
    private initialized_ = false;

    on<K extends keyof ScreenInfoEvents>(
        event: K,
        handler: (...args: ScreenInfoEvents[K]) => void,
    ): () => void {
        return this.events_.on(event, handler);
    }

    update(width: number, height: number, dpr: number = 1): void {
        const newOrientation = width > height ? ScreenOrientation.Landscape : ScreenOrientation.Portrait;
        const orientationChanged = this.initialized_ && newOrientation !== this.orientation;

        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.orientation = newOrientation;
        this.initialized_ = true;

        this.events_.emit('resize', width, height);

        if (orientationChanged) {
            this.events_.emit('orientationchange', this.orientation);
        }
    }
}
