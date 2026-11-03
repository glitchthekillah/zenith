// Keep native scrolling. Only defer hover decoration until the content settles.
(() => {
  const app = document.getElementById('app');
  if (!app) return;
  let timer = 0;
  const clear = () => { clearTimeout(timer); timer = 0; document.body.classList.remove('scrolling'); };
  app.addEventListener('scroll', () => {
    if (!timer) document.body.classList.add('scrolling');
    clearTimeout(timer);
    timer = setTimeout(clear, 200);
  }, { passive: true, capture: true });
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
})();
