export interface EntityComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface RuntimeEntityData {
    entityId: number;
    name: string;
    parentId: number | null;
    children: number[];
    components: EntityComponentData[];
}

export interface RuntimeStats {
    fps: number;
    entityCount: number;
}

type EventHandler = (data: any) => void;

export class GameViewBridge {
    private iframe_: HTMLIFrameElement;
    private messageId_ = 0;
    private pendingRequests_ = new Map<number, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();
    private listeners_ = new Map<string, Set<EventHandler>>();
    private boundHandler_: (e: MessageEvent) => void;
    private ready_ = false;

    constructor(iframe: HTMLIFrameElement) {
        this.iframe_ = iframe;
        this.boundHandler_ = (e: MessageEvent) => this.handleMessage(e);
        window.addEventListener('message', this.boundHandler_);
    }

    get isReady(): boolean {
        return this.ready_;
    }

    request<T = any>(type: string, payload?: Record<string, unknown>, timeout = 5000): Promise<T> {
        return new Promise((resolve, reject) => {
            const requestId = ++this.messageId_;
            const timer = setTimeout(() => {
                this.pendingRequests_.delete(requestId);
                reject(new Error(`GameViewBridge: '${type}' timed out`));
            }, timeout);
            this.pendingRequests_.set(requestId, { resolve, timer });
            this.postCommand({ type, requestId, ...payload });
        });
    }

    send(type: string, payload?: Record<string, unknown>): void {
        this.postCommand({ type, ...payload });
    }

    async pause(): Promise<void> {
        await this.request('pause');
    }

    async resume(): Promise<void> {
        await this.request('resume');
    }

    async step(): Promise<void> {
        await this.request('step');
    }

    setSpeed(speed: number): void {
        this.send('set-speed', { speed });
    }

    async queryEntityList(): Promise<RuntimeEntityData[]> {
        return this.request('query-entity-list');
    }

    async queryEntity(entityId: number): Promise<RuntimeEntityData> {
        return this.request('query-entity', { entityId });
    }

    async setEntityProperty(
        entityId: number,
        component: string,
        property: string,
        value: unknown,
    ): Promise<void> {
        return this.request('set-entity-property', { entityId, component, property, value });
    }

    async queryStats(): Promise<RuntimeStats> {
        return this.request('query-stats');
    }

    on(event: string, handler: EventHandler): () => void {
        if (!this.listeners_.has(event)) {
            this.listeners_.set(event, new Set());
        }
        this.listeners_.get(event)!.add(handler);
        return () => {
            this.listeners_.get(event)?.delete(handler);
        };
    }

    dispose(): void {
        window.removeEventListener('message', this.boundHandler_);
        for (const { timer } of this.pendingRequests_.values()) {
            clearTimeout(timer);
        }
        this.pendingRequests_.clear();
        this.listeners_.clear();
        this.ready_ = false;
    }

    private postCommand(data: Record<string, unknown>): void {
        this.iframe_.contentWindow?.postMessage(data, '*');
    }

    private handleMessage(e: MessageEvent): void {
        if (e.source !== this.iframe_.contentWindow) return;

        const msg = e.data;
        if (!msg || typeof msg !== 'object' || !msg.type) return;

        if (msg.type === 'ready') {
            this.ready_ = true;
        }

        if (msg.requestId !== undefined) {
            const pending = this.pendingRequests_.get(msg.requestId);
            if (pending) {
                clearTimeout(pending.timer);
                pending.resolve(msg.data);
                this.pendingRequests_.delete(msg.requestId);
                return;
            }
        }

        const handlers = this.listeners_.get(msg.type);
        if (handlers) {
            for (const handler of handlers) {
                handler(msg.data);
            }
        }
    }
}
