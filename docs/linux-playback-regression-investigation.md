# Linux playback regression investigation

The published 0.2.7-rc.1 must not be promoted on the strength of the previous software-rendered checks. The user reports invisible controls, long buffering and black video after seeking on Linux.

## Reproductions

- Run 43337095682: the unchanged published package stalled at 30 seconds on Wayland and at 58 seconds on X11 during sparse-PGS seek tests, with no reported playback error. These failures occur before the new pointer tests.
- Run 43337389703, X11: real W3C pointer input successfully woke the controls and opened settings through GTK. Over HTTP with 200 ms delay and throughput twice the moving fixture's mean bitrate, seeks to 18, 4 and 23 seconds took 11.30, 10.93 and 5.53 seconds. Seeking back to 9 seconds failed the picture/progress deadline.
- Run 43337548730, X11: the same normal-video seek pattern reproduced after isolating it from the sparse-PGS tests: 11.27, 11.04 and 5.81 seconds, then a timeout at 9 seconds. Native telemetry confirmed zero presented frames while waiting at the requested position. The real-pointer check passed. This is evidence of a player/network-buffer regression, not a decoder-startup failure.

The software-rendered pointer pass does **not** explain or disprove invisible overlays on the user's actual GPU/compositor. Keep that separate from the seek reproduction.

## Controlled experiments and corrections

The attempted invoke-hook overrides in runs 43338007089 and 43338592402 were inconclusive: Tauri's invoke property is protected, so assignments silently failed. Do not treat those runs as evidence about changing buffer settings. The valid factory-injected comparison is run 43339459113.

In that comparison, the Wayland run measured seeks to 4/9 seconds at 11.48/13.11 seconds with the shipped 15-second buffer and 4.64/7.27 seconds with a 3-second buffer. Reducing the byte ceiling from 64 MiB to 4 MiB did not further improve them. Initial seeks remained slow, and the X11 run stopped responding to a seek for over 100 seconds. This also exposed synchronous seek work running on GTK's window thread.

## Implementation and current acceptance

- 138d3b1 adopts upstream GstPlay's dedicated controller thread, seek serialization, buffering/state/clock handling and cached position/duration queries. It removes the application's synchronous GTK-thread flushing seeks and custom bus-driven state changes. The native GTK sink, original-file stream and controls remain.
- Native snapshots now report buffering; the actual controller emits deduplicated `waiting`/`playing` events and keeps controls visible during loading. The test failed before implementation and passes afterward, including play-while-already-buffering.
- The frontend buffer target is three seconds, retaining the 64 MiB byte ceiling.
- First candidate build 43343379754 compiled and resumed all four real-player seeks in approximately 1.0–1.2 seconds, with visible native pictures. It failed the menu-pixel check: screenshots retained the removed initial Pause button and stale menu pixels. It was not published.
- 9af760a rolls back RC1's blanket legacy renderer override on WebKit older than 2.54, preserves the newer full-frame shared-memory correction, fixes initial-mute/unmute consistency and installs the GstPlay build SDK in both Linux workflows. The next candidate build is 43354046004. The acceptance test now explicitly verifies closed DOM menu state before comparing presented pixels.
- Subsequent test-only commits require real pointer interactivity and a visible loading indicator during delayed-network seeking, plus the GstPlay library inside the AppImage. These changes do not weaken pixel checks.

101 Node regression tests, the host Cargo check and three standalone renderer-policy tests passed. Final packaged X11/Wayland and constrained-network acceptance remains pending. These software-rendered checks cannot establish every physical GPU/compositor's behavior.

## Upstream references

- Tauri warns that an unconditional `WEBKIT_DISABLE_DMABUF_RENDERER` override removes the faster rendering path for unaffected users: https://v2.tauri.app/develop/debug/linux-graphics/
- GStreamer's own GstPlay pauses before seeking, serializes pending seeks, and coordinates buffering with seek completion: https://github.com/GStreamer/gstreamer/blob/1.20/subprojects/gst-plugins-bad/gst-libs/gst/play/gstplay.c
- GTK input pass-through is a documented overlay facility, but the current real-pointer tests do not justify changing it yet: https://docs.gtk.org/gtk3/method.Overlay.set_overlay_pass_through.html

## Release boundary

No stable release, updater manifest, Windows executable or previously published changelog has been modified during this investigation. RC1 remains a prerelease with known regressions.
