/* NEXUS News — app logic. Data: news.json written every ~10 min by the "Update news" GitHub Action. */
(() => {
  'use strict';
  const REPO = 'olivercraftboycompany-design/NEXUS-News';
  const RAW = `https://raw.githubusercontent.com/${REPO}/data/news.json`;
  const LS_DATA = 'nxnews_data_v1', LS_SAVED = 'nxnews_saved_v1', LS_THEME = 'nxnews_theme', LS_TAB = 'nxnews_tab';
  const TABS = [
    ['top', 'Top', '🔥'], ['world', 'World', '🌍'], ['tech', 'Tech', '💻'], ['science', 'Science', '🔬'], ['sports', 'Sports', '🏈'],
    ['gaming', 'Gaming', '🎮'], ['iowa', 'Iowa', '🌽'], ['faith', 'Faith', '✝️'], ['saved', 'Saved', '🔖']
  ];
  // Backup only: if the auto-updated file is missing or very old, read a few feeds through a public RSS-to-JSON service.
  const FALLBACK = {
    top: [['NPR', 'https://feeds.npr.org/1001/rss.xml'], ['CBS News', 'https://www.cbsnews.com/latest/rss/main'], ['Fox News', 'https://moxie.foxnews.com/google-publisher/latest.xml']],
    world: [['BBC News', 'https://feeds.bbci.co.uk/news/world/rss.xml'], ['NPR', 'https://feeds.npr.org/1004/rss.xml']],
    tech: [['The Verge', 'https://www.theverge.com/rss/index.xml'], ['Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index']],
    science: [['NASA', 'https://www.nasa.gov/news-release/feed/'], ['Space.com', 'https://www.space.com/feeds/all']],
    sports: [['CBS Sports', 'https://www.cbssports.com/rss/headlines/'], ['Yahoo Sports', 'https://sports.yahoo.com/rss/']],
    gaming: [['IGN', 'https://feeds.feedburner.com/ign/all'], ['GameSpot', 'https://www.gamespot.com/feeds/mashup/']],
    iowa: [['KCCI', 'https://www.kcci.com/topstories-rss'], ['Iowa Capital Dispatch', 'https://iowacapitaldispatch.com/feed/']],
    faith: [['Christianity Today', 'https://www.christianitytoday.com/feed/'], ['The Christian Post', 'https://www.christianpost.com/rss']]
  };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let data = store.get(LS_DATA, null);      // last good news.json
  let saved = store.get(LS_SAVED, []);
  let servedFromCache = false, tab = 'top', query = '', shown = 30, loading = false, lastCheck = 0, fetchFailed = false, fromFallback = false;

  // ---------- helpers ----------
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const isSaved = id => saved.some(s => s.id === id);
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function hl(s) {
    if (!query) return esc(s);
    const words = query.split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return esc(s);
    return esc(s).replace(new RegExp('(' + words.map(esc).join('|') + ')', 'gi'), '<mark>$1</mark>');
  }
  function badge(it) {
    const age = Date.now() - it.p;
    if (age > 3600e3 || age < -600e3) return '';
    const multi = it.a && it.a.length >= 1;
    return multi && (it.c.includes('top') || it.c.includes('world')) ? '<span class="badge brk">Breaking</span>' : '<span class="badge new">New</span>';
  }
  const also = it => it.a && it.a.length ? `<span class="also">+ ${it.a.length} more source${it.a.length > 1 ? 's' : ''}</span>` : '';
  const catName = c => (TABS.find(t => t[0] === c) || [c, c])[1];
  function img(it, cls) {
    return it.i ? `<div class="${cls || 'im'}"><img src="${esc(it.i)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : '';
  }
  const link = it => `href="${esc(it.u)}" target="_blank" rel="noopener noreferrer"`;
  function saveBtn(it) {
    const on = isSaved(it.id);
    return `<button class="save" data-save="${esc(it.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from saved' : 'Save for later'}">${on ? '★' : '☆'}</button>`;
  }
  function card(it, opts = {}) {
    const compact = opts.compact && it.i;
    const catBadge = opts.showCat ? `<span class="badge cat">${esc(catName(it.c[0]))}</span>` : '';
    return `<article class="card${compact ? ' compact' : ''}">
      <a class="lnk" ${link(it)}>${img(it)}
        <div class="b">
          <div class="meta">${badge(it)}${catBadge}<span class="src">${esc(it.s)}</span><span>·</span><time datetime="${new Date(it.p).toISOString()}">${ago(it.p)}</time></div>
          <h3>${hl(it.t)}</h3>
          ${it.d ? `<p class="sum">${hl(it.d)}</p>` : ''}
          ${also(it)}
        </div></a>${saveBtn(it)}</article>`;
  }

  // ---------- data ----------
  function byId() { const m = new Map(); (data?.items || []).forEach(i => m.set(i.id, i)); return m; }
  function itemsFor(c) { return (data?.items || []).filter(i => i.c.includes(c)).sort((a, b) => b.p - a.p); }

  async function getJSON(url, ms = 9000) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (r.headers.get('X-NXNews-Cache')) j._cached = true; // served by the offline copy
      return j;
    } finally { clearTimeout(t); }
  }

  async function fallbackFeeds() {
    // Backup path: a public RSS→JSON service, used only when news.json can't be reached or is >3 hours old.
    const out = [];
    await Promise.all(Object.entries(FALLBACK).flatMap(([cat, list]) => list.map(async ([src, url]) => {
      try {
        const j = await getJSON('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url), 8000);
        for (const x of (j.items || []).slice(0, 10)) {
          const p = Date.parse((x.pubDate || '').replace(' ', 'T') + 'Z') || Date.now();
          const d = (x.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
          let h = 0; for (const ch of x.link || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          out.push({ id: 'f' + h.toString(36), t: x.title, u: x.link, s: src, c: [cat], p, i: x.thumbnail || (x.enclosure && x.enclosure.link) || '', d });
        }
      } catch {}
    })));
    if (out.length < 8) return null;
    const seen = new Set(); const items = out.filter(i => { const k = i.t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; });
    const top = items.filter(i => i.c[0] === 'top').sort((a, b) => b.p - a.p).slice(0, 6).map(i => i.id);
    return { v: 1, updated: new Date().toISOString(), top, items, fallback: true, sources: [] };
  }

  async function load(manual) {
    if (loading) return; loading = true; setSpinning(true);
    const before = data ? new Set(data.items.map(i => i.id)) : null;
    let fresh = null; servedFromCache = false;
    const bucket = Math.floor(Date.now() / 60000);
    for (const url of [RAW + '?t=' + bucket]) {
      try { const j = await getJSON(url); if (j && j._cached) { servedFromCache = true; if (!fresh) fresh = j; continue; } if (j && j.items && j.items.length && (!fresh || Date.parse(j.updated) > Date.parse(fresh.updated))) fresh = j; if (fresh && Date.now() - Date.parse(fresh.updated) < 3 * 3600e3) break; } catch {}
    }
    fromFallback = false;
    if ((!fresh || Date.now() - Date.parse(fresh.updated) > 3 * 3600e3) && navigator.onLine && !servedFromCache) {
      const fb = await fallbackFeeds();
      if (fb) { fresh = fb; fromFallback = true; }
    }
    lastCheck = Date.now();
    if (fresh && (!data || Date.parse(fresh.updated) >= Date.parse(data.updated) || data.fallback)) {
      data = fresh; delete data._cached; fetchFailed = servedFromCache;
      store.set(LS_DATA, data);
      if (before && manual !== 'silent') {
        const n = data.items.filter(i => !before.has(i.id)).length;
        if (manual) toast(n ? `${n} new stor${n === 1 ? 'y' : 'ies'}` : 'You’re up to date');
      }
      render();
    } else if (!fresh || servedFromCache) {
      fetchFailed = true;
      if (manual) toast(navigator.onLine ? 'Couldn’t reach the news server' : 'You’re offline');
    } else if (manual) toast('You’re up to date');
    loading = false; setSpinning(false); renderStatus();
  }

  // ---------- render ----------
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([id, name, emo]) => {
      const n = id === 'saved' && saved.length ? `<span class="n">${saved.length}</span>` : '';
      return `<button class="chip" role="tab" data-tab="${id}" aria-selected="${id === tab && !query}">${emo} ${name}${n}</button>`;
    }).join('');
  }
  function renderStatus() {
    const el = $('#updated'), dot = $('#dot'), off = $('#offline');
    dot.className = 'dot';
    if (!data) { el.textContent = fetchFailed ? 'Couldn’t load news. Pull down to retry.' : 'Loading news…'; if (fetchFailed) dot.classList.add('off'); }
    else {
      const age = Date.now() - Date.parse(data.updated);
      el.textContent = (fromFallback || data.fallback ? 'Live backup feed · ' : '') + 'Updated ' + ago(Date.parse(data.updated));
      if (age > 45 * 60e3) dot.classList.add('stale');
    }
    const offline = !navigator.onLine || (fetchFailed && data) || servedFromCache;
    if (offline && data) {
      off.hidden = false;
      off.textContent = `📴 ${navigator.onLine && !servedFromCache ? 'Can’t reach the news server' : 'You’re offline'}. Showing the news from ${new Date(data.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${ago(Date.parse(data.updated))}).`;
      dot.classList.add('off');
    } else off.hidden = true;
  }
  function render() {
    renderTabs(); renderStatus();
    const hero = $('#hero'), list = $('#list'), empty = $('#empty');
    hero.innerHTML = ''; empty.hidden = true;
    if (!data && tab !== 'saved') {
      list.innerHTML = fetchFailed ? '' : '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
      if (fetchFailed) { empty.hidden = false; empty.textContent = 'Couldn’t load the news yet. Check your connection and tap ⟳.'; }
      return;
    }
    let items, title;
    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const pool = [...(data?.items || []), ...saved.filter(s => !byId().has(s.id))];
      items = pool.filter(i => { const h = (i.t + ' ' + (i.d || '') + ' ' + i.s).toLowerCase(); return words.every(w => h.includes(w)); }).sort((a, b) => b.p - a.p);
      title = `${items.length} result${items.length === 1 ? '' : 's'} for “${esc(query)}”`;
      list.innerHTML = `<h2 class="sec-title" style="grid-column:1/-1">${title}</h2>` + items.slice(0, 60).map(i => card(i, { compact: true, showCat: true })).join('');
      if (!items.length) { empty.hidden = false; empty.textContent = 'No stories match that. Try another word.'; }
      return;
    }
    if (tab === 'saved') {
      items = [...saved].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      list.innerHTML = items.length ? `<h2 class="sec-title" style="grid-column:1/-1">Saved for later · ${items.length}</h2>` + items.map(i => card(i, { compact: true, showCat: true })).join('') : '';
      if (!items.length) { empty.hidden = false; empty.innerHTML = 'Nothing saved yet.<br>Tap ☆ on any story to keep it here. Saved stories stay on this phone, even offline.'; }
      return;
    }
    items = itemsFor(tab);
    if (tab === 'top') {
      const m = byId();
      const top = (data.top || []).map(id => m.get(id)).filter(Boolean);
      if (top.length) {
        const [h, ...rest] = top;
        hero.innerHTML = `<h2 class="sec-title">Top stories</h2>
          <div class="hero-wrap"><a class="hero-main${h.i ? '' : ' noimg'}" ${link(h)}>${h.i ? `<img src="${esc(h.i)}" alt="" referrerpolicy="no-referrer">` : ''}<div class="shade"></div>
            <div class="txt"><div class="meta">${badge(h)}<span class="src">${esc(h.s)}</span><span>·</span><span>${ago(h.p)}</span>${h.a && h.a.length ? `<span>· ${h.a.length + 1} outlets</span>` : ''}</div><h2>${esc(h.t)}</h2></div></a>${saveBtn(h)}</div>
          <div class="rail">${rest.map(i => `<a class="mini" ${link(i)}><div class="im">${i.i ? `<img src="${esc(i.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</div><div class="b"><div class="meta">${badge(i)}<span class="src">${esc(i.s)}</span><span>·</span><span>${ago(i.p)}</span></div><h3>${esc(i.t)}</h3></div></a>`).join('')}</div>`;
        const ids = new Set(top.map(i => i.id));
        items = items.filter(i => !ids.has(i.id));
      }
    }
    title = tab === 'top' ? 'Latest' : 'Latest in ' + catName(tab);
    const slice = items.slice(0, shown);
    list.innerHTML = `<h2 class="sec-title" style="grid-column:1/-1">${title}</h2>` +
      slice.map((i, k) => card(i, { compact: !(k === 0 || k % 6 === 0) })).join('') +
      (items.length > shown ? `<button class="more" id="moreBtn" style="grid-column:1/-1">Show more (${items.length - shown})</button>` : '');
    if (!items.length) { empty.hidden = false; empty.textContent = 'No stories here right now. Pull down to refresh.'; }
  }

  function setTab(t, push) {
    tab = TABS.some(x => x[0] === t) ? t : 'top'; shown = 30;
    store.set(LS_TAB, tab);
    if (push !== false) history.replaceState(null, '', '#' + tab);
    render(); window.scrollTo({ top: 0 });
    const chip = document.querySelector(`.chip[data-tab="${tab}"]`); if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) { if (query) { query = ''; $('#q').value = ''; $('#searchWrap').hidden = true; } setTab(chip.dataset.tab); return; }
    const sv = e.target.closest('[data-save]');
    if (sv) {
      e.preventDefault(); e.stopPropagation();
      const id = sv.dataset.save;
      if (isSaved(id)) { saved = saved.filter(s => s.id !== id); toast('Removed from Saved'); }
      else {
        const it = byId().get(id); if (!it) return;
        saved.unshift({ ...it, savedAt: Date.now() }); toast('Saved 🔖');
      }
      store.set(LS_SAVED, saved.slice(0, 300));
      const on = isSaved(id);
      document.querySelectorAll(`[data-save="${CSS.escape(id)}"]`).forEach(b => { b.setAttribute('aria-pressed', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save for later'); });
      renderTabs(); if (tab === 'saved') render();
      return;
    }
    if (e.target.id === 'moreBtn') { shown += 30; render(); }
  });
  // Hide broken images instead of showing a broken icon
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG') { const box = t.closest('.im'); if (box) box.remove(); else { t.remove(); const h = document.querySelector('.hero-main'); if (h && !h.querySelector('img')) h.classList.add('noimg'); } }
  }, true);
  $('#refreshBtn').addEventListener('click', () => load(true));
  $('#searchBtn').addEventListener('click', () => { const w = $('#searchWrap'); w.hidden = !w.hidden; if (!w.hidden) $('#q').focus(); else { query = ''; $('#q').value = ''; render(); } });
  $('#qClear').addEventListener('click', () => { query = ''; $('#q').value = ''; $('#searchWrap').hidden = true; render(); });
  let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); render(); }, 180); });
  $('#sourcesLink').addEventListener('click', e => {
    e.preventDefault();
    const rows = (data?.sources || []).map(s => `<div class="row"><span>${esc(s.source)}</span><b>${esc(s.cat)} · ${s.ok ? s.n : '—'}</b></div>`).join('') || '<p>Sources load with the news.</p>';
    $('#sourcesList').innerHTML = rows; $('#sourcesDlg').showModal();
  });
  // Theme
  function applyTheme(t) {
    document.documentElement.classList.toggle('light', t === 'light');
    $('#themeBtn').textContent = t === 'light' ? '☀️' : '🌙';
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'light' ? '#f4f5f8' : '#09090b');
  }
  let theme = store.get(LS_THEME, 'dark'); applyTheme(theme);
  $('#themeBtn').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; store.set(LS_THEME, theme); applyTheme(theme); });
  function setSpinning(on) { $('#refreshBtn').classList.toggle('spinning', on); const p = $('#ptr'); p.classList.toggle('loading', on); if (!on) { p.style.transform = ''; $('#ptrText').textContent = 'Pull to refresh'; } }

  // Pull to refresh
  let y0 = null, pulled = 0;
  window.addEventListener('touchstart', e => { y0 = window.scrollY <= 0 && !document.querySelector('dialog[open]') ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (y0 === null) return;
    pulled = Math.max(0, e.touches[0].clientY - y0);
    if (pulled > 4 && window.scrollY <= 0) {
      const p = $('#ptr'); p.classList.add('pulling');
      p.style.transform = `translateY(${Math.min(pulled * 0.5, 70) - 60}px)`;
      $('#ptrText').textContent = pulled > 110 ? 'Release to refresh' : 'Pull to refresh';
    }
  }, { passive: true });
  window.addEventListener('touchend', () => {
    const p = $('#ptr'); p.classList.remove('pulling');
    if (y0 !== null && pulled > 110) { p.style.transform = 'translateY(8px)'; $('#ptrText').textContent = 'Refreshing…'; load(true); }
    else p.style.transform = '';
    y0 = null; pulled = 0;
  });

  // Install button
  let deferred = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (!standalone()) $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) { toast('Use ⋮ → Install app'); return; }
    deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null;
    if (r && r.outcome === 'accepted') $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed! Find NEXUS News on your home screen'); });

  window.addEventListener('online', () => { renderStatus(); load('silent'); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastCheck > 2 * 60e3) load('silent'); });
  setInterval(renderStatus, 30e3);
  setInterval(() => { if (!document.hidden) load('silent'); }, 5 * 60e3);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== tab) setTab(h, false); });

  // Service worker (offline + installable)
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  }

  // Start
  const params = new URLSearchParams(location.search);
  const start = params.get('tab') || location.hash.slice(1) || 'top';
  tab = TABS.some(x => x[0] === start) ? start : 'top';
  render();
  load('silent');
  window.NXNews = { get data() { return data; }, get saved() { return saved; }, load, setTab };
})();
