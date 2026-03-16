import { defineResource } from '../resource';
import type { Entity } from '../types';

export type UIEventType = 'click' | 'press' | 'release' | 'hover_enter' | 'hover_exit' | 'focus' | 'blur' | 'submit' | 'change' | 'drag_start' | 'drag_move' | 'drag_end' | 'scroll' | 'select' | 'deselect';

export type UIEventHandler = (event: UIEvent) => void;
export type Unsubscribe = () => void;

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
    private entityTypeHandlers_ = new Map<Entity, Map<UIEventType, UIEventHandler[]>>();
    private globalHandlers_ = new Map<UIEventType, UIEventHandler[]>();
    private activeDispatches_ = new Set<string>();
    private entityValidator_: ((entity: Entity) => boolean) | null = null;

    on(entity: Entity, type: UIEventType, handler: UIEventHandler): Unsubscribe;
    on(type: UIEventType, handler: UIEventHandler): Unsubscribe;
    on(
        entityOrType: Entity | UIEventType,
        typeOrHandler: UIEventType | UIEventHandler,
        handler?: UIEventHandler,
    ): Unsubscribe {
        if (handler !== undefined) {
            const entity = entityOrType as Entity;
            const type = typeOrHandler as UIEventType;
            let typeMap = this.entityTypeHandlers_.get(entity);
            if (!typeMap) {
                typeMap = new Map();
                this.entityTypeHandlers_.set(entity, typeMap);
            }
            let handlers = typeMap.get(type);
            if (!handlers) {
                handlers = [];
                typeMap.set(type, handlers);
            }
            handlers.push(handler);
            let removed = false;
            return () => {
                if (removed) return;
                removed = true;
                const arr = typeMap!.get(type);
                if (arr) {
                    const idx = arr.indexOf(handler);
                    if (idx !== -1) arr.splice(idx, 1);
                }
            };
        } else {
            const type = entityOrType as UIEventType;
            const h = typeOrHandler as UIEventHandler;
            let handlers = this.globalHandlers_.get(type);
            if (!handlers) {
                handlers = [];
                this.globalHandlers_.set(type, handlers);
            }
            handlers.push(h);
            let removed = false;
            return () => {
                if (removed) return;
                removed = true;
                const arr = this.globalHandlers_.get(type);
                if (arr) {
                    const idx = arr.indexOf(h);
                    if (idx !== -1) arr.splice(idx, 1);
                }
            };
        }
    }

    removeAll(entity: Entity): void {
        this.entityTypeHandlers_.delete(entity);
    }

    setEntityValidator(validator: (entity: Entity) => boolean): void {
        this.entityValidator_ = validator;
    }

    emit(entity: Entity, type: UIEventType, target?: Entity): UIEvent {
        const t = target ?? entity;
        const event: UIEvent = {
            entity, type, target: t, currentTarget: entity,
            propagationStopped: false,
            stopPropagation() { this.propagationStopped = true; },
        };
        this.events_.push(event);

        const key = `${entity as number}:${type}`;
        if (!this.activeDispatches_.has(key)) {
            this.activeDispatches_.add(key);
            this.dispatchToHandlers_(event);
            this.activeDispatches_.delete(key);
        }

        return event;
    }

    emitBubbled(entity: Entity, type: UIEventType, target: Entity, shared: UIEvent): void {
        const event: UIEvent = {
            entity, type, target, currentTarget: entity,
            propagationStopped: false,
            stopPropagation() { shared.propagationStopped = true; },
        };
        this.events_.push(event);

        const key = `${entity as number}:${type}`;
        if (!this.activeDispatches_.has(key)) {
            this.activeDispatches_.add(key);
            this.dispatchToHandlers_(event);
            this.activeDispatches_.delete(key);
        }
    }

    drain(): UIEvent[] {
        if (this.entityValidator_) {
            for (const entity of this.entityTypeHandlers_.keys()) {
                if (!this.entityValidator_(entity)) {
                    this.entityTypeHandlers_.delete(entity);
                }
            }
        }
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

    private dispatchToHandlers_(event: UIEvent): void {
        const typeMap = this.entityTypeHandlers_.get(event.entity);
        if (typeMap) {
            const handlers = typeMap.get(event.type);
            if (handlers) {
                this.invokeHandlers_([...handlers], event);
            }
        }

        const globalHandlers = this.globalHandlers_.get(event.type);
        if (globalHandlers) {
            this.invokeHandlers_([...globalHandlers], event);
        }
    }

    private invokeHandlers_(handlers: UIEventHandler[], event: UIEvent): void {
        for (const handler of handlers) {
            try {
                handler(event);
            } catch (e) {
                console.error(`UIEvent handler error [${event.type}]:`, e);
            }
        }
    }
}

export const UIEvents = defineResource<UIEventQueue>(new UIEventQueue(), 'UIEvents');
