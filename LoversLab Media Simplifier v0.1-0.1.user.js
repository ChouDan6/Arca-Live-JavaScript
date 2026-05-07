// ==UserScript==
// @name         LoversLab Media Simplifier v0.1
// @namespace    https://tampermonkey.net/
// @version      0.1
// @description  瀑布流浏览
// @author       Henry W (@GuDongKing) & 影 & LucyTtk
// @match        https://www.loverslab.com/topic/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY_MAX_PAGES = 'll_max_auto_pages_v037';

  const CONFIG = {
    columnWidthPx: 340,
    cardGapPx: 12,
    imageMaxHeight: 560,
    showMeta: true,

    autoLoadNextPages: true,
    defaultMaxAutoPages: 20, // 用户可改
    requestIntervalMs: 500,

    archiveExt: /\.(zip|7z|rar|tar|gz|bz2|xz|zst)(\?.*)?$/i,
    attachmentHint: /(attachment|download|dl|file|files|ipsattach|attach|controller=attach|do=download)/i,

    enableNetworkProbe: true,
    probeConcurrency: 6,
    probeTimeoutMs: 12000,
    probeCacheSize: 2000,

    dedupeArchiveGlobally: true,

    imageRetryCount: 1,
    imageRetryDelayMs: 1200,

    appendBatchSize: 8,
    appendBatchDelayMs: 50
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ViewFilterMode = {
    ALL: 'all',
    ARCHIVE_ONLY: 'archive_only',
    ARCHIVE_FIRST_IMAGE: 'archive_first_image'
  };

  const state = {
    loadedPageUrls: new Set(),
    stopAutoLoad: false,
    isLoading: false,

    totalPostsSeen: 0,
    totalCardsRendered: 0,
    totalArchivesUnique: 0,

    probeCache: new Map(),
    archiveUrlSeenGlobal: new Set(),

    viewMode: 'simplified',
    originalNodes: [],

    itemsByKey: new Map(),
    renderedCardKeys: new Set(),

    filterMode: ViewFilterMode.ALL,
    fullRenderLock: false,

    // 分页游标
    nextPageUrl: null,
    loadedPageCount: 0, // 实际已抓取页数（不含初始DOM直接解析）
    maxAutoPages: loadMaxPages(),
  };

  function loadMaxPages() {
    const n = Number(localStorage.getItem(STORAGE_KEY_MAX_PAGES));
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return CONFIG.defaultMaxAutoPages;
  }

  function saveMaxPages(n) {
    localStorage.setItem(STORAGE_KEY_MAX_PAGES, String(n));
  }

  function normalizeUrl(url, base = location.href) {
    try { return new URL(url, base).href; } catch { return url; }
  }
  function text(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function escapeHtml(str = '') {
    return str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function uniqBy(arr, keyFn) {
    const m = new Map();
    for (const i of arr) { const k = keyFn(i); if (!m.has(k)) m.set(k, i); }
    return [...m.values()];
  }
  function fileNameFromUrl(url) {
    try {
      const u = new URL(url);
      const name = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
      return name || url;
    } catch { return url; }
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function isImageUrl(url) { return /\.(png|jpe?g|gif|webp|bmp|avif)(\?.*)?$/i.test(url); }

  function throttle(fn, wait = 120) {
    let timer = null, pending = false;
    return function (...args) {
      if (timer) { pending = true; return; }
      fn.apply(this, args);
      timer = setTimeout(() => {
        timer = null;
        if (pending) { pending = false; fn.apply(this, args); }
      }, wait);
    };
  }

  const setMasonryColumns = throttle(() => {
    const masonry = $('#ll-masonry');
    if (!masonry) return;
    const width = masonry.clientWidth || window.innerWidth;
    masonry.style.columnCount = String(Math.max(1, Math.floor(width / CONFIG.columnWidthPx)));
  }, 120);

  function injectStyles() {
    if ($('#ll-style')) return;
    const style = document.createElement('style');
    style.id = 'll-style';
    style.textContent = `
      :root{
        --ll-bg:#0f1115; --ll-card:#171a21; --ll-text:#e9eef5; --ll-sub:#9aa7b7;
        --ll-border:#2a3040; --ll-accent:#66b3ff; --ll-gap:${CONFIG.cardGapPx}px;
      }
      #ll-wrap{ position:relative; z-index:999999; min-height:100vh; box-sizing:border-box; padding:16px; background:var(--ll-bg); color:var(--ll-text); }
      #ll-top{
        position:sticky; top:8px; z-index:10; display:flex; gap:8px; flex-wrap:wrap; align-items:center;
        margin-bottom:12px; padding:10px 12px; border:1px solid var(--ll-border); border-radius:12px;
        background:rgba(15,17,21,.88); backdrop-filter:blur(6px);
      }
      #ll-top button,#ll-floating-switch button{
        border:1px solid var(--ll-border); background:#202633; color:var(--ll-text); border-radius:8px; padding:6px 10px; cursor:pointer;
      }
      #ll-top button:hover,#ll-floating-switch button:hover{ border-color:var(--ll-accent); }
      #ll-top input[type="number"]{
        width:88px; border:1px solid var(--ll-border); background:#111722; color:var(--ll-text);
        border-radius:8px; padding:6px 8px;
      }

      #ll-masonry{ column-gap:var(--ll-gap); }
      .ll-card{
        break-inside:avoid; -webkit-column-break-inside:avoid; page-break-inside:avoid;
        display:inline-block; width:100%; margin:0 0 var(--ll-gap);
        border:1px solid var(--ll-border); border-radius:12px; overflow:hidden; background:var(--ll-card);
      }
      .ll-head{ padding:10px 12px; border-bottom:1px solid var(--ll-border); }
      .ll-author{ font-size:14px; font-weight:700; }
      .ll-time{ font-size:12px; color:var(--ll-sub); margin-top:2px; }
      .ll-body{ padding:10px 12px; display:flex; flex-direction:column; gap:10px; }

      .ll-images{ display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; }
      .ll-img-btn{
        all:unset; display:block; width:100%; cursor:zoom-in;
        border:1px solid var(--ll-border); border-radius:8px; overflow:hidden; background:#0d1016;
      }
      .ll-img-btn img{
        display:block; width:100%; height:auto; max-height:${CONFIG.imageMaxHeight}px; object-fit:cover; background:#111722;
      }
      .ll-img-fallback{ padding:10px; font-size:12px; color:var(--ll-sub); display:flex; flex-direction:column; gap:6px; }
      .ll-img-fallback a{ color:var(--ll-accent); text-decoration:none; font-size:12px; word-break:break-all; }

      .ll-files{ display:flex; flex-direction:column; gap:6px; }
      .ll-file{
        display:inline-flex; gap:6px; align-items:center; text-decoration:none; color:var(--ll-accent);
        border:1px dashed #3b4459; border-radius:8px; padding:6px 8px; font-size:13px; word-break:break-all;
      }
      .ll-badge{
        font-size:11px; color:#cfe7ff; background:#2b3a57; border:1px solid #3b527d; border-radius:999px; padding:1px 7px;
      }

      .ll-muted{ font-size:12px; color:var(--ll-sub); }
      #ll-loader{ font-size:12px; color:var(--ll-sub); }

      #ll-floating-switch{ position:fixed; right:14px; bottom:14px; z-index:2147483647; display:none; }

      #ll-lightbox{
        position:fixed; inset:0; z-index:2147483647; display:none; background:rgba(0,0,0,.85); align-items:center; justify-content:center;
      }
      #ll-lightbox.show{ display:flex; }
      #ll-lightbox img{
        max-width:96vw; max-height:92vh; object-fit:contain; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.45);
      }
      #ll-lightbox-close{
        position:fixed; top:12px; right:12px; border:1px solid #3c465d; background:#1f2736; color:#fff;
        border-radius:8px; padding:6px 10px; cursor:pointer;
      }
      @media (max-width:700px){ #ll-wrap{ padding:10px; } }
    `;
    document.head.appendChild(style);
  }

  function captureOriginalNodes() {
    if (state.originalNodes.length) return;
    state.originalNodes = Array.from(document.body.children).filter(
      n => !['ll-style', 'll-wrap', 'll-floating-switch', 'll-lightbox'].includes(n.id)
    );
  }

  function showSimplifiedOnly() {
    state.viewMode = 'simplified';
    const wrap = $('#ll-wrap');
    const floating = $('#ll-floating-switch');
    if (wrap) wrap.style.display = '';
    if (floating) floating.style.display = 'none';
    for (const n of state.originalNodes) n.style.display = 'none';
  }

  function showOriginalOnly() {
    state.viewMode = 'original';
    const wrap = $('#ll-wrap');
    const floating = $('#ll-floating-switch');
    if (wrap) wrap.style.display = 'none';
    if (floating) floating.style.display = '';
    for (const n of state.originalNodes) n.style.display = '';
  }

  function filterModeText() {
    if (state.filterMode === ViewFilterMode.ARCHIVE_ONLY) return '过滤:仅含压缩包';
    if (state.filterMode === ViewFilterMode.ARCHIVE_FIRST_IMAGE) return '过滤:仅压缩包+首图';
    return '过滤:全部';
  }

  function setStat() {
    const el = $('#ll-stat');
    if (!el) return;
    el.textContent =
      `卡片 ${state.totalCardsRendered} · 帖子 ${state.totalPostsSeen} · 已抓页 ${state.loadedPageCount} · 最大页 ${state.maxAutoPages} · 压缩包(唯一) ${state.totalArchivesUnique} · ${filterModeText()}`;
  }

  function setLoader(msg = '') {
    const el = $('#ll-loader');
    if (el) el.textContent = msg ? ` | ${msg}` : '';
  }

  function refreshPageControls() {
    const nextBtn = $('#ll-btn-next');
    const autoBtn = $('#ll-btn-auto');
    const maxInput = $('#ll-max-pages');
    if (maxInput) maxInput.value = String(state.maxAutoPages);

    const noNext = !state.nextPageUrl;
    if (nextBtn) {
      nextBtn.disabled = state.isLoading || noNext;
      nextBtn.textContent = noNext ? '没有下一页' : '下一页(继续加载)';
    }
    if (autoBtn) {
      autoBtn.disabled = state.isLoading || noNext;
      autoBtn.textContent = state.isLoading ? '加载中...' : '自动加载到最大页';
    }
  }

  function looksLikeAttachmentAnchor(a, url, label) {
    const cls = (a.className || '').toLowerCase();
    const role = (a.getAttribute('data-action') || '').toLowerCase();
    const fileext = (a.getAttribute('data-fileext') || '').toLowerCase();
    const title = (a.getAttribute('title') || '').toLowerCase();
    const attrs = Array.from(a.attributes).map(x => `${x.name}=${x.value}`).join(' ').toLowerCase();
    const hay = `${url} ${label} ${cls} ${role} ${fileext} ${title} ${attrs}`;
    return CONFIG.attachmentHint.test(hay);
  }

  function parseSrcsetFirst(srcset) {
    if (!srcset) return '';
    const first = srcset.split(',')[0]?.trim() || '';
    return first.split(/\s+/)[0] || '';
  }

  function getBestImageUrlFromImgEl(img, baseUrl) {
    const candidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-fileurl'),
      parseSrcsetFirst(img.getAttribute('data-srcset') || ''),
      parseSrcsetFirst(img.getAttribute('srcset') || ''),
      img.getAttribute('src')
    ].filter(Boolean);

    for (const c of candidates) {
      const u = normalizeUrl(c, baseUrl);
      if (u && !u.startsWith('data:')) return u;
    }
    return '';
  }

  function extractArchiveCandidatesFromArea(areaEl, baseUrl) {
    const links = $$('a[href]', areaEl);
    const out = [];
    for (const a of links) {
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;

      const url = normalizeUrl(raw, baseUrl);
      const label = text(a) || fileNameFromUrl(url);
      if (isImageUrl(url)) continue;

      if (CONFIG.archiveExt.test(url) || CONFIG.archiveExt.test(label)) {
        out.push({ url, name: label, confidence: 'ext' });
      } else if (looksLikeAttachmentAnchor(a, url, label)) {
        out.push({ url, name: label, confidence: 'hint' });
      }
    }
    return uniqBy(out, x => x.url);
  }

  function parseSinglePost(postEl, baseUrl) {
    const author =
      text($('.cAuthorPane_author strong', postEl)) ||
      text($('.ipsType_break .ipsType_reset', postEl)) ||
      'Unknown';

    const timeEl = $('time', postEl);
    const time = timeEl?.getAttribute('datetime') || text(timeEl) || '';

    const content =
      $('[data-role="commentContent"]', postEl) ||
      $('.ipsComment_content .ipsType_richText', postEl) ||
      $('.ipsType_richText', postEl) ||
      postEl;

    const postPermalink =
      $('a[data-action="permalink"]', postEl)?.href ||
      $('a[href*="#comment-"]', postEl)?.href ||
      `${baseUrl}#post-${Math.random().toString(36).slice(2)}`;

    const imgFromTag = $$('img', content).map(img => {
      const src = getBestImageUrlFromImgEl(img, baseUrl);
      if (!src) return null;
      return { url: src, name: img.getAttribute('alt') || 'image' };
    }).filter(Boolean);

    const imgFromLink = $$('a[href]', content).map(a => {
      const href = a.getAttribute('href') || '';
      if (!href) return null;
      const url = normalizeUrl(href, baseUrl);
      if (!isImageUrl(url)) return null;
      return { url, name: text(a) || fileNameFromUrl(url) };
    }).filter(Boolean);

    const images = uniqBy([...imgFromTag, ...imgFromLink], x => x.url);

    const candidateAreas = [
      content,
      ...$$('.ipsAttachLink, .ipsAttachedFiles, .cPost_attachment, .attachment, .ipsComment_attachments', postEl),
      ...$$('blockquote, .ipsQuote', postEl)
    ];

    let candidates = [];
    for (const area of candidateAreas) candidates.push(...extractArchiveCandidatesFromArea(area, baseUrl));
    candidates = uniqBy(candidates, x => x.url);

    const archives = candidates.filter(c => c.confidence === 'ext').map(c => ({ url: c.url, name: c.name }));
    const archiveCandidates = candidates.filter(c => c.confidence === 'hint').map(c => ({ url: c.url, name: c.name }));

    return { keyBase: postPermalink, author, time, images, archives, archiveCandidates };
  }

  function parsePostsFromDoc(doc, baseUrl) {
    const selectors = [
      'article[data-role="comment"]',
      'article.ipsComment',
      '.cPost',
      'li[data-rowid][data-role="comment"]'
    ];
    let posts = [];
    for (const s of selectors) { posts = $$(s, doc); if (posts.length) break; }
    return posts.map(el => parseSinglePost(el, baseUrl)).filter(Boolean);
  }

  function getDisplayItemByFilter(item) {
    if (state.filterMode === ViewFilterMode.ARCHIVE_ONLY) {
      if (!item.archives.length) return null;
      return { ...item };
    }
    if (state.filterMode === ViewFilterMode.ARCHIVE_FIRST_IMAGE) {
      if (!item.archives.length) return null;
      return { ...item, images: item.images.length ? [item.images[0]] : [] };
    }
    if (!item.images.length && !item.archives.length) return null;
    return { ...item };
  }

  function makeRenderKey(itemShown) {
    const mediaUrls = [...itemShown.images.map(x => x.url), ...itemShown.archives.map(x => x.url)].sort();
    return `${itemShown.keyBase}::${mediaUrls.join('|')}`;
  }

  function attachImageReliability(imgEl, originalUrl) {
    let retries = 0;
    imgEl.addEventListener('error', () => {
      if (retries < CONFIG.imageRetryCount) {
        retries++;
        const nextUrl = originalUrl + (originalUrl.includes('?') ? '&' : '?') + `ll_retry=${Date.now()}_${retries}`;
        setTimeout(() => { imgEl.src = nextUrl; }, CONFIG.imageRetryDelayMs);
      } else {
        const parentBtn = imgEl.closest('.ll-img-btn');
        if (!parentBtn || parentBtn.querySelector('.ll-img-fallback')) return;
        imgEl.style.display = 'none';
        const fb = document.createElement('div');
        fb.className = 'll-img-fallback';
        fb.innerHTML = `<div>图片加载失败</div><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noreferrer noopener">点击查看原图</a>`;
        parentBtn.appendChild(fb);
      }
    }, { once: false });
  }

  function createImageButton(img) {
    const btn = document.createElement('button');
    btn.className = 'll-img-btn';
    btn.type = 'button';
    btn.title = '点击放大预览';
    btn.dataset.full = img.url;

    const im = document.createElement('img');
    im.loading = 'lazy';
    im.decoding = 'async';
    im.referrerPolicy = 'no-referrer';
    im.src = img.url;
    im.alt = img.name || 'image';
    attachImageReliability(im, img.url);

    btn.appendChild(im);
    return btn;
  }

  function createCard(itemShown) {
    const card = document.createElement('article');
    card.className = 'll-card';

    const head = document.createElement('div');
    head.className = 'll-head';
    head.innerHTML = CONFIG.showMeta
      ? `<div class="ll-author">${escapeHtml(itemShown.author)}</div><div class="ll-time">${escapeHtml(itemShown.time)}</div>`
      : `<div class="ll-author">${escapeHtml(itemShown.author)}</div>`;

    const body = document.createElement('div');
    body.className = 'll-body';

    if (itemShown.images.length) {
      const wrap = document.createElement('div');
      wrap.className = 'll-images';
      for (const img of itemShown.images) wrap.appendChild(createImageButton(img));
      body.appendChild(wrap);
    }

    if (itemShown.archives.length) {
      const files = document.createElement('div');
      files.className = 'll-files';
      for (const f of itemShown.archives) {
        const a = document.createElement('a');
        a.className = 'll-file';
        a.href = f.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.innerHTML = `<span class="ll-badge">ARCHIVE</span><span>${escapeHtml(f.name || fileNameFromUrl(f.url))}</span>`;
        files.appendChild(a);
      }
      body.appendChild(files);
    }

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function applyGlobalArchiveDedupe(items) {
    if (!CONFIG.dedupeArchiveGlobally) return items;
    for (const it of items) {
      const uniqueLocal = [];
      for (const a of (it.archives || [])) {
        if (state.archiveUrlSeenGlobal.has(a.url)) continue;
        state.archiveUrlSeenGlobal.add(a.url);
        uniqueLocal.push(a);
      }
      it.archives = uniqueLocal;
    }
    state.totalArchivesUnique = state.archiveUrlSeenGlobal.size;
    return items;
  }

  function mergeItems(items) {
    for (const it of items) {
      if (!state.itemsByKey.has(it.keyBase)) {
        state.itemsByKey.set(it.keyBase, it);
      } else {
        const old = state.itemsByKey.get(it.keyBase);
        old.images = uniqBy([...(old.images || []), ...(it.images || [])], x => x.url);
        old.archives = uniqBy([...(old.archives || []), ...(it.archives || [])], x => x.url);
      }
    }
  }

  async function appendItemsIncrementally(items) {
    const masonry = $('#ll-masonry');
    if (!masonry) return;

    const toAppend = [];
    for (const raw of items) {
      const shown = getDisplayItemByFilter(raw);
      if (!shown) continue;
      const key = makeRenderKey(shown);
      if (state.renderedCardKeys.has(key)) continue;
      state.renderedCardKeys.add(key);
      toAppend.push(shown);
    }

    for (let i = 0; i < toAppend.length; i += CONFIG.appendBatchSize) {
      const batch = toAppend.slice(i, i + CONFIG.appendBatchSize);
      const frag = document.createDocumentFragment();
      for (const it of batch) {
        frag.appendChild(createCard(it));
        state.totalCardsRendered++;
      }
      masonry.appendChild(frag);
      setStat();
      await sleep(CONFIG.appendBatchDelayMs);
    }
  }

  async function fullRerender() {
    if (state.fullRenderLock) return;
    state.fullRenderLock = true;
    try {
      const masonry = $('#ll-masonry');
      if (!masonry) return;
      masonry.innerHTML = '';
      state.renderedCardKeys.clear();
      state.totalCardsRendered = 0;

      await appendItemsIncrementally([...state.itemsByKey.values()]);
      setMasonryColumns();
      setStat();
    } finally {
      state.fullRenderLock = false;
    }
  }

  async function fetchDocument(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function findNextPageUrl(doc, baseUrl) {
    const next =
      $('a[rel="next"]', doc) ||
      $('.ipsPagination_next a', doc) ||
      $('li.ipsPagination_next a', doc) ||
      $$('a', doc).find(a => /next/i.test(text(a)));
    if (!next) return null;
    const href = next.getAttribute('href');
    return href ? normalizeUrl(href, baseUrl) : null;
  }

  async function probeArchiveByHttp(url) {
    if (state.probeCache.has(url)) return state.probeCache.get(url);

    if (state.probeCache.size > CONFIG.probeCacheSize) {
      const oldest = state.probeCache.keys().next().value;
      state.probeCache.delete(oldest);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.probeTimeoutMs);

    async function req(method) {
      return fetch(url, { method, credentials: 'include', redirect: 'follow', signal: controller.signal });
    }

    try {
      let res;
      try { res = await req('HEAD'); } catch { res = await req('GET'); }

      const finalUrl = res.url || url;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const cd = (res.headers.get('content-disposition') || '').toLowerCase();
      const nameGuess = fileNameFromUrl(finalUrl);

      const byUrl = CONFIG.archiveExt.test(finalUrl) || CONFIG.archiveExt.test(nameGuess);
      const byCD = /(filename=.*\.(zip|7z|rar|tar|gz|bz2|xz|zst))/i.test(cd);
      const byCT = /(application\/(zip|x-7z-compressed|x-rar-compressed|x-tar|gzip|x-gzip|x-bzip2|x-xz|zstd|octet-stream))/i.test(ct);

      const out = { ok: Boolean(byUrl || byCD || byCT), filename: nameGuess, reason: `ct=${ct}; cd=${cd}` };
      state.probeCache.set(url, out);
      return out;
    } catch (e) {
      const out = { ok: false, filename: '', reason: String(e?.message || e) };
      state.probeCache.set(url, out);
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveArchiveCandidates(items) {
    if (!CONFIG.enableNetworkProbe) return items;

    const urls = [];
    for (const it of items) for (const c of (it.archiveCandidates || [])) urls.push(c.url);
    const uniqUrls = [...new Set(urls)];
    if (!uniqUrls.length) return items;

    setLoader(`探测压缩包中... ${uniqUrls.length}`);

    let idx = 0;
    async function worker() {
      while (idx < uniqUrls.length && !state.stopAutoLoad) {
        const u = uniqUrls[idx++];
        await probeArchiveByHttp(u);
      }
    }
    await Promise.all(Array.from({ length: CONFIG.probeConcurrency }, () => worker()));

    for (const it of items) {
      const confirmed = [];
      for (const c of (it.archiveCandidates || [])) {
        const r = state.probeCache.get(c.url);
        if (r?.ok) {
          confirmed.push({
            url: c.url,
            name: (c.name && c.name !== c.url) ? c.name : (r.filename || fileNameFromUrl(c.url))
          });
        }
      }
      it.archives = uniqBy([...(it.archives || []), ...confirmed], x => x.url);
      delete it.archiveCandidates;
    }

    setLoader('压缩包探测完成');
    return items;
  }

  async function processPage(url) {
    if (!url || state.loadedPageUrls.has(url)) return { nextUrl: state.nextPageUrl };
    state.loadedPageUrls.add(url);

    setLoader(`抓取页面: ${url}`);
    const doc = await fetchDocument(url);

    let items = parsePostsFromDoc(doc, url);
    state.totalPostsSeen += items.length;

    items = await resolveArchiveCandidates(items);
    items = applyGlobalArchiveDedupe(items);

    mergeItems(items);
    await appendItemsIncrementally(items);

    state.loadedPageCount += 1;
    state.nextPageUrl = findNextPageUrl(doc, url);

    setMasonryColumns();
    setStat();
    refreshPageControls();

    return { nextUrl: state.nextPageUrl };
  }

  async function loadNextOnePage() {
    if (state.isLoading || !state.nextPageUrl) return;
    state.isLoading = true;
    refreshPageControls();
    try {
      await processPage(state.nextPageUrl);
    } finally {
      state.isLoading = false;
      refreshPageControls();
    }
  }

  async function loadUntilMaxPages() {
    if (state.isLoading || !state.nextPageUrl) return;
    state.isLoading = true;
    refreshPageControls();
    try {
      while (!state.stopAutoLoad && state.nextPageUrl && state.loadedPageCount < state.maxAutoPages) {
        await processPage(state.nextPageUrl);
        await sleep(CONFIG.requestIntervalMs);
      }

      if (state.loadedPageCount >= state.maxAutoPages) {
        setLoader(`已达到最大页数 ${state.maxAutoPages}，可点“下一页(继续加载)”继续`);
      } else if (!state.nextPageUrl) {
        setLoader('已到最后一页');
      }
    } finally {
      state.isLoading = false;
      refreshPageControls();
    }
  }

  function setupLightbox() {
    if ($('#ll-lightbox')) return;
    const box = document.createElement('div');
    box.id = 'll-lightbox';
    box.innerHTML = `
      <button id="ll-lightbox-close" type="button">关闭</button>
      <img id="ll-lightbox-img" src="" alt="preview" />
    `;
    document.body.appendChild(box);

    const close = () => box.classList.remove('show');
    $('#ll-lightbox-close', box).addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ll-img-btn');
      if (!btn) return;
      e.preventDefault();
      const src = btn.dataset.full;
      const img = $('#ll-lightbox-img');
      img.src = src;
      box.classList.add('show');
    });
  }

  function ensureFloatingSwitch() {
    if ($('#ll-floating-switch')) return;
    const f = document.createElement('div');
    f.id = 'll-floating-switch';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '切换到简化视图';
    btn.addEventListener('click', () => showSimplifiedOnly());
    f.appendChild(btn);
    document.body.appendChild(f);
  }

  function ensureShell() {
    if ($('#ll-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'll-wrap';

    const top = document.createElement('div');
    top.id = 'll-top';

    const stat = document.createElement('span');
    stat.id = 'll-stat';
    stat.className = 'll-muted';
    stat.textContent = '初始化中...';

    const loader = document.createElement('span');
    loader.id = 'll-loader';

    const btnMode = document.createElement('button');
    btnMode.textContent = '切换到原页面';
    btnMode.onclick = () => {
      if (state.viewMode === 'simplified') showOriginalOnly();
      else showSimplifiedOnly();
    };

    const btnAll = document.createElement('button');
    btnAll.textContent = '显示全部卡片';
    btnAll.onclick = async () => { state.filterMode = ViewFilterMode.ALL; await fullRerender(); };

    const btnArchiveOnly = document.createElement('button');
    btnArchiveOnly.textContent = '仅显示含压缩包';
    btnArchiveOnly.onclick = async () => { state.filterMode = ViewFilterMode.ARCHIVE_ONLY; await fullRerender(); };

    const btnArchiveFirstImg = document.createElement('button');
    btnArchiveFirstImg.textContent = '仅压缩包+首图';
    btnArchiveFirstImg.onclick = async () => { state.filterMode = ViewFilterMode.ARCHIVE_FIRST_IMAGE; await fullRerender(); };

    // 新增：最大页数输入
    const maxLabel = document.createElement('span');
    maxLabel.className = 'll-muted';
    maxLabel.textContent = '最大页数';

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.min = '1';
    maxInput.step = '1';
    maxInput.id = 'll-max-pages';
    maxInput.value = String(state.maxAutoPages);
    maxInput.addEventListener('change', () => {
      const v = Math.max(1, Math.floor(Number(maxInput.value) || CONFIG.defaultMaxAutoPages));
      state.maxAutoPages = v;
      saveMaxPages(v);
      maxInput.value = String(v);
      setStat();
    });

    // 新增：下一页按钮（从当前最大页及之后继续）
    const btnNext = document.createElement('button');
    btnNext.id = 'll-btn-next';
    btnNext.textContent = '下一页(继续加载)';
    btnNext.onclick = async () => {
      // 点击下一页时，允许继续超出当前 max（按你的描述“当前最大页及之后”）
      await loadNextOnePage();
    };

    // 新增：自动加载到最大页按钮
    const btnAuto = document.createElement('button');
    btnAuto.id = 'll-btn-auto';
    btnAuto.textContent = '自动加载到最大页';
    btnAuto.onclick = async () => {
      await loadUntilMaxPages();
    };

    const btnStop = document.createElement('button');
    btnStop.textContent = '停止自动加载';
    btnStop.onclick = () => {
      state.stopAutoLoad = true;
      setLoader('已停止自动加载');
    };

    top.append(
      stat, loader, btnMode, btnAll, btnArchiveOnly, btnArchiveFirstImg,
      maxLabel, maxInput, btnAuto, btnNext, btnStop
    );

    const masonry = document.createElement('div');
    masonry.id = 'll-masonry';

    wrap.append(top, masonry);
    document.body.appendChild(wrap);

    setMasonryColumns();
    window.addEventListener('resize', setMasonryColumns);
    refreshPageControls();
  }

  async function start() {
    injectStyles();
    setupLightbox();
    ensureShell();
    ensureFloatingSwitch();
    captureOriginalNodes();

    showSimplifiedOnly();

    // 先处理当前页（计入已抓取页）
    state.nextPageUrl = findNextPageUrl(document, location.href);

    let items = parsePostsFromDoc(document, location.href);
    state.totalPostsSeen += items.length;

    items = await resolveArchiveCandidates(items);
    items = applyGlobalArchiveDedupe(items);

    mergeItems(items);
    await appendItemsIncrementally(items);

    state.loadedPageCount = 1; // 当前页计入
    setMasonryColumns();
    setStat();
    refreshPageControls();

    if (CONFIG.autoLoadNextPages) {
      await loadUntilMaxPages();
    }
  }

  start();
})();