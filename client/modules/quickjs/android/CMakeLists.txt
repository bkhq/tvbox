cmake_minimum_required(VERSION 3.13)
project(quickjs-bridge C)

set(CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)
set(ENGINE_SOURCES
  ${CPP_DIR}/quickjs-ng/quickjs.c
  ${CPP_DIR}/quickjs-ng/dtoa.c
  ${CPP_DIR}/quickjs-ng/libregexp.c
  ${CPP_DIR}/quickjs-ng/libunicode.c
)

add_library(quickjs-bridge SHARED
  ${ENGINE_SOURCES}
  ${CPP_DIR}/qjs_bridge.c
  src/main/cpp/quickjs_jni.c
)

set_target_properties(quickjs-bridge PROPERTIES C_STANDARD 11 C_EXTENSIONS ON)
target_include_directories(quickjs-bridge PRIVATE ${CPP_DIR})
# NDEBUG: engine assertions (e.g. the leak check in JS_FreeRuntime) must not
# abort the app in debug builds.
target_compile_definitions(quickjs-bridge PRIVATE _GNU_SOURCE NDEBUG)
target_compile_options(quickjs-bridge PRIVATE -O2 -fvisibility=hidden)
set_source_files_properties(${ENGINE_SOURCES} PROPERTIES COMPILE_OPTIONS "-w")
target_link_options(quickjs-bridge PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(quickjs-bridge m)
