# Bundled upstream components

KDE MpvQt 1.2.1, commit 8a4d1ae9d1a1c5c94cd96bccb5330b83c1704b99
Source: https://github.com/KDE/mpvqt/tree/8a4d1ae9d1a1c5c94cd96bccb5330b83c1704b99
Copyright 2023 George Florea Bănuș and upstream contributors.
MpvQt sources retain their upstream SPDX notices, including the choice of
LGPL-2.1-only OR LGPL-3.0-only OR LicenseRef-KDE-Accepted-LGPL. Build files
also carry BSD-3-Clause; the upstream LICENSES directory is shipped unmodified.

Zenith dynamically links libMpvQt.so.1 and libmpv, allowing replacement of
these shared libraries. The exact, unmodified MpvQt source is installed under
share/zenith-qt-player/sources/mpvqt; only the local CMake wrapper replaces
upstream ECM-based build orchestration. A forced-include compatibility header maps Qt 6.9 logging-category syntax to its Qt 6.8 equivalent, without modifying upstream sources. Build with CMake 3.24+, Qt 6.8+ and
pkg-config libmpv 0.34+ (see CMakeLists.txt). No upstream renderer is copied
into Zenith code or replaced by a custom renderer.

The package assembler must additionally include the Qt, Chromium/WebEngine,
FFmpeg/libmpv, and transitive library license notices and corresponding
source offers required by the exact distributed builds. This notice does
not replace those upstream licenses. Qt and libmpv are shared libraries.

