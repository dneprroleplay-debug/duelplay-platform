cmake_minimum_required(VERSION 3.20)

project(DuelPlayPlayerAvatar VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
add_compile_options(-include strings.h)

# =========================
# CS2 / Metamod dependencies
# =========================
set(HL2SDK "/home/ubuntu/duelplay-build-deps/hl2sdk-cs2")
set(MMSOURCE "/home/ubuntu/duelplay-build-deps/metamod-source")

set(HL2SDK_PUBLIC "${HL2SDK}/public")
set(METAMOD_CORE "${MMSOURCE}/core")
set(KHOOK_INCLUDE "${MMSOURCE}/third_party/khook/include")

# =========================
# Linux / Source 2 defines
# =========================
add_compile_definitions(
    LINUX
    _LINUX
    POSIX
    _FILE_OFFSET_BITS=64
    COMPILER_GCC
    META_IS_SOURCE2
    stricmp=strcasecmp
    strnicmp=strncasecmp
)

# =========================
# Required files
# =========================
if(NOT EXISTS "${HL2SDK_PUBLIC}/networkstringtabledefs.h")
    message(FATAL_ERROR "CS2 SDK not found: ${HL2SDK_PUBLIC}/networkstringtabledefs.h")
endif()

if(NOT EXISTS "${METAMOD_CORE}/ISmmPlugin.h")
    message(FATAL_ERROR "Metamod SDK not found: ${METAMOD_CORE}/ISmmPlugin.h")
endif()

if(NOT EXISTS "${HL2SDK}/common/network_connection.proto")
    message(FATAL_ERROR "CS2 proto not found: ${HL2SDK}/common/network_connection.proto")
endif()

# =========================
# Protobuf
# =========================
find_program(PROTOC_EXECUTABLE protoc REQUIRED)

execute_process(
    COMMAND "${PROTOC_EXECUTABLE}" --version
    OUTPUT_VARIABLE PROTOC_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

message(STATUS "protoc: ${PROTOC_VERSION}")

if(NOT PROTOC_VERSION MATCHES "libprotoc 3\\.21\\.")
    message(FATAL_ERROR "protoc 3.21.x required, found: ${PROTOC_VERSION}")
endif()

set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")

set(PROTO_FILE
    "${HL2SDK}/common/network_connection.proto"
)

set(PROTO_CC
    "${GENERATED_DIR}/network_connection.pb.cc"
)

set(PROTO_H
    "${GENERATED_DIR}/network_connection.pb.h"
)

add_custom_command(
    OUTPUT
        "${PROTO_CC}"
        "${PROTO_H}"

    COMMAND
        "${CMAKE_COMMAND}" -E make_directory "${GENERATED_DIR}"

    COMMAND
        "${PROTOC_EXECUTABLE}"
        --cpp_out=${GENERATED_DIR}
        --proto_path=${HL2SDK}/common
        network_connection.proto

    DEPENDS
        "${PROTO_FILE}"

    WORKING_DIRECTORY
        "${HL2SDK}/common"

    COMMENT
        "Generating network_connection.pb.cc/.h"

    VERBATIM
)

# =========================
# Plugin
# =========================
find_package(Protobuf REQUIRED)

add_library(DuelPlayPlayerAvatar SHARED
    src/plugin.cpp
    "${PROTO_H}"
    "${HL2SDK}/interfaces/interfaces.cpp"
    "${HL2SDK}/public/tier0/memoverride.cpp"
    "${HL2SDK}/tier1/keyvalues3.cpp"
    "${HL2SDK}/tier1/convar.cpp"
)

target_include_directories(DuelPlayPlayerAvatar PRIVATE
    "${METAMOD_CORE}"
    "${KHOOK_INCLUDE}"
    "${HL2SDK_PUBLIC}"
    "${HL2SDK_PUBLIC}/tier0"
    "${HL2SDK_PUBLIC}/tier1"
    "${HL2SDK_PUBLIC}/mathlib"
    "${GENERATED_DIR}"
)

set_target_properties(DuelPlayPlayerAvatar PROPERTIES
    OUTPUT_NAME "DuelPlayPlayerAvatar"
    PREFIX ""
)

target_link_libraries(DuelPlayPlayerAvatar PRIVATE
    protobuf::libprotobuf
    /home/ubuntu/cs2/game/bin/linuxsteamrt64/libtier0.so
)

# Linux native plugin
if(UNIX AND NOT APPLE)
    target_link_options(DuelPlayPlayerAvatar PRIVATE
        "-Wl,--no-undefined"
    )
endif()

message(STATUS "")
message(STATUS "===== DuelPlayPlayerAvatar =====")
message(STATUS "CS2 SDK:      ${HL2SDK}")
message(STATUS "Metamod:      ${MMSOURCE}")
message(STATUS "Generated:    ${GENERATED_DIR}")
message(STATUS "protoc:       ${PROTOC_VERSION}")
message(STATUS "==============================")
