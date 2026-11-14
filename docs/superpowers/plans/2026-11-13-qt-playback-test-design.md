# Actual Qt player runtime test design

`tests/check-linux-qt-player.sh` runs a built or packaged helper supplied through
`ZENITH_QT_PLAYER`, using repository app assets. The caller provides an X11
display, running PulseAudio server, and `CI=true`. Run once with
`LIBGL_ALWAYS_SOFTWARE=1`, and separately without that variable on the intended
physical graphics stack. Software Xvfb evidence is not physical GPU evidence.

Example inside the prepared Linux CI environment:

```sh
CI=true ZENITH_QT_PLAYER=/absolute/path/zenith-player \
  LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s '-screen 0 1280x800x24' \
  dbus-run-session -- bash tests/check-linux-qt-player.sh
```

Dependencies are Node 22+, Python/Pillow, FFmpeg, ImageMagick X11 capture,
PulseAudio CLI tools, and the built helper's Qt/MpvQt/mpv dependency closure.
There are no npm dependencies. The public PGS sample is downloaded by the
existing SHA-256-pinned fixture generator; fixture generation fails on changed
content or unavailable network access. Existing GTK comparison fixtures are
reused, including the first PGS packet at approximately 26.406 seconds.

The harness enables loopback CDP at `127.0.0.1:9223` only after requiring CI.
The helper is launched with `--assets <repository>/app`; synthetic credentials
and settings enter over its private stdin JSON bootstrap, never argv. A local
fake Jellyfin implements the current PlaybackInfo/device profile, item, user,
session, and original-file range routes. Every playback negotiation is checked
for disabled server conversion, and original-file requests must be static.

Acceptance assertions:

- CDP inspects the actual Qt WebEngine player page, not a replacement browser.
  The helper process maps must contain Qt6WebEngineCore, MpvQt, and libmpv.
  The real `player.js` and Qt adapter must load, the GTK adapter/aperture must
  not load, and native bootstrap must report a Qt 6 version.
- The real HTMLMediaElement facade advances with visible dimensions and sound
  recorded from a dedicated PulseAudio null sink monitor. Clock checks alone
  cannot establish presented movie frames.
- CDP `Input.dispatchMouseEvent` opens actual settings and continuously hovers
  the seek bar and every visible bottom-row button while ImageMagick captures
  the X11 root surface. Every sample must retain blue movie pixels beneath HTML
  and opaque strokes in every icon, including individual rows and the lower
  quarter. CDP screenshots are deliberately not used as composition evidence.
- Native fullscreen state and mini window resize are exercised while playback
  and recorded sound continue. Source replacement uses the real `player.js`.
  A moving test pattern must change actual native surface pixels, both before
  seeking and after each forward/backward seek to 18, 4, 23, and 9 seconds.
- Sparse embedded PGS is selected, repeatedly sought across and before its
  first packet, disabled, and checked for resumed clock and recorded sound.
  Missing native track APIs or missing PGS tracks fail rather than skip.
- Byte-range use, real Jellyfin negotiation, ready/closed events, exit status,
  and absence of helper errors are mandatory. The helper must close in response
  to its stdin close message.

Evidence is retained in `ZENITH_QT_ARTIFACTS` (or a fresh temporary directory):
native root screenshots, captured PCM, redacted synthetic request metadata,
helper events and stderr. Failed assertions retain evidence and terminate the
helper/recorder. Tests do not change production code or package workflows.

This test requires an actual Linux runtime. Syntax checks on Windows do not
constitute Qt playback acceptance. A physical GPU run and installed package
launch remain distinct release checks.
