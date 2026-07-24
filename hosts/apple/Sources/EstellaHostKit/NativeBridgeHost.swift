import Foundation
import JavaScriptCore
import CoreGraphics
import ImageIO

/// Builds the JS object that satisfies the SDK's `NativeBridge` contract
/// (sdk/src/platform/native/bridge.ts), backed by Foundation. `installNativePlatform`
/// adapts it into the engine's PlatformAdapter, so the unchanged TS SDK + wasm core get
/// their OS capabilities from here — no WebView, no DOM.
///
/// Async methods return real JS Promises resolved on the main run loop (the thread the host
/// pumps), so JSC is only ever touched from one thread.
public final class NativeBridgeHost {
    private let rt: JSRuntime
    private let root: URL              // packaged-asset base for project-relative reads
    private let cacheDir: URL          // content-addressed hot-update cache
    private var input: JSValue?        // the engine's input sink (registerInput)
    public var backingScale: Double = 1.0

    public init(runtime: JSRuntime, assetRoot: URL) {
        self.rt = runtime
        self.root = assetRoot
        self.cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("estella")
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    /// The JS object to pass to `EstellaBoot.installPlatform`.
    public func makeBridgeObject() -> JSValue {
        let ctx = rt.context
        let bridge = JSValue(newObjectIn: ctx)!
        func set(_ name: String, _ fn: Any) { bridge.setObject(fn, forKeyedSubscript: name as NSString) }

        // --- files / network (async → Promise) ---
        let readFile: @convention(block) (String) -> JSValue = { [weak self] path in
            self!.promise { resolve, reject in
                if let data = self!.readData(path) { resolve(self!.rt.makeArrayBuffer(data)) }
                else { reject("readFile: not found: \(path)") }
            }
        }
        set("readFile", readFile)

        let fileExists: @convention(block) (String) -> JSValue = { [weak self] path in
            self!.promise { resolve, _ in resolve(JSValue(bool: self!.resolveURL(path) != nil, in: ctx)) }
        }
        set("fileExists", fileExists)

        let fetchFn: @convention(block) (String, JSValue?) -> JSValue = { [weak self] url, _ in
            self!.fetch(url)
        }
        set("fetch", fetchFn)

        let loadImagePixels: @convention(block) (String) -> JSValue = { [weak self] path in
            self!.promise { resolve, reject in
                guard let (w, h, rgba) = self!.decodeRGBA(path) else { reject("loadImagePixels: decode failed: \(path)"); return }
                let out = JSValue(newObjectIn: ctx)!
                out.setObject(w, forKeyedSubscript: "width" as NSString)
                out.setObject(h, forKeyedSubscript: "height" as NSString)
                out.setObject(self!.rt.makeUint8Array(rgba), forKeyedSubscript: "pixels" as NSString)
                resolve(out)
            }
        }
        set("loadImagePixels", loadImagePixels)

        // --- persistent key-value store (sync, NSUserDefaults) ---
        let ud = UserDefaults.standard
        let getItem: @convention(block) (String) -> Any? = { ud.string(forKey: "es:" + $0) }
        set("getStorageItem", getItem)
        let setItem: @convention(block) (String, String) -> Void = { ud.set($1, forKey: "es:" + $0) }
        set("setStorageItem", setItem)
        let removeItem: @convention(block) (String) -> Void = { ud.removeObject(forKey: "es:" + $0) }
        set("removeStorageItem", removeItem)
        let keys: @convention(block) () -> [String] = {
            ud.dictionaryRepresentation().keys.filter { $0.hasPrefix("es:") }.map { String($0.dropFirst(3)) }
        }
        set("storageKeys", keys)

        // --- content-addressed cache (hot-update offline store, async) ---
        let readCache: @convention(block) (String) -> JSValue = { [weak self] key in
            self!.promise { resolve, _ in
                let f = self!.cacheDir.appendingPathComponent(key)
                if let d = try? Data(contentsOf: f) { resolve(self!.rt.makeArrayBuffer(d)) }
                else { resolve(JSValue(nullIn: ctx)) }
            }
        }
        set("readCacheFile", readCache)
        let writeCache: @convention(block) (String, JSValue) -> JSValue = { [weak self] key, buf in
            self!.promise { resolve, _ in
                if let d = self!.dataFromArrayBuffer(buf) { try? d.write(to: self!.cacheDir.appendingPathComponent(key)) }
                resolve(JSValue(undefinedIn: ctx))
            }
        }
        set("writeCacheFile", writeCache)

        // --- input sink registration ---
        let registerInput: @convention(block) (JSValue) -> JSValue = { [weak self] listener in
            self!.input = listener
            let unsub: @convention(block) () -> Void = { [weak self] in self!.input = nil }
            return JSValue(object: unsub, in: ctx)
        }
        set("registerInput", registerInput)

        // --- device / locale ---
        let dpr: @convention(block) () -> Double = { [weak self] in self!.backingScale }
        set("devicePixelRatio", dpr)
        let now: @convention(block) () -> Double = { CFAbsoluteTimeGetCurrent() * 1000.0 }
        set("now", now)
        let language: @convention(block) () -> String = { Locale.preferredLanguages.first ?? "en" }
        set("language", language)

        return bridge
    }

    // MARK: - Input push (called by the front end's view)

    public func pushTouchStart(_ id: Int, _ x: Double, _ y: Double) { input?.invokeMethod("onTouchStart", withArguments: [id, x, y]) }
    public func pushTouchMove(_ id: Int, _ x: Double, _ y: Double)  { input?.invokeMethod("onTouchMove", withArguments: [id, x, y]) }
    public func pushTouchEnd(_ id: Int)                             { input?.invokeMethod("onTouchEnd", withArguments: [id]) }
    public func pushKeyDown(_ code: String)                         { input?.invokeMethod("onKeyDown", withArguments: [code]) }
    public func pushKeyUp(_ code: String)                           { input?.invokeMethod("onKeyUp", withArguments: [code]) }

    // MARK: - Helpers

    /// Create a JS Promise whose executor runs `body` on the main run loop (safe JSC access).
    private func promise(_ body: @escaping (_ resolve: @escaping (Any?) -> Void, _ reject: @escaping (String) -> Void) -> Void) -> JSValue {
        let ctx = rt.context
        return JSValue(newPromiseIn: ctx) { resolve, reject in
            let doResolve: (Any?) -> Void = { v in resolve?.call(withArguments: [v as Any]) }
            let doReject: (String) -> Void = { msg in reject?.call(withArguments: [JSValue(object: msg, in: ctx) as Any]) }
            DispatchQueue.main.async { body(doResolve, doReject) }
        }
    }

    private func fetch(_ url: String) -> JSValue {
        let ctx = rt.context
        return JSValue(newPromiseIn: ctx) { resolve, _ in
            guard let u = URL(string: url) else {
                resolve?.call(withArguments: [NativeBridgeHost.errorResponse(in: ctx)])
                return
            }
            URLSession.shared.dataTask(with: u) { data, response, _ in
                DispatchQueue.main.async {
                    let http = response as? HTTPURLResponse
                    let out = JSValue(newObjectIn: ctx)!
                    out.setObject((http?.statusCode ?? 0) < 400 && data != nil, forKeyedSubscript: "ok" as NSString)
                    out.setObject(http?.statusCode ?? 0, forKeyedSubscript: "status" as NSString)
                    if let data { out.setObject(self.rt.makeArrayBuffer(data), forKeyedSubscript: "arrayBuffer" as NSString) }
                    resolve?.call(withArguments: [out as Any])
                }
            }.resume()
        }
    }

    private static func errorResponse(in ctx: JSContext) -> JSValue {
        let out = JSValue(newObjectIn: ctx)!
        out.setObject(false, forKeyedSubscript: "ok" as NSString)
        out.setObject(0, forKeyedSubscript: "status" as NSString)
        return out
    }

    private func resolveURL(_ path: String) -> URL? {
        if path.hasPrefix("/") { let u = URL(fileURLWithPath: path); return FileManager.default.fileExists(atPath: u.path) ? u : nil }
        let u = root.appendingPathComponent(path)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    private func readData(_ path: String) -> Data? { resolveURL(path).flatMap { try? Data(contentsOf: $0) } }

    private func dataFromArrayBuffer(_ buf: JSValue) -> Data? {
        // The SDK hands ArrayBuffers back as JS values; read length + bytes via the typed-array
        // view the engine already uses. Kept simple for the skeleton (copies through a Uint8Array).
        let ctx = rt.context
        guard let u8 = ctx.evaluateScript("(function(b){return new Uint8Array(b);})")?.call(withArguments: [buf]) else { return nil }
        let len = Int(u8.objectForKeyedSubscript("length").toInt32())
        var bytes = [UInt8](repeating: 0, count: len)
        for i in 0..<len { bytes[i] = UInt8(truncatingIfNeeded: u8.atIndex(i).toInt32()) }
        return Data(bytes)
    }

    /// Decode an image file to top-first RGBA8 (the engine's pixel-decode texture contract).
    private func decodeRGBA(_ path: String) -> (Int, Int, Data)? {
        guard let url = resolveURL(path),
              let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        let w = img.width, h = img.height
        var buffer = Data(count: w * h * 4)
        let ok = buffer.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            // CGContext is bottom-left origin; flip so row 0 is the TOP row.
            ctx.translateBy(x: 0, y: CGFloat(h))
            ctx.scaleBy(x: 1, y: -1)
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? (w, h, buffer) : nil
    }
}
