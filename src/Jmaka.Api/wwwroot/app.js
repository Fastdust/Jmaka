const fileInput = document.getElementById('fileInput');
const saveBtn = document.getElementById('saveBtn');
const preview = document.getElementById('preview');
const result = document.getElementById('result');
const hint = document.getElementById('hint');
const filesTbody = document.getElementById('filesTbody');
const sizeButtons = document.getElementById('sizeButtons');
const sizeBtns = sizeButtons ? Array.from(sizeButtons.querySelectorAll('button.size-btn')) : [];

// viewer modal elements
const viewerModal = document.getElementById('viewerModal');
const viewerCloseBtn = document.getElementById('viewerClose');
const viewerImg = document.getElementById('viewerImg');
const viewerLabel = document.getElementById('viewerLabel');
const viewerOpen = document.getElementById('viewerOpen');

function isLikelyImageUrl(url) {
  if (!url) return false;
  // Strip query/hash (we often add ?v=... for cache-busting)
  const raw = String(url);
  const base = raw.split('?')[0].split('#')[0].toLowerCase();
  return base.endsWith('.jpg')
    || base.endsWith('.jpeg')
    || base.endsWith('.png')
    || base.endsWith('.webp')
    || base.endsWith('.gif')
    || base.endsWith('.bmp');
}

function openViewer(href, label) {
  if (!href) return;
  if (!viewerModal || !viewerImg) {
    window.open(href, '_blank', 'noreferrer');
    return;
  }

  viewerModal.hidden = false;
  viewerImg.src = href;
  viewerImg.alt = label || 'image';

  if (viewerLabel) {
    viewerLabel.textContent = label || href;
  }
  if (viewerOpen) {
    viewerOpen.href = href;
    viewerOpen.hidden = false;
  }
}

function closeViewer() {
  if (!viewerModal) return;
  viewerModal.hidden = true;
  if (viewerImg) {
    viewerImg.removeAttribute('src');
    viewerImg.alt = '';
  }
  if (viewerLabel) viewerLabel.textContent = '';
  if (viewerOpen) {
    viewerOpen.href = '#';
    viewerOpen.hidden = true;
  }
}

if (viewerModal) {
  viewerModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeViewer();
    }
  });
}
if (viewerCloseBtn) viewerCloseBtn.addEventListener('click', closeViewer);

// Intercept clicks on preview/size links in the table and show in-app viewer
if (filesTbody) {
  filesTbody.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;

    const href = a.getAttribute('href');
    if (!href) return;

    // Only intercept for image links.
    if (!isLikelyImageUrl(href)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Try to provide a short label
    const label = a.textContent && a.textContent.trim() ? a.textContent.trim() : href;
    openViewer(href, label);
  });
}

// delete modal elements
const deleteModal = document.getElementById('deleteModal');
const deleteCloseBtn = document.getElementById('deleteClose');
const deleteCancelBtn = document.getElementById('deleteCancel');
const deleteConfirmBtn = document.getElementById('deleteConfirm');
const deleteSkipConfirmEl = document.getElementById('deleteSkipConfirm');

const DELETE_SKIP_KEY = 'jmaka_delete_skip_confirm';

function getDeleteSkipConfirm() {
  try { return localStorage.getItem(DELETE_SKIP_KEY) === '1'; } catch { return false; }
}

function setDeleteSkipConfirm(v) {
  try { localStorage.setItem(DELETE_SKIP_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

let pendingDeleteResolve = null;

function closeDeleteModal(ok) {
  if (!deleteModal) return;
  deleteModal.hidden = true;
  const r = pendingDeleteResolve;
  pendingDeleteResolve = null;

  if (ok && deleteSkipConfirmEl && deleteSkipConfirmEl.checked) {
    setDeleteSkipConfirm(true);
  }

  if (deleteSkipConfirmEl) {
    deleteSkipConfirmEl.checked = false;
  }

  if (r) r(!!ok);
}

function confirmDeleteAsync(storedName) {
  if (getDeleteSkipConfirm()) {
    return Promise.resolve(true);
  }

  if (!deleteModal) {
    // fallback
    return Promise.resolve(confirm('Удалить запись и все связанные файлы безвозвратно?'));
  }

  deleteModal.hidden = false;

  return new Promise((resolve) => {
    pendingDeleteResolve = resolve;
  });
}

if (deleteModal) {
  // backdrop click
  deleteModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeDeleteModal(false);
    }
  });
}
if (deleteCloseBtn) deleteCloseBtn.addEventListener('click', () => closeDeleteModal(false));
if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => closeDeleteModal(false));
if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', () => closeDeleteModal(true));

// crop modal elements
const cropModal = document.getElementById('cropModal');
const cropStage = document.getElementById('cropStage');
const cropImg = document.getElementById('cropImg');
const cropRectEl = document.getElementById('cropRect');
const cropApplyBtn = document.getElementById('cropApply');
const cropCancelBtn = document.getElementById('cropCancel');
const cropCloseBtn = document.getElementById('cropClose');
const cropSourceLabel = document.getElementById('cropSourceLabel');
const cropOpenOriginal = document.getElementById('cropOpenOriginal');
const cropAspectBtns = cropModal ? Array.from(cropModal.querySelectorAll('button.aspect-btn')) : [];

// tool buttons (Crop/Split)
const toolButtons = document.querySelector('.tool-buttons');
const cropToolBtn = document.getElementById('cropToolBtn');
const splitToolBtn = document.getElementById('splitToolBtn');

// split modal elements
const splitModal = document.getElementById('splitModal');
const splitCloseBtn = document.getElementById('splitClose');
const splitCancelBtn = document.getElementById('splitCancel');
const splitApplyBtn = document.getElementById('splitApply');
const splitPickTargetA = document.getElementById('splitPickTargetA');
const splitPickTargetB = document.getElementById('splitPickTargetB');
const splitTargetImgA = document.getElementById('splitTargetImgA');
const splitTargetImgB = document.getElementById('splitTargetImgB');
const splitGallery = document.getElementById('splitGallery');
const splitStage = document.getElementById('splitStage');
const splitHalfLeft = document.getElementById('splitHalfLeft');
const splitHalfRight = document.getElementById('splitHalfRight');
const splitItemA = document.getElementById('splitItemA');
const splitItemB = document.getElementById('splitItemB');
const splitHint = document.getElementById('splitHint');

function syncCropAspectButtons() {
  if (!cropAspectBtns || cropAspectBtns.length === 0) return;
  for (const b of cropAspectBtns) {
    const aw = Number(b.dataset.aw);
    const ah = Number(b.dataset.ah);
    const label = (aw > 0 && ah > 0) ? `${aw}:${ah}` : '';
    b.classList.toggle('is-active', label === (cropState && cropState.aspectLabel));
  }
}

function setCropAspect(aw, ah) {
  if (!aw || !ah || aw <= 0 || ah <= 0) return;
  cropState.aspect = aw / ah;
  cropState.aspectLabel = `${aw}:${ah}`;
  syncCropAspectButtons();

  // If modal is open and we already computed the image box, re-init the rect for the new aspect.
  if (cropState.open && cropState.imgBox) {
    initCropRect();
  }
}

const TARGET_WIDTHS = [720, 1080, 1280, 1920, 2440];

let selectedFile = null;
let lastUpload = null; // { storedName, originalRelativePath, previewRelativePath, imageWidth, imageHeight }

// storedName -> { tr, cells: Map(width->td), created: Set(width) }
const uploads = new Map();

// After crop we overwrite files under the same URLs (preview/<storedName>, upload/<storedName>, resized/<w>/<storedName>).
// Browsers/proxies may cache these aggressively, so we add a per-file cache-buster version.
// storedName -> version (number)
const cacheBust = new Map();

function withCacheBust(relativeUrl, storedName) {
  if (!relativeUrl || !storedName) return relativeUrl;
  const v = cacheBust.get(storedName);
  if (!v) return relativeUrl;
  const sep = relativeUrl.includes('?') ? '&' : '?';
  return `${relativeUrl}${sep}v=${v}`;
}

// -------- Split tool --------

function getSplitHalfRect(which) {
  const el = which === 'a' ? splitHalfLeft : splitHalfRight;
  if (!el) return null;
  return el.getBoundingClientRect();
}

function splitGetPointerPosInHalf(which, e) {
  const r = getSplitHalfRect(which);
  if (!r) return { x: 0, y: 0 };
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function splitBringToFront(which) {
  if (!splitItemA || !splitItemB) return;
  if (which === 'a') {
    splitItemA.style.zIndex = '2';
    splitItemB.style.zIndex = '1';
  } else {
    splitItemA.style.zIndex = '1';
    splitItemB.style.zIndex = '2';
  }
}

function splitGetHalfSize(which) {
  const r = getSplitHalfRect(which);
  if (!r) return { w: 0, h: 0 };
  return { w: r.width, h: r.height };
}

const splitState = {
  open: false,
  history: [],
  action: null,
  a: { storedName: null, sourceWidth: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 },
  b: { storedName: null, sourceWidth: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 }
};

function splitShowItem(which) {
  const st = which === 'a' ? splitState.a : splitState.b;
  const el = which === 'a' ? splitItemA : splitItemB;
  if (!el) return;

  el.style.left = `${st.x}px`;
  el.style.top = `${st.y}px`;
  el.style.width = `${st.w}px`;
  el.style.height = `${st.h}px`;
}

function splitClampMove(which, st, halfW, halfH) {
  // Allow moving/scale freely inside each half container.
  // Anything outside the half is clipped by CSS overflow hidden.
  // Keep at least a small visible portion so you don't lose the image completely.
  const minVisible = 24;

  const minX = -st.w + minVisible;
  const maxX = halfW - minVisible;

  const minY = -st.h + minVisible;
  const maxY = halfH - minVisible;

  st.x = Math.min(Math.max(st.x, minX), maxX);
  st.y = Math.min(Math.max(st.y, minY), maxY);
}

function splitClampResize(which, st, halfW, halfH, aspect) {
  const minW = 60;
  const maxWHard = 20000;

  // In half mode there is no "forbidden" crossing; the other side is simply clipped.
  st.w = Math.max(minW, Math.min(st.w, maxWHard));
  st.h = st.w / aspect;

  splitClampMove(which, st, halfW, halfH);
}

function splitLayoutDefaults() {
  // Layout inside each half container.
  for (const which of ['a', 'b']) {
    const st = which === 'a' ? splitState.a : splitState.b;
    if (!st.url || !st.natW || !st.natH) continue;

    const { w: halfW, h: halfH } = splitGetHalfSize(which);
    if (!halfW || !halfH) continue;

    const aspect = st.natW / st.natH;
    const targetW = halfW * 1.15;
    st.w = targetW;
    st.h = st.w / aspect;

    if (st.h > halfH * 0.9) {
      st.h = halfH * 0.9;
      st.w = st.h * aspect;
    }

    st.x = (halfW - st.w) / 2;
    st.y = (halfH - st.h) / 2;
    splitClampMove(which, st, halfW, halfH);
    splitShowItem(which);
  }
}

async function fetchHistoryRaw() {
  try {
    const res = await fetch('history', { cache: 'no-store' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = []; }
    if (!res.ok || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function splitGetPreviewUrl(item) {
  if (!item) return null;
  const rel = item.previewRelativePath ? item.previewRelativePath : item.originalRelativePath;
  if (!rel) return null;
  return withCacheBust(String(rel), item.storedName);
}

function splitUpdateTargetThumb(which) {
  const st = which === 'a' ? splitState.a : splitState.b;
  const img = which === 'a' ? splitTargetImgA : splitTargetImgB;
  if (!img) return;

  if (!st || !st.storedName) {
    img.removeAttribute('src');
    img.alt = '';
    return;
  }

  const item = splitState.history.find(x => x && x.storedName === st.storedName);
  const src = item ? splitGetPreviewUrl(item) : null;
  if (!src) {
    img.removeAttribute('src');
    img.alt = '';
    return;
  }

  img.src = src;
  img.alt = item.originalName || item.storedName || '';
}

function splitSyncGallerySelection() {
  if (!splitGallery) return;
  const a = splitState.a && splitState.a.storedName;
  const b = splitState.b && splitState.b.storedName;

  for (const btn of Array.from(splitGallery.querySelectorAll('button.split-thumb'))) {
    const sn = btn.dataset && btn.dataset.sn ? btn.dataset.sn : '';
    btn.classList.toggle('is-selected', sn && (sn === a || sn === b));
  }
}

function splitGetBestResizedWidth(item) {
  if (!item || !item.resized) return null;

  // Prefer the biggest available for quality.
  for (let i = TARGET_WIDTHS.length - 1; i >= 0; i--) {
    const w = TARGET_WIDTHS[i];
    const rel = item.resized[String(w)] || item.resized[w];
    if (rel) return w;
  }

  return null;
}

function splitGetResizedUrl(item, width) {
  if (!item || !item.resized || !width) return null;
  const rel = item.resized[String(width)] || item.resized[width];
  if (!rel) return null;
  return withCacheBust(String(rel), item.storedName);
}

function splitSetItemFromStoredName(which, storedName) {
  const el = which === 'a' ? splitItemA : splitItemB;
  if (!el) return;

  const img = el.querySelector('img.split-img');
  if (!img) return;

  const item = splitState.history.find(x => x && x.storedName === storedName);
  if (!item) {
    el.hidden = true;
    return;
  }

  const bestW = splitGetBestResizedWidth(item);
  const url = bestW ? splitGetResizedUrl(item, bestW) : null;
  if (!url || !bestW) {
    el.hidden = true;
    return;
  }

  const st = which === 'a' ? splitState.a : splitState.b;
  st.storedName = item.storedName;
  st.sourceWidth = bestW;
  st.url = url;

  el.hidden = false;
  splitBringToFront(which);

  img.onload = () => {
    st.natW = img.naturalWidth || 0;
    st.natH = img.naturalHeight || 0;
    // if it was not laid out yet, do a default layout pass
    splitLayoutDefaults();
  };

  img.onerror = () => {
    if (splitHint) splitHint.textContent = 'Не удалось загрузить 1280-картинку для Split.';
  };

  img.src = url;
  img.alt = item.originalName || item.storedName || '';
}

async function openSplitModal() {
  if (!splitModal) return;

  splitModal.hidden = false;
  splitState.open = true;
  splitState.pickTarget = 'a';

  if (splitPickTargetA) splitPickTargetA.classList.add('is-active');
  if (splitPickTargetB) splitPickTargetB.classList.remove('is-active');

  if (splitHint) {
    splitHint.textContent = 'Загружаю список...';
  }

  splitState.history = await fetchHistoryRaw();
  const candidates = splitState.history.filter(it => !!splitGetBestResizedWidth(it));

  // build gallery
  if (splitGallery) {
    splitGallery.textContent = '';

    for (const it of candidates) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-thumb';
      btn.dataset.sn = it.storedName;
      btn.title = it.originalName || it.storedName || '';

      const img = document.createElement('img');
      img.alt = it.originalName || it.storedName || '';
      img.loading = 'lazy';
      img.src = splitGetPreviewUrl(it) || '';

      btn.appendChild(img);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const which = splitState.pickTarget || 'a';
        splitSetItemFromStoredName(which, it.storedName);
        splitUpdateTargetThumb(which);
        splitSyncGallerySelection();
      });

      splitGallery.appendChild(btn);
    }
  }

  // default picks: prefer current active image for slot #1 (if it has 1280)
  const preferredA = (lastUpload && lastUpload.storedName && candidates.some(x => x && x.storedName === lastUpload.storedName))
    ? lastUpload.storedName
    : (candidates[0] && candidates[0].storedName);

  const first = preferredA;
  const second = candidates.find(x => x && x.storedName !== first) && candidates.find(x => x && x.storedName !== first).storedName;

  if (splitItemA) splitItemA.hidden = true;
  if (splitItemB) splitItemB.hidden = true;

  if (first) {
    splitSetItemFromStoredName('a', first);
    splitUpdateTargetThumb('a');
  }
  if (second || first) {
    splitSetItemFromStoredName('b', second || first);
    splitUpdateTargetThumb('b');
  }

  splitSyncGallerySelection();

  if (splitHint) {
    splitHint.textContent = candidates.length > 0
      ? 'Выберите слот (#1/#2), затем кликните по превью. Дальше перетаскивайте/масштабируйте.'
      : 'Нет картинок с готовым размером 1280. Сначала сделайте resize 1280.';
  }

  if (splitApplyBtn) {
    splitApplyBtn.disabled = candidates.length === 0;
  }
}

function closeSplitModal() {
  if (!splitModal) return;
  splitModal.hidden = true;
  splitState.open = false;
  splitState.action = null;

  if (splitItemA) splitItemA.hidden = true;
  if (splitItemB) splitItemB.hidden = true;

  if (splitGallery) {
    splitGallery.textContent = '';
  }

  if (splitTargetImgA) splitTargetImgA.removeAttribute('src');
  if (splitTargetImgB) splitTargetImgB.removeAttribute('src');

  // stop image loading
  if (splitItemA) {
    const img = splitItemA.querySelector('img.split-img');
    if (img) img.removeAttribute('src');
  }
  if (splitItemB) {
    const img = splitItemB.querySelector('img.split-img');
    if (img) img.removeAttribute('src');
  }
}

async function applySplit() {
  if (!splitState.open) return;

  const a = splitState.a;
  const b = splitState.b;

  if (!a || !a.storedName || !b || !b.storedName) {
    if (splitHint) splitHint.textContent = 'Выберите две картинки.';
    return;
  }

  if (!a.sourceWidth || !b.sourceWidth) {
    if (splitHint) splitHint.textContent = 'Для выбранных картинок нет готовых размеров (720/1080/1280/1920/2440).';
    return;
  }

  const halfA = splitGetHalfSize('a');
  const halfB = splitGetHalfSize('b');

  if (!halfA.w || !halfA.h || !halfB.w || !halfB.h) {
    if (splitHint) splitHint.textContent = 'Не удалось определить размер поля.';
    return;
  }

  const req = {
    storedNameA: a.storedName,
    storedNameB: b.storedName,
    sourceWidthA: a.sourceWidth,
    sourceWidthB: b.sourceWidth,
    a: { x: a.x, y: a.y, w: a.w, h: a.h, viewW: halfA.w, viewH: halfA.h },
    b: { x: b.x, y: b.y, w: b.w, h: b.h, viewW: halfB.w, viewH: halfB.h }
  };

  try {
    if (splitApplyBtn) splitApplyBtn.disabled = true;
    setBusy(true);
    if (splitHint) splitHint.textContent = 'Склеиваю...';

    const res = await fetch('split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      if (splitHint) splitHint.textContent = 'Ошибка split.';
      showResult(data);
      return;
    }

    showResult(data);

    // split output is associated with storedNameA (slot #1)
    cacheBust.set(a.storedName, Date.now());

    await loadHistory(a.storedName);

    hint.textContent = 'Split создан.';
    closeSplitModal();
  } catch (e) {
    if (splitHint) splitHint.textContent = 'Ошибка split.';
    showResult(String(e));
  } finally {
    setBusy(false);
    if (splitApplyBtn) splitApplyBtn.disabled = false;
  }
}

function wireSplitUI() {
  if (!splitModal || !splitStage || !splitHalfLeft || !splitHalfRight) return;

  // open button
  if (splitToolBtn) {
    splitToolBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSplitModal();
    });
  }

  // close controls
  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeSplitModal();
  };

  if (splitCloseBtn) splitCloseBtn.addEventListener('click', close);
  if (splitCancelBtn) splitCancelBtn.addEventListener('click', close);

  // backdrop click
  splitModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeSplitModal();
    }
  });

  // picking target (#1/#2)
  const setPickTarget = (which) => {
    splitState.pickTarget = which;
    if (splitPickTargetA) splitPickTargetA.classList.toggle('is-active', which === 'a');
    if (splitPickTargetB) splitPickTargetB.classList.toggle('is-active', which === 'b');
  };

  if (splitPickTargetA) {
    splitPickTargetA.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPickTarget('a');
    });
  }
  if (splitPickTargetB) {
    splitPickTargetB.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPickTarget('b');
    });
  }

  // drag/resize on items
  const wireItem = (which, el) => {
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (!splitState.open) return;

      const t = e.target;
      const handle = t && t.dataset ? t.dataset.h : null;
      const p = splitGetPointerPosInHalf(which, e);

      const st = which === 'a' ? splitState.a : splitState.b;
      if (!st || !st.url) return;

      splitBringToFront(which);

      // If user starts interacting, set active pick target too (convenience).
      splitState.pickTarget = which;
      if (splitPickTargetA) splitPickTargetA.classList.toggle('is-active', which === 'a');
      if (splitPickTargetB) splitPickTargetB.classList.toggle('is-active', which === 'b');

      if (handle) {
        splitState.action = {
          type: 'resize',
          which,
          handle,
          startX: p.x,
          startY: p.y,
          startRect: { x: st.x, y: st.y, w: st.w, h: st.h }
        };
      } else {
        splitState.action = {
          type: 'move',
          which,
          offsetX: p.x - st.x,
          offsetY: p.y - st.y
        };
      }

      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!splitState.open || !splitState.action) return;
      if (splitState.action.which !== which) return;

      const { w: halfW, h: halfH } = splitGetHalfSize(which);
      if (!halfW || !halfH) return;

      const st = which === 'a' ? splitState.a : splitState.b;
      if (!st || !st.url) return;

      const p = splitGetPointerPosInHalf(which, e);

      if (splitState.action.type === 'move') {
        st.x = p.x - splitState.action.offsetX;
        st.y = p.y - splitState.action.offsetY;
        splitClampMove(which, st, halfW, halfH);
        splitShowItem(which);
        return;
      }

      // resize (proportional), with anchors depending on handle
      const dx = p.x - splitState.action.startX;
      const dy = p.y - splitState.action.startY;

      const aspect = st.natW && st.natH ? (st.natW / st.natH) : 1;
      const sr = splitState.action.startRect;
      const h = String(splitState.action.handle || 'br');

      // Compute width delta based on handle direction.
      const dwX = (h.includes('l') ? -dx : dx);
      const dwY = (h.includes('t') ? -dy : dy) * aspect;

      let dw;
      if (h === 'l' || h === 'r') {
        dw = dwX;
      } else if (h === 't' || h === 'b') {
        dw = dwY;
      } else {
        // corners: pick the dominant movement
        dw = Math.abs(dwX) >= Math.abs(dwY) ? dwX : dwY;
      }

      const minW = 60;
      const maxWHard = 20000;
      const newW = Math.max(minW, Math.min(sr.w + dw, maxWHard));
      const newH = newW / aspect;

      // Anchor: opposite side stays in place.
      let newX = sr.x;
      let newY = sr.y;
      if (h.includes('l')) {
        newX = sr.x + (sr.w - newW);
      }
      if (h.includes('t')) {
        newY = sr.y + (sr.h - newH);
      }

      st.x = newX;
      st.y = newY;
      st.w = newW;
      st.h = newH;

      splitClampMove(which, st, halfW, halfH);
      splitShowItem(which);
    });

    const end = (e) => {
      if (!splitState.action || splitState.action.which !== which) return;
      splitState.action = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  wireItem('a', splitItemA);
  wireItem('b', splitItemB);

  // apply
  if (splitApplyBtn) {
    splitApplyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applySplit();
    });
  }

  window.addEventListener('resize', () => {
    if (!splitState.open) return;
    splitLayoutDefaults();
  });
}

// crop state (coords are in cropStage coordinate space)
const CROP_MIN_W = 60;

function getCropAspect() {
  // width / height
  const a = cropState && cropState.aspect ? cropState.aspect : (16 / 9);
  return a > 0 ? a : (16 / 9);
}

let cropState = {
  open: false,
  storedName: null,
  originalRelativePath: null, // current working file (upload/<storedName>)
  sourceRelativePath: null,   // immutable source (upload-original/<storedName>)
  aspect: 16 / 9,
  aspectLabel: '16:9',
  imgBox: null, // { x, y, w, h } in stage coords
  rect: { x: 0, y: 0, w: 0, h: 0 },
  action: null, // { type: 'move'|'resize', handle?: 'tl'|'tr'|'bl'|'br', startRect, startX, startY, offsetX, offsetY }
  busy: false
};

function setBusy(busy) {
  saveBtn.disabled = busy;
  saveBtn.title = busy ? 'Загрузка...' : 'Загрузить файл';
}

function showResult(obj) {
  result.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

function setMainPreviewFromItem(item) {
  if (!preview) return;

  if (!item || !item.originalRelativePath) {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    preview.alt = '';

    if (toolButtons) {
      toolButtons.hidden = true;
    }

    return;
  }

  // Для превью используем миниатюру (preview/*), чтобы не грузить оригинал.
  // Важно: используем относительные пути, чтобы приложение могло жить под base-path (например /jmaka/).
  const src = item.previewRelativePath ? item.previewRelativePath : item.originalRelativePath;
  preview.src = withCacheBust(src, item.storedName);
  preview.style.display = 'block';
  preview.alt = item.originalName || item.storedName || 'original';

  if (toolButtons) {
    toolButtons.hidden = false;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(d) {
  // "дд.мм.гггг - чч:мм:сс"
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} - ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function makeA(href, text) {
  const a = document.createElement('a');
  a.className = 'link-a';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = String(text).slice(0, 10);
  return a;
}

function makeImageLink(href, imgSrc, alt) {
  const a = document.createElement('a');
  a.className = 'link-img';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';

  const img = document.createElement('img');
  img.className = 'table-preview';
  img.alt = alt || '';
  img.loading = 'lazy';
  img.src = imgSrc;

  a.appendChild(img);
  return a;
}

function setActiveRow(storedName) {
  for (const v of uploads.values()) {
    v.tr.classList.remove('is-active');
  }
  const u = uploads.get(storedName);
  if (u) {
    u.tr.classList.add('is-active');
  }
}

async function deleteRow(storedName) {
  const ok = await confirmDeleteAsync(storedName);
  if (!ok) return;

  try {
    setBusy(true);
    hint.textContent = 'Удаляю...';

    const res = await fetch('delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storedName })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      hint.textContent = 'Ошибка удаления.';
      showResult(data);
      return;
    }

    // Локально удаляем строку
    const u = uploads.get(storedName);
    if (u && u.tr) {
      u.tr.remove();
    }
    uploads.delete(storedName);

    // Если удалили активную — выбираем следующую строку или очищаем превью
    if (lastUpload && lastUpload.storedName === storedName) {
      const firstTr = filesTbody && filesTbody.querySelector('tr');
      if (firstTr && firstTr.dataset.storedName) {
        const sn = firstTr.dataset.storedName;
        const first = { storedName: sn };
        // лучше перезагрузить историю, чтобы восстановить полные данные
        await loadHistory();
        return;
      }

      lastUpload = null;
      resetSizeButtons();
      setMainPreviewFromItem(null);
    }

    hint.textContent = 'Удалено.';
  } catch (e) {
    hint.textContent = 'Ошибка удаления.';
    showResult(String(e));
  } finally {
    setBusy(false);
  }
}

function ensureTableRowForUpload(data, opts) {
  if (!filesTbody) return;
  if (!data || !data.storedName || !data.originalRelativePath) return;

  const createdAt = opts && opts.createdAt ? opts.createdAt : null;
  const makeActive = opts && Object.prototype.hasOwnProperty.call(opts, 'makeActive') ? !!opts.makeActive : true;

  const storedName = data.storedName;

  // если уже есть строка (теоретически) — просто активируем
  const existing = uploads.get(storedName);
  if (existing) {
    setActiveRow(storedName);
    return;
  }

  const tr = document.createElement('tr');
  tr.dataset.storedName = storedName;

  const tdDt = document.createElement('td');
  tdDt.className = 'col-dt';
  tdDt.textContent = createdAt ? formatDateTime(new Date(createdAt)) : formatDateTime(new Date());

  const tdOrig = document.createElement('td');
  tdOrig.className = 'col-orig';
  // В таблице показываем миниатюру (preview/*), а ссылка ведёт на оригинал.
  // Если previewRelativePath нет (старые записи) — используем оригинал.
  if (data.imageWidth && data.imageHeight) {
    const href = withCacheBust(data.originalRelativePath, storedName);
    const imgSrc = withCacheBust(data.previewRelativePath ? data.previewRelativePath : data.originalRelativePath, storedName);
    tdOrig.appendChild(makeImageLink(href, imgSrc, 'original'));
  } else {
    tdOrig.appendChild(makeA(withCacheBust(data.originalRelativePath, storedName), 'original'));
  }

  const cells = new Map();
  for (const w of TARGET_WIDTHS) {
    const td = document.createElement('td');
    td.className = 'size-cell empty';
    td.dataset.w = String(w);
    td.textContent = '—';
    tr.appendChild(td);
    cells.set(w, td);
  }

  // Split result cell
  const tdSplit = document.createElement('td');
  tdSplit.className = 'split-cell empty col-split';
  tdSplit.textContent = '—';
  tr.appendChild(tdSplit);

  // Кнопка удаления (крестик)
  const tdDel = document.createElement('td');
  tdDel.className = 'col-del';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'del-btn';
  delBtn.title = 'Удалить';
  delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7A1 1 0 1 0 5.7 7.1L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteRow(storedName);
  });
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  tr.insertBefore(tdOrig, tr.firstChild);
  tr.insertBefore(tdDt, tr.firstChild);

  // новая запись сверху
  filesTbody.insertBefore(tr, filesTbody.firstChild);

  uploads.set(storedName, { tr, cells, splitTd: tdSplit, created: new Set() });
  if (makeActive) {
    setActiveRow(storedName);
  }

  // Клик по строке делает её "активной" (т.е. на неё будут применяться кнопки размеров)
  tr.addEventListener('click', (e) => {
    // If user clicked a link inside the row, the viewer/link handler should handle it.
    const a = e && e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) return;

    const sn = tr.dataset.storedName;
    if (!sn) return;

    // Обновляем текущий "контекст" работы кнопок размеров
    lastUpload = {
      storedName: sn,
      originalRelativePath: data.originalRelativePath,
      previewRelativePath: data.previewRelativePath,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight
    };
    setActiveRow(sn);
    updateSizeButtonsForCurrent();

    // И обновляем главное превью
    setMainPreviewFromItem(data);
  });
}

function hydrateRowFromHistory(item) {
  ensureTableRowForUpload(item, { createdAt: item.createdAt, makeActive: false });

  const u = uploads.get(item.storedName);
  if (!u) return;

  const resized = item.resized;
  if (resized && typeof resized === 'object') {
    for (const [wStr, rel] of Object.entries(resized)) {
      const w = Number(wStr);
      if (!w || !rel) continue;
      if (!TARGET_WIDTHS.includes(w)) continue;
      setCellLink(item.storedName, w, rel);
      u.created.add(w);
    }
  }

  if (item.splitRelativePath) {
    setSplitCellLink(item.storedName, item.splitRelativePath);
  }
}

async function loadHistory(preferStoredName) {
  if (!filesTbody) return [];

  try {
    const res = await fetch('history', { cache: 'no-store' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = []; }

    if (!res.ok || !Array.isArray(data)) {
      return [];
    }

    // Перерисовываем таблицу целиком
    filesTbody.textContent = '';
    uploads.clear();

    for (const item of data) {
      hydrateRowFromHistory(item);
    }

    // Активная строка: предпочитаем указанную, иначе первую
    const preferred = preferStoredName ? data.find(x => x && x.storedName === preferStoredName) : null;
    const active = preferred || data[0];

    if (active && active.storedName) {
      lastUpload = {
        storedName: active.storedName,
        originalRelativePath: active.originalRelativePath,
        previewRelativePath: active.previewRelativePath,
        imageWidth: active.imageWidth,
        imageHeight: active.imageHeight
      };
      setActiveRow(active.storedName);
      updateSizeButtonsForCurrent();
      setMainPreviewFromItem(active);
    } else {
      lastUpload = null;
      resetSizeButtons();
      setMainPreviewFromItem(null);
    }

    return data;
  } catch {
    return [];
  }
}

function setCellLink(storedName, width, relativePath) {
  const u = uploads.get(storedName);
  if (!u) return;
  const td = u.cells.get(width);
  if (!td) return;

  td.classList.remove('empty');
  td.textContent = '';

  // В колонках размеров — только текстовая ссылка.
  td.appendChild(makeA(withCacheBust(relativePath, storedName), String(width)));
}

function setSplitCellLink(storedName, relativePath) {
  const u = uploads.get(storedName);
  if (!u || !u.splitTd) return;

  const td = u.splitTd;
  td.classList.remove('empty');
  td.textContent = '';

  const href = withCacheBust(relativePath, storedName);
  td.appendChild(makeImageLink(href, href, 'split'));
}

function resetSizeButtons() {
  if (!sizeButtons) return;
  sizeButtons.hidden = true;
  for (const btn of sizeBtns) {
    btn.disabled = true;
    delete btn.dataset.href;
  }
}

function updateSizeButtonsForCurrent() {
  if (!sizeButtons) return;

  const storedName = lastUpload && lastUpload.storedName;
  const imageWidth = lastUpload && lastUpload.imageWidth;

  if (!storedName || !imageWidth || imageWidth <= 0) {
    resetSizeButtons();
    return;
  }

  sizeButtons.hidden = false;

  const u = uploads.get(storedName);

  for (const btn of sizeBtns) {
    const w = Number(btn.dataset.w);
    if (!w || w <= 0) {
      btn.disabled = true;
      continue;
    }

    const already = u && u.created && u.created.has(w);
    // Allow upscaling: even if original is small, user may want to generate bigger sizes.
    btn.disabled = !!already;
  }
}

async function generateResize(width) {
  if (!lastUpload || !lastUpload.storedName) {
    return null;
  }

  const res = await fetch('resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storedName: lastUpload.storedName, width })
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  }

  return data;
}

if (sizeButtons) {
  sizeButtons.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button.size-btn');
    if (!btn || btn.disabled) return;

    const width = Number(btn.dataset.w);
    if (!width) return;

    // Проверка дубликатов: если уже делали этот размер для текущего изображения — ничего не делаем.
    const storedName = lastUpload && lastUpload.storedName;
    const u = storedName ? uploads.get(storedName) : null;
    if (u && u.created && u.created.has(width)) {
      hint.textContent = `Размер ${width}px уже создан для этого изображения.`;
      return;
    }

    try {
      setBusy(true);
      hint.textContent = `Оптимизирую до ${width}px...`;

      const data = await generateResize(width);
      if (data && data.relativePath) {
        const storedName = lastUpload && lastUpload.storedName;
        if (!storedName) {
          hint.textContent = 'Не выбран оригинал.';
          return;
        }

        // Заполняем ячейку в таблице
        setCellLink(storedName, width, data.relativePath);

        // Запоминаем, что этот размер уже создан
        const u = uploads.get(storedName);
        if (u) {
          u.created.add(width);
        }

        // Отключаем кнопку, чтобы не делать дубликат
        btn.disabled = true;

        hint.textContent = 'Готово.';
      } else {
        hint.textContent = 'Не удалось создать файл.';
      }
    } catch (err) {
      hint.textContent = 'Ошибка оптимизации.';
      showResult(String(err));
    } finally {
      setBusy(false);
    }
  });
}

async function upload(files) {
  const list = Array.isArray(files) ? files : Array.from(files || []);

  if (list.length <= 0) {
    return;
  }

  if (list.length > 15) {
    hint.textContent = 'Можно загрузить максимум 15 файлов за раз.';
    showResult({ error: 'too_many_files', max: 15, selected: list.length });
    return;
  }

  setBusy(true);
  showResult('Загрузка...');
  resetSizeButtons();

  try {
    const fd = new FormData();
    for (const f of list) {
      fd.append('files', f);
    }

    const res = await fetch('upload', {
      method: 'POST',
      body: fd
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      showResult(data);
      hint.textContent = 'Ошибка загрузки.';
      return;
    }

    // Backend returns an array for multi-upload; keep backward compatibility.
    const items = Array.isArray(data) ? data : [data];
    showResult(items);

    // Create rows for each uploaded file; make last one active.
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const makeActive = i === items.length - 1;
      ensureTableRowForUpload(it, { createdAt: it && it.createdAt, makeActive });

      if (makeActive) {
        lastUpload = {
          storedName: it && it.storedName,
          originalRelativePath: it && it.originalRelativePath,
          previewRelativePath: it && it.previewRelativePath,
          imageWidth: it && it.imageWidth,
          imageHeight: it && it.imageHeight
        };
      }
    }

    updateSizeButtonsForCurrent();

    hint.textContent = items.length === 1
      ? 'Файл загружен.'
      : `Загружено файлов: ${items.length}.`; 
  } catch (e) {
    showResult(String(e));
  } finally {
    setBusy(false);
  }
}

saveBtn.addEventListener('click', () => {
  // Кнопка-дискета = выбор файла. После выбора загрузка стартует автоматически.
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];

  selectedFile = files[0] || null;

  if (!selectedFile) {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    resetSizeButtons();
    hint.textContent = 'Нажмите на дискету, выберите изображения — и они загрузятся.';
    showResult('');
    return;
  }

  if (files.length > 15) {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    resetSizeButtons();
    hint.textContent = 'Можно выбрать максимум 15 файлов за раз.';
    showResult({ error: 'too_many_files', max: 15, selected: files.length });
    return;
  }

  // Пока файлы не загружены — сбрасываем lastUpload, чтобы клик по превью не пытался кадрировать старую запись
  lastUpload = null;
  resetSizeButtons();

  // Превью первого локального файла
  preview.src = URL.createObjectURL(selectedFile);
  preview.style.display = 'block';
  preview.alt = selectedFile.name;

  hint.textContent = files.length === 1 ? 'Загружаю файл...' : `Загружаю файлов: ${files.length}...`;
  showResult({
    selectedFiles: files.map(f => ({ name: f.name, size: f.size, type: f.type }))
  });

  upload(files);
});

function setCropBusy(busy) {
  cropState.busy = !!busy;
  if (cropApplyBtn) cropApplyBtn.disabled = cropState.busy;
  if (cropCancelBtn) cropCancelBtn.disabled = cropState.busy;
  if (cropCloseBtn) cropCloseBtn.disabled = cropState.busy;
}

function showCropRect() {
  if (!cropRectEl) return;
  cropRectEl.style.left = `${cropState.rect.x}px`;
  cropRectEl.style.top = `${cropState.rect.y}px`;
  cropRectEl.style.width = `${cropState.rect.w}px`;
  cropRectEl.style.height = `${cropState.rect.h}px`;
}

function clampMoveRectToImgBox(x, y, w, h) {
  const b = cropState.imgBox;
  if (!b) return { x, y, w, h };

  const maxX = b.x + b.w - w;
  const maxY = b.y + b.h - h;

  const nx = Math.min(Math.max(x, b.x), maxX);
  const ny = Math.min(Math.max(y, b.y), maxY);

  return { x: nx, y: ny, w, h };
}

function computeImgBoxInStage() {
  if (!cropStage || !cropImg) return null;

  const stageRect = cropStage.getBoundingClientRect();
  const imgRect = cropImg.getBoundingClientRect();

  const x = imgRect.left - stageRect.left;
  const y = imgRect.top - stageRect.top;
  const w = imgRect.width;
  const h = imgRect.height;

  if (w <= 1 || h <= 1) return null;
  return { x, y, w, h };
}

function initCropRect() {
  const b = cropState.imgBox;
  if (!b) return;

  // стараемся взять ~80% площади по ширине, но чтобы влезало по высоте и держало выбранные пропорции
  const aspect = getCropAspect();
  const maxW = b.w * 0.85;
  const maxWByH = b.h * aspect;
  const w = Math.max(CROP_MIN_W, Math.min(maxW, maxWByH));
  const h = w / aspect;

  const x = b.x + (b.w - w) / 2;
  const y = b.y + (b.h - h) / 2;

  cropState.rect = clampMoveRectToImgBox(x, y, w, h);
  showCropRect();
}

function openCropModal() {
  if (!cropModal || !cropStage || !cropImg || !cropRectEl) return;

  if (!lastUpload || !lastUpload.storedName || !lastUpload.originalRelativePath) return;
  if (!lastUpload.imageWidth || !lastUpload.imageHeight) return;

  cropState.open = true;
  cropState.storedName = lastUpload.storedName;
  cropState.originalRelativePath = lastUpload.originalRelativePath;
  cropState.sourceRelativePath = `upload-original/${lastUpload.storedName}`;
  cropState.action = null;
  setCropBusy(false);

  // Keep current aspect selection (default 16:9)
  syncCropAspectButtons();

  cropModal.hidden = false;

  const v = Date.now();
  const sourceUrl = `${cropState.sourceRelativePath}?v=${v}`;
  const fallbackUrl = `${cropState.originalRelativePath}?v=${v}`;

  // UI hint: show which file we are cropping + link to open it.
  if (cropSourceLabel) {
    cropSourceLabel.textContent = `Режем оригинал: ${cropState.sourceRelativePath}`;
  }
  if (cropOpenOriginal) {
    cropOpenOriginal.href = sourceUrl;
    cropOpenOriginal.hidden = false;
  }

  // Загружаем неизменённый оригинал в модалку. Если файла нет (старые записи), fallback на upload/.
  cropImg.dataset.fallbackTried = '';
  cropImg.onerror = () => {
    if (cropImg.dataset.fallbackTried) return;
    cropImg.dataset.fallbackTried = '1';

    if (cropSourceLabel) {
      cropSourceLabel.textContent = `Режем (fallback): ${cropState.originalRelativePath}`;
    }
    if (cropOpenOriginal) {
      cropOpenOriginal.href = fallbackUrl;
      cropOpenOriginal.hidden = false;
    }

    cropImg.src = fallbackUrl;
  };

  cropImg.src = sourceUrl;
  cropImg.alt = lastUpload.originalName || lastUpload.storedName || 'crop';

  // После загрузки картинки вычислим box и инициализируем прямоугольник
  cropImg.onload = () => {
    requestAnimationFrame(() => {
      cropState.imgBox = computeImgBoxInStage();
      initCropRect();
    });
  };

  // если картинка уже в кеше и onload может не сработать — попробуем через rAF
  requestAnimationFrame(() => {
    const b = computeImgBoxInStage();
    if (b) {
      cropState.imgBox = b;
      initCropRect();
    }
  });
}

function closeCropModal() {
  if (!cropModal) return;
  cropModal.hidden = true;
  cropState.open = false;
  cropState.action = null;
  cropState.sourceRelativePath = null;
  setCropBusy(false);

  if (cropImg) {
    cropImg.onerror = null;
    delete cropImg.dataset.fallbackTried;
    cropImg.removeAttribute('src');
    cropImg.alt = '';
  }
  if (cropSourceLabel) {
    cropSourceLabel.textContent = '';
  }
  if (cropOpenOriginal) {
    cropOpenOriginal.href = '#';
    cropOpenOriginal.hidden = true;
  }
}

function getPointerPosInStage(e) {
  if (!cropStage) return { x: 0, y: 0 };
  const r = cropStage.getBoundingClientRect();
  return {
    x: e.clientX - r.left,
    y: e.clientY - r.top
  };
}

function clampResizeW(anchorX, anchorY, handle, desiredW) {
  const b = cropState.imgBox;
  if (!b) return Math.max(CROP_MIN_W, desiredW);

  // Доступное пространство от anchor до границы изображения
  let maxW;
  let maxH;

  if (handle === 'br') {
    maxW = (b.x + b.w) - anchorX;
    maxH = (b.y + b.h) - anchorY;
  } else if (handle === 'tr') {
    maxW = (b.x + b.w) - anchorX;
    maxH = anchorY - b.y;
  } else if (handle === 'bl') {
    maxW = anchorX - b.x;
    maxH = (b.y + b.h) - anchorY;
  } else {
    // tl
    maxW = anchorX - b.x;
    maxH = anchorY - b.y;
  }

  maxW = Math.max(1, maxW);
  maxH = Math.max(1, maxH);

  // Ограничение по высоте тоже переводим в ограничение по ширине
  const maxWByH = maxH * getCropAspect();
  const hardMaxW = Math.max(1, Math.min(maxW, maxWByH));

  return Math.min(Math.max(desiredW, CROP_MIN_W), hardMaxW);
}

async function applyCrop() {
  if (!cropState.open || cropState.busy) return;
  if (!cropState.storedName || !cropImg || !cropStage) return;

  const b = cropState.imgBox;
  if (!b || b.w <= 1 || b.h <= 1) return;

  const natW = cropImg.naturalWidth;
  const natH = cropImg.naturalHeight;
  if (!natW || !natH) return;

  const scaleX = natW / b.w;
  const scaleY = natH / b.h;

  const xInImg = cropState.rect.x - b.x;
  const yInImg = cropState.rect.y - b.y;

  const req = {
    storedName: cropState.storedName,
    x: Math.round(xInImg * scaleX),
    y: Math.round(yInImg * scaleY),
    width: Math.round(cropState.rect.w * scaleX),
    height: Math.round(cropState.rect.h * scaleY)
  };

  try {
    setCropBusy(true);
    hint.textContent = 'Обрезаю...';

    const res = await fetch('crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      hint.textContent = 'Ошибка кадрирования.';
      showResult(data);
      return;
    }

    showResult(data);

    // Crop overwrites files under the same storedName, so bump cache-buster.
    cacheBust.set(cropState.storedName, Date.now());

    // Обновляем таблицу/превью из истории. Плюс сохраняем выделение на этой же записи.
    await loadHistory(cropState.storedName);

    hint.textContent = 'Готово. Ресайзы сброшены — их нужно создать заново.';
    closeCropModal();
  } catch (e) {
    hint.textContent = 'Ошибка кадрирования.';
    showResult(String(e));
  } finally {
    setCropBusy(false);
  }
}

function wireCropUI() {
  if (!cropModal || !cropStage || !cropRectEl) return;

  // Aspect buttons
  if (cropAspectBtns && cropAspectBtns.length > 0) {
    for (const b of cropAspectBtns) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const aw = Number(b.dataset.aw);
        const ah = Number(b.dataset.ah);
        setCropAspect(aw, ah);
      });
    }
  }

  // Закрытие по кнопкам
  if (cropCancelBtn) cropCancelBtn.addEventListener('click', closeCropModal);
  if (cropCloseBtn) cropCloseBtn.addEventListener('click', closeCropModal);
  if (cropApplyBtn) cropApplyBtn.addEventListener('click', applyCrop);

  // Клик по фону
  cropModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeCropModal();
    }
  });

  // Drag (move) по прямоугольнику
  cropRectEl.addEventListener('pointerdown', (e) => {
    if (!cropState.open || cropState.busy) return;

    const handle = e.target && e.target.dataset ? e.target.dataset.h : null;
    const p = getPointerPosInStage(e);

    const r = cropState.rect;

    if (handle) {
      cropState.action = {
        type: 'resize',
        handle,
        startRect: { ...r },
        startX: p.x,
        startY: p.y
      };
    } else {
      cropState.action = {
        type: 'move',
        startRect: { ...r },
        offsetX: p.x - r.x,
        offsetY: p.y - r.y
      };
    }

    cropRectEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  cropRectEl.addEventListener('pointermove', (e) => {
    if (!cropState.open || cropState.busy) return;
    if (!cropState.action) return;

    const p = getPointerPosInStage(e);
    const b = cropState.imgBox;
    if (!b) return;

    if (cropState.action.type === 'move') {
      const w = cropState.rect.w;
      const h = cropState.rect.h;
      const x = p.x - cropState.action.offsetX;
      const y = p.y - cropState.action.offsetY;
      cropState.rect = clampMoveRectToImgBox(x, y, w, h);
      showCropRect();
      return;
    }

    // resize
    const handle = cropState.action.handle;
    const sr = cropState.action.startRect;

    // anchor = противоположный угол
    let ax, ay;
    if (handle === 'br') {
      ax = sr.x;
      ay = sr.y;
    } else if (handle === 'tr') {
      ax = sr.x;
      ay = sr.y + sr.h;
    } else if (handle === 'bl') {
      ax = sr.x + sr.w;
      ay = sr.y;
    } else {
      // tl
      ax = sr.x + sr.w;
      ay = sr.y + sr.h;
    }

    // ограничим pointer в пределах изображения (чтобы не было отрицательных размеров)
    const px = Math.min(Math.max(p.x, b.x), b.x + b.w);
    const py = Math.min(Math.max(p.y, b.y), b.y + b.h);

    const dx = Math.abs(px - ax);
    const dy = Math.abs(py - ay);

    const wFromX = dx;
    const wFromY = dy * getCropAspect();

    let desiredW = Math.min(wFromX, wFromY);
    desiredW = clampResizeW(ax, ay, handle, desiredW);

    const newW = desiredW;
    const newH = newW / getCropAspect();

    let x, y;
    if (handle === 'br') {
      x = ax;
      y = ay;
    } else if (handle === 'tr') {
      x = ax;
      y = ay - newH;
    } else if (handle === 'bl') {
      x = ax - newW;
      y = ay;
    } else {
      x = ax - newW;
      y = ay - newH;
    }

    cropState.rect = clampMoveRectToImgBox(x, y, newW, newH);
    showCropRect();
  });

  const endPointer = (e) => {
    if (!cropState.open) return;
    if (!cropState.action) return;
    cropState.action = null;
    try { cropRectEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  cropRectEl.addEventListener('pointerup', endPointer);
  cropRectEl.addEventListener('pointercancel', endPointer);

  // если окно/вьюпорт изменился — пересчитаем box и чуть поправим прямоугольник
  window.addEventListener('resize', () => {
    if (!cropState.open) return;
    const b = computeImgBoxInStage();
    if (!b) return;
    cropState.imgBox = b;
    initCropRect();
  });
}

// Клик по главному превью открывает интерфейс кадрирования
if (preview) {
  preview.addEventListener('click', () => {
    openCropModal();
  });
}

// Tool buttons
if (cropToolBtn) {
  cropToolBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCropModal();
  });
}

wireCropUI();
wireSplitUI();

document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
});
