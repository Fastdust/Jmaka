const fileInput = document.getElementById('fileInput');
const saveBtn = document.getElementById('saveBtn');
const preview = document.getElementById('preview');
const result = document.getElementById('result');
const hint = document.getElementById('hint');

// Debug output is hidden for regular users.
// Enable it locally with: ?debug=1 (persists in localStorage), or by setting localStorage jmaka_debug=1.
const DEBUG_KEY = 'jmaka_debug';
const DEBUG_ENABLED = (() => {
  try {
    const qs = new URLSearchParams(window.location.search);
    const q = qs.get('debug');
    if (q === '1' || q === 'true') {
      localStorage.setItem(DEBUG_KEY, '1');
      return true;
    }
    if (q === '0' || q === 'false') {
      localStorage.removeItem(DEBUG_KEY);
      return false;
    }
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
})();
const filesTbody = document.getElementById('filesTbody');
const compositesTbody = document.getElementById('compositesTbody');
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

// help modal
const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const helpCloseBtn = document.getElementById('helpClose');

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

// help modal wiring
if (helpBtn && helpModal) {
  const openHelp = () => {
    helpModal.hidden = false;
  };
  const closeHelp = () => {
    helpModal.hidden = true;
  };

  helpBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp();
  });

  if (helpCloseBtn) {
    helpCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeHelp();
    });
  }

  helpModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeHelp();
    }
  });
}

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

// split3 modal elements
const split3ToolBtn = document.getElementById('split3ToolBtn');
const split3Modal = document.getElementById('split3Modal');
const split3CloseBtn = document.getElementById('split3Close');
const split3CancelBtn = document.getElementById('split3Cancel');
const split3ApplyBtn = document.getElementById('split3Apply');
const split3PickTargetA = document.getElementById('split3PickTargetA');
const split3PickTargetB = document.getElementById('split3PickTargetB');
const split3PickTargetC = document.getElementById('split3PickTargetC');
const split3TargetImgA = document.getElementById('split3TargetImgA');
const split3TargetImgB = document.getElementById('split3TargetImgB');
const split3TargetImgC = document.getElementById('split3TargetImgC');
const split3Gallery = document.getElementById('split3Gallery');
const split3Stage = document.getElementById('split3Stage');
const split3ThirdA = document.getElementById('split3ThirdA');
const split3ThirdB = document.getElementById('split3ThirdB');
const split3ThirdC = document.getElementById('split3ThirdC');
const split3ItemA = document.getElementById('split3ItemA');
const split3ItemB = document.getElementById('split3ItemB');
const split3ItemC = document.getElementById('split3ItemC');
const split3Hint = document.getElementById('split3Hint');

// TrashImg elements
const trashToolBtn = document.getElementById('trashToolBtn');
const trashFixToolBtn = document.getElementById('trashFixToolBtn');
const trashModal = document.getElementById('trashModal');
const trashCloseBtn = document.getElementById('trashClose');
const trashCancelBtn = document.getElementById('trashCancel');
const trashApplyBtn = document.getElementById('trashApply');
const trashStage = document.getElementById('trashStage');
const trashCard = document.getElementById('trashCard');
const trashImgViewport = document.getElementById('trashImgViewport');
const trashImg = document.getElementById('trashImg');
const trashHandleLeft = document.getElementById('trashHandleLeft');
const trashHandleRight = document.getElementById('trashHandleRight');
const trashHint = document.getElementById('trashHint');
const trashZoomInBtn = document.getElementById('trashZoomIn');
const trashZoomOutBtn = document.getElementById('trashZoomOut');

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

const TARGET_WIDTHS = [1280, 1920, 2440];

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

function detectEdgeHandle(localX, localY, w, h, edgePx) {
  const edge = edgePx || 12;
  if (!w || !h) return { handle: null, cursor: 'move' };

  const nearLeft = localX >= 0 && localX <= edge;
  const nearRight = localX >= (w - edge) && localX <= w;
  const nearTop = localY >= 0 && localY <= edge;
  const nearBottom = localY >= (h - edge) && localY <= h;

  let handle = null;
  if (nearLeft && nearTop) handle = 'tl';
  else if (nearRight && nearTop) handle = 'tr';
  else if (nearLeft && nearBottom) handle = 'bl';
  else if (nearRight && nearBottom) handle = 'br';
  else if (nearTop) handle = 't';
  else if (nearBottom) handle = 'b';
  else if (nearLeft) handle = 'l';
  else if (nearRight) handle = 'r';

  let cursor = 'move';
  if (handle === 'tl' || handle === 'br') cursor = 'nwse-resize';
  else if (handle === 'tr' || handle === 'bl') cursor = 'nesw-resize';
  else if (handle === 'l' || handle === 'r') cursor = 'ew-resize';
  else if (handle === 't' || handle === 'b') cursor = 'ns-resize';

  return { handle, cursor };
}

function cursorForHandle(handle) {
  const h = String(handle || '');
  if (h === 'tl' || h === 'br') return 'nwse-resize';
  if (h === 'tr' || h === 'bl') return 'nesw-resize';
  if (h === 'l' || h === 'r') return 'ew-resize';
  if (h === 't' || h === 'b') return 'ns-resize';
  return 'move';
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
  a: { storedName: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 },
  b: { storedName: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 }
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

function splitGetOriginalUrl(item) {
  if (!item || !item.originalRelativePath) return null;
  return withCacheBust(String(item.originalRelativePath), item.storedName);
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

  const url = splitGetOriginalUrl(item);
  if (!url) {
    el.hidden = true;
    return;
  }

  const st = which === 'a' ? splitState.a : splitState.b;
  st.storedName = item.storedName;
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
  // allow any uploaded image (no need to pre-generate resized)
  const candidates = splitState.history.filter(it => !!(it && it.originalRelativePath && it.imageWidth && it.imageHeight));

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

  // default picks: prefer current active image for slot #1
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
      : 'Нет загруженных изображений.';
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

  const halfA = splitGetHalfSize('a');
  const halfB = splitGetHalfSize('b');

  if (!halfA.w || !halfA.h || !halfB.w || !halfB.h) {
    if (splitHint) splitHint.textContent = 'Не удалось определить размер поля.';
    return;
  }

  const req = {
    storedNameA: a.storedName,
    storedNameB: b.storedName,
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

    // Split output is independent, but sources may change; still bump cache for involved sources.
    cacheBust.set(a.storedName, Date.now());
    cacheBust.set(b.storedName, Date.now());

    await loadComposites();

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
      let handle = t && t.dataset ? t.dataset.h : null;
      const p = splitGetPointerPosInHalf(which, e);

      const st = which === 'a' ? splitState.a : splitState.b;
      if (!st || !st.url) return;

      splitBringToFront(which);

      // If user starts interacting, set active pick target too (convenience).
      splitState.pickTarget = which;
      if (splitPickTargetA) splitPickTargetA.classList.toggle('is-active', which === 'a');
      if (splitPickTargetB) splitPickTargetB.classList.toggle('is-active', which === 'b');

      // If not on a handle element - allow resize by grabbing ANY point near the edges.
      if (!handle) {
        const localX = p.x - st.x;
        const localY = p.y - st.y;
        handle = detectEdgeHandle(localX, localY, st.w, st.h, 12).handle;
      }

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
      if (!splitState.open) return;

      const st = which === 'a' ? splitState.a : splitState.b;
      if (!st || !st.url) return;

      const p = splitGetPointerPosInHalf(which, e);

      // Idle: update cursor so user can grab edges anywhere.
      if (!splitState.action) {
        const t = e.target;
        const hFromEl = t && t.dataset ? t.dataset.h : null;
        if (hFromEl) {
          el.style.cursor = cursorForHandle(hFromEl);
        } else {
          const localX = p.x - st.x;
          const localY = p.y - st.y;
          el.style.cursor = detectEdgeHandle(localX, localY, st.w, st.h, 12).cursor;
        }
        return;
      }

      if (splitState.action.which !== which) return;

      const { w: halfW, h: halfH } = splitGetHalfSize(which);
      if (!halfW || !halfH) return;

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

// -------- Split3 tool (3 panels) --------

function getSplit3PanelRect(which) {
  const el = which === 'a' ? split3ThirdA : (which === 'b' ? split3ThirdB : split3ThirdC);
  if (!el) return null;
  return el.getBoundingClientRect();
}

function split3GetPointerPosInPanel(which, e) {
  const r = getSplit3PanelRect(which);
  if (!r) return { x: 0, y: 0 };
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function split3BringToFront(which) {
  if (!split3ItemA || !split3ItemB || !split3ItemC) return;
  const z = { a: 1, b: 1, c: 1 };
  z[which] = 3;
  // keep deterministic stacking for others
  if (which === 'a') { z.b = 2; z.c = 1; }
  if (which === 'b') { z.a = 1; z.c = 2; }
  if (which === 'c') { z.a = 2; z.b = 1; }
  split3ItemA.style.zIndex = String(z.a);
  split3ItemB.style.zIndex = String(z.b);
  split3ItemC.style.zIndex = String(z.c);
}

function split3GetPanelSize(which) {
  const r = getSplit3PanelRect(which);
  if (!r) return { w: 0, h: 0 };
  return { w: r.width, h: r.height };
}

const split3State = {
  open: false,
  history: [],
  action: null,
  pickTarget: 'a',
  a: { storedName: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 },
  b: { storedName: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 },
  c: { storedName: null, url: null, natW: 0, natH: 0, x: 0, y: 0, w: 0, h: 0 }
};

// TrashImg state: one image under a fixed-height window with resizable width (from center)
const trashState = {
  open: false,
  mode: 'experimental', // 'fix' | 'experimental'
  storedName: null,
  url: null,
  natW: 0,
  natH: 0,
  window: { y: 0, w: 0, h: 0 },
  img: { x: 0, y: 0, w: 0, h: 0 },
  action: null // { type: 'window-resize' | 'img-move' | 'img-scale', ... }
};

function split3ShowItem(which) {
  const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
  const el = which === 'a' ? split3ItemA : (which === 'b' ? split3ItemB : split3ItemC);
  if (!el) return;
  el.style.left = `${st.x}px`;
  el.style.top = `${st.y}px`;
  el.style.width = `${st.w}px`;
  el.style.height = `${st.h}px`;
}

function split3ClampMove(which, st, w, h) {
  const minVisible = 24;
  const minX = -st.w + minVisible;
  const maxX = w - minVisible;
  const minY = -st.h + minVisible;
  const maxY = h - minVisible;
  st.x = Math.min(Math.max(st.x, minX), maxX);
  st.y = Math.min(Math.max(st.y, minY), maxY);
}

function split3LayoutDefaults() {
  for (const which of ['a', 'b', 'c']) {
    const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
    if (!st.url || !st.natW || !st.natH) continue;

    const { w: panelW, h: panelH } = split3GetPanelSize(which);
    if (!panelW || !panelH) continue;

    const aspect = st.natW / st.natH;
    const targetW = panelW * 1.15;
    st.w = targetW;
    st.h = st.w / aspect;

    if (st.h > panelH * 0.9) {
      st.h = panelH * 0.9;
      st.w = st.h * aspect;
    }

    st.x = (panelW - st.w) / 2;
    st.y = (panelH - st.h) / 2;

    split3ClampMove(which, st, panelW, panelH);
    split3ShowItem(which);
  }
}

function split3UpdateTargetThumb(which) {
  const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
  const img = which === 'a' ? split3TargetImgA : (which === 'b' ? split3TargetImgB : split3TargetImgC);
  if (!img) return;

  if (!st || !st.storedName) {
    img.removeAttribute('src');
    img.alt = '';
    return;
  }

  const item = split3State.history.find(x => x && x.storedName === st.storedName);
  const src = item ? splitGetPreviewUrl(item) : null;
  if (!src) {
    img.removeAttribute('src');
    img.alt = '';
    return;
  }

  img.src = src;
  img.alt = item.originalName || item.storedName || '';
}

function split3SyncGallerySelection() {
  if (!split3Gallery) return;
  const a = split3State.a && split3State.a.storedName;
  const b = split3State.b && split3State.b.storedName;
  const c = split3State.c && split3State.c.storedName;

  for (const btn of Array.from(split3Gallery.querySelectorAll('button.split-thumb'))) {
    const sn = btn.dataset && btn.dataset.sn ? btn.dataset.sn : '';
    btn.classList.toggle('is-selected', sn && (sn === a || sn === b || sn === c));
  }
}

function split3SetItemFromStoredName(which, storedName) {
  const el = which === 'a' ? split3ItemA : (which === 'b' ? split3ItemB : split3ItemC);
  if (!el) return;

  const img = el.querySelector('img.split-img');
  if (!img) return;

  const item = split3State.history.find(x => x && x.storedName === storedName);
  if (!item) {
    el.hidden = true;
    return;
  }

  const url = splitGetOriginalUrl(item);
  if (!url) {
    el.hidden = true;
    return;
  }

  const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
  st.storedName = item.storedName;
  st.url = url;

  el.hidden = false;
  split3BringToFront(which);

  img.onload = () => {
    st.natW = img.naturalWidth || 0;
    st.natH = img.naturalHeight || 0;
    split3LayoutDefaults();
  };

  img.onerror = () => {
    if (split3Hint) split3Hint.textContent = 'Не удалось загрузить картинку для Split3.';
  };

  img.src = url;
  img.alt = item.originalName || item.storedName || '';
}

async function openSplit3Modal() {
  if (!split3Modal) return;

  split3Modal.hidden = false;
  split3State.open = true;
  split3State.pickTarget = 'a';

  if (split3PickTargetA) split3PickTargetA.classList.add('is-active');
  if (split3PickTargetB) split3PickTargetB.classList.remove('is-active');
  if (split3PickTargetC) split3PickTargetC.classList.remove('is-active');

  if (split3Hint) split3Hint.textContent = 'Загружаю список...';

  split3State.history = await fetchHistoryRaw();
  const candidates = split3State.history.filter(it => !!(it && it.originalRelativePath && it.imageWidth && it.imageHeight));

  if (split3Gallery) {
    split3Gallery.textContent = '';

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
        const which = split3State.pickTarget || 'a';
        split3SetItemFromStoredName(which, it.storedName);
        split3UpdateTargetThumb(which);
        split3SyncGallerySelection();
      });

      split3Gallery.appendChild(btn);
    }
  }

  const preferredA = (lastUpload && lastUpload.storedName && candidates.some(x => x && x.storedName === lastUpload.storedName))
    ? lastUpload.storedName
    : (candidates[0] && candidates[0].storedName);

  const first = preferredA;
  const second = candidates.find(x => x && x.storedName !== first) && candidates.find(x => x && x.storedName !== first).storedName;
  const third = candidates.find(x => x && x.storedName !== first && x.storedName !== second)
    && candidates.find(x => x && x.storedName !== first && x.storedName !== second).storedName;

  if (split3ItemA) split3ItemA.hidden = true;
  if (split3ItemB) split3ItemB.hidden = true;
  if (split3ItemC) split3ItemC.hidden = true;

  if (first) {
    split3SetItemFromStoredName('a', first);
    split3UpdateTargetThumb('a');
  }
  if (second || first) {
    split3SetItemFromStoredName('b', second || first);
    split3UpdateTargetThumb('b');
  }
  if (third || second || first) {
    split3SetItemFromStoredName('c', third || second || first);
    split3UpdateTargetThumb('c');
  }

  split3SyncGallerySelection();

  if (split3Hint) {
    split3Hint.textContent = candidates.length > 0
      ? 'Выберите слот (#1/#2/#3), затем кликните по превью. Дальше перетаскивайте/масштабируйте.'
      : 'Нет загруженных изображений.';
  }

  if (split3ApplyBtn) {
    split3ApplyBtn.disabled = candidates.length === 0;
  }
}

function closeSplit3Modal() {
  if (!split3Modal) return;
  split3Modal.hidden = true;
  split3State.open = false;
  split3State.action = null;

  if (split3ItemA) split3ItemA.hidden = true;
  if (split3ItemB) split3ItemB.hidden = true;
  if (split3ItemC) split3ItemC.hidden = true;

  if (split3Gallery) split3Gallery.textContent = '';

  if (split3TargetImgA) split3TargetImgA.removeAttribute('src');
  if (split3TargetImgB) split3TargetImgB.removeAttribute('src');
  if (split3TargetImgC) split3TargetImgC.removeAttribute('src');

  // stop image loading
  for (const el of [split3ItemA, split3ItemB, split3ItemC]) {
    if (!el) continue;
    const img = el.querySelector('img.split-img');
    if (img) img.removeAttribute('src');
  }
}

async function applySplit3() {
  if (!split3State.open) return;

  const a = split3State.a;
  const b = split3State.b;
  const c = split3State.c;

  if (!a || !a.storedName || !b || !b.storedName || !c || !c.storedName) {
    if (split3Hint) split3Hint.textContent = 'Выберите три картинки.';
    return;
  }

  const panelA = split3GetPanelSize('a');
  const panelB = split3GetPanelSize('b');
  const panelC = split3GetPanelSize('c');

  if (!panelA.w || !panelA.h || !panelB.w || !panelB.h || !panelC.w || !panelC.h) {
    if (split3Hint) split3Hint.textContent = 'Не удалось определить размер поля.';
    return;
  }

  const req = {
    storedNameA: a.storedName,
    storedNameB: b.storedName,
    storedNameC: c.storedName,
    a: { x: a.x, y: a.y, w: a.w, h: a.h, viewW: panelA.w, viewH: panelA.h },
    b: { x: b.x, y: b.y, w: b.w, h: b.h, viewW: panelB.w, viewH: panelB.h },
    c: { x: c.x, y: c.y, w: c.w, h: c.h, viewW: panelC.w, viewH: panelC.h }
  };

  try {
    if (split3ApplyBtn) split3ApplyBtn.disabled = true;
    setBusy(true);
    if (split3Hint) split3Hint.textContent = 'Склеиваю...';

    const res = await fetch('split3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      if (split3Hint) split3Hint.textContent = 'Ошибка split3.';
      showResult(data);
      return;
    }

    showResult(data);

    // Split3 output is independent, but sources may change; still bump cache for involved sources.
    cacheBust.set(a.storedName, Date.now());
    cacheBust.set(b.storedName, Date.now());
    cacheBust.set(c.storedName, Date.now());
    await loadComposites();

    hint.textContent = 'Split3 создан.';
    closeSplit3Modal();
  } catch (e) {
    if (split3Hint) split3Hint.textContent = 'Ошибка split3.';
    showResult(String(e));
  } finally {
    setBusy(false);
    if (split3ApplyBtn) split3ApplyBtn.disabled = false;
  }
}

function wireSplit3UI() {
  if (!split3Modal || !split3Stage || !split3ThirdA || !split3ThirdB || !split3ThirdC) return;

  if (split3ToolBtn) {
    split3ToolBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSplit3Modal();
    });
  }

  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeSplit3Modal();
  };

  if (split3CloseBtn) split3CloseBtn.addEventListener('click', close);
  if (split3CancelBtn) split3CancelBtn.addEventListener('click', close);

  split3Modal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeSplit3Modal();
    }
  });

  const setPickTarget = (which) => {
    split3State.pickTarget = which;
    if (split3PickTargetA) split3PickTargetA.classList.toggle('is-active', which === 'a');
    if (split3PickTargetB) split3PickTargetB.classList.toggle('is-active', which === 'b');
    if (split3PickTargetC) split3PickTargetC.classList.toggle('is-active', which === 'c');
  };

  if (split3PickTargetA) split3PickTargetA.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPickTarget('a'); });
  if (split3PickTargetB) split3PickTargetB.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPickTarget('b'); });
  if (split3PickTargetC) split3PickTargetC.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPickTarget('c'); });

  const wireItem = (which, el) => {
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (!split3State.open) return;

      const t = e.target;
      let handle = t && t.dataset ? t.dataset.h : null;
      const p = split3GetPointerPosInPanel(which, e);

      const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
      if (!st || !st.url) return;

      split3BringToFront(which);
      split3State.pickTarget = which;
      if (split3PickTargetA) split3PickTargetA.classList.toggle('is-active', which === 'a');
      if (split3PickTargetB) split3PickTargetB.classList.toggle('is-active', which === 'b');
      if (split3PickTargetC) split3PickTargetC.classList.toggle('is-active', which === 'c');

      // If not on a handle element - allow resize by grabbing ANY point near the edges.
      if (!handle) {
        const localX = p.x - st.x;
        const localY = p.y - st.y;
        handle = detectEdgeHandle(localX, localY, st.w, st.h, 12).handle;
      }

      if (handle) {
        split3State.action = {
          type: 'resize',
          which,
          handle,
          startX: p.x,
          startY: p.y,
          startRect: { x: st.x, y: st.y, w: st.w, h: st.h }
        };
      } else {
        split3State.action = {
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
      if (!split3State.open) return;

      const st = which === 'a' ? split3State.a : (which === 'b' ? split3State.b : split3State.c);
      if (!st || !st.url) return;

      const p = split3GetPointerPosInPanel(which, e);

      // Idle: update cursor so user can grab edges anywhere.
      if (!split3State.action) {
        const t = e.target;
        const hFromEl = t && t.dataset ? t.dataset.h : null;
        if (hFromEl) {
          el.style.cursor = cursorForHandle(hFromEl);
        } else {
          const localX = p.x - st.x;
          const localY = p.y - st.y;
          el.style.cursor = detectEdgeHandle(localX, localY, st.w, st.h, 12).cursor;
        }
        return;
      }

      if (split3State.action.which !== which) return;

      const { w: panelW, h: panelH } = split3GetPanelSize(which);
      if (!panelW || !panelH) return;

      if (split3State.action.type === 'move') {
        st.x = p.x - split3State.action.offsetX;
        st.y = p.y - split3State.action.offsetY;
        split3ClampMove(which, st, panelW, panelH);
        split3ShowItem(which);
        return;
      }

      const dx = p.x - split3State.action.startX;
      const dy = p.y - split3State.action.startY;

      const aspect = st.natW && st.natH ? (st.natW / st.natH) : 1;
      const sr = split3State.action.startRect;
      const h = String(split3State.action.handle || 'br');

      const dwX = (h.includes('l') ? -dx : dx);
      const dwY = (h.includes('t') ? -dy : dy) * aspect;

      let dw;
      if (h === 'l' || h === 'r') {
        dw = dwX;
      } else if (h === 't' || h === 'b') {
        dw = dwY;
      } else {
        dw = Math.abs(dwX) >= Math.abs(dwY) ? dwX : dwY;
      }

      const minW = 60;
      const maxWHard = 20000;
      const newW = Math.max(minW, Math.min(sr.w + dw, maxWHard));
      const newH = newW / aspect;

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

      split3ClampMove(which, st, panelW, panelH);
      split3ShowItem(which);
    });

    const end = (e) => {
      if (!split3State.action || split3State.action.which !== which) return;
      split3State.action = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  wireItem('a', split3ItemA);
  wireItem('b', split3ItemB);
  wireItem('c', split3ItemC);

  if (split3ApplyBtn) {
    split3ApplyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applySplit3();
    });
  }

  window.addEventListener('resize', () => {
    if (!split3State.open) return;
    split3LayoutDefaults();
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
  if (!result) return;

  try { result.hidden = false; } catch { /* ignore */ }

  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  if (!result.textContent) {
    result.textContent = text;
  } else {
    result.textContent += "\n\n" + text;
  }
}

function setMainPreviewFromItem(item) {
  const hasItem = !!(item && item.originalRelativePath);

  // Tools availability should not depend on the preview element.
  if (toolButtons) {
    toolButtons.hidden = !hasItem;
  }

  // Preview is optional (we may remove it from UI).
  if (!preview) {
    return;
  }

  if (!hasItem) {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    preview.alt = '';
    return;
  }

  // Для превью используем миниатюру (preview/*), чтобы не грузить оригинал.
  // Важно: используем относительные пути, чтобы приложение могло жить под base-path (например /jmaka/).
  const src = item.previewRelativePath ? item.previewRelativePath : item.originalRelativePath;
  preview.src = withCacheBust(src, item.storedName);
  preview.style.display = 'block';
  preview.alt = item.originalName || item.storedName || 'original';
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

function triggerDownload(href, suggestedName) {
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  if (suggestedName) {
    a.download = suggestedName;
  } else {
    // Fallback: derive from URL path.
    try {
      const clean = href.split('?')[0].split('#')[0];
      const parts = clean.split('/');
      const last = parts[parts.length - 1];
      if (last) a.download = last;
    } catch {
      // ignore
    }
  }
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function appendLinkWithDownload(td, linkEl, href, suggestedName) {
  if (!td || !linkEl || !href) {
    if (td && linkEl) td.appendChild(linkEl);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'cell-with-download';

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'download-btn';
  dlBtn.title = 'Скачать';
  // Жирная иконка дискеты
  dlBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v4h9V5H6zm2 2h5V7H8v0zm-2 6v7h11v-7H6z"/></svg>';
  dlBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerDownload(href, suggestedName);
  });

  wrap.appendChild(linkEl);
  wrap.appendChild(dlBtn);
  td.appendChild(wrap);
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
    const link = makeImageLink(href, imgSrc, 'original');
    appendLinkWithDownload(tdOrig, link, href, data.originalName || storedName);
  } else {
    const href = withCacheBust(data.originalRelativePath, storedName);
    const link = makeA(href, 'original');
    appendLinkWithDownload(tdOrig, link, href, data.originalName || storedName);
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

  uploads.set(storedName, { tr, cells, created: new Set() });
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

    // Сервер уже отдаёт историю в порядке CreatedAt DESC (новые → старые).
    // ensureTableRowForUpload вставляет новые строки через insertBefore(firstChild),
    // поэтому для сохранения порядка "новые сверху" нам нужно обходить массив с конца.
    for (let i = data.length - 1; i >= 0; i--) {
      const item = data[i];
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

  const href = withCacheBust(relativePath, storedName);
  const link = makeA(href, String(width));
  appendLinkWithDownload(td, link, href);
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

    // Ensure tools row becomes visible for the active item (even if we don't show the main preview).
    const activeItem = items.length > 0 ? items[items.length - 1] : null;
    setMainPreviewFromItem(activeItem);

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

// Drag & drop upload
(function setupDragAndDrop() {
  const page = document.querySelector('.page');
  if (!page) return;

  let dragCounter = 0;

  const setDragState = (on) => {
    if (!page) return;
    page.classList.toggle('is-dragover', !!on);
  };

  page.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    setDragState(true);
  });

  page.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  page.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) setDragState(false);
  });

  page.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    setDragState(false);

    const dt = e.dataTransfer;
    if (!dt) return;

    const files = dt.files && dt.files.length ? Array.from(dt.files) : [];
    if (files.length === 0 && dt.items && dt.items.length) {
      for (const item of dt.items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }

    if (files.length > 0) {
      hint.textContent = files.length === 1
        ? 'Загружаю файл из перетаскивания...'
        : `Загружаю файлов из перетаскивания: ${files.length}...`;
      upload(files);
    }
  });
})();

// Paste from clipboard (images)
document.addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  if (!cd) return;

  const files = [];
  if (cd.files && cd.files.length) {
    for (const f of Array.from(cd.files)) {
      files.push(f);
    }
  } else if (cd.items && cd.items.length) {
    for (const item of cd.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }

  if (files.length === 0) return;

  e.preventDefault();
  hint.textContent = files.length === 1
    ? 'Загружаю файл из буфера обмена...'
    : `Загружаю файлов из буфера обмена: ${files.length}...`;
  upload(files);
});

fileInput.addEventListener('change', () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];

  selectedFile = files[0] || null;

  if (!selectedFile) {
    if (preview) {
      preview.style.display = 'none';
      preview.removeAttribute('src');
    }
    resetSizeButtons();
    hint.textContent = 'Нажмите на дискету, перетащите файлы или вставьте из буфера обмена — и они загрузятся.';
    showResult('');
    return;
  }

  if (files.length > 15) {
    if (preview) {
      preview.style.display = 'none';
      preview.removeAttribute('src');
    }
    resetSizeButtons();
    hint.textContent = 'Можно выбрать максимум 15 файлов за раз.';
    showResult({ error: 'too_many_files', max: 15, selected: files.length });
    return;
  }

  // Пока файлы не загружены — сбрасываем lastUpload
  lastUpload = null;
  resetSizeButtons();
  setMainPreviewFromItem(null);

  // Превью локального файла больше не показываем (UI без превью).
  if (preview) {
    try { preview.removeAttribute('src'); } catch { /* ignore */ }
    preview.style.display = 'none';
  }

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
wireSplit3UI();
wireTrashUI();

async function deleteComposite(relativePath, tr) {
  if (!relativePath) return;

  try {
    setBusy(true);
    const res = await fetch('delete-composite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      showResult(data);
      return;
    }

    if (tr) tr.remove();
  } catch (e) {
    showResult(String(e));
  } finally {
    setBusy(false);
  }
}

async function loadComposites() {
  if (!compositesTbody) return [];

  try {
    const res = await fetch('composites', { cache: 'no-store' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = []; }

    if (!res.ok || !Array.isArray(data)) {
      return [];
    }

    compositesTbody.textContent = '';

    for (const it of data) {
      const tr = document.createElement('tr');

      const tdDt = document.createElement('td');
      tdDt.className = 'col-dt';
      tdDt.textContent = it && it.createdAt ? formatDateTime(new Date(it.createdAt)) : formatDateTime(new Date());

      const tdKind = document.createElement('td');
      tdKind.className = 'col-kind';
      const kind = (it && it.kind) ? String(it.kind) : '';
      tdKind.textContent = kind === 'split3' ? 'Split3' : (kind === 'trashimg' ? 'Trash' : 'Split');

      const tdImg = document.createElement('td');
      tdImg.className = 'col-comp';
      const rel = it && it.relativePath ? String(it.relativePath) : '';
      if (rel) {
        const href = rel;
        const link = makeImageLink(href, rel, kind || 'split');
        appendLinkWithDownload(tdImg, link, href);
      } else {
        tdImg.textContent = '—';
        tdImg.classList.add('empty');
      }

      const tdDel = document.createElement('td');
      tdDel.className = 'col-del';
      if (rel) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'del-btn';
        delBtn.title = 'Удалить результат';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7A1 1 0 1 0 5.7 7.1L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteComposite(rel, tr);
        });
        tdDel.appendChild(delBtn);
      }

      tr.appendChild(tdDt);
      tr.appendChild(tdKind);
      tr.appendChild(tdImg);
      tr.appendChild(tdDel);

      compositesTbody.appendChild(tr);
    }

    return data;
  } catch {
    return [];
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  loadComposites();
});

function getPointerPosInTrashStage(e) {
  if (!trashStage) return { x: 0, y: 0 };
  const r = trashStage.getBoundingClientRect();
  return {
    x: e.clientX - r.left,
    y: e.clientY - r.top
  };
}

const TRASH_ASPECT = 16 / 9; // окно 1920x1080
const TRASH_TEMPLATE_W = 1920;
const TRASH_TEMPLATE_H = 1080;
const TRASH_WINDOW_PX = { x: 593, y: 79, w: 735, h: 922 };

function getTrashWindowRectInCard() {
  if (!trashCard) return { x: 0, y: 0, w: 0, h: 0 };
  const cardRect = trashCard.getBoundingClientRect();
  if (!cardRect.width || !cardRect.height) return { x: 0, y: 0, w: 0, h: 0 };

  // В экспериментальном режиме окном считаем всю карточку.
  if (trashState.mode !== 'fix') {
    return { x: 0, y: 0, w: cardRect.width, h: cardRect.height };
  }

  // В режиме TrashFix окно строго соответствует прозрачному прямоугольнику в PNG-шаблоне.
  const sx = cardRect.width / TRASH_TEMPLATE_W;
  const sy = cardRect.height / TRASH_TEMPLATE_H;
  const k = (sx + sy) / 2;

  return {
    x: TRASH_WINDOW_PX.x * k,
    y: TRASH_WINDOW_PX.y * k,
    w: TRASH_WINDOW_PX.w * k,
    h: TRASH_WINDOW_PX.h * k
  };
}

function clampTrashImageToWindow(img, win) {
  if (!win || !img) return img;

  const minX = win.x + win.w - img.w;
  const maxX = win.x;
  const minY = win.y + win.h - img.h;
  const maxY = win.y;

  let x = img.x;
  let y = img.y;

  if (minX <= maxX) {
    x = Math.min(maxX, Math.max(minX, x));
  } else {
    // Если картинка меньше окна (теоретически) — ставим по центру.
    x = (minX + maxX) / 2;
  }

  if (minY <= maxY) {
    y = Math.min(maxY, Math.max(minY, y));
  } else {
    y = (minY + maxY) / 2;
  }

  return { ...img, x, y };
}

function layoutTrashWindowInitial() {
  if (!trashStage || !trashCard) return;
  const stageRect = trashStage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return;

  const maxW = stageRect.width * 0.8;
  const maxH = stageRect.height * 0.8;
  // вписываем окно 16:9 в центр с небольшими отступами
  let w = maxW;
  let h = w / TRASH_ASPECT;
  if (h > maxH) {
    h = maxH;
    w = h * TRASH_ASPECT;
  }

  const y = (stageRect.height - h) / 2;

  trashState.window.y = y;
  trashState.window.h = h;
  trashState.window.w = w;

  updateTrashWindowLayout();
}

function updateTrashWindowLayout() {
  if (!trashStage || !trashCard) return;
  const stageRect = trashStage.getBoundingClientRect();
  if (!stageRect.width) return;
  const h = trashState.window.h;
  const w = trashState.window.w;
  const left = (stageRect.width - w) / 2;
  const top = trashState.window.y;

  trashCard.style.width = `${w}px`;
  trashCard.style.height = `${h}px`;
  trashCard.style.left = `${left}px`;
  trashCard.style.top = `${top}px`;
}

function openTrashModal(mode) {
  if (!trashModal || !trashStage || !trashCard || !trashImgViewport || !trashImg) return;

  if (!lastUpload || !lastUpload.storedName || !lastUpload.originalRelativePath) {
    if (trashHint) {
      trashHint.textContent = 'Сначала выберите строку в таблице файлов.';
    }
    return;
  }

  trashState.open = true;
  trashState.mode = mode === 'fix' ? 'fix' : 'experimental';
  trashState.storedName = lastUpload.storedName;
  // Для TrashImg всегда используем ОРИГИНАЛ (upload/*), чтобы координаты кадра
  // совпадали с координатами, по которым режем на бэкенде.
  const rel = lastUpload.originalRelativePath;
  trashState.url = withCacheBust(rel, lastUpload.storedName);

  trashModal.hidden = false;
  if (trashApplyBtn) trashApplyBtn.disabled = true;

  if (trashHint) {
    trashHint.textContent = 'Потяните за края окна, чтобы изменить ширину.';
  }

  layoutTrashWindowInitial();

  trashImg.onload = () => {
    trashState.natW = trashImg.naturalWidth || 0;
    trashState.natH = trashImg.naturalHeight || 0;
    layoutTrashImageCover();
    if (trashApplyBtn) trashApplyBtn.disabled = false;
  };

  trashImg.src = trashState.url;
  trashImg.alt = lastUpload.originalName || lastUpload.storedName || '';
}

function layoutTrashImageCover() {
  if (!trashCard || !trashImg || !trashState.natW || !trashState.natH) return;
  const win = getTrashWindowRectInCard();
  const winW = win.w;
  const winH = win.h;
  if (!winW || !winH) return;

  // Вставляем пропорционально по высоте: высота окна = высота картинки.
  const scale = winH / trashState.natH;
  const w = trashState.natW * scale;
  const h = winH; // === trashState.natH * scale

  const centerX = win.x + winW / 2;
  const centerY = win.y + winH / 2;
  const x0 = centerX - w / 2;
  const y0 = centerY - h / 2;

  const clamped = clampTrashImageToWindow({ x: x0, y: y0, w, h }, win);
  trashState.img = clamped;

  trashImg.style.width = `${clamped.w}px`;
  trashImg.style.height = `${clamped.h}px`;
  trashImg.style.left = `${clamped.x}px`;
  trashImg.style.top = `${clamped.y}px`;
}

function closeTrashModal() {
  if (!trashModal) return;
  trashModal.hidden = true;
  trashState.open = false;
  trashState.action = null;
  if (trashImg) {
    trashImg.removeAttribute('src');
    trashImg.alt = '';
  }
}

function wireTrashUI() {
  if (!trashModal || !trashStage || !trashCard) return;

  if (trashToolBtn) {
    trashToolBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTrashModal('experimental');
    });
  }

      if (trashFixToolBtn) {
        trashFixToolBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTrashModal('fix');
      });
    }

  const trashZoomByFactor = (factor) => {
    if (!trashState.open || !trashCard || !trashImg || !trashState.img) return;
    const rect = trashCard.getBoundingClientRect();
    const win = getTrashWindowRectInCard();
    const winW = win.w;
    const winH = win.h;
    if (!winW || !winH) return;

    const img0 = trashState.img;
    let f = factor;
    // ограничиваем общий множитель, чтобы не улетать слишком далеко
    f = Math.max(0.2, Math.min(5, f));

    let w = img0.w * f;
    let h = img0.h * f;

    // минимальный масштаб: высота картинки не меньше высоты окна
    const minScale = winH / img0.h;
    if (f < minScale) {
      w = img0.w * minScale;
      h = img0.h * minScale;
    }

    const centerX = rect.left + win.x + winW / 2;
    const centerY = rect.top + win.y + winH / 2;
    const cx = centerX - rect.left;
    const cy = centerY - rect.top;

    const x0 = cx - (w / img0.w) * (centerX - (rect.left + img0.x));
    const y0 = cy - (h / img0.h) * (centerY - (rect.top + img0.y));

    const img1 = clampTrashImageToWindow({ x: x0, y: y0, w, h }, win);
    trashState.img = img1;
    trashImg.style.width = `${img1.w}px`;
    trashImg.style.height = `${img1.h}px`;
    trashImg.style.left = `${img1.x}px`;
    trashImg.style.top = `${img1.y}px`;
  };

  // Ctrl+0 — сброс масштаба фона до "по высоте окна"
  document.addEventListener('keydown', (e) => {
    if (!trashState.open) return;
    if ((e.key === '0' || e.code === 'Digit0') && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      layoutTrashImageCover();
    }
  });

  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeTrashModal();
  };

  if (trashCloseBtn) trashCloseBtn.addEventListener('click', close);
  if (trashCancelBtn) trashCancelBtn.addEventListener('click', close);

  if (trashZoomInBtn) {
    trashZoomInBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trashZoomByFactor(1.12);
    });
  }

  if (trashZoomOutBtn) {
    trashZoomOutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trashZoomByFactor(0.9);
    });
  }

  trashModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      closeTrashModal();
    }
  });

  const onHandleDown = (side, e) => {
    if (!trashState.open) return;
    if (trashState.mode === 'fix') return; // в режиме TrashFix нельзя менять ширину окна
    const p = getPointerPosInTrashStage(e);
    trashState.action = {
      type: 'window-resize',
      side,
      startX: p.x,
      startW: trashState.window.w
    };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  };

  if (trashHandleLeft) {
    trashHandleLeft.addEventListener('pointerdown', (e) => onHandleDown('left', e));
  }
  if (trashHandleRight) {
    trashHandleRight.addEventListener('pointerdown', (e) => onHandleDown('right', e));
  }

  // изменение только ширины окна, высота фиксированная
  trashStage.addEventListener('pointermove', (e) => {
    if (!trashState.open || !trashState.action || trashState.action.type !== 'window-resize') return;
    const p = getPointerPosInTrashStage(e);
    const { side, startX, startW } = trashState.action;
    let half = startW / 2;
    const dx = p.x - startX;
    if (side === 'left') {
      half -= dx; // тянем влево/вправо, ширина меняется симметрично
    } else {
      half += dx;
    }

    const stageRect = trashStage.getBoundingClientRect();
    const minHalf = 40;
    const maxHalf = Math.max(minHalf, stageRect.width * 0.48);
    half = Math.max(minHalf, Math.min(maxHalf, half));

    trashState.window.w = half * 2;
    // ВЫСОТА НЕ МЕНЯЕТСЯ, остаётся той же, что и была при инициализации

    updateTrashWindowLayout();
  });

  const endResize = (e) => {
    if (!trashState.action || trashState.action.type !== 'window-resize') return;
    trashState.action = null;
    try { e.target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  trashStage.addEventListener('pointerup', endResize);
  trashStage.addEventListener('pointercancel', endResize);

  // Перемещение/масштабирование изображения под окном (панорамирование + zoom)
  if (trashImgViewport) {
    trashImgViewport.addEventListener('wheel', (e) => {
      if (!trashState.open) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      trashZoomByFactor(factor);
    });

    trashImgViewport.addEventListener('pointerdown', (e) => {
      if (!trashState.open) return;
      // не перехватываем, если клик по ручке окна
      if (e.target === trashHandleLeft || e.target === trashHandleRight) return;
      if (!trashCard) return;

      const rect = trashCard.getBoundingClientRect();
      const win = getTrashWindowRectInCard();
      const winW = win.w;
      const winH = win.h;
      const cx = rect.left + win.x + winW / 2;
      const cy = rect.top + win.y + winH / 2;

      // проверяем, попали ли в край картинки (для зума)
      const img = trashState.img;
      const localX = e.clientX - (rect.left + img.x);
      const localY = e.clientY - (rect.top + img.y);
      const edgeInfo = detectEdgeHandle(localX, localY, img.w, img.h, 12);

      if (edgeInfo.handle) {
        trashState.action = {
          type: 'img-scale',
          handle: edgeInfo.handle,
          startPointerX: e.clientX,
          startPointerY: e.clientY,
          startImg: { ...img },
          centerX: cx,
          centerY: cy
        };
      } else {
        trashState.action = {
          type: 'img-move',
          startPointerX: e.clientX,
          startPointerY: e.clientY,
          startX: img.x,
          startY: img.y
        };
      }

      try { trashImgViewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });

    trashImgViewport.addEventListener('pointermove', (e) => {
      if (!trashState.open || !trashState.action) return;

      const action = trashState.action;

      if (action.type === 'img-move') {
        const dx = e.clientX - action.startPointerX;
        const dy = e.clientY - action.startPointerY;

        const win = getTrashWindowRectInCard();
        const img0 = trashState.img;
        const tentative = {
          x: action.startX + dx,
          y: action.startY + dy,
          w: img0.w,
          h: img0.h
        };

        const img1 = clampTrashImageToWindow(tentative, win);
        trashState.img = img1;
        trashImg.style.left = `${img1.x}px`;
        trashImg.style.top = `${img1.y}px`;
        return;
      }

      if (action.type === 'img-scale') {
        if (!trashCard) return;
        const rect = trashCard.getBoundingClientRect();
        const win = getTrashWindowRectInCard();
        const winW = win.w;
        const winH = win.h;
        const img0 = action.startImg;

        const dx = e.clientX - action.startPointerX;
        const dy = e.clientY - action.startPointerY;

        // масштаб относительно центра окна; вертикальное движение даёт более "контролируемый" zoom
        let factor = 1 + (dy * -0.003); // вверх = увеличить, вниз = уменьшить
        factor = Math.max(0.2, Math.min(5, factor));

        let w = img0.w * factor;
        let h = img0.h * factor;

        // минимальный масштаб: высота картинки не меньше высоты окна
        const minScale = winH / img0.h;
        if (factor < minScale) {
          w = img0.w * minScale;
          h = img0.h * minScale;
        }

        const cx = action.centerX - rect.left;
        const cy = action.centerY - rect.top;

        const x0 = cx - (w / img0.w) * (action.centerX - (rect.left + img0.x));
        const y0 = cy - (h / img0.h) * (action.centerY - (rect.top + img0.y));

        const img1 = clampTrashImageToWindow({ x: x0, y: y0, w, h }, win);
        trashState.img = img1;
        trashImg.style.width = `${img1.w}px`;
        trashImg.style.height = `${img1.h}px`;
        trashImg.style.left = `${img1.x}px`;
        trashImg.style.top = `${img1.y}px`;
        return;
      }
    });

    const endImgMove = (e) => {
      if (!trashState.action || (trashState.action.type !== 'img-move' && trashState.action.type !== 'img-scale')) return;
      trashState.action = null;
      try { trashImgViewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    trashImgViewport.addEventListener('pointerup', endImgMove);
    trashImgViewport.addEventListener('pointercancel', endImgMove);
  }

  if (trashApplyBtn) {
    trashApplyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!trashState.open || !trashState.storedName) return;
      if (!trashCard) return;

      const win = getTrashWindowRectInCard();
      const img = trashState.img;
      if (!img || !trashState.natW || !trashState.natH || !win.w || !win.h) return;

      // Переводим текущее положение/масштаб картинки в координаты ОРИГИНАЛА
      // для прямоугольника, который соответствует окну шаблона.
      const scale = img.w / trashState.natW;
      if (!scale || !isFinite(scale)) return;

      const cropX = (win.x - img.x) / scale;
      const cropY = (win.y - img.y) / scale;
      const cropW = win.w / scale;
      const cropH = win.h / scale;

      const req = {
        storedName: trashState.storedName,
        x: cropX,
        y: cropY,
        w: cropW,
        h: cropH
      };

      try {
        setBusy(true);
        if (trashHint) trashHint.textContent = 'Генерирую TrashImg...';

        const res = await fetch('trashimg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req)
        });

        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }

        if (!res.ok) {
          if (trashHint) trashHint.textContent = 'Ошибка TrashImg.';
          showResult(data);
          return;
        }

        showResult(data);
        await loadComposites();
        if (trashHint) trashHint.textContent = 'TrashImg создан.';
        closeTrashModal();
      } catch (err) {
        if (trashHint) trashHint.textContent = 'Ошибка TrashImg.';
        showResult(String(err));
      } finally {
        setBusy(false);
      }
    });
  }

  window.addEventListener('resize', () => {
    if (!trashState.open) return;
    layoutTrashWindowInitial();
    layoutTrashImageCover();
  });
}
