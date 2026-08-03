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
#import <CoreText/CoreText.h>

#include "Host.hpp"
#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC, for the font match

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

@class EstellaViewController;

/** What the platform needs of whoever owns the keyboard's responder. A role, not
 *  a class, so the C++ side names no view controller. */
@protocol EstellaTextEditorHost <NSObject>
- (void)textEditorFocus:(NSString*)value selectionStart:(NSInteger)selectionStart
           selectionEnd:(NSInteger)selectionEnd multiline:(BOOL)multiline
              maxLength:(NSInteger)maxLength password:(BOOL)password;
- (void)textEditorBlur;
- (void)textEditorWrite:(NSString*)value selectionStart:(NSInteger)selectionStart
           selectionEnd:(NSInteger)selectionEnd;
@end

namespace {

struct IOSPlatform final : eshost::Platform {
    CAMetalLayer* layer = nil;
    // Whoever owns the responder the keyboard talks to (the view controller); set
    // once it has loaded, which is also what makes hasTextEditor() true.
    //
    // `__unsafe_unretained` rather than `__weak`: this file compiles under manual
    // reference counting (where a zeroing weak reference does not exist), and the
    // reference must not own the controller that owns the surface. The app has one
    // root controller for the life of the process, so there is nothing for a
    // zeroing reference to zero.
    __unsafe_unretained id<EstellaTextEditorHost> editorHost = nil;

    bool hasTextEditor() const override { return editorHost != nil; }

    void textEditorFocus(const std::string& value, int selectionStart, int selectionEnd,
                         bool multiline, int maxLength, bool password) override {
        NSString* text = [NSString stringWithUTF8String:value.c_str()] ?: @"";
        [editorHost textEditorFocus:text selectionStart:selectionStart selectionEnd:selectionEnd
                          multiline:multiline maxLength:maxLength password:password];
    }

    void textEditorBlur() override { [editorHost textEditorBlur]; }

    void textEditorWrite(const std::string& value, int selectionStart, int selectionEnd) override {
        NSString* text = [NSString stringWithUTF8String:value.c_str()] ?: @"";
        [editorHost textEditorWrite:text selectionStart:selectionStart selectionEnd:selectionEnd];
    }

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

    /** Application Support, not Caches: iOS empties Caches whenever it wants the
     *  space back, which is correct for content that refetches and wrong for a
     *  save. Unlike the other two this directory does not exist until an app
     *  makes it, so create it — and only report it once it is really there,
     *  since an empty answer degrades storage to the session rather than
     *  handing out a path that every write will fail against. */
    std::string dataDir() override {
        NSArray* dirs = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
        if (dirs.count == 0) return {};
        NSString* path = dirs[0];
        NSError* err = nil;
        if (![[NSFileManager defaultManager] createDirectoryAtPath:path
                                       withIntermediateDirectories:YES
                                                        attributes:nil
                                                             error:&err]) {
            return {};
        }
        return std::string([path UTF8String]);
    }

    /** Documents, not Caches: the record exists to be sent, and Documents is the
     *  directory the Files app shows (with UIFileSharingEnabled) and iTunes/Finder
     *  can copy off a device that has none. */
    std::string logDir() override {
        NSArray* dirs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
        if (dirs.count == 0) return {};
        return std::string([dirs[0] UTF8String]);
    }

    std::string describe() override {
        UIDevice* d = [UIDevice currentDevice];
        return std::string([[d model] UTF8String]) + ", iOS "
             + std::string([[d systemVersion] UTF8String]) + ", arm64";
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

    // Core Text names the file: it resolves a family (falling back to the system
    // font when the name is unknown), and CTFontCreateForString picks a face that
    // actually covers the codepoint — the CJK fallback, without a hard-coded path.
    // The URL is a real file under /System/Library/Fonts, readable from the app.
    eshost::FontFile loadFont(const std::string& family, u32 codepoint, int style) override {
        eshost::FontFile out;
        CTFontSymbolicTraits traits = 0;
        if (style & eshost::GLYPH_BOLD) traits |= kCTFontTraitBold;
        if (style & eshost::GLYPH_ITALIC) traits |= kCTFontTraitItalic;

        NSString* name = family.empty() ? @"Helvetica" : [NSString stringWithUTF8String:family.c_str()];
        CTFontRef font = CTFontCreateWithName((__bridge CFStringRef)name, 16.0, NULL);
        if (!font) return out;
        if (traits) {
            if (CTFontRef styled = CTFontCreateCopyWithSymbolicTraits(font, 16.0, NULL, traits, traits)) {
                CFRelease(font);
                font = styled;
            }
        }
        // A family without a real bold or italic face leaves the trait unset; the
        // rasterizer then synthesizes it, as a browser does for the same family.
        const CTFontSymbolicTraits actual = CTFontGetSymbolicTraits(font);
        out.syntheticBold = (traits & kCTFontTraitBold) && !(actual & kCTFontTraitBold);
        out.syntheticItalic = (traits & kCTFontTraitItalic) && !(actual & kCTFontTraitItalic);

        // Does this face have the glyph? If not, let Core Text find one that does.
        if (codepoint) {
            UniChar chars[2];
            CFIndex length = 0;
            if (codepoint >= 0x10000) {
                const uint32_t v = codepoint - 0x10000;
                chars[length++] = (UniChar)(0xD800 + (v >> 10));
                chars[length++] = (UniChar)(0xDC00 + (v & 0x3FF));
            } else {
                chars[length++] = (UniChar)codepoint;
            }
            CGGlyph glyphs[2] = {0, 0};
            if (!CTFontGetGlyphsForCharacters(font, chars, glyphs, length)) {
                CFStringRef text = CFStringCreateWithCharacters(NULL, chars, length);
                CTFontRef fallback = CTFontCreateForString(font, text, CFRangeMake(0, length));
                CFRelease(text);
                if (fallback) {
                    CFRelease(font);
                    font = fallback;
                }
            }
        }

        CFURLRef url = (CFURLRef)CTFontCopyAttribute(font, kCTFontURLAttribute);
        CFRelease(font);
        if (!url) return out;
        NSString* path = [(__bridge NSURL*)url path];
        CFRelease(url);
        if (!path) return out;

        NSData* data = [NSData dataWithContentsOfFile:path];
        if (!data) return out;
        out.path = std::string([path UTF8String]);
        out.bytes.resize(data.length);
        memcpy(out.bytes.data(), data.bytes, data.length);
        return out;
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

// The app's editing surface: a real UITextView, invisible, that the keyboard and
// its IME talk to. Core Text draws the field itself, but composition (pinyin,
// kana, prediction) is delivered only to a UIKit responder — so the responder is
// what this holds, and nothing else about the field lives here.
@interface EstellaViewController : UIViewController <UITextViewDelegate, EstellaTextEditorHost>
@end

@implementation EstellaViewController {
    CADisplayLink* _displayLink;
    BOOL _booted;
    UITextView* _editor;
    BOOL _multiline;
    BOOL _writing;      // set while adopting a value the app decided, so it is not echoed back
}

- (void)loadView {
    self.view = [[EstellaMetalView alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.view.multipleTouchEnabled = NO;   // the host feeds one touch id, as Android does
}

- (void)viewDidLoad {
    [super viewDidLoad];
    // Before boot: whether there is an editing surface decides whether the
    // es_textEditor_* entry points are bound at all.
    g_platform.editorHost = self;
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

// -- The editing surface ------------------------------------------------------

/** The responder, created on first use. Off-screen and clear: it must be a real,
 *  attached view for the keyboard to attach to, but the game draws the field. */
- (UITextView*)ensureEditor {
    if (_editor) return _editor;
    _editor = [[UITextView alloc] initWithFrame:CGRectMake(-100, -100, 1, 1)];
    _editor.delegate = self;
    _editor.backgroundColor = UIColor.clearColor;
    _editor.textColor = UIColor.clearColor;
    _editor.tintColor = UIColor.clearColor;   // no system caret; the game draws its own
    _editor.autocorrectionType = UITextAutocorrectionTypeNo;
    _editor.autocapitalizationType = UITextAutocapitalizationTypeNone;
    [self.view addSubview:_editor];
    return _editor;
}

- (void)textEditorFocus:(NSString*)value selectionStart:(NSInteger)selectionStart
           selectionEnd:(NSInteger)selectionEnd multiline:(BOOL)multiline
              maxLength:(NSInteger)maxLength password:(BOOL)password {
    UITextView* editor = [self ensureEditor];
    _multiline = multiline;
    _writing = YES;
    editor.text = value;
    editor.returnKeyType = multiline ? UIReturnKeyDefault : UIReturnKeyDone;
    // The field renders its own bullets; this is for the keyboard's benefit — no
    // suggestion strip or autocorrect over a password.
    editor.textContentType = password ? UITextContentTypePassword : nil;
    editor.secureTextEntry = password;
    [self setEditorSelectionStart:selectionStart end:selectionEnd];
    _writing = NO;
    [editor becomeFirstResponder];
}

- (void)textEditorBlur {
    [_editor resignFirstResponder];
}

- (void)textEditorWrite:(NSString*)value selectionStart:(NSInteger)selectionStart
           selectionEnd:(NSInteger)selectionEnd {
    if (!_editor) return;
    _writing = YES;
    if (![_editor.text isEqualToString:value]) _editor.text = value;
    [self setEditorSelectionStart:selectionStart end:selectionEnd];
    _writing = NO;
}

- (void)setEditorSelectionStart:(NSInteger)start end:(NSInteger)end {
    const NSInteger length = (NSInteger)_editor.text.length;
    const NSInteger lo = MAX(0, MIN(start, length));
    const NSInteger hi = MAX(lo, MIN(end, length));
    _editor.selectedRange = NSMakeRange((NSUInteger)lo, (NSUInteger)(hi - lo));
}

/** Hand the responder's whole state to the engine. A marked range IS the IME
 *  preedit, so that is what `composing` asks about. */
- (void)reportEditorState {
    if (_writing || !_editor) return;
    const NSRange selection = _editor.selectedRange;
    const BOOL composing = _editor.markedTextRange != nil;
    eshost::deliverTextEditorState(_editor.text.UTF8String ?: "",
                                   (int)selection.location,
                                   (int)(selection.location + selection.length), composing);
}

- (void)textViewDidChange:(UITextView*)textView { [self reportEditorState]; }

- (void)textViewDidChangeSelection:(UITextView*)textView { [self reportEditorState]; }

- (BOOL)textView:(UITextView*)textView shouldChangeTextInRange:(NSRange)range
                                           replacementText:(NSString*)text {
    // Return on a single-line field submits instead of inserting a newline —
    // the same rule the web's Enter follows.
    if (!_multiline && [text isEqualToString:@"\n"]) {
        eshost::deliverTextEditorSubmit();
        return NO;
    }
    return YES;
}

- (void)textViewDidEndEditing:(UITextView*)textView {
    // The keyboard went away (done, or another responder took over): for a UI
    // field that is losing focus, which is what Escape does on the web.
    eshost::deliverTextEditorCancel();
}

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
