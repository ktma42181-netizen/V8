const $=id=>document.getElementById(id);

const DISCLOSURE="쿠팡 파트너스 활동으로 일정액의 수수료를 제공받습니다.";
const REQUEST_TIMEOUT=22000;

const FOOD_KEYWORDS=[
  "갈비","고기","한우","소고기","돼지고기","닭고기","오리고기","생선","수산물","해산물",
  "새우","과일","참외","수박","사과","배","포도","복숭아","채소","야채","김치","반찬",
  "라면","국수","우동","면","만두","볶음밥","국","탕","찌개","간편식","냉동식품",
  "참치","통조림","과자","오예스","쿠키","빵","떡","초콜릿","젤리","커피","차","음료",
  "생수","주스","우유","두유","치즈","요거트","계란","달걀","소스","양념","고추장",
  "된장","간장","식품"
];

const LIVING_KEYWORDS=[
  "세제","섬유유연제","화장지","휴지","물티슈","키친타월","청소포","수세미","세정제",
  "주방세제","욕실세정제","욕실청소","락스","탈취제","방향제","샴푸","린스",
  "트리트먼트","바디워시","비누","치약","칫솔","생리대","기저귀","마스크","면봉",
  "화장솜","수납","봉투","랩","호일","지퍼백","위생장갑","종이컵","생활용품","생필품",
  "리필","청소용"
];

const STOP_TOKENS=new Set([
  "쿠팡","coupang","로켓","배송","무료","상품","구매","판매","할인","정품",
  "1개","2개","3개","4개","5개","6개","세트","구성"
]);

const state={
  metadata:null,
  readerText:"",
  searchText:"",
  finalTitle:"",
  finalPrice:"",
  category:"",
  logs:[]
};

const clean=value=>String(value||"").replace(/\u00a0/g," ").trim().replace(/\s+/g," ");

function classify(name){
  const text=clean(name).toLowerCase();
  const food=FOOD_KEYWORDS.some(word=>text.includes(word.toLowerCase()));
  const living=LIVING_KEYWORDS.some(word=>text.includes(word.toLowerCase()));
  if(food&&!living)return"식품";
  if(living&&!food)return"생필품";
  if(food&&living)return"식품·생필품";
  return"일반 상품";
}

function normalize(text){
  return clean(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g," ")
    .replace(/[()[\]{}<>|/\\,_·:;'"!?%+*=~`@#$^&-]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function tokens(text){
  return normalize(text)
    .split(" ")
    .filter(token=>token.length>=2&&!STOP_TOKENS.has(token));
}

function tokenSimilarity(a,b){
  const ta=[...new Set(tokens(a))];
  const tb=new Set(tokens(b));
  if(!ta.length||!tb.size)return 0;
  const common=ta.filter(token=>tb.has(token)).length;
  return common/Math.max(2,Math.min(ta.length,tb.size));
}

function hasProductEvidence(text,product){
  if(!text)return false;
  const productTokens=tokens(product).filter(token=>!/\d/.test(token)||token.length>=3);
  if(!productTokens.length)return false;
  const normalized=normalize(text);
  const hits=productTokens.filter(token=>normalized.includes(token)).length;
  return hits>=Math.min(2,productTokens.length);
}

function cleanPageTitle(title){
  return clean(title)
    .replace(/\s*[-|:]\s*쿠팡!?[\s\S]*$/i,"")
    .replace(/\s*쿠팡!?\s*$/i,"")
    .replace(/\s*-\s*Coupang[\s\S]*$/i,"")
    .replace(/^쿠팡!\s*/i,"")
    .trim();
}

function isPlausibleTitle(candidate,input){
  const title=cleanPageTitle(candidate);
  if(title.length<4||title.length>180)return false;
  if(/^(쿠팡|coupang|로그인|장바구니|검색)/i.test(title))return false;
  return tokenSimilarity(title,input)>=0.34||hasProductEvidence(title,input);
}

function formatWon(raw){
  const digits=String(raw).replace(/[^\d]/g,"");
  if(!digits)return"";
  const number=Number(digits);
  if(!Number.isFinite(number)||number<100||number>100000000)return"";
  return number.toLocaleString("ko-KR")+"원";
}

function extractTitleFromReader(text,input){
  if(!text)return"";
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
  const titleLine=lines.find(line=>/^Title:\s*/i.test(line));
  if(titleLine){
    const candidate=cleanPageTitle(titleLine.replace(/^Title:\s*/i,""));
    if(isPlausibleTitle(candidate,input))return candidate;
  }

  let best={text:"",score:0};
  for(const line of lines.slice(0,220)){
    if(line.length<5||line.length>180)continue;
    if(/^(URL Source|Markdown Content|Published Time|Warning|쿠팡 홈|카테고리)/i.test(line))continue;
    let score=tokenSimilarity(line,input)*10;
    if(/\d+\s*(?:ml|mL|l|L|g|kg|개|팩|봉|캔|병|입)/.test(line))score+=2;
    if(/쿠팡|coupang/i.test(line))score-=1;
    if(score>best.score){
      best={text:cleanPageTitle(line.replace(/^#+\s*/,"")),score};
    }
  }
  return best.score>=4?best.text:"";
}

function extractTitleFromMetadata(metadata,input){
  const title=cleanPageTitle(metadata?.data?.title||"");
  return isPlausibleTitle(title,input)?title:"";
}

function configurationTokens(title){
  return [...clean(title).matchAll(
    /\d+(?:\.\d+)?\s*(?:kg|g|mg|ml|mL|L|l|개|팩|봉|캔|병|매|롤|박스|세트|입)/g
  )].map(match=>match[0].replace(/\s+/g,"").toLowerCase());
}

function isUnitPriceMatch(line,matchIndex){
  const before=line.slice(Math.max(0,matchIndex-18),matchIndex).toLowerCase();
  return /(?:100\s*(?:ml|g)|10\s*g|개|1개)\s*당\s*$/.test(before);
}

function extractPrice(text,title){
  if(!text)return"";
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
  const titleIndex=lines.findIndex(line=>hasProductEvidence(line,title));
  const configs=configurationTokens(title);
  const candidates=[];
  const priceRegex=/(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원/g;

  lines.forEach((line,index)=>{
    let match;
    while((match=priceRegex.exec(line))!==null){
      if(isUnitPriceMatch(line,match.index))continue;

      const price=formatWon(match[1]);
      if(!price)continue;
      const numeric=Number(price.replace(/[^\d]/g,""));
      if(numeric<500)continue;

      let score=0;
      const lower=line.toLowerCase();
      const compact=lower.replace(/\s+/g,"");

      if(/판매가|할인가|쿠폰가|구매가|최종가|와우회원가|현재가/.test(line))score+=7;
      if(/구매많음|선택|옵션|수량/.test(line))score+=2;
      if(/배송|로켓/.test(line))score+=1;
      if(configs.some(config=>compact.includes(config)))score+=5;

      const around=line.slice(
        Math.max(0,match.index-18),
        Math.min(line.length,match.index+match[0].length+18)
      );

      if(/정가|기존가|할인\s*전|원래|정상가/.test(around))score-=7;
      if(/~~[^~]*원[^~]*~~/.test(around)||line.includes(`~~${match[0]}~~`))score-=9;
      if(line.length>180)score-=1;

      candidates.push({price,numeric,line,index,score});
    }
  });

  candidates.forEach(candidate=>{
    if(titleIndex>=0){
      const distance=candidate.index-titleIndex;
      if(distance>=0&&distance<=8){
        candidate.score+=7-distance*.55;
      }else if(distance<0&&distance>=-2){
        candidate.score+=2;
      }
    }
  });

  candidates.sort((a,b)=>b.score-a.score||a.numeric-b.numeric);
  const best=candidates[0];
  if(!best||best.score<2)return"";

  state.logs.push(`가격 후보 선택: ${best.price} / 근거 문장: ${best.line}`);
  return best.price;
}

function buildBody(title,price,link){
  const lines=[title];
  if(price)lines.push(price);
  lines.push(link);
  lines.push(DISCLOSURE);
  return lines.join("\n");
}

function validate(){
  const product=clean($("productName").value);
  const link=clean($("partnerLink").value);

  if(!product){
    showToast("상품명을 입력하세요.");
    $("productName").focus();
    return false;
  }
  if(!link){
    showToast("쿠팡 파트너스 링크를 입력하세요.");
    $("partnerLink").focus();
    return false;
  }
  try{
    const url=new URL(link);
    if(!["http:","https:"].includes(url.protocol))throw new Error();
  }catch{
    showToast("http 또는 https로 시작하는 링크를 입력하세요.");
    $("partnerLink").focus();
    return false;
  }
  return true;
}

async function fetchWithTimeout(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
  try{
    const response=await fetch(url,{
      ...options,
      signal:controller.signal,
      cache:"no-store"
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response;
  }finally{
    clearTimeout(timer);
  }
}

async function fetchMicrolink(targetUrl){
  const endpoint=`https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}&meta=true&screenshot=false&video=false&audio=false`;
  const response=await fetchWithTimeout(endpoint,{headers:{"Accept":"application/json"}});
  const json=await response.json();
  if(json.status!=="success")throw new Error(json.message||"Microlink failed");
  return json;
}

async function fetchJinaReader(targetUrl){
  const endpoint=`https://r.jina.ai/${targetUrl}`;
  const response=await fetchWithTimeout(endpoint,{
    headers:{
      "Accept":"text/plain",
      "X-Return-Format":"markdown"
    }
  });
  return response.text();
}

async function fetchSearchPage(product){
  const query=encodeURIComponent(`${product} 쿠팡`);
  const searchUrls=[
    `https://search.naver.com/search.naver?query=${query}`,
    `https://www.bing.com/search?q=${query}`
  ];

  const results=[];
  for(const url of searchUrls){
    try{
      const text=await fetchJinaReader(url);
      if(text&&text.length>100){
        results.push(text);
        if(hasProductEvidence(text,product))break;
      }
    }catch(error){
      state.logs.push(`검색 페이지 확인 실패: ${error.message}`);
    }
  }
  return results.join("\n\n");
}

function setProgress(percent,message){
  $("progressPanel").classList.remove("hidden");
  $("progressBar").style.width=`${percent}%`;
  $("progressText").textContent=message;
}

function setStep(id,status,text){
  const element=$(id);
  element.classList.remove("done","fail");
  if(status)element.classList.add(status);
  element.textContent=text;
}

function resetVerificationView(){
  ["verifiedCategory","verifiedTitleStatus","verifiedSearchStatus","verifiedPriceStatus"]
    .forEach(id=>$(id).textContent="확인 중");
  $("verifiedTitle").value="";
  $("verifiedPrice").value="";
  $("verificationLog").textContent="웹 확인을 시작합니다.";
  $("threadBody").value="";
  $("bodyCount").textContent="0";
  $("resultNotice").classList.add("hidden");
  setStep("stepMetadata","", "링크 공개정보 확인 대기");
  setStep("stepReader","", "상품 페이지 확인 대기");
  setStep("stepSearch","", "상품명 웹검색 대기");
  setStep("stepGenerate","", "본문 작성 대기");
}

async function verifyAndGenerate(){
  if(!validate())return;

  const product=clean($("productName").value);
  const link=clean($("partnerLink").value);
  const button=$("verifyBtn");

  button.disabled=true;
  state.metadata=null;
  state.readerText="";
  state.searchText="";
  state.finalTitle="";
  state.finalPrice="";
  state.category=classify(product);
  state.logs=[];
  resetVerificationView();
  $("verifiedCategory").textContent=state.category;

  try{
    setProgress(8,"쿠팡 링크의 공개정보를 확인하고 있습니다.");
    try{
      state.metadata=await fetchMicrolink(link);
      setStep("stepMetadata","done","링크 공개정보 확인 완료");
      state.logs.push(`공개 메타 제목: ${state.metadata?.data?.title||"없음"}`);
    }catch(error){
      setStep("stepMetadata","fail","링크 공개정보 확인 실패");
      state.logs.push(`공개정보 오류: ${error.message}`);
    }

    setProgress(34,"상품 페이지의 공개 내용을 확인하고 있습니다.");
    try{
      state.readerText=await fetchJinaReader(link);
      if(state.readerText.length<80)throw new Error("페이지 내용이 너무 짧습니다.");
      setStep("stepReader","done","상품 페이지 공개 내용 확인 완료");
      state.logs.push(`페이지 텍스트 수신: ${state.readerText.length.toLocaleString()}자`);
    }catch(error){
      setStep("stepReader","fail","상품 페이지 확인 실패");
      state.logs.push(`페이지 확인 오류: ${error.message}`);
    }

    setProgress(62,"상품명으로 웹검색 결과를 대조하고 있습니다.");
    try{
      state.searchText=await fetchSearchPage(product);
      if(!state.searchText)throw new Error("검색 결과를 읽지 못했습니다.");
      const matched=hasProductEvidence(state.searchText,product);
      setStep(
        "stepSearch",
        matched?"done":"fail",
        matched?"상품명 웹검색 대조 완료":"검색 결과에서 충분한 일치정보를 찾지 못함"
      );
      state.logs.push(`검색 결과 일치: ${matched?"예":"아니오"}`);
    }catch(error){
      setStep("stepSearch","fail","상품명 웹검색 확인 실패");
      state.logs.push(`웹검색 오류: ${error.message}`);
    }

    setProgress(82,"확인된 정보를 비교하고 있습니다.");

    const metadataTitle=extractTitleFromMetadata(state.metadata,product);
    const readerTitle=extractTitleFromReader(state.readerText,product);

    if(readerTitle&&metadataTitle){
      state.finalTitle=
        tokenSimilarity(readerTitle,product)>=tokenSimilarity(metadataTitle,product)
          ?readerTitle
          :metadataTitle;
    }else{
      state.finalTitle=readerTitle||metadataTitle||product;
    }

    const directEvidence=
      hasProductEvidence(state.readerText,product)||
      Boolean(metadataTitle);

    const searchEvidence=hasProductEvidence(state.searchText,product);

    $("verifiedTitleStatus").textContent=
      directEvidence?"링크에서 확인":"입력 상품명 사용";
    $("verifiedSearchStatus").textContent=
      searchEvidence?"검색 결과 일치":"대조 불충분";

    state.finalPrice=extractPrice(state.readerText,state.finalTitle);
    $("verifiedPriceStatus").textContent=
      state.finalPrice?"직접 페이지에서 확인":"확인하지 못함";
    $("verifiedPrice").value=state.finalPrice;
    $("verifiedTitle").value=state.finalTitle;

    state.logs.push(`최종 상품명: ${state.finalTitle}`);
    state.logs.push(`최종 가격: ${state.finalPrice||"생략"}`);
    state.logs.push("가격은 직접 링크 페이지에서 확인된 경우에만 반영했습니다.");

    $("threadBody").value=buildBody(state.finalTitle,state.finalPrice,link);
    $("bodyCount").textContent=$("threadBody").value.length;

    const notice=$("resultNotice");
    notice.classList.remove("hidden");
    if(state.finalPrice){
      notice.textContent=
        "상품명과 가격을 공개 페이지에서 확인했습니다. 게시 직전 쿠팡 상세페이지의 선택 옵션과 가격을 한 번 더 확인하세요.";
    }else{
      notice.textContent=
        "현재 가격을 확실히 확인하지 못해 본문에서 가격을 생략했습니다. 임의 가격은 생성하지 않았습니다.";
    }

    setStep("stepGenerate","done","확인된 정보로 본문 작성 완료");
    setProgress(100,"본문 작성이 완료됐습니다.");
    $("verificationLog").textContent=state.logs.join("\n");
    saveDraft();
    showToast("웹 확인 후 본문을 만들었습니다.");
  }catch(error){
    state.logs.push(`전체 처리 오류: ${error.message}`);
    $("verificationLog").textContent=state.logs.join("\n");
    setProgress(100,"일부 웹 확인에 실패해 입력한 상품명으로 본문을 만들었습니다.");

    state.finalTitle=product;
    state.finalPrice="";
    $("verifiedTitle").value=product;
    $("verifiedTitleStatus").textContent="입력 상품명 사용";
    $("verifiedSearchStatus").textContent="확인 실패";
    $("verifiedPriceStatus").textContent="생략";
    $("threadBody").value=buildBody(product,"",link);
    $("bodyCount").textContent=$("threadBody").value.length;
    setStep("stepGenerate","done","가격 없이 안전하게 본문 작성 완료");

    const notice=$("resultNotice");
    notice.classList.remove("hidden");
    notice.textContent=
      "웹 확인이 완료되지 않아 입력한 상품명과 링크만 사용했습니다. 가격은 생성하지 않았습니다.";
    showToast("웹 확인이 제한되어 가격 없는 본문을 만들었습니다.");
  }finally{
    button.disabled=false;
  }
}

async function copyBody(){
  const text=$("threadBody").value.trim();
  if(!text){
    showToast("복사할 본문이 없습니다.");
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    $("threadBody").focus();
    $("threadBody").select();
    document.execCommand("copy");
  }
  const button=$("copyBtn");
  const old=button.textContent;
  button.textContent="복사됨";
  showToast("본문을 복사했습니다.");
  setTimeout(()=>button.textContent=old,1100);
}

function foodSample(){
  $("productName").value="해태제과 오예스 16+2 초코 파이 케이크 과자 540g 1개";
  $("partnerLink").value="https://link.coupang.com/a/example";
  saveDraft();
  showToast("식품 예시를 입력했습니다. 실제 링크로 교체하세요.");
}

function livingSample(){
  $("productName").value="유한락스 멀티액션 욕실청소용 세정제 510ml 3개";
  $("partnerLink").value="https://link.coupang.com/a/example";
  saveDraft();
  showToast("생필품 예시를 입력했습니다. 실제 링크로 교체하세요.");
}

function resetAll(){
  $("productName").value="";
  $("partnerLink").value="";
  $("threadBody").value="";
  $("verifiedTitle").value="";
  $("verifiedPrice").value="";
  $("bodyCount").textContent="0";
  $("verificationLog").textContent="아직 확인하지 않았습니다.";
  ["verifiedCategory","verifiedTitleStatus","verifiedSearchStatus","verifiedPriceStatus"]
    .forEach(id=>$(id).textContent="확인 전");
  $("progressPanel").classList.add("hidden");
  $("resultNotice").classList.add("hidden");
  localStorage.removeItem("threadsWebVerifyV8");
  showToast("초기화했습니다.");
}

function saveDraft(){
  localStorage.setItem("threadsWebVerifyV8",JSON.stringify({
    productName:$("productName").value,
    partnerLink:$("partnerLink").value,
    threadBody:$("threadBody").value,
    verifiedTitle:$("verifiedTitle").value,
    verifiedPrice:$("verifiedPrice").value
  }));
}

function restoreDraft(){
  try{
    const data=JSON.parse(localStorage.getItem("threadsWebVerifyV8")||"{}");
    $("productName").value=data.productName||"";
    $("partnerLink").value=data.partnerLink||"";
    $("threadBody").value=data.threadBody||"";
    $("verifiedTitle").value=data.verifiedTitle||"";
    $("verifiedPrice").value=data.verifiedPrice||"";
    $("bodyCount").textContent=$("threadBody").value.length;
  }catch{
    localStorage.removeItem("threadsWebVerifyV8");
  }
}

function showToast(message){
  const toast=$("toast");
  toast.textContent=message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove("show"),1800);
}

/* PWA */
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredPrompt=event;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  $("installBtn").classList.add("hidden");
});
if("serviceWorker"in navigator&&location.protocol!=="file:"){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

/* Events */
$("verifyBtn").addEventListener("click",verifyAndGenerate);
$("copyBtn").addEventListener("click",copyBody);
$("foodSampleBtn").addEventListener("click",foodSample);
$("livingSampleBtn").addEventListener("click",livingSample);
$("resetBtn").addEventListener("click",resetAll);
["productName","partnerLink","threadBody"].forEach(id=>{
  $(id).addEventListener("input",()=>{
    if(id==="threadBody")$("bodyCount").textContent=$(id).value.length;
    saveDraft();
  });
});

restoreDraft();
