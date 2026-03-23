export type SocketReadyState = 'connecting' | 'open' | 'closing' | 'closed';

export interface GameSocketOptions {
    url: string;
    protocols?: string | string[];
}

export class GameSocket {
    private url_: string;
    private protocols_?: string | string[];
    private ws_: WebSocket | null = null;
    private sendQueue_: (string | ArrayBuffer)[] = [];

    readyState: SocketReadyState = 'closed';

    onOpen: (() => void) | null = null;
    onMessage: ((data: string | ArrayBuffer) => void) | null = null;
    onClose: ((code: number, reason: string) => void) | null = null;
    onError: ((error: unknown) => void) | null = null;

    constructor(options: GameSocketOptions) {
        this.url_ = options.url;
        this.protocols_ = options.protocols;
    }

    connect(): void {
        if (this.ws_) return;

        this.readyState = 'connecting';

        try {
            this.ws_ = new WebSocket(this.url_, this.protocols_);
            this.ws_.binaryType = 'arraybuffer';

            this.ws_.onopen = () => {
                this.readyState = 'open';
                for (const msg of this.sendQueue_) {
                    this.ws_!.send(msg);
                }
                this.sendQueue_ = [];
                this.onOpen?.();
            };

            this.ws_.onmessage = (e) => {
                this.onMessage?.(e.data);
            };

            this.ws_.onclose = (e) => {
                this.readyState = 'closed';
                this.ws_ = null;
                this.onClose?.(e.code, e.reason);
            };

            this.ws_.onerror = (e) => {
                this.onError?.(e);
            };
        } catch (e) {
            this.readyState = 'closed';
            this.onError?.(e);
        }
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.ws_) {
            this.ws_.send(data);
        } else {
            this.sendQueue_.push(data);
        }
    }

    close(code?: number, reason?: string): void {
        if (this.ws_) {
            this.readyState = 'closing';
            this.ws_.close(code, reason);
        }
    }
}
