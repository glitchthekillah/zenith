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

101 Node regression tests and three standalone renderer-policy tests passed again after the final pipeline selection change. Final packaged X11/Wayland and constrained-network acceptance remains pending. These software-rendered checks cannot establish every physical GPU/compositor's behavior.

## Subsequent lifecycle and transport evidence

- Native GstPlay readiness is gated by the matching URI acknowledgment and matching media info. Its stop and URI setters queue worker operations; their return alone does not acknowledge a replacement file.
- A concrete XCB abort in run 43358254885 identified missing early Xlib threading initialization. The app now calls XInitThreads before creating Tauri/GTK/WebKit or media workers; the packaged binary exposes successful initialization in its runtime check.
- The first closed-video pixel assertion sampled a frame before WebKit presented its opaque background. Waiting two animation frames plus 150 ms makes that check inspect a presented frame. The assertion still requires black pixels; it is not removed or relaxed.
- GStreamer 1.20's GstPlay defaults to legacy playbin2. Selecting its supported playbin3 path resolved the sparse-PGS seek stalls in run 43362663571. The complete X11 suite passed: four real-player seeks around 1.2 seconds, visible menu pixels, six title replacements and HEVC10/VP9/AV1 originals. The app now selects this path before workers start, preserving explicit user overrides.
- Some later failures show only a tauri-driver intermediary HTTP `SendRequest` connection reset. App telemetry continues after the reset; these are not sufficient evidence that Zenith crashed. The intermediary uses a pooled Hyper client. The next controlled check sends standard session commands straight to WebKitWebDriver after Tauri translates launch capabilities, with no retries and all existing assertions retained. This isolates test transport from the app. A core capture is enabled only on disposable diagnostic runners.
- The Tauri GTK ancestry fix described by the native-video upstream is already present in the locked tauri-runtime-wry 2.12.3 source (`toplevel()` with a fallible downcast), so blindly applying an older runtime patch is unnecessary.

## Upstream references

- Tauri warns that an unconditional `WEBKIT_DISABLE_DMABUF_RENDERER` override removes the faster rendering path for unaffected users: https://v2.tauri.app/develop/debug/linux-graphics/
- GStreamer's own GstPlay pauses before seeking, serializes pending seeks, and coordinates buffering with seek completion: https://github.com/GStreamer/gstreamer/blob/1.20/subprojects/gst-plugins-bad/gst-libs/gst/play/gstplay.c
- GTK input pass-through is a documented overlay facility, but the current real-pointer tests do not justify changing it yet: https://docs.gtk.org/gtk3/method.Overlay.set_overlay_pass_through.html

## Release boundary

## RC4 transparent control-strip follow-up

The user's friend reports that RC3 still briefly erases a horizontal strip through control icons while the mouse moves. RC3 removed a demonstrated source of redundant DOM invalidation; it did not fix the physical-GPU rendering artifact.

The renderer policy incorrectly restricted FORCE_SHM to WebKit 2.54+. Inspection of the exact 2.50.4 AppImage source and WebKit 2.44.0 shows that both add SharedMemory transport before the FORCE_SHM early return and only add Hardware transport afterward. Therefore FORCE_SHM=1 is a supported way to keep compositing active while avoiding driver-imported interface buffers on those versions too. This is distinct from DISABLE_DMABUF, which returns with an empty transport and caused earlier overlay regressions.

RC4 selects shared interface frames from verified WebKit 2.44 onward, preserves explicit overrides, and leaves native video decoding, sink, buffer settings and strict original-file playback unchanged. The new older-version policy test failed before the correction; all four policy tests and 103 Node tests pass afterward. The packaged startup check verifies the actual override.

The X11 mouse test now compares settled, opaque control-icon strokes with the root-window picture after each pointer movement, alongside the existing movie-pixel check. This detects erased horizontal control strips rather than sampling only the video area. Its scope is software-rendered X11 at the test scale; physical GPU and display-scale confirmation remain separate. The reported brief startup hesitations are not yet isolated in this environment, so no buffering changes are made on speculation.

Sources: https://github.com/WebKit/WebKit/blob/webkitgtk-2.50.4/Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp and https://github.com/WebKit/WebKit/blob/webkitgtk-2.44.0/Source/WebKit/UIProcess/gtk/AcceleratedBackingStoreDMABuf.cpp .

## RC3 mouse-movement follow-up

RC2 improved actual Oppenheimer playback on the user's friend's machine, but moving the mouse still exposed the underlying interface and disrupted controls. `wake()` removed the already-absent idle class on every mouse move. DOMTokenList emits these unchanged attribute records; the native compositor treated them as ancestor background/layout changes and reconstructed the aperture and occluder masks.

Run 43494111831 reproduced eight unchanged class records for eight real X11 pointer movements against the published RC2 package. The new wake regression failed with 30 redundant changes for 30 calls; the compositor regression also failed on an unchanged class record. The fixes guard the wake mutation and ignore unchanged observed attributes. Both tests now pass while real styling changes, loading visibility and idle timer behavior remain covered. The full Node suite passes 103 tests.

That baseline run also intermittently stalled in the earlier sparse-PGS seek phase on Wayland, before it reached the mouse test. This is an existing playback limitation, not evidence about the mouse fix; do not claim it is resolved by RC3. No pipeline, decoder, buffering or renderer selection changes are part of RC3. Software-rendered pointer acceptance remains distinct from the friend's physical Intel GPU validation.

No stable release, updater manifest, Windows executable or previously published changelog has been modified during this investigation. RC1 remains a prerelease with known regressions.
