async function probe() {
  // Runs only in the selected Kavita origin. SSO accounts use an HttpOnly cookie.
  for (let i = 0; i < localStorage.length; i++) {
    try {
      const v = JSON.parse(localStorage.getItem(localStorage.key(i)));
      if (v && typeof v.token === 'string' && v.token && v.apiKey)
        return { token: v.token, refreshToken: v.refreshToken || '', apiKey: v.apiKey, username: v.username || '' };
    } catch {}
  }
  try {
    const r = await fetch('/api/Account', { credentials: 'include', cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    if (typeof v?.username !== 'string' || !v.username) return null;
    const image = v.authKeys?.find(k => k.name === 'image-only')?.key;
    return { cookie: true, token: '', refreshToken: '', apiKey: image || v.apiKey || '', username: v.username };
  } catch { return null; }
}
