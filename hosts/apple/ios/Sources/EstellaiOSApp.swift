import SwiftUI

// iOS front end. Reuses EstellaHostKit — the same JSC embed / NativeBridge / boot / WebGPU
// bridge as macOS; only the window + input layer is UIKit here (REARCH_NATIVE.md N2).
@main
struct EstellaiOSApp: App {
    var body: some Scene {
        WindowGroup {
            GameView().ignoresSafeArea()
        }
    }
}

private struct GameView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> GameViewController { GameViewController() }
    func updateUIViewController(_ vc: GameViewController, context: Context) {}
}
