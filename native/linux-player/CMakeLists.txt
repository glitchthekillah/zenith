cmake_minimum_required(VERSION 3.24)
project(zenith-qt-player VERSION 1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
include(GNUInstallDirs)
include(FetchContent)
include(GenerateExportHeader)
find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Qml Quick OpenGL WebEngineQuick WebEngineCore WebChannel Network)
find_package(PkgConfig REQUIRED)
pkg_check_modules(MPV REQUIRED IMPORTED_TARGET mpv>=0.34)
# SOURCE_SUBDIR deliberately avoids upstream's ECM dependency. Sources and licenses
# remain byte-for-byte upstream; renderer/lifetime code is never reimplemented here.
FetchContent_Declare(mpvqt
    GIT_REPOSITORY https://github.com/KDE/mpvqt.git
    GIT_TAG 8a4d1ae9d1a1c5c94cd96bccb5330b83c1704b99
    GIT_SHALLOW FALSE
    SOURCE_SUBDIR zenith-no-upstream-project)
FetchContent_MakeAvailable(mpvqt)
add_library(MpvQt SHARED
    ${mpvqt_SOURCE_DIR}/src/mpvabstractitem.cpp
    ${mpvqt_SOURCE_DIR}/src/mpvabstractitem.h
    ${mpvqt_SOURCE_DIR}/src/mpvcontroller.cpp
    ${mpvqt_SOURCE_DIR}/src/mpvcontroller.h
    ${mpvqt_SOURCE_DIR}/src/mpvrenderer.cpp
    ${mpvqt_SOURCE_DIR}/src/mpvrenderer.h)
target_compile_options(MpvQt PRIVATE -include "${CMAKE_CURRENT_SOURCE_DIR}/mpvqt-compat.h")
generate_export_header(MpvQt BASE_NAME MPVQT EXPORT_FILE_NAME mpvqt_export.h)
target_include_directories(MpvQt PUBLIC ${mpvqt_SOURCE_DIR}/src ${CMAKE_CURRENT_BINARY_DIR})
target_link_libraries(MpvQt PUBLIC Qt6::Quick Qt6::OpenGL PkgConfig::MPV)
set_target_properties(MpvQt PROPERTIES VERSION 1.2.1 SOVERSION 1 INSTALL_RPATH "$ORIGIN")
qt_add_executable(zenith-qt-player main.cpp bridge.cpp bridge.h videoitem.cpp videoitem.h policy.h)
qt_add_resources(zenith-qt-player player_qml PREFIX "/" FILES Main.qml)
target_link_libraries(zenith-qt-player PRIVATE MpvQt Qt6::Core Qt6::Gui Qt6::Quick Qt6::Qml Qt6::WebEngineQuick Qt6::WebEngineCore Qt6::WebChannel Qt6::Network)
set_target_properties(zenith-qt-player PROPERTIES INSTALL_RPATH "$ORIGIN/../${CMAKE_INSTALL_LIBDIR}")
install(TARGETS zenith-qt-player MpvQt RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(DIRECTORY ${mpvqt_SOURCE_DIR}/LICENSES/ DESTINATION share/zenith-qt-player/licenses/MpvQt)
install(FILES THIRD_PARTY.md DESTINATION share/zenith-qt-player/licenses)
install(DIRECTORY ${mpvqt_SOURCE_DIR}/ DESTINATION share/zenith-qt-player/sources/mpvqt PATTERN ".git" EXCLUDE)
include(CTest)
if(BUILD_TESTING)
    find_package(Qt6 6.8 REQUIRED COMPONENTS Test)
    qt_add_executable(player-policy-test tests/policytest.cpp)
    target_include_directories(player-policy-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(player-policy-test PRIVATE Qt6::Test Qt6::Network)
    add_test(NAME player-policy COMMAND player-policy-test)
endif()


