import UIKit
import JavaScriptCore
import EstellaHostKit

/// A UIView whose backing layer is a CAMetalLayer — the engine's on-screen render surface.
final class MetalUIView: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
}

/// Boots the shared engine host and drives it onto the CAMetalLayer each frame — the UIKit
/// mirror of the macOS AppDelegate. wgpu-native owns the layer's Metal setup via
/// wgpuSurfaceConfigure, so the view hands it a bare layer.
final class GameViewController: UIViewController {
    private var runtime: JSRuntime!
    private var bridge: NativeBridgeHost!
    private var engine: EngineHost!
    private var wgpuBridge: WgpuBridge?
    private var displayLink: CADisplayLink?
    private var pendingStart: (() -> Void)?

    private var metalView: MetalUIView { view as! MetalUIView }

    override func loadView() { view = MetalUIView() }

    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            runtime = JSRuntime()
            bridge = NativeBridgeHost(runtime: runtime, assetRoot: Bundle.main.bundleURL)
            engine = EngineHost(runtime: runtime, bridge: bridge)
            try engine.boot(assets: try EngineAssets.bundled())
        } catch {
            print("iOS engine boot failed: \(error)")
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard displayLink == nil, engine != nil else { return }

        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        bridge.backingScale = Double(scale)
        metalView.metalLayer.contentsScale = scale
        let pxW = Int(view.bounds.width * scale), pxH = Int(view.bounds.height * scale)

        // Deferred to the first live frame: the CAMetalLayer only vends a drawable once on-screen.
        pendingStart = { [weak self] in
            guard let self else { return }
            do {
                let ctx = try WgpuContext()
                ctx.createSurfaceOnly(metalLayer: Unmanaged.passUnretained(self.metalView.metalLayer).toOpaque())
                let wb = WgpuBridge(runtime: self.runtime, context: ctx)
                wb.installGlobals(targetWidth: pxW, targetHeight: pxH)
                try self.engine.renderNative(deviceObject: wb.makeDevice(), width: pxW, height: pxH)
                self.engine.spawnDemo(200)
                self.wgpuBridge = wb
            } catch {
                print("iOS engine-on-view failed: \(error)")
            }
        }

        let link = CADisplayLink(target: self, selector: #selector(frameTick))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func frameTick() {
        if let start = pendingStart { pendingStart = nil; start() }
        try? engine.tick(1.0 / 60.0)
        wgpuBridge?.present()
    }

    // Touch -> engine input (UIKit coordinates are already top-left / logical px).
    private func loc(_ t: UITouch) -> (Double, Double) {
        let p = t.location(in: view)
        return (Double(p.x), Double(p.y))
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for t in touches { let (x, y) = loc(t); bridge.pushTouchStart(0, x, y) }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for t in touches { let (x, y) = loc(t); bridge.pushTouchMove(0, x, y) }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { bridge.pushTouchEnd(0) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { bridge.pushTouchEnd(0) }
}
