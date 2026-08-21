// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    apple_common.mm
 * @brief   Core Text font matching and NSURLSession fetching, shared by the iOS
 *          app and the desktop (macOS) host. See apple_common.hpp for why.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include "platform/apple_common.hpp"
#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC, for the font match
#include "Runtime.hpp"                 // ESHOST_LOGE
#include <vector>
#include <cstring>
#include <cmath>

namespace eshost {

using esengine::u32;
using esengine::f32;
using esengine::u8;

/** @p codepoint as UTF-16; one unit below U+10000, a surrogate pair above it. */
CFIndex utf16For(u32 codepoint, UniChar (&chars)[2]) {
    if (codepoint >= 0x10000) {
        const uint32_t v = codepoint - 0x10000;
        chars[0] = (UniChar)(0xD800 + (v >> 10));
        chars[1] = (UniChar)(0xDC00 + (v & 0x3FF));
        return 2;
    }
    chars[0] = (UniChar)codepoint;
    return 1;
}

/**
 * The face Core Text gives for @p family at @p size that also covers @p codepoint
 * — the family, the style traits it has, and the per-codepoint fallback that is
 * how CJK resolves without a font name written down anywhere.
 *
 * Caller releases. `synthetic*` report the traits the matched face does NOT have.
 */
CTFontRef matchFace(const std::string& family, u32 codepoint, int style, CGFloat size,
                    bool* syntheticBold, bool* syntheticItalic) {
    CTFontSymbolicTraits traits = 0;
    if (style & GLYPH_BOLD) traits |= kCTFontTraitBold;
    if (style & GLYPH_ITALIC) traits |= kCTFontTraitItalic;

    NSString* name = family.empty() ? @"Helvetica" : [NSString stringWithUTF8String:family.c_str()];
    CTFontRef font = CTFontCreateWithName((__bridge CFStringRef)name, size, NULL);
    if (!font) return NULL;
    if (traits) {
        if (CTFontRef styled = CTFontCreateCopyWithSymbolicTraits(font, size, NULL, traits, traits)) {
            CFRelease(font);
            font = styled;
        }
    }
    // A family without a real bold or italic face leaves the trait unset; the
    // rasterizer then synthesizes it, as a browser does for the same family.
    const CTFontSymbolicTraits actual = CTFontGetSymbolicTraits(font);
    if (syntheticBold) *syntheticBold = (traits & kCTFontTraitBold) && !(actual & kCTFontTraitBold);
    if (syntheticItalic) *syntheticItalic = (traits & kCTFontTraitItalic) && !(actual & kCTFontTraitItalic);

    // Does this face have the glyph? If not, let Core Text find one that does.
    if (codepoint) {
        UniChar chars[2];
        const CFIndex length = utf16For(codepoint, chars);
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
    return font;
}

FontFile appleLoadFont(const std::string& family, u32 codepoint, int style) {
    FontFile out;
    CTFontRef font = matchFace(family, codepoint, style, 16.0,
                               &out.syntheticBold, &out.syntheticItalic);
    if (!font) return out;

    CFURLRef url = (CFURLRef)CTFontCopyAttribute(font, kCTFontURLAttribute);
    if (!url) {
        ESHOST_LOGE("font: Core Text matched a face for \"%s\" that names no file, so nothing "
                    "can be read for it", family.c_str());
        CFRelease(font);
        return out;
    }
    // WHICH face in that file. A .ttc holds several — the CJK fallback lands in
    // one — and the descriptors come back in file order, so the matched face's
    // position in them is the index stbtt needs. Every other platform's matcher
    // answers this itself (AFont_getCollectionIndex, FC_INDEX, IDWriteFont::GetIndex);
    // Core Text answers a font, so its index is looked up here rather than assumed 0.
    if (CFStringRef want = CTFontCopyPostScriptName(font)) {
        if (CFArrayRef faces = CTFontManagerCreateFontDescriptorsFromURL(url)) {
            const CFIndex count = CFArrayGetCount(faces);
            for (CFIndex i = 0; i < count; ++i) {
                CTFontDescriptorRef d = (CTFontDescriptorRef)CFArrayGetValueAtIndex(faces, i);
                CFStringRef have = (CFStringRef)CTFontDescriptorCopyAttribute(d, kCTFontNameAttribute);
                const bool same = have && CFStringCompare(have, want, 0) == kCFCompareEqualTo;
                if (have) CFRelease(have);
                if (same) { out.faceIndex = (int)i; break; }
            }
            CFRelease(faces);
        }
        CFRelease(want);
    }
    CFRelease(font);
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

bool appleDrawGlyph(const std::string& family, u32 codepoint, int style,
                    f32 pixelSize, int supersample, int padding,
                    Platform::GlyphCoverage& out) {
    const int ss = supersample > 0 ? supersample : 1;
    if (pixelSize <= 0.0f) return false;

    // Drawn at the supersampled size, so the grid handed back tiles the shared
    // path's exactly and its downsample is the only place resolution is lost.
    const CGFloat size = (CGFloat)pixelSize * (CGFloat)ss;
    CTFontRef font = matchFace(family, codepoint, style, size, NULL, NULL);
    if (!font) return false;

    UniChar chars[2];
    const CFIndex length = utf16For(codepoint, chars);
    CGGlyph glyphs[2] = {0, 0};
    if (!CTFontGetGlyphsForCharacters(font, chars, glyphs, length) || glyphs[0] == 0) {
        CFRelease(font);
        return false;
    }
    const CGGlyph glyph = glyphs[0];

    CGSize adv = CGSizeZero;
    CTFontGetAdvancesForGlyphs(font, kCTFontOrientationHorizontal, &glyph, &adv, 1);
    out.advance = (f32)(adv.width / ss);

    // Ink box in supersampled px, y UP from the baseline — Core Graphics' own
    // convention, and the one the draw below happens in.
    const CGRect box = CTFontGetBoundingRectsForGlyphs(font, kCTFontOrientationHorizontal,
                                                       &glyph, NULL, 1);
    const int x0 = (int)std::floor(CGRectGetMinX(box));
    const int y0 = (int)std::floor(CGRectGetMinY(box));
    const int inkWss = (int)std::ceil(CGRectGetMaxX(box)) - x0;
    const int inkHss = (int)std::ceil(CGRectGetMaxY(box)) - y0;
    if (inkWss <= 0 || inkHss <= 0) {   // whitespace: an advance and no tile
        out.blank = true;
        CFRelease(font);
        return true;
    }

    // Padding is in STORED px, so the tile is sized there and multiplied up —
    // which is also what keeps the grid an exact multiple of the supersample.
    const int w = (inkWss + ss - 1) / ss + padding * 2;
    const int h = (inkHss + ss - 1) / ss + padding * 2;
    const int wss = w * ss;
    const int hss = h * ss;

    std::vector<esengine::u8> canvas((size_t)wss * hss, 0);
    CGContextRef ctx = CGBitmapContextCreate(canvas.data(), (size_t)wss, (size_t)hss, 8,
                                             (size_t)wss, NULL, kCGImageAlphaOnly);
    if (!ctx) {
        CFRelease(font);
        return false;
    }
    CGContextSetShouldAntialias(ctx, true);
    CGContextSetShouldSmoothFonts(ctx, false);   // coverage, not subpixel triplets
    // Put the ink's low corner `padding` stored px in from the tile's.
    const CGPoint pen = CGPointMake((CGFloat)(padding * ss - x0), (CGFloat)(padding * ss - y0));
    CTFontDrawGlyphs(font, &glyph, &pen, 1, ctx);
    CGContextRelease(ctx);
    CFRelease(font);

    // Core Graphics counts rows from the bottom and the atlas from the top.
    out.alpha.resize((size_t)wss * hss);
    for (int row = 0; row < hss; ++row) {
        std::memcpy(out.alpha.data() + (size_t)row * wss,
                    canvas.data() + (size_t)(hss - 1 - row) * wss, (size_t)wss);
    }
    out.width = wss;
    out.height = hss;
    // The tile's top-left in pen space, y UP — the same two the stb path reports.
    out.bearingX = (f32)x0 / (f32)ss - (f32)padding;
    out.bearingY = (f32)(y0 + inkHss) / (f32)ss + (f32)padding;
    return true;
}

// NSURLSession runs the request (TLS via the OS) on a background queue and calls
// its completion there; deliverFetch is thread-safe and the JS callback runs back
// on the main thread in drainFetches.
void appleStartFetch(const FetchRequest& req) {
    NSURL* url = [NSURL URLWithString:[NSString stringWithUTF8String:req.url.c_str()]];
    if (!url) {
        FetchResult r; r.id = req.id; r.error = "invalid url";
        deliverFetch(std::move(r));
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
            FetchResult r;
            r.id = id;
            r.isText = wantText;
            if (error) {
                r.error = error.localizedDescription.UTF8String ?: "network error";
                deliverFetch(std::move(r));
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
            deliverFetch(std::move(r));
        }];
    [task resume];
}

}  // namespace eshost
