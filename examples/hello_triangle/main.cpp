#include <esengine/ESEngine.hpp>
#include <esengine/ui/UIContext.hpp>
#include <esengine/ui/rendering/UIBatchRenderer.hpp>
#include <esengine/ui/font/SDFFont.hpp>
#include <esengine/ui/font/MSDFFont.hpp>
#include <esengine/events/Dispatcher.hpp>
#include <cstdio>

using namespace esengine;
using namespace esengine::ecs;

// Demo application with MSDF font testing
class HelloTriangleApp : public Application {
public:
    HelloTriangleApp() : Application(createConfig()) {}

private:
    static ApplicationConfig createConfig() {
        ApplicationConfig config;
        config.title = "MSDF Font Test - 中英文测试";
        config.width = 800;
        config.height = 600;
        return config;
    }

protected:
    void onInit() override {
        ES_LOG_INFO("MSDF Font Test initialized!");

        // Create UI context for font rendering
        uiContext_ = makeUnique<ui::UIContext>(getRenderContext(), dispatcher_);
        uiContext_->init();
        uiContext_->setViewport(getWidth(), getHeight());

        // Load MSDF font with CJK support
        const char* fontPaths[] = {
#ifdef ES_PLATFORM_WEB
            "/assets/fonts/msyh.ttc",       // Embedded font for web
#elif defined(_WIN32)
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

        // Load MSDF font
        for (const char** path = fontPaths; *path != nullptr; ++path) {
            msdfFont_ = ui::MSDFFont::create(*path, 32.0f, 4.0f);
            if (msdfFont_) {
                ES_LOG_INFO("Loaded MSDF font: {}", *path);
                break;
            }
        }

        if (!msdfFont_) {
            ES_LOG_ERROR("Failed to load any MSDF font!");
        }

        // Also load SDF font for comparison
        for (const char** path = fontPaths; *path != nullptr; ++path) {
            sdfFont_ = ui::SDFFont::create(*path, 48.0f, 8.0f);
            if (sdfFont_) {
                ES_LOG_INFO("Loaded SDF font: {}", *path);
                break;
            }
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
            glm::vec2(400.0f, 550.0f),
            glm::vec2(100.0f, 50.0f),
            glm::vec4(0.2f, 0.2f, 0.3f, 1.0f)
        );

        if (uiContext_) {
            auto& uiRenderer = uiContext_->getRenderer();

            glm::mat4 projection = glm::ortho(
                0.0f, static_cast<f32>(getWidth()),
                static_cast<f32>(getHeight()), 0.0f,
                -1.0f, 1.0f
            );

            uiRenderer.begin(projection);

            if (sdfFont_) {
                uiRenderer.drawText(
                    "SDF:  Hello World 123",
                    {50.0f, 30.0f},
                    *sdfFont_,
                    32.0f,
                    {0.0f, 1.0f, 1.0f, 1.0f}
                );
            }
            if (msdfFont_) {
                uiRenderer.drawText(
                    "MSDF: Hello World 123",
                    {50.0f, 70.0f},
                    *msdfFont_,
                    32.0f,
                    {1.0f, 0.5f, 0.0f, 1.0f}
                );
            }

            // Draw MSDF text (left side)
            if (msdfFont_) {
                uiRenderer.drawText(
                    "MSDF Font:",
                    {50.0f, 80.0f},
                    *msdfFont_,
                    24.0f,
                    {1.0f, 0.8f, 0.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Hello MSDF!",
                    {50.0f, 120.0f},
                    *msdfFont_,
                    32.0f,
                    {1.0f, 1.0f, 1.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "你好世界 中文",
                    {50.0f, 170.0f},
                    *msdfFont_,
                    32.0f,
                    {1.0f, 1.0f, 0.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Small 14px",
                    {50.0f, 220.0f},
                    *msdfFont_,
                    14.0f,
                    {0.8f, 0.8f, 1.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Large 48px",
                    {50.0f, 250.0f},
                    *msdfFont_,
                    48.0f,
                    {1.0f, 0.6f, 0.6f, 1.0f}
                );
            }

            // Draw SDF text (right side) for comparison
            if (sdfFont_) {
                uiRenderer.drawText(
                    "SDF Font:",
                    {420.0f, 30.0f},
                    *sdfFont_,
                    24.0f,
                    {0.0f, 0.8f, 1.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Hello SDF!",
                    {420.0f, 70.0f},
                    *sdfFont_,
                    32.0f,
                    {1.0f, 1.0f, 1.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "你好世界 中文",
                    {420.0f, 120.0f},
                    *sdfFont_,
                    32.0f,
                    {1.0f, 1.0f, 0.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Small 14px",
                    {420.0f, 170.0f},
                    *sdfFont_,
                    14.0f,
                    {0.8f, 0.8f, 1.0f, 1.0f}
                );

                uiRenderer.drawText(
                    "Large 48px",
                    {420.0f, 200.0f},
                    *sdfFont_,
                    48.0f,
                    {1.0f, 0.6f, 0.6f, 1.0f}
                );
            }

            uiRenderer.end();
        }
    }

    void onShutdown() override {
        msdfFont_.reset();
        sdfFont_.reset();
        uiContext_.reset();
        ES_LOG_INFO("MSDF Font Test shutdown");
    }

private:
    Dispatcher dispatcher_;
    Unique<ui::UIContext> uiContext_;
    Unique<ui::MSDFFont> msdfFont_;
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
