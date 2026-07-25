// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    main_ios.mm
 * @brief   The iOS glue for the JS host: a CAMetalLayer-backed view, the app
 *          bundle's assets, Metal-backed Dawn, touch, and a CADisplayLink loop.
 * @details The Android sibling of this file is main_android.cpp; everything they
 *          share — Dawn bring-up, the es_* bindings, the SDK bundle and the frame —
 *          is in host_core.cpp. Obj-C++ so UIKit and the C++ host meet directly,
 *          with no bridging layer.
 *
 *          The app target is a thin shell: its main() calls EstellaRunApp(), and
 *          the delegate + view controller below (compiled into the static host
 *          library) own the window. Link the app with -ObjC so these classes
 *          survive dead-stripping.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#import <UIKit/UIKit.h>
#import <QuartzCore/CAMetalLayer.h>

#include "host_core.hpp"

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

@class EstellaViewController;

namespace {

struct IOSPlatform final : eshost::Platform {
    CAMetalLayer* layer = nil;

    // A file shipped inside the .app bundle — the packaged-asset analog of the
    // APK's assets/. Paths are project-relative ("game.config.json", "logo.png"),
    // so a game reads the same paths on both platforms. An exported project lives
    // under Content/ (a folder reference, which keeps its subdirectories); the
    // bundle root is the fallback, where the built-in demo's files sit.
    std::vector<u8> readAsset(const char* path) override {
        NSString* rel = [NSString stringWithUTF8String:path];
        NSString* root = [[NSBundle mainBundle] resourcePath];
        for (NSString* base : @[[root stringByAppendingPathComponent:@"Content"], root]) {
            NSData* data = [NSData dataWithContentsOfFile:[base stringByAppendingPathComponent:rel]];
            if (!data) continue;
            std::vector<u8> out(data.length);
            memcpy(out.data(), data.bytes, data.length);
            return out;
        }
        return {};
    }

    std::string cacheDir() override {
        NSArray* dirs = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES);
        if (dirs.count == 0) return {};
        return std::string([dirs[0] UTF8String]);
    }

    WGPUBackendType backend() const override { return WGPUBackendType_Metal; }

    WebGPUDevice::NativeSurface surface() override {
        return {WebGPUDevice::NativeWindowKind::MetalLayer, (__bridge void*)layer};
    }

    void surfaceSize(u32& width, u32& height) override {
        width = layer ? (u32)layer.drawableSize.width : 0;
        height = layer ? (u32)layer.drawableSize.height : 0;
    }

    void log(bool error, const char* message) override {
        NSLog(@"[Estella]%s %s", error ? " ERROR:" : "", message);
    }

    // NSURLSession runs the request (TLS via the OS) on a background queue and
    // calls its completion there; deliverFetch is thread-safe and the JS callback
    // runs back on the main thread in drainFetches.
    void startFetch(const eshost::FetchRequest& req) override {
        NSURL* url = [NSURL URLWithString:[NSString stringWithUTF8String:req.url.c_str()]];
        if (!url) {
            eshost::FetchResult r; r.id = req.id; r.error = "invalid url";
            eshost::deliverFetch(std::move(r));
            return;
        }
        NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:url];
        request.HTTPMethod = [NSString stringWithUTF8String:req.method.c_str()];
        for (const auto& kv : req.headers) {
            [request setValue:[NSString stringWithUTF8String:kv.second.c_str()]
                forHTTPHeaderField:[NSString stringWithUTF8String:kv.first.c_str()]];
        }
        if (!req.body.empty()) {
            request.HTTPBody = [NSData dataWithBytes:req.body.data() length:req.body.size()];
        }
        const int id = req.id;
        const bool wantText = req.wantText;
        NSURLSessionDataTask* task = [NSURLSession.sharedSession dataTaskWithRequest:request
            completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
                eshost::FetchResult r;
                r.id = id;
                r.isText = wantText;
                if (error) {
                    r.error = error.localizedDescription.UTF8String ?: "network error";
                    eshost::deliverFetch(std::move(r));
                    return;
                }
                NSHTTPURLResponse* http = [response isKindOfClass:NSHTTPURLResponse.class]
                    ? (NSHTTPURLResponse*)response : nil;
                r.status = http ? (int)http.statusCode : 200;
                r.ok = r.status >= 200 && r.status < 300;
                r.statusText = [NSHTTPURLResponse localizedStringForStatusCode:r.status].UTF8String ?: "";
                for (NSString* key in http.allHeaderFields) {
                    NSString* val = [http.allHeaderFields[key] description];
                    r.headers.emplace_back(key.UTF8String, val.UTF8String ?: "");
                }
                if (data.length) {
                    const u8* bytes = (const u8*)data.bytes;
                    r.body.assign(bytes, bytes + data.length);
                }
                eshost::deliverFetch(std::move(r));
            }];
        [task resume];
    }
};

IOSPlatform g_platform;

}  // namespace

/// A view whose backing layer is the CAMetalLayer Dawn renders into.
@interface EstellaMetalView : UIView
@end

@implementation EstellaMetalView
+ (Class)layerClass { return [CAMetalLayer class]; }
@end

@interface EstellaViewController : UIViewController
@end

@implementation EstellaViewController {
    CADisplayLink* _displayLink;
    BOOL _booted;
}

- (void)loadView {
    self.view = [[EstellaMetalView alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.view.multipleTouchEnabled = NO;   // the host feeds one touch id, as Android does
}

- (void)viewDidLoad {
    [super viewDidLoad];
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(step:)];
    [_displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];

    NSNotificationCenter* nc = NSNotificationCenter.defaultCenter;
    [nc addObserver:self selector:@selector(appBackgrounded)
               name:UIApplicationDidEnterBackgroundNotification object:nil];
    [nc addObserver:self selector:@selector(appForegrounded)
               name:UIApplicationWillEnterForegroundNotification object:nil];
}

// The layer's drawable size is in pixels; the engine's viewport and the touch
// coordinates it receives are in those same pixels.
- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    CAMetalLayer* layer = (CAMetalLayer*)self.view.layer;
    UIScreen* screen = self.view.window.screen ?: UIScreen.mainScreen;
    const CGFloat scale = screen.scale;
    layer.contentsScale = scale;
    const CGSize size = CGSizeMake(self.view.bounds.size.width * scale,
                                   self.view.bounds.size.height * scale);
    if (size.width <= 0 || size.height <= 0) return;

    const BOOL resized = !CGSizeEqualToSize(layer.drawableSize, size);
    layer.drawableSize = size;
    g_platform.layer = layer;

    // Boot on the first laid-out frame: Dawn needs a layer with a real size to
    // configure a surface against. Later layouts (rotation) just rebind.
    if (!_booted) {
        _booted = eshost::boot(g_platform);
    } else if (resized) {
        eshost::bindSurface();
    }
}

- (void)step:(CADisplayLink*)link { eshost::frame(); }

- (void)appBackgrounded {
    _displayLink.paused = YES;
    eshost::surfaceLost();
    eshost::setVisible(false);   // suspend audio + auto-pause the game
}

- (void)appForegrounded {
    eshost::setVisible(true);    // resume audio even if the surface rebind lags
    if (_booted && eshost::bindSurface()) _displayLink.paused = NO;
}

// UIKit touches are in points, top-left origin; the host contract is surface
// pixels with the same origin (as on the web), so scale them here.
- (void)dispatchTouches:(NSSet<UITouch*>*)touches type:(int)type {
    UITouch* t = touches.anyObject;
    if (!t) return;
    const CGPoint p = [t locationInView:self.view];
    const CGFloat scale = self.view.contentScaleFactor;
    eshost::touch(type, 0, (float)(p.x * scale), (float)(p.y * scale));
}

- (void)touchesBegan:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    [self dispatchTouches:touches type:0];
}
- (void)touchesMoved:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    [self dispatchTouches:touches type:1];
}
- (void)touchesEnded:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    [self dispatchTouches:touches type:2];
}
- (void)touchesCancelled:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
    [self dispatchTouches:touches type:3];
}

- (BOOL)prefersStatusBarHidden { return YES; }

@end

@interface EstellaAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow* window;
@end

@implementation EstellaAppDelegate
- (BOOL)application:(UIApplication*)application
        didFinishLaunchingWithOptions:(NSDictionary*)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [[EstellaViewController alloc] init];
    [self.window makeKeyAndVisible];
    return YES;
}

- (void)applicationDidReceiveMemoryWarning:(UIApplication*)application {
    eshost::memoryWarning();   // SDK residency caches trim (the audio buffer cache)
}
@end

extern "C" int EstellaRunApp(int argc, char** argv) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass([EstellaAppDelegate class]));
    }
}
