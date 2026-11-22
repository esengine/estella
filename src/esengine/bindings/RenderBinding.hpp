// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#ifdef ES_RENDER_THREADS
#include "ActiveContext.hpp"
#include <string_view>
#include <tuple>
#include <type_traits>

#ifdef __EMSCRIPTEN__
namespace emscripten { class val; }
#endif

namespace esengine {

// Both script hosts cross exactly the same ownership boundary. The default is
// a rendezvous: the caller may recycle its upload scratch or mutate its world
// immediately afterwards. Only commands with explicitly owned inputs detach.
template<unsigned N> struct BindingName {
    char text[N];
    constexpr BindingName(const char (&name)[N]) {
        for (unsigned i = 0; i < N; ++i) text[i] = name[i];
    }
};

template<BindingName Name, auto Function> struct RenderBinding;

template<BindingName Name, class R, class... Args, R (*Function)(Args...)>
struct RenderBinding<Name, Function> {
    static R call(Args... args) {
        constexpr std::string_view name(Name.text);
        auto& queue = activeCtx().renderThread();
        if (!queue.enabled() || queue.isOwner()) return Function(args...);
#ifdef __EMSCRIPTEN__
        // JS objects belong to the originating realm. These queries read CPU
        // metadata only, once the render owner has stopped modifying it.
        if constexpr (std::is_same_v<R, emscripten::val>) {
            queue.flush();
            return Function(args...);
        } else
#endif
        if constexpr (name == "renderer_endFrame") {
#ifdef __EMSCRIPTEN__
            queue.finishFrame([] { Function(); });
#else
            // The native host places the frame fence after presenting its surface.
            queue.enqueue([] { Function(); });
#endif
        } else if constexpr (name == "renderer_end" || name == "renderer_flush"
                || name == "mesh_release" || name == "environment_release"
                || name == "rm_releaseTexture" || name == "rm_releaseBitmapFont"
                || name == "rm_releaseShader") {
            // A resource-manager reference names a context-owned service. Other
            // arguments in this list are handles. Shutdown drains before teardown.
            queue.enqueue([values = std::tuple<Args...>(args...)] { std::apply(Function, values); });
        } else {
            return queue.invoke([&] { return Function(args...); });
        }
    }
};

} // namespace esengine

#define ES_RENDER_BIND(name) (&::esengine::RenderBinding<#name, &::esengine::name>::call)
#else
#define ES_RENDER_BIND(name) (&::esengine::name)
#endif
