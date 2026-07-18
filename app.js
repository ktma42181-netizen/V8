const state = {
  files: [],
  previewUrls: [],
  ocrText: "",
};

const $ = (id) => document.getElementById(id);
const MAX_FILES = 3;

function clean(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[\r]+/g, "")
    .trim();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setStatus(message, tone = "default") {
  const box = $("statusBox");
  box.textContent = message;
  box.style.borderColor = tone === "error" ? "#fecaca" : tone === "success" ? "#bbf7d0" : "#e2e8f0";
  box.style.background = tone === "error" ? "#fef2f2" : tone === "success" ? "#f0fdf4" : "#f8fafc";
  box.style.color = tone === "error" ? "#991b1b" : tone === "success" ? "#166534" : "#475569";
}

function releasePreviewUrls() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
}

function renderPreviews() {
  const grid = $("previewGrid");
  const previewImages = $("previewImages");
  grid.innerHTML = "";
  previewImages.innerHTML = "";

  if (!state.files.length) {
    grid.classList.add("empty");
    previewImages.className = "preview-images empty";
    previewImages.textContent = "업로드한 이미지가 여기에 표시됩니다.";
    return;
  }

  grid.classList.remove("empty");
  previewImages.className = "preview-images";

  releasePreviewUrls();
  state.previewUrls = state.files.map((file) => URL.createObjectURL(file));

  state.previewUrls.forEach((url, idx) => {
    const box = document.createElement("div");
    box.className = "image-box";
    box.innerHTML = `
      <img src="${url}" alt="업로드 이미지 ${idx + 1}">
      <div class="image-caption">이미지 ${idx + 1}${idx === 0 ? " · 대표 미리보기" : ""}</div>
    `;
    grid.appendChild(box);

    const preview = document.createElement("div");
    preview.className = "preview-image";
    preview.innerHTML = `<img src="${url}" alt="스레드 미리보기 이미지 ${idx + 1}">`;
    previewImages.appendChild(preview);
  });
}

function normalizeForParse(raw = "") {
  return raw
    .replace(/[|│]/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");
}

function splitLines(raw = "") {
  return raw
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean);
}

function isNoiseLine(line) {
  return /(link\.coupang\.com|http|광고|팔로우|조회|댓글|도착|로켓|무료배송|무료반품|오늘|내일|쿠폰|할인|남음|판매|정말 맛있|추천|평점|브랜드|한달구매|구매|BEST AWARDS|프로필|스레드|쿠팡 파트너스 활동)/i.test(line);
}

function hasSpec(line) {
  return /(\d+(?:[.,]\d+)?\s*(?:g|kg|ml|mL|L|개|입|팩|세트|봉|캔|병|롤|매))/i.test(line);
}

function looksLikeUnitPrice(line) {
  return /(10g당|100g당|100ml당|1세트당|개당|당\s*\d)/i.test(line);
}

function findPriceCandidates(lines) {
  const found = [];
  const priceRegex = /\d{1,3}(?:,\d{3})+원|\d{4,6}원/g;

  lines.forEach((line) => {
    if (looksLikeUnitPrice(line)) return;
    const matches = line.match(priceRegex) || [];
    matches.forEach((p) => {
      const value = Number(String(p).replace(/[^\d]/g, ""));
      if (value >= 500 && value <= 999999) found.push({ text: formatWon(value), value, source: line });
    });
  });

  return found;
}

function formatWon(value) {
  const n = Number(String(value).replace(/[^\d]/g, ""));
  if (!n) return "";
  return `${n.toLocaleString("ko-KR")}원`;
}

function guessCategory(title = "") {
  const t = title.toLowerCase();
  if (/(라면|과자|쿠키|초콜릿|우유|주스|사과|생수|시리얼|커피|음료|컵밥|떡볶이|냉면|소스|간식|식품)/i.test(t)) return "식품";
  if (/(세제|리필|청소|욕실|주방|수세미|수건|비누|핸드솝|샴푸|바디워시|생필품)/i.test(t)) return "생필품";
  if (/(슬라이서|칼|주방용품|도구|수납|정리|마그네틱)/i.test(t)) return "주방/생활용품";
  return "기타";
}

function parseProductTitle(lines) {
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const current = clean(lines[i]);
    if (!current || isNoiseLine(current)) continue;

    const next = clean(lines[i + 1] || "");
    const pair = clean(`${current} ${!isNoiseLine(next) ? next : ""}`);

    const options = [pair, current];
    options.forEach((candidate) => {
      if (!candidate || /원/.test(candidate)) return;
      const score =
        (hasSpec(candidate) ? 6 : 0) +
        (/[가-힣]/.test(candidate) ? 3 : 0) +
        Math.min(candidate.length / 8, 5) -
        ((candidate.match(/\d{1,2}:\d{2}/g) || []).length * 4) -
        (isNoiseLine(candidate) ? 5 : 0);
      if (score > 3) candidates.push({ text: candidate, score });
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  const best = candidates[0]?.text || "";
  return best.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
}

function parseFromOcr(raw) {
  const normalized = normalizeForParse(raw);
  const lines = splitLines(raw).map((line) => normalizeForParse(line));

  const title = parseProductTitle(lines);
  const prices = findPriceCandidates(lines);

  let original = "";
  let current = "";

  if (prices.length >= 2) {
    original = prices[0].text;
    current = prices[prices.length - 1].text;
    if (Number(original.replace(/[^\d]/g, "")) < Number(current.replace(/[^\d]/g, ""))) {
      const tmp = original;
      original = current;
      current = tmp;
    }
  } else if (prices.length === 1) {
    current = prices[0].text;
  }

  return {
    title,
    original,
    current,
    category: guessCategory(title),
    raw: normalized,
  };
}

async function recognizeImage(file) {
  const result = await Tesseract.recognize(file, "kor+eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const percent = Math.round((m.progress || 0) * 100);
        setStatus(`OCR 분석 중... ${percent}%`);
      }
    },
  });
  return result.data.text || "";
}

async function analyzeImages() {
  if (!state.files.length) {
    showToast("먼저 상품 이미지를 업로드하세요.");
    return;
  }

  if (typeof Tesseract === "undefined") {
    setStatus("OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도하세요.", "error");
    return;
  }

  setStatus("이미지를 분석하고 있습니다...");
  $("analyzeBtn").disabled = true;

  try {
    const texts = [];
    for (let i = 0; i < state.files.length; i++) {
      setStatus(`이미지 ${i + 1}/${state.files.length} 분석 중...`);
      const text = await recognizeImage(state.files[i]);
      texts.push(text);
    }

    state.ocrText = texts.join("\n\n----\n\n");
    $("ocrRaw").value = state.ocrText;

    const parsed = parseFromOcr(state.ocrText);
    if (parsed.title && !$("productTitle").value.trim()) $("productTitle").value = parsed.title;
    if (parsed.original && !$("priceOriginal").value.trim()) $("priceOriginal").value = parsed.original;
    if (parsed.current && !$("priceCurrent").value.trim()) $("priceCurrent").value = parsed.current;
    if (parsed.category && !$("categoryHint").value.trim()) $("categoryHint").value = parsed.category;

    buildThreadBody();
    setStatus("이미지 분석이 완료되었습니다. 인식 결과를 확인한 뒤 본문을 사용하세요.", "success");
    showToast("분석 완료");
  } catch (error) {
    console.error(error);
    setStatus("이미지 분석 중 오류가 발생했습니다. 이미지가 선명한지 확인하고 다시 시도하세요.", "error");
    showToast("분석 실패");
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

function generateBodyByStyle({ title, original, current, link1, link2, hook, includeDisclosure, style }) {
  const lines = [];
  const cleanedTitle = clean(title);
  const cleanedCurrent = formatWon(current);
  const cleanedOriginal = formatWon(original);
  const links = [clean(link1), clean(link2)].filter(Boolean);

  if (style === "promo" && includeDisclosure) {
    lines.push("쿠팡 파트너스 활동으로 수수료를 제공받습니다.");
    lines.push("");
  }

  if (style === "promo" && clean(hook)) {
    lines.push(clean(hook));
    lines.push("");
  }

  lines.push(cleanedTitle || "상품명을 입력하세요.");

  if (style === "sale" && cleanedOriginal && cleanedCurrent && cleanedOriginal !== cleanedCurrent) {
    lines.push(`${cleanedOriginal} -> ${cleanedCurrent}`);
  } else if (style === "promo") {
    lines.push(`💬 ${cleanedCurrent || "가격 입력 필요"}`);
  } else {
    lines.push(cleanedCurrent || "가격 입력 필요");
  }

  if (links.length) lines.push("");
  links.forEach((link) => lines.push(link));

  if (style !== "promo" && includeDisclosure) {
    lines.push("");
    lines.push("쿠팡 파트너스 활동으로 일정액의 수수료를 제공받습니다.");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildThreadBody() {
  const payload = {
    title: $("productTitle").value,
    original: $("priceOriginal").value,
    current: $("priceCurrent").value,
    link1: $("link1").value,
    link2: $("link2").value,
    hook: $("hookText").value,
    includeDisclosure: $("includeDisclosure").checked,
    style: $("bodyStyle").value,
  };

  const body = generateBodyByStyle(payload);
  $("threadBody").value = body;
  $("charCount").textContent = `${body.length.toLocaleString("ko-KR")}자`;
  $("previewText").textContent = body || "본문이 여기에 표시됩니다.";
}

async function copyBody() {
  const text = $("threadBody").value.trim();
  if (!text) {
    showToast("복사할 본문이 없습니다.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("본문을 복사했습니다.");
  } catch (error) {
    console.error(error);
    showToast("복사에 실패했습니다.");
  }
}

function resetAll() {
  releasePreviewUrls();
  state.files = [];
  state.ocrText = "";
  $("imageInput").value = "";
  $("link1").value = "";
  $("link2").value = "";
  $("hookText").value = "";
  $("productTitle").value = "";
  $("priceOriginal").value = "";
  $("priceCurrent").value = "";
  $("categoryHint").value = "";
  $("ocrRaw").value = "";
  $("threadBody").value = "";
  $("charCount").textContent = "0자";
  $("previewText").textContent = "";
  renderPreviews();
  setStatus("초기화되었습니다. 이미지를 다시 넣고 분석하세요.");
}

$("imageInput").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []).slice(0, MAX_FILES);
  state.files = files;
  renderPreviews();
  setStatus(files.length ? `${files.length}개 이미지가 업로드되었습니다.` : "이미지를 넣고 분석 버튼을 누르세요.");
});

["productTitle", "priceOriginal", "priceCurrent", "link1", "link2", "hookText", "bodyStyle"].forEach((id) => {
  $(id).addEventListener("input", buildThreadBody);
  $(id).addEventListener("change", buildThreadBody);
});
$("includeDisclosure").addEventListener("change", buildThreadBody);
$("analyzeBtn").addEventListener("click", analyzeImages);
$("refreshBodyBtn").addEventListener("click", buildThreadBody);
$("copyBodyBtn").addEventListener("click", copyBody);
$("resetBtn").addEventListener("click", resetAll);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

renderPreviews();
buildThreadBody();
