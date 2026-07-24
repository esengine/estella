import AppKit
import QuartzCore
import Metal
import EstellaHostKit

/// Opens the window and drives the frame loop. The surface + display-link + input path is
/// fully wired; the pixels themselves come from the reserved native Dawn provider (N2), so
/// until it lands the window ticks the engine headlessly.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let engine: EngineHost
    private let bridge: NativeBridgeHost
    private var window: NSWindow?
    private var view: MetalHostView?
    private var displayLink: CADisplayLink?

    init(engine: EngineHost, bridge: NativeBridgeHost) {
        self.engine = engine
        self.bridge = bridge
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        let frame = NSRect(x: 0, y: 0, width: 960, height: 640)
        let win = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "Estella (native host)"
        let v = MetalHostView(frame: frame, bridge: bridge)
        win.contentView = v
        win.center()
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = win
        self.view = v

        let scale = win.backingScaleFactor
        bridge.backingScale = Double(scale)
        v.metalLayer.contentsScale = scale
        v.metalLayer.drawableSize = CGSize(width: frame.width * scale, height: frame.height * scale)

        let pxW = Int(frame.width * scale), pxH = Int(frame.height * scale)
        do {
            try engine.startRendered(provider: DawnGPUProvider(), layer: v.metalLayer, width: pxW, height: pxH)
        } catch {
            print("rendering reserved (\(error))\n  -> window ticks headlessly until the native Dawn provider (N2) lands.")
        }
        engine.spawnDemo(2000)

        // macOS 14+ CADisplayLink — the same driver the iOS front end will use.
        let link = v.displayLink(target: self, selector: #selector(frameTick))
        link.add(to: .main, forMode: .common)
        self.displayLink = link
    }

    @objc private func frameTick() {
        try? engine.tick(1.0 / 60.0)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
}

/// An `NSView` backed by a `CAMetalLayer`, forwarding pointer/keyboard events to the engine
/// via the NativeBridge push contract (logical px, origin top-left).
final class MetalHostView: NSView {
    private let bridge: NativeBridgeHost

    var metalLayer: CAMetalLayer { layer as! CAMetalLayer }

    init(frame: NSRect, bridge: NativeBridgeHost) {
        self.bridge = bridge
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) unused") }

    override func makeBackingLayer() -> CALayer {
        let layer = CAMetalLayer()
        layer.device = MTLCreateSystemDefaultDevice()
        layer.pixelFormat = .bgra8Unorm
        layer.framebufferOnly = true
        return layer
    }

    // Top-left origin so pushed touch coordinates match the NativeInputListener contract.
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    private func point(_ e: NSEvent) -> (Double, Double) {
        let p = convert(e.locationInWindow, from: nil)
        return (Double(p.x), Double(p.y))
    }

    override func mouseDown(with e: NSEvent)    { let (x, y) = point(e); bridge.pushTouchStart(0, x, y) }
    override func mouseDragged(with e: NSEvent) { let (x, y) = point(e); bridge.pushTouchMove(0, x, y) }
    override func mouseUp(with e: NSEvent)      { bridge.pushTouchEnd(0) }
    override func keyDown(with e: NSEvent)      { bridge.pushKeyDown(e.charactersIgnoringModifiers ?? "") }
    override func keyUp(with e: NSEvent)        { bridge.pushKeyUp(e.charactersIgnoringModifiers ?? "") }
}
