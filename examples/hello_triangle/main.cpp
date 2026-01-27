#include <esengine/ESEngine.hpp>
#include <esengine/ui/UIContext.hpp>
#include <esengine/ui/rendering/UIBatchRenderer.hpp>
#include <esengine/ui/font/SDFFont.hpp>
#include <esengine/events/Dispatcher.hpp>

using namespace esengine;
using namespace esengine::ecs;

// Demo application with SDF font testing
class HelloTriangleApp : public Application {
public:
    HelloTriangleApp() : Application(createConfig()) {}

private:
    static ApplicationConfig createConfig() {
        ApplicationConfig config;
        config.title = "SDF Font Test - 中英文测试";
        config.width = 800;
        config.height = 600;
        return config;
    }

protected:
    void onInit() override {
        ES_LOG_INFO("SDF Font Test initialized!");

        // Create UI context for font rendering
        uiContext_ = makeUnique<ui::UIContext>(getRenderContext(), dispatcher_);
        uiContext_->init();
        uiContext_->setViewport(getWidth(), getHeight());

        // Load SDF font with CJK support
        const char* fontPaths[] = {
#ifdef _WIN32
            "C:/Windows/Fonts/msyh.ttc",    // Microsoft YaHei (中文)
            "C:/Windows/Fonts/simhei.ttf",  // SimHei
            "C:/Windows/Fonts/simsun.ttc",  // SimSun
            "C:/Windows/Fonts/arial.ttf",   // Arial (English fallback)
#else
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
#endif
            nullptr
        };

        for (const char** path = fontPaths; *path != nullptr; ++path) {
            sdfFont_ = ui::SDFFont::create(*path, 48.0f, 8.0f);
            if (sdfFont_) {
                ES_LOG_INFO("Loaded SDF font: {}", *path);
                break;
            }
        }

        if (!sdfFont_) {
            ES_LOG_ERROR("Failed to load any SDF font!");
        }

        // Create some entities
        auto& registry = getRegistry();
        Entity triangle = registry.create();
        registry.emplace<LocalTransform>(triangle, glm::vec3(400.0f, 450.0f, 0.0f));
        registry.emplace<Name>(triangle, "Triangle");

        ES_LOG_INFO("Press ESC to exit");
    }

    void onUpdate(f32 deltaTime) override {
        (void)deltaTime;
        if (getInput().isKeyPressed(KeyCode::Escape)) {
            quit();
        }
    }

    void onRender() override {
        auto& renderer = getRenderer();

        // Draw a simple quad
        renderer.drawQuad(
            glm::vec2(400.0f, 450.0f),
            glm::vec2(100.0f, 100.0f),
            glm::vec4(1.0f, 0.5f, 0.2f, 1.0f)
        );

        // Draw SDF text
        if (sdfFont_ && uiContext_) {
            auto& uiRenderer = uiContext_->getRenderer();

            glm::mat4 projection = glm::ortho(
                0.0f, static_cast<f32>(getWidth()),
                static_cast<f32>(getHeight()), 0.0f,
                -1.0f, 1.0f
            );

            uiRenderer.begin(projection);

            // English text
            uiRenderer.drawText(
                "Hello SDF Font!",
                {50.0f, 50.0f},
                *sdfFont_,
                32.0f,
                {1.0f, 1.0f, 1.0f, 1.0f}
            );

            // Chinese text
            uiRenderer.drawText(
                "你好，世界！中文测试",
                {50.0f, 100.0f},
                *sdfFont_,
                32.0f,
                {1.0f, 1.0f, 0.0f, 1.0f}
            );

            // Mixed text
            uiRenderer.drawText(
                "ESEngine 引擎 - SDF字体渲染",
                {50.0f, 150.0f},
                *sdfFont_,
                28.0f,
                {0.5f, 1.0f, 0.5f, 1.0f}
            );

            // Different sizes to show SDF scaling
            uiRenderer.drawText(
                "Small 小字 16px",
                {50.0f, 200.0f},
                *sdfFont_,
                16.0f,
                {0.8f, 0.8f, 1.0f, 1.0f}
            );

            uiRenderer.drawText(
                "Large 大字 48px",
                {50.0f, 240.0f},
                *sdfFont_,
                48.0f,
                {1.0f, 0.6f, 0.6f, 1.0f}
            );

            uiRenderer.drawText(
                "动态加载 Dynamic Loading",
                {50.0f, 320.0f},
                *sdfFont_,
                24.0f,
                {0.6f, 0.9f, 1.0f, 1.0f}
            );

            uiRenderer.end();
        }
    }

    void onShutdown() override {
        sdfFont_.reset();
        uiContext_.reset();
        ES_LOG_INFO("SDF Font Test shutdown");
    }

private:
    Dispatcher dispatcher_;
    Unique<ui::UIContext> uiContext_;
    Unique<ui::SDFFont> sdfFont_;
};

// Entry point
#ifndef ES_PLATFORM_WEB
int main() {
    HelloTriangleApp app;
    app.run();
    return 0;
}
#else
ES_MAIN(HelloTriangleApp)
#endif
