import { defineResource } from '../resource';
import type { Entity } from '../types';

export type UIEventType = 'click' | 'press' | 'release' | 'hover_enter' | 'hover_exit' | 'focus' | 'blur' | 'submit' | 'change' | 'drag_start' | 'drag_move' | 'drag_end' | 'scroll';

export interface UIEvent {
    entity: Entity;
    type: UIEventType;
    target: Entity;
    currentTarget: Entity;
    propagationStopped: boolean;
    stopPropagation(): void;
}

export class UIEventQueue {
    private events_: UIEvent[] = [];

    emit(entity: Entity, type: UIEventType, target?: Entity): UIEvent {
        const t = target ?? entity;
        const event: UIEvent = {
            entity, type, target: t, currentTarget: entity,
            propagationStopped: false,
            stopPropagation() { this.propagationStopped = true; },
        };
        this.events_.push(event);
        return event;
    }

    emitBubbled(entity: Entity, type: UIEventType, target: Entity, shared: UIEvent): void {
        this.events_.push({
            entity, type, target, currentTarget: entity,
            propagationStopped: false,
            stopPropagation() { shared.propagationStopped = true; },
        });
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
