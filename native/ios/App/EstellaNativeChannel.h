// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The game's line to this app's own Objective-C or Swift: methods a script calls
// by name, and events native code raises for the script.
//
// The engine knows nothing of an ad SDK, a store or a sign-in library; those are
// the project's. A project answers a name here and its script calls that name:
//
//     + (void)load {
//         [EstellaNativeChannel registerMethod:@"ads.show"
//                                      handler:^(NSString* args, EstellaNativeReply reply) {
//             ...
//             reply(@"{\"completed\":true}", nil);
//         }];
//     }
//
//     const result = await NativeChannel.call('ads.show', { kind: 'rewarded', unitId });
//
// Arguments and results are JSON text, so neither side needs the other's types.
// A handler runs on the main thread and may answer later from any thread, once.
// Register before the game starts: a class's +load is early enough, and needs no
// entry point of its own.
//
// The class itself is in the engine library (Estella.xcframework); this header is
// all an app target needs to use it.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// How a handler answers: `json` for a result (nil for no value), or `error` for
/// a failure the script's promise rejects with. Once; a second answer is dropped.
typedef void (^EstellaNativeReply)(NSString* _Nullable json, NSString* _Nullable error);

/// What answers a method. Runs on the main thread. `argsJson` is JSON text.
typedef void (^EstellaNativeHandler)(NSString* argsJson, EstellaNativeReply reply);

@interface EstellaNativeChannel : NSObject

/// Answer `method` from now on; a later registration replaces an earlier one.
+ (void)registerMethod:(NSString*)method handler:(EstellaNativeHandler)handler;

/// Stop answering `method`.
+ (void)unregisterMethod:(NSString*)method;

/// Tell the script something it did not ask for: every listener of `event` hears
/// `json` on the game's next frame. From any thread.
+ (void)emitEvent:(NSString*)event json:(nullable NSString*)json;

@end

NS_ASSUME_NONNULL_END
