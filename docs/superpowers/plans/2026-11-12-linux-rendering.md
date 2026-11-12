# Linux rendering regression

Goal: stabilize native original-file playback and its UI using upstream-supported methods. No server conversion, no terminal setup for users, no changes to published 0.2.6.

1. Reproduce against the shipped package with Zenith's actual player HTML/CSS, moving video, menus, fullscreen and repeated title changes. Previous tests removed the actual UI and forced software rendering; they did not cover this regression.
2. Compare UI presentation separately from decoding. Tauri documents DMA-BUF/driver failures and session-specific renderer compatibility workarounds. Evaluate those before changing the decoder. Use existing libmpv backend only if evidence requires that change; do not invent another decoder or rendering API.
3. Apply the smallest demonstrated correction, retain strict direct play and existing controls. Build candidate 0.2.7, check original-file codecs/audio/subtitles and X11/Wayland presentation, then publish only with honest GPU-validation limits. Preserve user-only Git identity.

References: https://v2.tauri.app/develop/debug/linux-graphics/ ; https://github.com/jellyfin/jellyfin-desktop/blob/master/src/player/MpvVideoItem.cpp ; https://mpv.io/manual/stable/#options-hwdec
