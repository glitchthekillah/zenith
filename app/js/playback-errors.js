const safeMessage = value => String(value || '').replace(/https?:\/\/[^\s)]+/gi, '[media URL]').replace(/\b(api_key|access_token|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
export function playbackFailure(error, platform, source) {
  const decoding = error?.code === 3 || error?.code === 4 || /cannot direct play on this device/i.test(error?.message || '');
  const formats = [source?.Container, ...(source?.MediaStreams || []).filter(s => s.Type === 'Video' || s.Type === 'Audio').map(s => s.Codec)].filter(Boolean).join(' / ');
  return {
    message: decoding ? `Original-file playback could not start${formats ? ` (${formats})` : ''}. Server transcoding remains disabled.` : safeMessage(error?.message) || 'The video stopped.',
    command: '',
  };
}
