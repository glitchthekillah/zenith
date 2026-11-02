// The moving sky behind the app: the same liquid field as the zenith panel and request site,
// a different patch on every launch, drifting toward the mouse. Falls back to the CSS glow if WebGL is off.
(() => {
  const cv = document.getElementById('sky2'); if (!cv) return;
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) { cv.remove(); return; }
  document.body.classList.add('liquid');
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `precision highp float;
uniform vec2 r;uniform float t;uniform vec2 m;uniform vec3 cI;uniform vec3 cB;uniform vec3 cP;uniform vec3 cG;
uniform vec2 o;uniform float a;uniform float k;uniform vec2 L;uniform vec2 V;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=R*p*2.02;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/r.y;
  p=mat2(cos(a),-sin(a),sin(a),cos(a))*p*k+o;                     // a different patch of the field every load
  float T=t*.035;
  vec2 q=vec2(fbm(p*1.4+vec2(0.,T)),fbm(p*1.4+vec2(5.2,-T)));
  vec2 w=vec2(fbm(p*1.6+2.*q+vec2(1.7,9.2)+T*.6),fbm(p*1.6+2.*q+vec2(8.3,2.8)-T*.5));
  float f=fbm(p*1.2+2.4*w);
  vec3 col=cI;
  float b=smoothstep(.35,.95,f);
  vec3 tint=mix(cB,cP,smoothstep(.2,.8,fbm(p*.7+w+vec2(T*.4,0.))));   // purple drifting into pink
  col=mix(col,tint*.85,b*.85);
  float ribbon=smoothstep(.014,.0,abs(f-.62))*smoothstep(.3,.9,length(w));
  col=mix(col,cG,ribbon*.75);
  col+=cG*.10*smoothstep(.75,1.,f);
  vec2 lp=L+vec2(m.x*.25,-m.y*.2);
  col+=tint*.35*exp(-3.2*length((gl_FragCoord.xy-.5*r)/r.y-lp));
  float v=smoothstep(1.25,.25,length(uv-V));
  col=mix(cI,col,v);
  gl_FragColor=vec4(col,1.);
}`;
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.remove(); document.body.classList.remove('liquid'); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (x) => gl.getUniformLocation(pr, x);
  // ink, purple, pink and an amber thread; the same colours as the rest of the panel
  gl.uniform3f(U('cI'), .027, .024, .05); gl.uniform3f(U('cB'), .30, .17, .75); gl.uniform3f(U('cP'), .62, .16, .42); gl.uniform3f(U('cG'), 1.0, .66, .28);
  // Every load starts somewhere new: offset, turn, zoom, where the light sits and where the bright middle is
  const R = (lo, hi) => lo + Math.random() * (hi - lo);
  gl.uniform2f(U('o'), R(-60, 60), R(-60, 60)); gl.uniform1f(U('a'), R(0, Math.PI * 2)); gl.uniform1f(U('k'), R(.8, 1.25));
  gl.uniform2f(U('L'), R(-.6, .6), R(-.35, .35)); gl.uniform2f(U('V'), R(.3, .7), R(.35, .7));
  const ur = U('r'), ut = U('t'), um = U('m');
  const size = () => { const d = Math.min(devicePixelRatio || 1, 1.5) * .5; cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); gl.viewport(0, 0, cv.width, cv.height); };
  size(); addEventListener('resize', () => { size(); kick(); });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mx = 0, my = 0, sm = [0, 0], start = performance.now() - R(0, 600000), run = false, last = 0;
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });
  let scrolled = 0, st = 0; document.addEventListener('scroll', () => { scrolled = performance.now(); if (!st) document.body.classList.add('scrolling'); clearTimeout(st); st = setTimeout(() => { st = 0; document.body.classList.remove('scrolling'); }, 200); }, { passive: true, capture: true });
  // Holds still while a video plays or the reader is open, so the GPU is free for them
  const still = () => reduce || document.body.classList.contains('calm') || document.body.classList.contains('playing') || document.body.classList.contains('mini');
  function draw(now) {
    run = false;
    if (document.hidden) return;
    if (now - last > (now - scrolled < 250 ? 50 : 30)) {     // about 30 frames a second, 20 while scrolling so the page stays smooth
      last = now;
      sm[0] += (mx - sm[0]) * .08; sm[1] += (my - sm[1]) * .08;
      gl.uniform2f(ur, cv.width, cv.height); gl.uniform1f(ut, (now - start) / 1000); gl.uniform2f(um, sm[0], sm[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!still()) kick();
  }
  function kick() { if (!run) { run = true; requestAnimationFrame(draw); } }
  document.addEventListener('visibilitychange', kick);
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  kick();
})();
