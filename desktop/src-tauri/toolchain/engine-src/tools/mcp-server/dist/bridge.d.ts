export declare class BridgeClient {
    private baseUrl_;
    discover(projectPath?: string): Promise<boolean>;
    get connected(): boolean;
    get(path: string): Promise<unknown>;
    post(path: string, body: unknown): Promise<unknown>;
    health(): Promise<unknown>;
}
