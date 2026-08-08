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

namespace eshost {

using esengine::u32;
using esengine::u8;

FontFile appleLoadFont(const std::string& family, u32 codepoint, int style) {
    FontFile out;
    CTFontSymbolicTraits traits = 0;
    if (style & GLYPH_BOLD) traits |= kCTFontTraitBold;
    if (style & GLYPH_ITALIC) traits |= kCTFontTraitItalic;

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
