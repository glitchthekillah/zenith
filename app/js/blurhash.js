// Blurred placeholders while pictures load (Jellyfin sends a tiny "blurhash" for each image).
// Hashes are collected from server answers; any <img> whose address has a known tag gets one.
const hashes = new Map(); // image tag -> blurhash
const made = new Map();   // image tag -> data: URL

export function collect(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return;
  if (Array.isArray(data)) { for (const x of data) collect(x, depth + 1); return; }
  const b = data.ImageBlurHashes;
  if (b) for (const kind of Object.values(b)) for (const [tag, hash] of Object.entries(kind || {})) if (typeof hash === 'string') hashes.set(tag, hash);
  if (Array.isArray(data.Items)) collect(data.Items, depth + 1);
}

const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const d83 = (s) => { let v = 0; for (const c of s) { const i = CH.indexOf(c); if (i < 0) throw new Error('bad'); v = v * 83 + i; } return v; };
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(v <= 0.0031308 ? v * 12.92 * 255 : (1.055 * v ** (1 / 2.4) - 0.055) * 255); };
const sp = (b, e) => Math.sign(b) * Math.abs(b) ** e;

// Standard blurhash decoding, returns RGBA pixels
export function decode(hash, w, h) {
  if (!hash || hash.length < 6) throw new Error('bad');
  const size = d83(hash[0]), nx = (size % 9) + 1, ny = Math.floor(size / 9) + 1;
  if (hash.length !== 4 + 2 * nx * ny) throw new Error('bad');
  const max = (d83(hash[1]) + 1) / 166;
  const colors = [];
  const dc = d83(hash.slice(2, 6));
  colors.push([toLin(dc >> 16), toLin((dc >> 8) & 255), toLin(dc & 255)]);
  for (let i = 1; i < nx * ny; i++) {
    const v = d83(hash.slice(4 + i * 2, 6 + i * 2));
    colors.push([sp((Math.floor(v / 361) - 9) / 9, 2) * max, sp(((Math.floor(v / 19) % 19) - 9) / 9, 2) * max, sp(((v % 19) - 9) / 9, 2) * max]);
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const basis = Math.cos((Math.PI * x * i) / w) * Math.cos((Math.PI * y * j) / h), c = colors[i + j * nx];
      r += c[0] * basis; g += c[1] * basis; b += c[2] * basis;
    }
    const k = 4 * (x + y * w);
    px[k] = toSrgb(r); px[k + 1] = toSrgb(g); px[k + 2] = toSrgb(b); px[k + 3] = 255;
  }
  return px;
}

function dataUrl(tag) {
  if (made.has(tag)) return made.get(tag);
  let url = '';
  try {
    const w = 32, h = 32, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    img.data.set(decode(hashes.get(tag), w, h));
    ctx.putImageData(img, 0, 0);
    url = c.toDataURL('image/png');
  } catch {}
  made.set(tag, url);
  return url;
}

function paint(img) {
  if (img.dataset.bh || img.complete && img.naturalWidth) return;
  const tag = /[?&]tag=([^&]+)/.exec(img.getAttribute('src') || '')?.[1];
  if (!tag || !hashes.has(decodeURIComponent(tag))) return;
  const url = dataUrl(decodeURIComponent(tag));
  if (!url) return;
  img.dataset.bh = '1';
  img.style.backgroundImage = `url("${url}")`;
  img.style.backgroundSize = 'cover';
  // drop the placeholder once the real picture is in (transparent images stay clean)
  img.addEventListener('load', () => { img.style.backgroundImage = ''; }, { once: true });
}

export function watch(root = document.body) {
  if (typeof MutationObserver === 'undefined') return;
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') paint(n); else for (const img of n.querySelectorAll?.('img[src*="tag="]') || []) paint(img);
    }
  }).observe(root, { childList: true, subtree: true });
}
