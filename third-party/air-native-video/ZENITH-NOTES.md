# Air native video source

Source: https://github.com/get-air/tauri-video-plugin
Revision: 6baf19ff74bfe5278838f05d9eaa4af55ecc4d05
License: MIT OR Apache-2.0, original notices retained.

Vendored because the inspected Linux surface implementation is not yet available in its documented npm version. Zenith uses only the raw Linux GStreamer controller; Windows and Android backends are not enabled by the host.

Zenith changes: add native playback-rate control, preserve rate during seeks, expose it through the media-element facade. The browser bundle is generated from guest-js/index.ts with scripts/build-native-video.mjs. No core Air UI or service is used.

The small controls.ts registration helper comes from https://github.com/get-air/video (same MIT OR Apache-2.0 license). WebKit metadata events are deferred until decoded video dimensions are available, so resume seeking cannot run before native preroll finishes.
