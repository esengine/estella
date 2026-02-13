import { defineResource } from '../resource';
import type { Entity } from '../types';

export type UIEventType = 'click' | 'press' | 'release' | 'hover_enter' | 'hover_exit' | 'submit' | 'change';

export interface UIEvent {
    entity: Entity;
    type: UIEventType;
}

export class UIEventQueue {
    private events_: UIEvent[] = [];

    emit(entity: Entity, type: UIEventType): void {
        this.events_.push({ entity, type });
    }

    drain(): UIEvent[] {
        const events = this.events_;
        this.events_ = [];
        return events;
    }

    query(type: UIEventType): UIEvent[] {
        return this.events_.filter(e => e.type === type);
    }

    hasEvent(entity: Entity, type: UIEventType): boolean {
        return this.events_.some(e => e.entity === entity && e.type === type);
    }
}

export const UIEvents = defineResource<UIEventQueue>(new UIEventQueue(), 'UIEvents');
