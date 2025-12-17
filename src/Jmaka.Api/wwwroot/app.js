const fileInput = document.getElementById('fileInput');
const saveBtn = document.getElementById('saveBtn');
const preview = document.getElementById('preview');
const result = document.getElementById('result');
const hint = document.getElementById('hint');
const filesTbody = document.getElementById('filesTbody');
const sizeButtons = document.getElementById('sizeButtons');
const sizeBtns = sizeButtons ? Array.from(sizeButtons.querySelectorAll('button.size-btn')) : [];

// crop modal elements
const cropModal = document.getElementById('cropModal');
const cropStage = document.getElementById('cropStage');
const cropImg = document.getElementById('cropImg');
const cropRectEl = document.getElementById('cropRect');
const cropApplyBtn = document.getElementById('cropApply');
const cropCancelBtn = document.getElementById('cropCancel');
const cropCloseBtn = document.getElementById('cropClose');

const TARGET_WIDTHS = [720, 1080, 1260, 1920, 2440];

let selectedFile = null;
let lastUpload = null; // { storedName, originalRelativePath, previewRelativePath, imageWidth, imageHeight }

// storedName -> { tr, cells: Map(width->td), created: Set(width) }
const uploads = new Map();

// crop state (coords are in cropStage coordinate space)
const CROP_ASPECT = 16 / 9;
const CROP_MIN_W = 60;
let cropState = {
  open: false,
  storedName: null,
  originalRelativePath: null,
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
    return;
  }

  // Для превью используем миниатюру (preview/*), чтобы не грузить оригинал.
  // Важно: используем относительные пути, чтобы приложение могло жить под base-path (например /jmaka/).
  const src = item.previewRelativePath ? item.previewRelativePath : item.originalRelativePath;
  preview.src = src;
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
  const ok = confirm('Удалить запись и все связанные файлы безвозвратно?');
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
    const href = data.originalRelativePath;
    const imgSrc = data.previewRelativePath ? data.previewRelativePath : href;
    tdOrig.appendChild(makeImageLink(href, imgSrc, 'original'));
  } else {
    tdOrig.appendChild(makeA(data.originalRelativePath, 'original'));
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
  tr.addEventListener('click', () => {
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
    const res = await fetch('history');
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
  td.appendChild(makeA(relativePath, String(width)));
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
    const tooBig = w >= imageWidth;
    btn.disabled = !!already || tooBig;
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

async function upload(file) {
  setBusy(true);
  showResult('Загрузка...');
  resetSizeButtons();

  try {
    const fd = new FormData();
    fd.append('file', file);

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

    showResult(data);

    // Запоминаем загруженный файл как "текущий"
    lastUpload = {
      storedName: data && data.storedName,
      originalRelativePath: data && data.originalRelativePath,
      previewRelativePath: data && data.previewRelativePath,
      imageWidth: data && data.imageWidth,
      imageHeight: data && data.imageHeight
    };

    // Создаём строку в таблице (для каждого оригинала — отдельная строка)
    ensureTableRowForUpload(data, { createdAt: data.createdAt, makeActive: true });

    // Обновляем кнопки размеров (активны только допустимые и ещё не созданные)
    updateSizeButtonsForCurrent();

    if (data && data.imageWidth && data.imageHeight) {
      hint.textContent = 'Выберите размер слева от превью.';
    } else if (data && data.originalRelativePath) {
      hint.textContent = 'Файл загружен (не изображение).';
    } else {
      hint.textContent = 'Файл загружен, но ссылка недоступна.';
    }
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
  const file = fileInput.files && fileInput.files[0];
  selectedFile = file || null;

  if (!selectedFile) {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    resetSizeButtons();
    hint.textContent = 'Нажмите на дискету, выберите изображение — и оно загрузится.';
    showResult('');
    return;
  }

  // Пока файл не загружен — сбрасываем lastUpload, чтобы клик по превью не пытался кадрировать старую запись
  lastUpload = null;
  resetSizeButtons();

  // Превью локального файла
  preview.src = URL.createObjectURL(selectedFile);
  preview.style.display = 'block';
  preview.alt = selectedFile.name;

  hint.textContent = 'Загружаю файл...';
  showResult({
    selectedFile: {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type
    }
  });

  upload(selectedFile);
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

  // стараемся взять ~80% площади по ширине, но чтобы влезало по высоте и держало 16:9
  const maxW = b.w * 0.85;
  const maxWByH = b.h * CROP_ASPECT;
  const w = Math.max(CROP_MIN_W, Math.min(maxW, maxWByH));
  const h = w / CROP_ASPECT;

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
  cropState.action = null;
  setCropBusy(false);

  cropModal.hidden = false;

  // Загружаем оригинал в модалку; добавляем cache-buster, чтобы после crop браузер не показывал старую картинку
  cropImg.src = `${cropState.originalRelativePath}?v=${Date.now()}`;
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
  setCropBusy(false);

  if (cropImg) {
    cropImg.removeAttribute('src');
    cropImg.alt = '';
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
  const maxWByH = maxH * CROP_ASPECT;
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
    const wFromY = dy * CROP_ASPECT;

    let desiredW = Math.min(wFromX, wFromY);
    desiredW = clampResizeW(ax, ay, handle, desiredW);

    const newW = desiredW;
    const newH = newW / CROP_ASPECT;

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

wireCropUI();

document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
});
