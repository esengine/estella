declare module 'pixelmatch' {
    function pixelmatch(
        img1: Buffer | Uint8Array,
        img2: Buffer | Uint8Array,
        output: Buffer | Uint8Array | null,
        width: number,
        height: number,
        options?: { threshold?: number },
    ): number;
    export default pixelmatch;
}
