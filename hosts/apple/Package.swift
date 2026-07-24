// swift-tools-version: 5.9
// The Apple native host shell (macOS now, iOS next) for the embedded Dawn + JSC
// runtime — NOT a WebView. See README.md and docs/REARCH_NATIVE.md (§3.3, N2).
import PackageDescription

let package = Package(
    name: "EstellaAppleHost",
    // macOS 14+ / iOS 17+ gives us the unified CADisplayLink and modern Metal.
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        // Platform-neutral shell core, shared by every Apple front end.
        .library(name: "EstellaHostKit", targets: ["EstellaHostKit"]),
        // macOS front end (NSApplication + CAMetalLayer window).
        .executable(name: "EstellaMac", targets: ["EstellaMac"]),
    ],
    targets: [
        // Vendored native WebGPU (wgpu-native) — the native GPU backing the host bridge
        // (REARCH_NATIVE.md §3.3.2). Binary fetched by Scripts/fetch-wgpu-native.sh.
        .target(
            name: "Cwgpu",
            // Headers reach the module via Sources/Cwgpu/include/webgpu -> vendor symlink
            // (created by Scripts/fetch-wgpu-native.sh), so include/ auto-search resolves them.
            linkerSettings: [
                // Link the platform's static archive by path (forces static; no runtime rpath).
                .unsafeFlags(["vendor/wgpu-native-macos/lib/libwgpu_native.a"], .when(platforms: [.macOS])),
                .unsafeFlags(["vendor/wgpu-native-ios/lib/libwgpu_native.a"], .when(platforms: [.iOS])),
                .linkedFramework("Metal"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("CoreFoundation"),
                .linkedFramework("IOKit", .when(platforms: [.macOS])),      // macOS-only
                .linkedFramework("IOSurface", .when(platforms: [.macOS])),  // macOS-only
            ]
        ),
        .target(
            name: "EstellaHostKit",
            dependencies: ["Cwgpu"],
            // prelude.js / boot.js / webgpu-probe.js are committed; the built engine assets
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
