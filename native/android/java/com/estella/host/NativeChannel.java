// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
package com.estella.host;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ServiceLoader;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The game's line to this app's own Java: methods a script calls by name, and
 * events Java raises for the script.
 *
 * The engine is native and knows nothing of an ad SDK, a store or a sign-in
 * library; those are Java, and they are the project's. A project answers a name
 * here and its script calls that name:
 *
 * <pre>
 *   NativeChannel.register("ads.show", (args, reply) -> { ... reply.resolve("{\"completed\":true}"); });
 * </pre>
 * <pre>
 *   const result = await NativeChannel.call('ads.show', { kind: 'rewarded', unitId });
 * </pre>
 *
 * Arguments and results are JSON text, so neither side needs the other's types.
 * A handler runs on the UI thread, which is where an SDK that shows anything has
 * to be called, and may answer later from any thread, once.
 *
 * Registration happens before the game's first frame through {@link Plugin}: a
 * class named in {@code META-INF/services/com.estella.host.NativeChannel$Plugin}
 * is constructed and asked to register, the way any Java library finds its
 * providers. A library can therefore bring its handlers with it, and nothing in
 * the manifest names them.
 */
public final class NativeChannel {

    /** How a handler answers. One of the two, once; a second answer is dropped. */
    public interface Reply {
        /** The call's result, as JSON text ({@code null} for no value). */
        void resolve(String json);
        /** The call failed: the script's promise rejects with this reason. */
        void reject(String reason);
    }

    /** What answers a method. Runs on the UI thread. */
    public interface Handler {
        void handle(String argsJson, Reply reply);
    }

    /** A provider of handlers, found through {@link ServiceLoader}. */
    public interface Plugin {
        /** Register what this plugin answers. On the game thread, before the first frame. */
        void register(Activity activity);
    }

    private static final String TAG = "EstellaSDK";
    private static final ConcurrentHashMap<String, Handler> handlers = new ConcurrentHashMap<>();
    private static volatile Activity activity;
    /** Set once the natives below are registered: before that there is nobody to tell. */
    private static volatile boolean attached;

    private NativeChannel() {}

    /** Answer {@code method} from now on; a later registration replaces an earlier one. */
    public static void register(String method, Handler handler) {
        if (method == null || handler == null) throw new IllegalArgumentException("method and handler are required");
        handlers.put(method, handler);
    }

    /** Stop answering {@code method}. */
    public static void unregister(String method) {
        if (method != null) handlers.remove(method);
    }

    /**
     * Tell the script something it did not ask for: every listener of {@code event}
     * hears {@code json} on the game's next frame. From any thread. Before the game
     * has started there is nobody to hear it, and it is dropped.
     */
    public static void emit(String event, String json) {
        if (event == null || !attached) return;
        nativeEvent(event, utf8(json == null ? "null" : json));
    }

    /** The game's activity, for an SDK that needs one. Null before the game starts. */
    public static Activity activity() {
        return activity;
    }

    // -- Called by the host (platform/android.cpp), on the game thread ---------

    static void attach(Activity host) {
        activity = host;
        attached = true;
        if (!handlers.containsKey("app.info")) register("app.info", new AppInfo(host));
        try {
            for (Plugin plugin : ServiceLoader.load(Plugin.class, host.getClassLoader())) {
                try {
                    plugin.register(host);
                } catch (Throwable error) {
                    Log.e(TAG, "native plugin " + plugin.getClass().getName() + " failed to register", error);
                }
            }
        } catch (Throwable error) {
            // A provider file naming a class that is not there: the rest still run.
            Log.e(TAG, "native plugins could not be listed", error);
        }
    }

    static boolean has(String method) {
        return method != null && handlers.containsKey(method);
    }

    /** Start {@code method}; false when nothing answers to the name. */
    static boolean call(final int id, String method, byte[] argsUtf8) {
        final String args = new String(argsUtf8 == null ? new byte[0] : argsUtf8, StandardCharsets.UTF_8);
        final Handler handler = method == null ? null : handlers.get(method);
        final Activity host = activity;
        if (handler == null || host == null) return false;
        final Once reply = new Once(id);
        host.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    handler.handle(args, reply);
                } catch (Throwable error) {
                    reply.reject(error.toString());
                }
            }
        });
        return true;
    }

    // Text crosses as UTF-8 bytes: a JNI string is modified UTF-8, which is not
    // what the script reads, and an emoji in a payload would arrive as two halves.
    private static native void nativeReply(int id, boolean ok, byte[] payloadUtf8);
    private static native void nativeEvent(String name, byte[] payloadUtf8);

    private static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** A reply that reaches the script once, however many times it is given. */
    private static final class Once implements Reply {
        private final int id;
        private final AtomicBoolean answered = new AtomicBoolean();

        Once(int id) { this.id = id; }

        @Override public void resolve(String json) {
            if (answered.compareAndSet(false, true)) nativeReply(id, true, utf8(json == null ? "null" : json));
        }

        @Override public void reject(String reason) {
            if (answered.compareAndSet(false, true)) nativeReply(id, false, utf8(reason == null ? "" : reason));
        }
    }

    /** What the app is, which a script cannot otherwise read: its id and version. */
    private static final class AppInfo implements Handler {
        private final Activity host;

        AppInfo(Activity host) { this.host = host; }

        @Override public void handle(String argsJson, Reply reply) {
            try {
                PackageInfo info = host.getPackageManager().getPackageInfo(host.getPackageName(), 0);
                JSONObject out = new JSONObject();
                out.put("os", "android");
                out.put("osVersion", Build.VERSION.RELEASE);
                out.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                out.put("id", host.getPackageName());
                out.put("version", info.versionName == null ? "" : info.versionName);
                out.put("build", String.valueOf(info.getLongVersionCode()));
                reply.resolve(out.toString());
            } catch (Throwable error) {
                reply.reject(error.toString());
            }
        }
    }
}
