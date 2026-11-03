// Profile picture: kept only on this device (IndexedDB), never sent to a server.
// Still pictures are cropped and saved small. GIFs are saved as they are so they keep moving,
// and the chosen crop is applied when they are shown.
import { settings, save, emit, render, modal, esc, toast } from './core.js';

const DB = 'zenith-local', STORE = 'files', KEY = 'avatar';
const db = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
const put = (blob) => tx('readwrite', (s) => s.put(blob, KEY));
const get = () => tx('readonly', (s) => s.get(KEY));
const del = () => tx('readwrite', (s) => s.delete(KEY));

let url = '';
export const hasAvatar = () => !!url;
export async function loadAvatar() {
  try {
    const p = settings.profile;
    // Pictures saved by the earlier version lived in settings; move them over
    if (p.avatar?.startsWith('data:')) { await put(await (await fetch(p.avatar)).blob()); p.avatar = 'local'; p.crop = null; save(); }
    const blob = p.avatar ? await get() : null;
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : '';
  } catch { url = ''; }
}
// The picture, cropped, filling whatever round box it sits in
export function avatarHtml(letter = '?') {
  if (!url) return `<span class="av-letter">${esc(String(letter).slice(0, 1).toUpperCase())}</span>`;
  const c = settings.profile.crop || { w: 1, h: 1, l: 0, t: 0 };
  return `<span class="av-crop"><img src="${url}" alt="" draggable="false" style="width:${c.w * 100}%;height:${c.h * 100}%;left:${-c.l * 100}%;top:${-c.t * 100}%"></span>`;
}
export async function clearAvatar() { await del().catch(() => {}); settings.profile.avatar = ''; settings.profile.crop = null; save(); await loadAvatar(); emit('servers'); render(); }

// The crop window: drag to move, slider or scroll wheel to zoom
export function pickAvatar(file) {
  if (!file.type.startsWith('image/')) return toast("That file isn't a picture.", 'bad');
  if (file.size > 25e6) return toast('That picture is over 25 MB. Try a smaller one.', 'bad');
  const isGif = file.type === 'image/gif';
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(src); toast("Couldn't open that picture.", 'bad'); };
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight, R = 260, O = 40;
    let z = 1, s = Math.min(W, H), sx = (W - s) / 2, sy = (H - s) / 2;
    const d = modal(`<h2 style="margin:0 0 4px">Crop your picture</h2><p style="color:var(--mute);margin:0 0 16px">Drag to move, scroll or use the slider to zoom.${isGif ? ' GIFs keep moving.' : ''}</p>
      <div class="crop-stage"><img src="${src}" alt="" draggable="false"><div class="crop-ring"></div></div>
      <label class="crop-zoom"><span>-</span><input type="range" min="1" max="5" step="0.01" value="1" aria-label="Zoom"><span>+</span></label>
      <div class="acts" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Cancel</button><button class="btn gold" data-crop-save>Save picture</button></div>`, { onClose: () => URL.revokeObjectURL(src) });
    const box = d.querySelector('.crop-stage'), pic = box.querySelector('img'), range = d.querySelector('input[type=range]');
    const draw = () => {
      sx = Math.max(0, Math.min(W - s, sx)); sy = Math.max(0, Math.min(H - s, sy));
      const k = R / s;
      Object.assign(pic.style, { width: `${W * k}px`, height: `${H * k}px`, left: `${O - sx * k}px`, top: `${O - sy * k}px` });
    };
    const zoom = (nz) => { const cx = sx + s / 2, cy = sy + s / 2; z = Math.max(1, Math.min(5, nz)); s = Math.min(W, H) / z; sx = cx - s / 2; sy = cy - s / 2; range.value = z; draw(); };
    range.oninput = () => zoom(Number(range.value));
    box.addEventListener('wheel', (e) => { e.preventDefault(); zoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    box.addEventListener('pointerdown', (e) => {
      box.setPointerCapture(e.pointerId); let lx = e.clientX, ly = e.clientY;
      const move = (m) => { const k = R / s; sx -= (m.clientX - lx) / k; sy -= (m.clientY - ly) / k; lx = m.clientX; ly = m.clientY; draw(); };
      const up = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); };
      box.addEventListener('pointermove', move); box.addEventListener('pointerup', up);
    });
    d.querySelector('[data-crop-save]').onclick = async () => {
      try {
        if (isGif) { await put(file); settings.profile.crop = { w: W / s, h: H / s, l: sx / s, t: sy / s }; }
        else {
          const n = 384, c = document.createElement('canvas'); c.width = c.height = n;
          c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, n, n);
          await put(await new Promise((r) => c.toBlob(r, 'image/webp', 0.9))); settings.profile.crop = null;
        }
        settings.profile.avatar = 'local'; save(); d.close();
        await loadAvatar(); emit('servers'); render(); toast('Picture saved on this device', 'ok');
      } catch (ex) { toast(`Couldn't save the picture: ${ex.message}`, 'bad'); }
    };
    draw();
  };
  img.src = src;
}
