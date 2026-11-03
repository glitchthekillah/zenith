// Which audio and subtitle tracks play by default, and how subtitles look.
// Defaults: English audio whenever the file has it; if it doesn't, English subtitles come on.
// Both are changed in Settings > Playback.
import { settings } from './core.js';

// Language names and the codes servers use for them (ISO 639-2, 639-1 and the full name)
export const LANGS = [
  ['eng', 'English', ['en', 'english']], ['jpn', 'Japanese', ['ja', 'japanese']], ['spa', 'Spanish', ['es', 'spanish', 'español']],
  ['fre', 'French', ['fra', 'fr', 'french', 'français']], ['ger', 'German', ['deu', 'de', 'german', 'deutsch']], ['ita', 'Italian', ['it', 'italian']],
  ['por', 'Portuguese', ['pt', 'portuguese', 'português']], ['rus', 'Russian', ['ru', 'russian']], ['kor', 'Korean', ['ko', 'korean']],
  ['chi', 'Chinese', ['zho', 'zh', 'chinese', 'mandarin', 'cantonese']], ['ara', 'Arabic', ['ar', 'arabic']], ['hin', 'Hindi', ['hi', 'hindi']],
  ['per', 'Persian', ['fas', 'fa', 'persian', 'farsi']], ['tur', 'Turkish', ['tr', 'turkish']], ['pol', 'Polish', ['pl', 'polish']],
  ['dut', 'Dutch', ['nld', 'nl', 'dutch']], ['swe', 'Swedish', ['sv', 'swedish']], ['tha', 'Thai', ['th', 'thai']],
];
const names = (code) => { const l = LANGS.find((x) => x[0] === code); return l ? [l[0], ...l[2], l[1].toLowerCase()] : [code]; };
export const isLang = (track, code) => {
  if (!track || !code) return false;
  const want = names(code), lang = String(track.lang || '').toLowerCase();
  if (lang && want.includes(lang)) return true;
  // No language tag: fall back to the track's title ("English 5.1", "Japanese [Dub]")
  return !lang && want.some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`, 'i').test(track.label || ''));
};
const commentary = (t) => /commentary|director|descriptive|audio description/i.test(t.label || '');

// Upgrade older saved settings once: direct play on, and the new subtitle rules
export function migrate(save) {
  const p = settings.playback;
  if ((p.v || 0) >= 2) return;
  p.directPlay = true;
  if (!p.subtitles || p.subtitles === 'auto') p.subtitles = 'smart';
  if (!p.audioLang) p.audioLang = 'eng';
  if (!p.subLang) p.subLang = 'eng';
  p.v = 2; save();
}
export function migrateStyle(save) {
  const p = settings.playback;
  if ((p.sv || 0) >= 1) return;
  const old = { light: 35, dark: 60, solid: 90 }[p.subBg];
  if (old) { p.subBg = 'line'; p.subBgOpacity = old; }
  for (const [k, v] of Object.entries(subDefaults)) if (p[k] === undefined) p[k] = v;
  if (p.subFont === 'bold') { p.subFont = 'sans'; p.subWeight = 800; }
  p.sv = 1; save();
}

// audio/subs: [{ index, lang, label, forced, isDefault, textBased }]
export function pickAudio(audio, fileDefault) {
  const want = settings.playback.audioLang || 'eng';
  if (want !== 'default') {
    const match = audio.filter((a) => isLang(a, want) && !commentary(a));
    if (match.length) return (match.find((a) => a.isDefault) || match[0]).index;
  }
  return fileDefault ?? audio.find((a) => a.isDefault)?.index ?? audio[0]?.index ?? null;
}
export function pickSub(subs, audioTrack) {
  const mode = settings.playback.subtitles || 'smart', lang = settings.playback.subLang || 'eng';
  if (mode === 'off' || !subs.length) return null;
  const inLang = subs.filter((s) => isLang(s, lang));
  const best = (list) => list.find((s) => s.textBased && !/sdh|cc|hearing/i.test(s.label)) || list.find((s) => s.textBased) || list[0];
  const full = inLang.filter((s) => !s.forced), forced = inLang.filter((s) => s.forced);
  const hearsLang = audioTrack && isLang(audioTrack, lang);
  if (mode === 'always') return (best(full) || best(forced))?.index ?? null;
  // Forced only, or "smart" when the audio is already in your language: just signs and foreign lines
  if (mode === 'forced' || hearsLang) return best(forced)?.index ?? null;
  // Smart: the audio isn't in your language, so show full subtitles
  return (best(full) || best(forced))?.index ?? null;
}

// ── Subtitle look (presets like the big streaming apps, every part adjustable) ──
export const SUB_COLORS = [['#ffffff', 'White'], ['#ffe066', 'Yellow'], ['#7ee8fa', 'Cyan'], ['#a7f3a0', 'Green'], ['#ffb3d9', 'Pink'], ['#c4b5fd', 'Lilac']];
export const SUB_BG_COLORS = [['#000000', 'Black'], ['#1f2430', 'Slate'], ['#ffffff', 'White'], ['#1b3a6b', 'Navy']];
export const SUB_BGS = [['none', 'None'], ['line', 'Behind each line'], ['window', 'One block']];
export const SUB_EDGES = [['shadow', 'Drop shadow'], ['outline', 'Outline'], ['raised', 'Raised'], ['glow', 'Soft glow'], ['none', 'None']];
export const SUB_FONTS = [['sans', 'Sans', 'Inter, "Segoe UI", Roboto, sans-serif'], ['serif', 'Serif', 'Georgia, "Times New Roman", serif'], ['mono', 'Mono', '"Cascadia Mono", Consolas, "Courier New", monospace'], ['round', 'Rounded', '"Varela Round", Nunito, "Segoe UI", sans-serif'], ['condensed', 'Condensed', '"Roboto Condensed", "Arial Narrow", "Segoe UI", sans-serif']];
export const SUB_WEIGHTS = [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy']];
export const subDefaults = { subPreset: 'zenith', subtitleSize: 100, subColor: '#ffffff', subOpacity: 100, subFont: 'sans', subWeight: 600, subEdge: 'shadow', subBg: 'line', subBgColor: '#000000', subBgOpacity: 55, subPos: 6 };
const P = (name, label, o) => [name, label, { ...subDefaults, ...o, subPreset: name }];
export const SUB_PRESETS = [
  P('zenith', 'Zenith', {}),
  P('youtube', 'YouTube', { subWeight: 500, subEdge: 'none', subBg: 'line', subBgOpacity: 75 }),
  P('netflix', 'Netflix', { subtitleSize: 110, subWeight: 700, subEdge: 'shadow', subBg: 'none' }),
  P('fansub', 'Anime fansub', { subtitleSize: 105, subFont: 'round', subWeight: 700, subEdge: 'outline', subBg: 'none' }),
  P('cinema', 'Cinema', { subColor: '#ffe066', subFont: 'serif', subWeight: 500, subEdge: 'shadow', subBg: 'none' }),
  P('classic', 'Classic TV', { subtitleSize: 95, subFont: 'mono', subWeight: 500, subEdge: 'none', subBg: 'window', subBgOpacity: 100 }),
  P('bigclear', 'Big and clear', { subtitleSize: 140, subWeight: 800, subEdge: 'none', subBg: 'line', subBgOpacity: 100 }),
  P('minimal', 'Minimal', { subtitleSize: 90, subWeight: 500, subOpacity: 90, subEdge: 'glow', subBg: 'none' }),
];
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
export function applySubStyle(el) {
  const p = { ...subDefaults, ...settings.playback };
  const a = p.subBg === 'none' ? 0 : p.subBgOpacity / 100;
  const dark = parseInt(p.subColor.slice(1), 16) < 0x808080 ? '#fff' : '#000';
  const edge = { none: 'none', shadow: '0 2px 4px rgba(0,0,0,.95), 0 0 10px rgba(0,0,0,.6)', outline: `-1.5px -1.5px 0 ${dark}, 1.5px -1.5px 0 ${dark}, -1.5px 1.5px 0 ${dark}, 1.5px 1.5px 0 ${dark}, 0 0 4px ${dark}`, raised: '1px 1px 0 #333, 2px 2px 0 #222, 3px 3px 2px rgba(0,0,0,.6)', glow: '0 0 6px rgba(0,0,0,.85), 0 0 16px rgba(0,0,0,.55)' }[p.subEdge] || 'none';
  const set = (k, v) => el.style.setProperty(k, v);
  set('--sub-size', p.subtitleSize / 100); set('--sub-color', p.subColor); set('--sub-opacity', p.subOpacity / 100);
  set('--sub-font', (SUB_FONTS.find((f) => f[0] === p.subFont) || SUB_FONTS[0])[2]); set('--sub-weight', p.subWeight);
  set('--sub-edge', edge); set('--sub-pos', `${p.subPos}%`);
  set('--sub-line-bg', p.subBg === 'line' ? rgba(p.subBgColor, a) : 'transparent');
  set('--sub-win-bg', p.subBg === 'window' ? rgba(p.subBgColor, a) : 'transparent');
}
// Cue text is kept to plain text plus italics, bold and underline
export const cueHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/&lt;(\/?)(i|b|u)&gt;/g, '<$1$2>').replace(/&lt;[^&]*?&gt;/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\n/g, '<br>');
