const imageInput = document.getElementById('imageInput');
const originalPreview = document.getElementById('originalPreview');
const cleanPreview = document.getElementById('cleanPreview');
const analyzeBtn = document.getElementById('analyzeBtn');
const sampleBtn = document.getElementById('sampleBtn');
const productNameEl = document.getElementById('productName');
const productPriceEl = document.getElementById('productPrice');
const bodyTextEl = document.getElementById('bodyText');
const link1El = document.getElementById('link1');
const styleTypeEl = document.getElementById('styleType');
const emojiLevelEl = document.getElementById('emojiLevel');
const includeDisclosureEl = document.getElementById('includeDisclosure');
const includePriceArrowEl = document.getElementById('includePriceArrow');
const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copyBtn');
const ocrLogEl = document.getElementById('ocrLog');
const downloadImageBtn = document.getElementById('downloadImageBtn');
const installBtn = document.getElementById('installBtn');

let uploadedImage = null;
let uploadedImageURL = '';
let lastCleanImageURL = '';

function setStatus(text, show=true){
  statusEl.textContent = text;
  statusEl.classList.toggle('hidden', !show);
}

function normalize(text=''){
  return text
    .replace(/[|]/g,'I')
    .replace(/[“”]/g,'"')
    .replace(/[‘’]/g,"'")
    .replace(/\s+/g,' ')
    .trim();
}

function normalizeTitle(text=''){
  return normalize(text)
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\bSs\b/g, '')
    .replace(/\bpr\b/gi, '')
    .replace(/\baaa\b/gi, '')
    .replace(/\brr\b/gi, '')
    .replace(/[>#]{2,}/g, '')
    .trim();
}

function parsePriceString(text=''){
  const m = text.replace(/\s/g,'').match(/(\d{1,3}(?:,\d{3})+|\d{3,})원/);
  return m ? `${Number(m[1].replace(/,/g,'')).toLocaleString('ko-KR')}원` : '';
}

function hasKorean(text=''){
  return /[가-힣]/.test(text);
}

function isLikelyInfoNoise(text=''){
  return /(무료배송|무료반품|내일|도착|로켓|와우|쿠폰|할인|평점|판매됨|구매많음|한달구매|원산지|비슷한 상품 보기|상품 보기|브랜드|추천|정말 맛있어요|타임할인)/.test(text);
}

function isFood(title=''){
  return /(라면|과자|시리얼|음료|주스|사과|우유|초코|초콜릿|커피|차|물|생수|만두|떡|국수|파스타|비빔면|간식|치즈|요거트|김|참치|햄|빵|쿠키|젤리|사탕|스낵)/.test(title);
}

function detectStyle(title=''){
  const selected = styleTypeEl.value;
  if (selected !== 'auto') return selected;
  return isFood(title) ? 'hook' : 'clean';
}

function buildHook(title=''){
  const level = emojiLevelEl.value;
  const food = isFood(title);
  if (food) {
    if (level === 'high') return '🔥 얘들아!! 이거 할인 뜬 거 체크해봐!! 🔥';
    if (level === 'mid') return '🍫 먹거리 특가 찾는 분들 체크해보세요';
    return '먹거리 할인 괜찮아서 가져왔어요';
  }
  if (level === 'high') return '🛒 생활용품 특가, 필요한 분들 바로 확인해보세요';
  if (level === 'mid') return '필요한 생활용품 할인이라 공유해요';
  return '가볍게 보기 좋은 할인 정보예요';
}

function buildPriceLine(price=''){
  if (!price) return '';
  if (!includePriceArrowEl.checked) return price;
  const level = emojiLevelEl.value;
  if (level === 'high') return `💜 ${price} 💜`;
  if (level === 'mid') return `🔎 ${price}`;
  return price;
}

function buildBody(title, price, link1) {
  const lines = [];
  const style = detectStyle(title);
  if (includeDisclosureEl.checked) {
    lines.push('쿠팡 파트너스 활동으로 수수료를 제공받습니다.');
    lines.push('');
  }
  if (style === 'hook') {
    lines.push(buildHook(title));
    lines.push('');
  }
  lines.push(title || '상품명 확인 필요');
  if (price) lines.push(buildPriceLine(price));
  if (link1) {
    const partnerLink = link1.trim();
    lines.push(partnerLink);
    lines.push(partnerLink);
  }
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function collectLines(data) {
  return (data.lines || []).map(line => {
    const text = normalize(line.text || '');
    return { text, bbox: line.bbox };
  }).filter(x => x.text);
}

function findBadgeLines(lines, width, height) {
  return lines.filter(line => {
    const { x0, y0, x1, y1 } = line.bbox;
    const isTopRight = x0 > width * 0.48 && y0 < height * 0.20;
    const badgeText = /(회\s*구매|\d+회|구매)/.test(line.text);
    const smallBox = (x1 - x0) < width * 0.25 && (y1 - y0) < height * 0.12;
    return isTopRight && badgeText && smallBox;
  });
}

function pickProductTitle(lines, width, height) {
  const candidates = lines.filter(line => {
    const { x0, y0, y1 } = line.bbox;
    if (x0 < width * 0.42) return false;
    if (y0 < height * 0.04 || y1 > height * 0.48) return false;
    if (!hasKorean(line.text)) return false;
    if (/원/.test(line.text)) return false;
    if (isLikelyInfoNoise(line.text)) return false;
    return true;
  }).sort((a,b) => a.bbox.y0 - b.bbox.y0);

  if (!candidates.length) {
    const alt = lines.filter(line => hasKorean(line.text) && !/원/.test(line.text) && !isLikelyInfoNoise(line.text));
    return normalizeTitle((alt.slice(0,3).map(x=>x.text).join(' ')));
  }

  const chosen = [];
  let lastY = null;
  for (const c of candidates) {
    if (chosen.length === 0) {
      chosen.push(c);
      lastY = c.bbox.y1;
      continue;
    }
    const gap = c.bbox.y0 - lastY;
    if (gap < height * 0.06 && chosen.length < 3) {
      chosen.push(c);
      lastY = c.bbox.y1;
    } else {
      break;
    }
  }
  return normalizeTitle(chosen.map(x => x.text).join(' '));
}

function pickPrice(lines, width, height) {
  const candidates = lines.filter(line => {
    const { x0, y0, y1 } = line.bbox;
    if (x0 < width * 0.42) return false;
    if (y0 < height * 0.18 || y1 > height * 0.72) return false;
    if (!/원/.test(line.text)) return false;
    if (/당/.test(line.text)) return false;
    return !!parsePriceString(line.text);
  }).map(line => ({
    text: parsePriceString(line.text),
    bbox: line.bbox,
    score: (line.bbox.y1 - line.bbox.y0) * (line.bbox.x1 - line.bbox.x0)
  })).sort((a,b) => b.score - a.score);
  return candidates[0]?.text || '';
}

function renderCleanImage(img, badgeLines=[]) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  for (const line of badgeLines) {
    const { x0, y0, x1, y1 } = line.bbox;
    const pad = Math.round(Math.max(canvas.width, canvas.height) * 0.01);
    const rx = Math.max(0, x0 - pad);
    const ry = Math.max(0, y0 - pad);
    const rw = Math.min(canvas.width - rx, (x1 - x0) + pad * 2);
    const rh = Math.min(canvas.height - ry, (y1 - y0) + pad * 2);
    const sampleX = Math.max(0, rx - 5);
    const sampleY = Math.max(0, ry - 5);
    const sampleW = Math.min(20, canvas.width - sampleX);
    const sampleH = Math.min(20, canvas.height - sampleY);
    const data = ctx.getImageData(sampleX, sampleY, sampleW, sampleH).data;
    let r=255,g=255,b=255,c=0;
    for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2];c++;}
    r=Math.round(r/c);g=Math.round(g/c);b=Math.round(b/c);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(rx, ry, rw, rh);
  }
  return canvas;
}

async function analyzeImage() {
  if (!uploadedImage) {
    alert('먼저 이미지를 업로드해주세요.');
    return;
  }
  setStatus('이미지 분석 중입니다...\nOCR 인식은 10~30초 정도 걸릴 수 있습니다.');
  analyzeBtn.disabled = true;

  try {
    const { data } = await Tesseract.recognize(uploadedImage, 'kor+eng', {
      logger: m => {
        if (m.status && typeof m.progress === 'number') {
          setStatus(`${m.status}\n진행률: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const width = uploadedImage.naturalWidth;
    const height = uploadedImage.naturalHeight;
    const lines = collectLines(data);
    ocrLogEl.textContent = lines.map(x => `${x.text}  [${x.bbox.x0},${x.bbox.y0},${x.bbox.x1},${x.bbox.y1}]`).join('\n');

    const badgeLines = findBadgeLines(lines, width, height);
    const title = pickProductTitle(lines, width, height);
    const price = pickPrice(lines, width, height);

    productNameEl.value = title;
    productPriceEl.value = price;

    const cleanCanvas = renderCleanImage(uploadedImage, badgeLines);
    if (lastCleanImageURL) URL.revokeObjectURL(lastCleanImageURL);
    cleanCanvas.toBlob(blob => {
      lastCleanImageURL = URL.createObjectURL(blob);
      cleanPreview.src = lastCleanImageURL;
      downloadImageBtn.href = lastCleanImageURL;
      downloadImageBtn.classList.remove('hidden');
    });

    bodyTextEl.value = buildBody(title, price, link1El.value);

    const badgeMsg = badgeLines.length ? `배지 ${badgeLines.length}개를 자동으로 가렸습니다.` : '삭제할 상단 구매 배지는 찾지 못했습니다.';
    setStatus(`분석 완료\n- 상품명: ${title || '인식 실패'}\n- 가격: ${price || '인식 실패'}\n- ${badgeMsg}`);
  } catch (err) {
    console.error(err);
    setStatus('분석 중 오류가 발생했습니다.\n다른 이미지를 사용하거나 상품명/가격을 직접 수정해주세요.');
  } finally {
    analyzeBtn.disabled = false;
  }
}

imageInput.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  uploadedImage = new Image();
  if (uploadedImageURL) URL.revokeObjectURL(uploadedImageURL);
  uploadedImageURL = URL.createObjectURL(file);
  uploadedImage.onload = () => {
    originalPreview.src = uploadedImageURL;
    cleanPreview.removeAttribute('src');
    setStatus('이미지가 업로드되었습니다. "이미지 분석 후 본문 만들기"를 눌러주세요.');
  };
  uploadedImage.src = uploadedImageURL;
});

sampleBtn.addEventListener('click', () => {
  productNameEl.value = '콘푸로스트 다크초코 컵 시리얼, 40g, 12개';
  productPriceEl.value = '10,210원';
  link1El.value = 'https://link.coupang.com/a/example1';
  bodyTextEl.value = buildBody(productNameEl.value, productPriceEl.value, link1El.value);
  setStatus('예시 값을 넣었습니다.');
});

analyzeBtn.addEventListener('click', analyzeImage);

[productNameEl, productPriceEl, link1El, styleTypeEl, emojiLevelEl, includeDisclosureEl, includePriceArrowEl].forEach(el => {
  el.addEventListener('input', () => {
    bodyTextEl.value = buildBody(productNameEl.value.trim(), productPriceEl.value.trim(), link1El.value);
  });
  el.addEventListener('change', () => {
    bodyTextEl.value = buildBody(productNameEl.value.trim(), productPriceEl.value.trim(), link1El.value);
  });
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(bodyTextEl.value);
    setStatus('본문을 복사했습니다.');
  } catch {
    alert('복사에 실패했습니다. 본문을 길게 눌러 직접 복사해주세요.');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installBtn.classList.remove('hidden');
  let deferredPrompt = e;
  installBtn.addEventListener('click', async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  }, { once: true });
});
