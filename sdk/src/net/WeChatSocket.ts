import type { GameSocketOptions, SocketReadyState } from './GameSocket';

export class WeChatSocket {
    private url_: string;
    private protocols_?: string | string[];
    private task_: any = null;
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
        if (this.task_) return;

        const wx = (globalThis as any).wx;
        if (!wx?.connectSocket) {
            this.onError?.('wx.connectSocket not available');
            return;
        }

        this.readyState = 'connecting';

        this.task_ = wx.connectSocket({
            url: this.url_,
            protocols: Array.isArray(this.protocols_) ? this.protocols_ : this.protocols_ ? [this.protocols_] : undefined,
        });

        this.task_.onOpen(() => {
            this.readyState = 'open';
            for (const msg of this.sendQueue_) {
                this.task_.send({ data: msg });
            }
            this.sendQueue_ = [];
            this.onOpen?.();
        });

        this.task_.onMessage((res: { data: string | ArrayBuffer }) => {
            this.onMessage?.(res.data);
        });

        this.task_.onClose((res: { code: number; reason: string }) => {
            this.readyState = 'closed';
            this.task_ = null;
            this.onClose?.(res.code, res.reason);
        });

        this.task_.onError((err: unknown) => {
            this.onError?.(err);
        });
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.task_) {
            this.task_.send({ data });
        } else {
            this.sendQueue_.push(data);
        }
    }

    close(code?: number, reason?: string): void {
        if (this.task_) {
            this.readyState = 'closing';
            this.task_.close({ code, reason });
        }
    }
}
