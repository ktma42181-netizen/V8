'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  imageInput: $('imageInput'),
  uploadBox: $('uploadBox'),
  selectedFileName: $('selectedFileName'),
  originalPreview: $('originalPreview'),
  previewPlaceholder: $('previewPlaceholder'),
  link1: $('link1'),
  styleType: $('styleType'),
  emojiLevel: $('emojiLevel'),
  removeBadge: $('removeBadge'),
  includeDisclosure: $('includeDisclosure'),
  includePriceArrow: $('includePriceArrow'),
  analyzeBtn: $('analyzeBtn'),
  resetBtn: $('resetBtn'),
  status: $('status'),
  productName: $('productName'),
  productPrice: $('productPrice'),
  cleanPreview: $('cleanPreview'),
  cleanPlaceholder: $('cleanPlaceholder'),
  downloadImageBtn: $('downloadImageBtn'),
  ocrLog: $('ocrLog'),
  bodyText: $('bodyText'),
  bodyCount: $('bodyCount'),
  rebuildBtn: $('rebuildBtn'),
  copyBtn: $('copyBtn'),
  installBtn: $('installBtn'),
  toast: $('toast')
};

const state = {
  file: null,
  image: null,
  imageUrl: '',
  cleanUrl: '',
  ocrText: '',
  ocrLines: [],
  deferredInstall: null
};

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[|｜]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

function setStatus(message, tone = 'warning') {
  els.status.textContent = message;
  els.status.className = 'status';
  if (tone === 'success') els.status.classList.add('success');
  if (tone === 'error') els.status.classList.add('error');
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function formatWon(value = '') {
  const match = String(value).replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+|\d{3,8})\s*원?/);
  if (!match) return '';
  const numeric = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric < 100 || numeric > 100000000) return '';
  return `${numeric.toLocaleString('ko-KR')}원`;
}

function normalizeTitle(value = '') {
  return cleanText(value)
    .replace(/\(\s*\d{1,3}(?:,\d{3})+\s*\)/g, ' ')
    .replace(/BEST\s*AWARDS/gi, ' ')
    .replace(/[<>#|]+/g, ' ')
    .replace(/\b(?:Ss|pr|aaa|rr|ah)\b/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isNoise(text = '') {
  return /(무료배송|무료반품|로켓|내일|오늘|도착|와우|쿠폰|할인|평점|판매됨|구매많음|한달구매|원산지|비슷한 상품|상품 보기|브랜드|추천|정말 맛있|타임할인|배송|반품|검색|장바구니|바로구매)/i.test(text);
}

function hasKorean(text = '') {
  return /[가-힣]/.test(text);
}

function hasSpecification(text = '') {
  return /\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|mL|L|개|입|팩|세트|봉|캔|병|롤|매|포)/i.test(text);
}

function isFood(title = '') {
  return /(라면|과자|시리얼|음료|주스|사과|우유|초코|초콜릿|커피|차|생수|만두|떡|국수|파스타|비빔면|간식|치즈|요거트|김|참치|햄|빵|쿠키|젤리|사탕|스낵)/.test(title);
}

function buildHook(title = '') {
  const food = isFood(title);
  const level = els.emojiLevel.value;
  if (food) {
    if (level === 'high') return '🔥 얘들아!! 이거 할인 뜬 거 체크해봐!! 🔥';
    if (level === 'mid') return '🍫 먹거리 할인 정보 공유해요';
    return '먹거리 할인 정보예요';
  }
  if (level === 'high') return '🛒 생활용품 특가, 필요한 분들 체크해보세요';
  if (level === 'mid') return '🛒 필요한 생활용품 할인 정보예요';
  return '생활용품 할인 정보예요';
}

function buildPriceLine(price = '') {
  const formatted = formatWon(price);
  if (!formatted) return '';
  if (!els.includePriceArrow.checked) return formatted;
  if (els.emojiLevel.value === 'high') return `💜${formatted}💜`;
  if (els.emojiLevel.value === 'mid') return `🔎 ${formatted}`;
  return formatted;
}

function buildBody() {
  const title = normalizeTitle(els.productName.value);
  const price = buildPriceLine(els.productPrice.value);
  const link = cleanText(els.link1.value).replace(/\s+/g, '');
  const style = els.styleType.value === 'auto' ? (isFood(title) ? 'hook' : 'clean') : els.styleType.value;
  const lines = [];

  if (els.includeDisclosure.checked) {
    lines.push('쿠팡 파트너스 활동으로 수수료를 제공받습니다.');
    lines.push('');
  }
  if (style === 'hook') {
    lines.push(buildHook(title));
    lines.push('');
  }
  if (title) lines.push(title);
  if (price) lines.push(price);
  if (link) {
    lines.push(link);
    lines.push(link);
  }

  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  els.bodyText.value = body;
  els.bodyCount.textContent = `${body.length.toLocaleString('ko-KR')}자`;
  return body;
}

function releaseUrl(key) {
  if (state[key]) {
    URL.revokeObjectURL(state[key]);
    state[key] = '';
  }
}

function showSelectedImage(file) {
  releaseUrl('imageUrl');
  state.file = file;
  state.imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    state.image = image;
    els.originalPreview.src = state.imageUrl;
    els.originalPreview.classList.add('visible');
    els.previewPlaceholder.classList.add('hidden');
    els.selectedFileName.textContent = file.name;
    setStatus('이미지 선택 완료. 쿠팡 파트너스 링크를 입력하고 분석 버튼을 누르세요.');
  };
  image.onerror = () => setStatus('이미지를 불러오지 못했습니다. JPG 또는 PNG 파일로 다시 선택해 주세요.', 'error');
  image.src = state.imageUrl;
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ocr-src="${url}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.ocrSrc = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  const sources = [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js'
  ];
  let lastError;
  for (const source of sources) {
    try {
      setStatus('OCR 기능을 불러오는 중입니다...');
      await loadScript(source);
      if (window.Tesseract) return window.Tesseract;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('OCR 라이브러리를 불러오지 못했습니다.');
}

function createOcrCanvas(image) {
  const maxSide = 2200;
  const scale = Math.min(2, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const contrast = gray < 150 ? Math.max(0, gray - 25) : Math.min(255, gray + 18);
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, scale };
}

function groupWordsIntoLines(words = []) {
  const normalizedWords = words
    .filter(word => word && cleanText(word.text))
    .map(word => ({
      text: cleanText(word.text),
      bbox: word.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
      confidence: Number(word.confidence || 0)
    }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  const lines = [];
  for (const word of normalizedWords) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    let target = lines.find(line => Math.abs(line.centerY - centerY) <= Math.max(height, line.height) * 0.65);
    if (!target) {
      target = { words: [], centerY, height, bbox: { ...word.bbox } };
      lines.push(target);
    }
    target.words.push(word);
    target.centerY = (target.centerY * (target.words.length - 1) + centerY) / target.words.length;
    target.height = Math.max(target.height, height);
    target.bbox.x0 = Math.min(target.bbox.x0, word.bbox.x0);
    target.bbox.y0 = Math.min(target.bbox.y0, word.bbox.y0);
    target.bbox.x1 = Math.max(target.bbox.x1, word.bbox.x1);
    target.bbox.y1 = Math.max(target.bbox.y1, word.bbox.y1);
  }

  return lines.map(line => {
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return { text: cleanText(line.words.map(word => word.text).join(' ')), bbox: line.bbox };
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function collectLines(data = {}) {
  if (Array.isArray(data.lines) && data.lines.length) {
    return data.lines.map(line => ({ text: cleanText(line.text), bbox: line.bbox })).filter(line => line.text && line.bbox);
  }
  if (Array.isArray(data.words) && data.words.length) {
    return groupWordsIntoLines(data.words);
  }
  return String(data.text || '')
    .split(/\n+/)
    .map((text, index) => ({ text: cleanText(text), bbox: { x0: 0, y0: index * 30, x1: 1, y1: index * 30 + 24 } }))
    .filter(line => line.text);
}

async function recognizeWithFallback(Tesseract, sourceCanvas) {
  const languages = ['kor+eng', 'kor', 'eng'];
  let lastError;
  for (const language of languages) {
    try {
      setStatus(`OCR 분석 중입니다. (${language})\n첫 분석은 언어파일 다운로드로 시간이 더 걸릴 수 있습니다.`);
      return await Tesseract.recognize(sourceCanvas, language, {
        logger(message) {
          if (message.status && typeof message.progress === 'number') {
            setStatus(`${message.status}\n진행률 ${Math.round(message.progress * 100)}%`);
          }
        }
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('OCR 인식 실패');
}

function findBadgeBoxes(lines, width, height) {
  const boxes = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = line.text.replace(/\s/g, '');
    const topArea = line.bbox.y0 < height * 0.22;
    const rightArea = line.bbox.x0 > width * 0.38;
    if (topArea && rightArea && /(\d+회구매|회구매|구매\d+회)/.test(text)) boxes.push(line.bbox);
  }
  return boxes;
}

function parseTextFallback(text = '') {
  const rows = String(text).split(/\n+/).map(cleanText).filter(Boolean);
  const prices = [];
  rows.forEach((row, index) => {
    if (/당/.test(row)) return;
    const matches = row.match(/(?:\d{1,3}(?:,\d{3})+|\d{3,8})\s*원/g) || [];
    matches.forEach(match => {
      const price = formatWon(match);
      if (price) prices.push({ price, index, score: /%/.test(row) ? 3 : 1 });
    });
  });
  prices.sort((a, b) => b.score - a.score || a.index - b.index);
  const price = prices[0]?.price || '';
  const priceRowIndex = prices[0]?.index ?? rows.length;
  const candidates = rows.slice(Math.max(0, priceRowIndex - 6), priceRowIndex)
    .filter(row => hasKorean(row) && !/원/.test(row) && !isNoise(row) && !/(회\s*구매)/.test(row))
    .map(row => ({ row: normalizeTitle(row), score: (hasSpecification(row) ? 8 : 0) + Math.min(row.length, 50) / 10 }));
  candidates.sort((a, b) => b.score - a.score);
  return { title: candidates[0]?.row || '', price };
}

function pickTitle(lines, width, height, rawText) {
  const candidates = lines
    .filter(line => {
      const text = normalizeTitle(line.text);
      if (!text || !hasKorean(text) || /원/.test(text) || isNoise(text) || /(회\s*구매)/.test(text)) return false;
      if (width > 10 && line.bbox.x0 < width * 0.34) return false;
      if (height > 10 && (line.bbox.y0 < height * 0.04 || line.bbox.y1 > height * 0.56)) return false;
      return true;
    })
    .map((line, index) => ({
      text: normalizeTitle(line.text),
      bbox: line.bbox,
      score: (hasSpecification(line.text) ? 9 : 0) + Math.min(line.text.length, 70) / 8 - index * 0.08
    }));

  for (let i = 0; i < candidates.length - 1; i += 1) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const gap = next.bbox.y0 - current.bbox.y1;
    if (gap >= 0 && gap < height * 0.07) {
      const combined = normalizeTitle(`${current.text} ${next.text}`);
      candidates.push({ text: combined, bbox: current.bbox, score: current.score + next.score + (hasSpecification(combined) ? 5 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = candidates[0]?.text || '';
  if (best && hasSpecification(best)) return best;
  const fallback = parseTextFallback(rawText).title;
  return best.length >= fallback.length ? best : fallback;
}

function pickPrice(lines, width, height, rawText) {
  const candidates = [];
  lines.forEach((line, index) => {
    if (/당/.test(line.text)) return;
    if (width > 10 && line.bbox.x0 < width * 0.32) return;
    if (height > 10 && (line.bbox.y0 < height * 0.12 || line.bbox.y1 > height * 0.76)) return;
    const matches = line.text.match(/(?:\d{1,3}(?:,\d{3})+|\d{3,8})\s*원/g) || [];
    matches.forEach(match => {
      const price = formatWon(match);
      if (!price) return;
      const area = Math.max(1, (line.bbox.x1 - line.bbox.x0) * (line.bbox.y1 - line.bbox.y0));
      candidates.push({ price, score: Math.log(area + 1) + (/%/.test(line.text) ? 2 : 0) - index * 0.03 });
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.price || parseTextFallback(rawText).price;
}

function sampleAverageColor(ctx, x, y, width, height) {
  const sx = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(y)));
  const sw = Math.max(1, Math.min(18, ctx.canvas.width - sx));
  const sh = Math.max(1, Math.min(18, ctx.canvas.height - sy));
  const pixels = ctx.getImageData(sx, sy, sw, sh).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; count += 1;
  }
  if (!count) return 'rgb(255,255,255)';
  return `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
}

function createCleanImage(badgeBoxes, ocrScale) {
  const image = state.image;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  if (els.removeBadge.checked) {
    if (badgeBoxes.length) {
      badgeBoxes.forEach(box => {
        const x0 = box.x0 / ocrScale;
        const y0 = box.y0 / ocrScale;
        const x1 = box.x1 / ocrScale;
        const y1 = box.y1 / ocrScale;
        const pad = Math.max(8, Math.round(Math.max(canvas.width, canvas.height) * 0.008));
        const rx = Math.max(0, x0 - pad);
        const ry = Math.max(0, y0 - pad);
        const rw = Math.min(canvas.width - rx, x1 - x0 + pad * 2);
        const rh = Math.min(canvas.height - ry, y1 - y0 + pad * 2);
        ctx.fillStyle = sampleAverageColor(ctx, rx - 12, ry - 12, rw, rh);
        ctx.fillRect(rx, ry, rw, rh);
      });
    }
  }
  return canvas;
}

function displayCleanCanvas(canvas) {
  canvas.toBlob(blob => {
    if (!blob) return;
    releaseUrl('cleanUrl');
    state.cleanUrl = URL.createObjectURL(blob);
    els.cleanPreview.src = state.cleanUrl;
    els.cleanPreview.classList.add('visible');
    els.cleanPlaceholder.classList.add('hidden');
    els.downloadImageBtn.href = state.cleanUrl;
    els.downloadImageBtn.classList.remove('hidden');
  }, 'image/png');
}

async function analyzeImage() {
  if (!state.file || !state.image) {
    setStatus('먼저 큰 이미지 선택창에서 상품 이미지를 선택해 주세요.', 'error');
    showToast('이미지를 먼저 선택하세요.');
    return;
  }
  const link = cleanText(els.link1.value).replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(link)) {
    setStatus('쿠팡 파트너스 링크를 정확히 입력해 주세요.', 'error');
    els.link1.focus();
    showToast('링크를 입력하세요.');
    return;
  }

  els.analyzeBtn.disabled = true;
  try {
    const Tesseract = await ensureTesseract();
    const { canvas: ocrCanvas, scale } = createOcrCanvas(state.image);
    const result = await recognizeWithFallback(Tesseract, ocrCanvas);
    const data = result.data || {};
    state.ocrText = String(data.text || '');
    state.ocrLines = collectLines(data);

    const badgeBoxes = findBadgeBoxes(state.ocrLines, ocrCanvas.width, ocrCanvas.height);
    const title = pickTitle(state.ocrLines, ocrCanvas.width, ocrCanvas.height, state.ocrText);
    const price = pickPrice(state.ocrLines, ocrCanvas.width, ocrCanvas.height, state.ocrText);

    els.productName.value = title;
    els.productPrice.value = price;
    els.ocrLog.textContent = [
      `OCR 원문:\n${state.ocrText || '(원문 없음)'}`,
      '',
      `인식 상품명: ${title || '(인식 실패)'}`,
      `인식 가격: ${price || '(인식 실패)'}`,
      `상단 구매 배지 후보: ${badgeBoxes.length}개`,
      '',
      '인식 줄:',
      ...state.ocrLines.map(line => `${line.text} [${line.bbox.x0},${line.bbox.y0},${line.bbox.x1},${line.bbox.y1}]`)
    ].join('\n');

    displayCleanCanvas(createCleanImage(badgeBoxes, scale));
    buildBody();

    const checks = [];
    checks.push(title ? `상품명: ${title}` : '상품명 인식 실패 — 직접 수정 필요');
    checks.push(price ? `가격: ${price}` : '가격 인식 실패 — 직접 수정 필요');
    checks.push(badgeBoxes.length ? `구매 배지 ${badgeBoxes.length}개 제거` : '구매 배지 미검출');
    setStatus(`분석 완료\n${checks.join('\n')}`, title && price ? 'success' : 'warning');
    showToast('분석이 완료되었습니다.');
  } catch (error) {
    console.error(error);
    setStatus('OCR 작동 중 오류가 발생했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.\n계속 실패하면 상품명과 가격을 직접 입력해도 본문 작성 기능은 정상 작동합니다.', 'error');
    showToast('OCR 분석에 실패했습니다.');
  } finally {
    els.analyzeBtn.disabled = false;
  }
}

function resetAll() {
  releaseUrl('imageUrl');
  releaseUrl('cleanUrl');
  state.file = null;
  state.image = null;
  state.ocrText = '';
  state.ocrLines = [];
  els.imageInput.value = '';
  els.originalPreview.removeAttribute('src');
  els.originalPreview.classList.remove('visible');
  els.previewPlaceholder.classList.remove('hidden');
  els.cleanPreview.removeAttribute('src');
  els.cleanPreview.classList.remove('visible');
  els.cleanPlaceholder.classList.remove('hidden');
  els.downloadImageBtn.classList.add('hidden');
  els.selectedFileName.textContent = '선택된 이미지 없음';
  els.link1.value = '';
  els.productName.value = '';
  els.productPrice.value = '';
  els.bodyText.value = '';
  els.bodyCount.textContent = '0자';
  els.ocrLog.textContent = '';
  setStatus('초기화했습니다. 이미지와 링크를 다시 입력해 주세요.');
}

els.imageInput.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) showSelectedImage(file);
});

['dragenter', 'dragover'].forEach(type => els.uploadBox.addEventListener(type, event => {
  event.preventDefault();
  els.uploadBox.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => els.uploadBox.addEventListener(type, event => {
  event.preventDefault();
  els.uploadBox.classList.remove('dragover');
}));
els.uploadBox.addEventListener('drop', event => {
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) showSelectedImage(file);
});

[els.productName, els.productPrice, els.link1, els.styleType, els.emojiLevel, els.includeDisclosure, els.includePriceArrow].forEach(element => {
  element.addEventListener('input', buildBody);
  element.addEventListener('change', buildBody);
});
els.bodyText.addEventListener('input', () => {
  els.bodyCount.textContent = `${els.bodyText.value.length.toLocaleString('ko-KR')}자`;
});
els.analyzeBtn.addEventListener('click', analyzeImage);
els.rebuildBtn.addEventListener('click', () => {
  buildBody();
  showToast('수정 내용으로 본문을 다시 만들었습니다.');
});
els.resetBtn.addEventListener('click', resetAll);
els.copyBtn.addEventListener('click', async () => {
  const text = els.bodyText.value.trim();
  if (!text) {
    showToast('복사할 본문이 없습니다.');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('본문을 복사했습니다.');
  } catch (error) {
    els.bodyText.focus();
    els.bodyText.select();
    const copied = document.execCommand('copy');
    showToast(copied ? '본문을 복사했습니다.' : '본문을 길게 눌러 직접 복사해 주세요.');
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.deferredInstall = event;
  els.installBtn.classList.remove('hidden');
});
els.installBtn.addEventListener('click', async () => {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  els.installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js?v=11-2');
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  });
}

buildBody();
