// Receive a Kavita sign-in only from the popup and origin this request opened.
export function browserWebLogin(url, verify) {
  const target = new URL(url);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const loginUrl = new URL('/login', target.origin);
  loginUrl.searchParams.set('zenith-connect', nonce);
  const popup = window.open(loginUrl.href, '_blank', 'popup,width=600,height=800');
  if (!popup) return Promise.reject(new Error('Allow popups for Zenith, then try again.'));
  return new Promise((resolve, reject) => {
    let done = false, verifying = false;
    const cleanup = () => { window.removeEventListener('message', receive); clearInterval(timer); clearTimeout(timeout); };
    const fail = error => { if (done) return; done = true; cleanup(); reject(error); };
    async function receive(e) {
      if (done || verifying || e.origin !== target.origin || e.source !== popup || e.data?.type !== 'zenith-kavita-login' || e.data.nonce !== nonce) return;
      if (e.data.error) return fail(new Error(String(e.data.error)));
      const r = e.data.login;
      if (typeof r?.token !== 'string' || !r.token || typeof r.username !== 'string' || !r.username) return;
      verifying = true;
      try {
        const verified = await verify(r);
        if (done) return;
        done = true; cleanup();
        popup.postMessage({ type: 'zenith-kavita-accepted', nonce }, target.origin);
        popup.close();
        resolve(verified);
      } catch { fail(new Error('Kavita signed in, but Zenith could not verify the connection. Try again.')); }
    }
    window.addEventListener('message', receive);
    const timer = setInterval(() => { if (popup.closed && !verifying) fail(new Error('Sign-in was closed before it finished.')); }, 500);
    const timeout = setTimeout(() => { fail(new Error('Sign-in timed out. Open the Kavita login again.')); if (!popup.closed) popup.close(); }, 10 * 60e3);
  });
}
