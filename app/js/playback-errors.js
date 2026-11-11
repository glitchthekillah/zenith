// Codec repair guidance belongs to the local Linux player, never the server.
export const LINUX_CODEC_COMMAND = 'sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly';
export function playbackFailure(error, platform, source) {
  const decoding = error?.code === 3 || error?.code === 4 || /cannot direct play on this device/i.test(error?.message || '');
  const formats = [source?.Container, ...(source?.MediaStreams || []).filter(s => s.Type === 'Video' || s.Type === 'Audio').map(s => s.Codec)].filter(Boolean).join(' / ');
  if (decoding && platform === 'linux') return {
    message: `Linux could not decode this original file${formats ? ` (${formats})` : ''}. On Ubuntu or Linux Mint, install the local GStreamer media packages below, then fully close and reopen Zenith. Server transcoding remains disabled.`,
    command: LINUX_CODEC_COMMAND,
  };
  return {message: decoding ? 'This device could not decode the original file. Server transcoding is disabled. Try a compatible copy or install the required local codec.' : error?.message || 'The video stopped.', command: ''};
}
