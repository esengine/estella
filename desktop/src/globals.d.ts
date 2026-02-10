declare module '/wasm/esengine.js' {
    const factory: (config?: unknown) => Promise<import('esengine').ESEngineModule>;
    export default factory;
}
