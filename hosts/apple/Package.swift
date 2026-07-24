// swift-tools-version: 5.9
// The Apple native host shell (macOS now, iOS next) for the embedded Dawn + JSC
// runtime — NOT a WebView. See README.md and docs/REARCH_NATIVE.md (§3.3, N2).
import PackageDescription

let package = Package(
    name: "EstellaAppleHost",
    // macOS 14+ / iOS 17+ gives us the unified CADisplayLink and modern Metal.
    platforms: [.macOS(.v14)],
    products: [
        // Platform-neutral shell core, shared by every Apple front end.
        .library(name: "EstellaHostKit", targets: ["EstellaHostKit"]),
        // macOS front end (NSApplication + CAMetalLayer window).
        .executable(name: "EstellaMac", targets: ["EstellaMac"]),
    ],
    targets: [
        .target(
            name: "EstellaHostKit",
            // prelude.js / boot.js are committed; the built engine assets
            // (esengine_native.{js,wasm}, estella-sdk.iife.js) are dropped in by
            // Scripts/build-js-assets.sh and are .gitignore'd.
            resources: [.copy("Resources/js")]
        ),
        .executableTarget(
            name: "EstellaMac",
            dependencies: ["EstellaHostKit"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Metal"),
                .linkedFramework("QuartzCore"),
            ]
        ),
    ]
)
