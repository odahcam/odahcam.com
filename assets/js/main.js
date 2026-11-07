const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ——— language ——— */
const lang = () => root.dataset.lang;
$('.lang').addEventListener('click', () => {
  const l = lang() === 'pt' ? 'en' : 'pt';
  root.dataset.lang = l;
  root.lang = l === 'pt' ? 'pt-BR' : 'en';
  try { localStorage.setItem('lang', l); } catch (e) {}
  $$('[data-count]').forEach(el => { if (el.dataset.done) el.textContent = fmt(el, +el.dataset.count); });
});
$('#yr').textContent = new Date().getFullYear();

/* ——— forest ——— */
const canvas = $('#forest');
let forest = null;
const progress = () => scrollY / Math.max(1, root.scrollHeight - innerHeight);
(async () => {
  try {
    const { Forest } = await import('./forest.js');
    forest = new Forest(canvas);
    forest.setProgress(progress());
    if (reduced) { forest.frame(true); addEventListener('scroll', () => { forest.setProgress(progress()); forest.frame(true); }, { passive: true }); return; }
    let visible = true;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) loop(); });
    const loop = () => { if (!visible) return; forest.frame(); requestAnimationFrame(loop); };
    loop();
  } catch (err) {
    // No WebGL: the photographs carry the atmosphere instead.
    console.warn('forest disabled:', err);
    canvas.style.background = 'url(/assets/img/fog-grove.jpg) center/cover';
  }
})();

/* ——— machado → odahcam ——— */
const name = $('.name');
function flip() {
  const letters = [...name.children];
  const first = letters.map(l => l.getBoundingClientRect());
  letters.reverse().forEach(l => name.appendChild(l));
  if (reduced) return;
  const last = letters.map(l => l.getBoundingClientRect());
  letters.forEach((l, i) => {
    const f = first[letters.length - 1 - i], t = last[i];
    const dx = f.left - t.left;
    const lift = (i % 2 ? 1 : -1) * (0.35 + Math.abs(dx) / innerWidth) * t.height;
    l.animate([
      { transform: `translate(${dx}px, 0) rotate(0deg)` },
      { transform: `translate(${dx / 2}px, ${lift}px) rotate(${i % 2 ? 8 : -8}deg)`, offset: 0.5 },
      { transform: 'translate(0, 0) rotate(0deg)' },
    ], { duration: 1500, delay: Math.abs(i - 3) * 40, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'backwards' });
  });
}
if (reduced) flip(); else setTimeout(flip, 1400);
name.style.cursor = 'pointer';
name.title = 'machado ⇄ odahcam';
name.addEventListener('click', () => { if (!reduced) flip(); });

/* ——— reveal + counters ——— */
const fmt = (el, v) => {
  const dec = +(el.dataset.dec || 0);
  return new Intl.NumberFormat(lang() === 'pt' ? 'pt-BR' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v) + (el.dataset.suffix || '');
};
$$('[data-count]').forEach(el => { el.textContent = fmt(el, +el.dataset.count); });
function count(el) {
  if (el.dataset.done) return;
  el.dataset.done = 1;
  const to = +el.dataset.count, t0 = performance.now(), dur = 1800;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(el, to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  reduced ? (el.textContent = fmt(el, to)) : requestAnimationFrame(step);
}
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    $$('[data-count]', e.target).forEach(count);
    if (e.target.matches('[data-count]')) count(e.target);
    io.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -12% 0px' });
$$('.rv').forEach(el => io.observe(el));

/* ——— nav state ——— */
const navLinks = $$('.nav ol a');
const sections = navLinks.map(a => $(a.getAttribute('href')));
const navIo = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
}, { rootMargin: '-45% 0px -50% 0px' });
sections.forEach(s => s && navIo.observe(s));

/* ——— photo plates parallax ——— */
const plates = $$('.plate img');
function parallax() {
  for (const img of plates) {
    const r = img.parentElement.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
    img.style.transform = `translate3d(0, ${k * -8}%, 0) scale(${1.04 + Math.abs(k) * 0.04})`;
  }
}

/* ——— tree rings ——— */
const ringCanvas = $('#rings');
const ringItems = $$('.ring-list li');
const FIRST = 2012, NOW = new Date().getFullYear();
const ringState = { active: FIRST, shown: FIRST };
function rnd(i) { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }
function drawRings() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = ringCanvas.clientWidth;
  if (!size) return;
  if (ringCanvas.width !== size * dpr) { ringCanvas.width = ringCanvas.height = size * dpr; }
  const g = ringCanvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const c = size / 2, R = size * 0.46, n = NOW - FIRST + 2;   // +1 for the ring still forming
  const shape = (rad, seed, wob) => {
    g.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const w = 1 + wob * (Math.sin(t * 3 + seed * 6) * 0.5 + Math.sin(t * 7 + seed * 11) * 0.25 + Math.sin(t * 2 + 1.3) * 0.6);
      const x = c + Math.cos(t) * rad * w, y = c + Math.sin(t) * rad * w * 0.96;
      a ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  // bark
  shape(R * 1.06, 0.3, 0.03); g.fillStyle = '#2a1710'; g.fill();
  // wood body
  const grad = g.createRadialGradient(c, c, 0, c, c, R);
  grad.addColorStop(0, '#7a3a1f'); grad.addColorStop(0.7, '#a2552d'); grad.addColorStop(0.92, '#c88a58'); grad.addColorStop(1, '#d9a774');
  shape(R, 0.1, 0.025); g.fillStyle = grad; g.fill();
  const shown = ringState.shown;
  let rad = R * 0.06;
  const widths = Array.from({ length: n }, (_, i) => 0.6 + rnd(i + 3) * 0.8);
  const total = widths.reduce((a, b) => a + b);
  for (let i = 0; i < n; i++) {
    rad += (R * 0.94) * widths[i] / total;
    const year = FIRST + i;
    const on = Math.abs(year - shown) < 0.5;
    const past = year <= shown;
    shape(rad, rnd(i), 0.018 + i * 0.0006);
    g.lineWidth = on ? 3 : 1;
    g.strokeStyle = on ? '#f3c48f' : past ? 'rgba(40, 16, 8, 0.75)' : 'rgba(40, 16, 8, 0.28)';
    g.stroke();
    if (on) { g.save(); g.shadowColor = '#e09455'; g.shadowBlur = 24; g.stroke(); g.restore(); }
  }
  // seasonal checks (radial cracks)
  g.strokeStyle = 'rgba(30, 12, 6, 0.55)'; g.lineWidth = 1.2;
  for (const a of [0.6, 2.3, 4.4]) {
    g.beginPath(); g.moveTo(c + Math.cos(a) * R * 0.98, c + Math.sin(a) * R * 0.98);
    g.lineTo(c + Math.cos(a + 0.04) * R * 0.62, c + Math.sin(a + 0.04) * R * 0.62); g.stroke();
  }
}
const ringIo = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) {
    ringItems.forEach(li => li.classList.toggle('on', li === e.target));
    ringState.active = +e.target.dataset.year;
    const label = e.target.querySelector('.yr').textContent.trim();
    $('#ring-age').textContent = /^\d{4}$/.test(label) ? `${label} · ${ringState.active - FIRST + 1}º` : label;
  }
}, { rootMargin: '-40% 0px -45% 0px' });
ringItems.forEach(li => ringIo.observe(li));
addEventListener('resize', drawRings);

/* ——— per-frame ——— */
const nav = $('.nav');
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    if (forest) forest.setProgress(progress());
    nav.classList.toggle('solid', scrollY > innerHeight * 0.6);
    if (!reduced) parallax();
  });
}
addEventListener('scroll', onScroll, { passive: true });
parallax();

(function ringLoop() {
  const d = ringState.active - ringState.shown;
  if (Math.abs(d) > 0.01 || !ringCanvas.width) { ringState.shown += reduced ? d : d * 0.12; drawRings(); }
  requestAnimationFrame(ringLoop);
})();
