# ESEngine Examples

# Hello Triangle Example
add_executable(hello_triangle hello_triangle/main.cpp)
target_link_libraries(hello_triangle PRIVATE esengine)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    es_apply_emscripten_settings(hello_triangle)

    # Copy HTML file
    configure_file(
        ${CMAKE_CURRENT_SOURCE_DIR}/../bindings/platform/web/index.html
        ${CMAKE_BINARY_DIR}/bin/hello_triangle.html
        COPYONLY
    )
endif()
