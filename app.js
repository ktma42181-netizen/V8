const $=id=>document.getElementById(id);

const DISCLOSURE="쿠팡 파트너스 활동으로 일정액의 수수료를 제공받습니다.";
const MAX_FILES=3;
const REQUEST_TIMEOUT=22000;

const state={
  files:[],
  objectUrls:[],
  ocrText:"",
  ocrTitle:"",
  ocrPrice:"",
  category:"",
  metadata:null,
  readerText:"",
  searchText:"",
  webTitle:"",
  webPrice:"",
  titleConfirmed:false,
  confirmedTitle:"",
  logs:[]
};

const FOOD_KEYWORDS=[
  "갈비","고기","한우","소고기","돼지고기","닭고기","오리고기","생선","수산물","해산물",
  "새우","과일","참외","수박","사과","배","포도","복숭아","채소","야채","김치","반찬",
  "라면","국수","우동","면","만두","볶음밥","국","탕","찌개","간편식","냉동식품",
  "참치","통조림","과자","오예스","몽쉘","쿠키","빵","떡","초콜릿","젤리","커피","차",
  "음료","생수","삼다수","주스","우유","두유","치즈","요거트","계란","달걀","소스",
  "양념","고추장","된장","간장","식품"
];

const LIVING_KEYWORDS=[
  "세제","섬유유연제","화장지","휴지","물티슈","키친타월","청소포","수세미","세정제",
  "주방세제","욕실세정제","욕실청소","락스","탈취제","방향제","샴푸","린스",
  "트리트먼트","바디워시","핸드솝","비누","치약","칫솔","생리대","기저귀","마스크",
  "면봉","화장솜","수납","봉투","랩","호일","지퍼백","위생장갑","종이컵","생활용품",
  "생필품","리필","청소용"
];

const UI_NOISE_PATTERNS=[
  /쿠팡에서 검색/i,/상품상세/i,/장바구니/i,/바로구매/i,/배송비/i,/무료배송/i,
  /무료반품/i,/로켓프레시/i,/로켓배송/i,/도착/i,/브랜드샵/i,/원산지/i,
  /상품 상세설명/i,/구매많음/i,/모든 옵션 보기/i,/개당 중량/i,/수량/i,
  /한 달간/i,/구매했어요/i,/판매자/i,/할인/i,/쿠폰/i,/별점/i,/리뷰/i,
  /와우카드/i,/저렴하게 구매/i,/오늘\(.+\)/i,/내일\(.+\)/i,/검색하세요/i,
  /^\d+%$/,/^\(?\d+(?:,\d+)*\)?$/,/^\d+\s*명/
];

const TITLE_BLOCK_PATTERNS=[
  /BEST\s*AWARDS/i,
  /(?:국산\s*)?(?:생수|식품|생활용품|상품)\s*순위/i,
  /\bTOP\s*\d*\b/i,
  /추천\s*(?:순위|제품|상품)/i,
  /랭킹|베스트\s*\d+|비교\s*추천/i,
  /구매\s*후기|사용\s*후기|리뷰\s*모음/i,
  /검색\s*결과|관련\s*검색어/i
];

const STOP_TOKENS=new Set([
  "쿠팡","coupang","로켓","배송","무료","상품","구매","판매","할인","정품",
  "1개","2개","3개","4개","5개","6개","세트","구성"
]);

const clean=value=>String(value||"").replace(/\u00a0/g," ").trim().replace(/\s+/g," ");

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
  if(!text||!product)return false;
  const productTokens=tokens(product).filter(token=>!/\d/.test(token)||token.length>=3);
  if(!productTokens.length)return false;
  const normalized=normalize(text);
  const hits=productTokens.filter(token=>normalized.includes(token)).length;
  return hits>=Math.min(2,productTokens.length);
}

function classify(name){
  const text=clean(name).toLowerCase();
  const food=FOOD_KEYWORDS.some(word=>text.includes(word.toLowerCase()));
  const living=LIVING_KEYWORDS.some(word=>text.includes(word.toLowerCase()));
  if(food&&!living)return"식품";
  if(living&&!food)return"생필품";
  if(food&&living)return"식품·생필품";
  return"일반 상품";
}

function formatWon(raw){
  const digits=String(raw).replace(/[^\d]/g,"");
  if(!digits)return"";
  const number=Number(digits);
  if(!Number.isFinite(number)||number<100||number>100000000)return"";
  return number.toLocaleString("ko-KR")+"원";
}

function normalizeOcrText(text){
  return String(text||"")
    .replace(/[｜|]/g," ")
    .replace(/[，]/g,",")
    .replace(/[₩]/g,"")
    .replace(/(\d)\s*,\s*(\d{3})/g,"$1,$2")
    .replace(/(\d)\s*원/g,"$1원")
    .replace(/\r/g,"");
}

function linesFromText(text){
  return normalizeOcrText(text)
    .split("\n")
    .map(line=>clean(line.replace(/^[•·\-–—]+\s*/,"")))
    .filter(Boolean);
}

function isNoiseLine(line){
  const value=clean(line);
  if(value.length<2)return true;
  if(UI_NOISE_PATTERNS.some(pattern=>pattern.test(value)))return true;
  if(TITLE_BLOCK_PATTERNS.some(pattern=>pattern.test(value)))return true;
  if(/^[\d\s%,.()]+$/.test(value))return true;
  if(/^[★☆⭐\s]+$/.test(value))return true;
  if(/^https?:/i.test(value))return true;
  if(/[<>#]{2,}/.test(value))return true;
  if((value.match(/\b[A-Za-z]{1,2}\b/g)||[]).length>=4)return true;
  return false;
}

function isUnitPriceContext(line,index){
  const before=line.slice(Math.max(0,index-30),index).toLowerCase();
  const after=line.slice(index,index+38).toLowerCase();

  if(/(?:100\s*(?:ml|g)|10\s*g|1\s*(?:개|병|팩|봉)|개|병|팩|봉)\s*당\s*$/.test(before)){
    return true;
  }

  if(/(?:100\s*(?:ml|g)|10\s*g|1\s*(?:개|병|팩|봉)|개|병|팩|봉)\s*당/.test(before+after)){
    const wonBefore=(before.match(/\d[\d,]*\s*원/g)||[]).length;
    if(wonBefore>=1)return true;
  }

  return false;
}

function extractPriceCandidates(text){
  const lines=linesFromText(text);
  const candidates=[];
  const regex=/(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원/g;

  lines.forEach((line,lineIndex)=>{
    let match;
    while((match=regex.exec(line))!==null){
      if(isUnitPriceContext(line,match.index))continue;

      const price=formatWon(match[1]);
      const numeric=Number(price.replace(/[^\d]/g,""));
      if(!price||numeric<500)continue;

      let score=0;
      const around=line.slice(
        Math.max(0,match.index-24),
        Math.min(line.length,match.index+match[0].length+24)
      );

      if(/판매가|현재가|구매가|최종가|할인가/.test(around))score+=8;
      if(/\d+%/.test(line))score+=3;
      if(/구매많음|선택|인기/.test(line))score+=3;
      if(/정상가|기존가|할인\s*전|원래|정가/.test(around))score-=8;
      if(/취소선|~~/.test(line))score-=8;

      score+=Math.max(0,8-lineIndex*.18);
      candidates.push({price,numeric,line,lineIndex,score,matchIndex:match.index});
    }
  });

  candidates.sort((a,b)=>b.score-a.score||a.lineIndex-b.lineIndex||a.numeric-b.numeric);
  return candidates;
}

function findReferencePriceIndex(lines,price){
  if(!price)return-1;
  const digits=price.replace(/[^\d]/g,"");
  return lines.findIndex(line=>line.replace(/[^\d]/g,"").includes(digits));
}

function sanitizeProductTitle(raw){
  let title=clean(raw)
    .replace(/\(\s*\d{1,3}(?:,\d{3})+\s*\)/g," ")
    .replace(/\b(?:BEST\s*AWARDS|TOP\s*\d*)\b/gi," ")
    .replace(/[<>#|]+/g," ")
    .replace(/[“”‘’`´]/g," ")
    .replace(/\s*[,/]\s*/g,", ")
    .replace(/\s+/g," ")
    .trim();

  title=title.replace(
    /(?:\b[A-Za-z]{1,2}\b[\s,]*){4,}/g,
    " "
  );

  title=title
    .replace(/^\s*[-,:;]+\s*/,"")
    .replace(/\s*[-,:;]+\s*$/,"")
    .replace(/\s+/g," ")
    .trim();

  const parts=title.split(" ");
  if(parts.length>=2&&parts[0]===parts[1]){
    parts.shift();
    title=parts.join(" ");
  }

  return title;
}

function titleQuality(raw){
  const title=sanitizeProductTitle(raw);
  const hangulCount=(title.match(/[가-힣]/g)||[]).length;
  const letterCount=(title.match(/[가-힣A-Za-z]/g)||[]).length;
  const symbolCount=(title.match(/[<>#|{}[\]]/g)||[]).length;
  const shortLatinCount=(title.match(/\b[A-Za-z]{1,2}\b/g)||[]).length;
  const hasUnit=/\d+(?:\.\d+)?\s*(?:ml|mL|l|L|g|kg|mg|개|팩|봉|캔|병|매|롤|박스|세트|입)/.test(title);
  const blocked=TITLE_BLOCK_PATTERNS.some(pattern=>pattern.test(title));

  let score=0;
  if(title.length>=5&&title.length<=120)score+=2;
  if(hangulCount>=3)score+=3;
  if(letterCount>=5)score+=1;
  if(hasUnit)score+=5;
  if(FOOD_KEYWORDS.some(word=>title.includes(word)))score+=2;
  if(LIVING_KEYWORDS.some(word=>title.includes(word)))score+=2;
  if(blocked)score-=10;
  if(symbolCount>0)score-=7;
  if(shortLatinCount>=4)score-=7;
  if(hangulCount===0)score-=5;
  if(title.length>90&&!hasUnit)score-=3;

  return{
    title,
    score,
    hasUnit,
    blocked,
    valid:Boolean(
      title&&
      score>=4&&
      !blocked&&
      symbolCount===0&&
      hangulCount>=2&&
      shortLatinCount<4
    )
  };
}

function extractPackageCount(title){
  const matches=[
    ...clean(title).matchAll(
      /(\d+)\s*(?:개|팩|봉|캔|병|매|롤|박스|세트|입)/g
    )
  ];
  if(!matches.length)return 1;
  return Math.max(...matches.map(match=>Number(match[1])||1));
}

function isSuspiciousBundlePrice(title,price){
  const numeric=Number(String(price||"").replace(/[^\d]/g,""));
  if(!numeric)return false;

  const count=extractPackageCount(title);
  const category=classify(title);

  if(count>=10&&numeric<1500)return true;
  if(count>=6&&/(?:생수|물|음료|우유|두유)/.test(title)&&numeric<4000){
    return true;
  }
  if(count>=3&&category==="생필품"&&numeric<1000)return true;

  return false;
}

function chooseOcrPrice(candidates,title){
  const ordered=[...candidates].sort(
    (a,b)=>b.score-a.score||a.lineIndex-b.lineIndex
  );

  const safe=ordered.find(candidate=>
    !isSuspiciousBundlePrice(title,candidate.price)
  );

  return safe?.price||"";
}

function reconcileProductData(ocrTitle,ocrPrice,webTitle,webPrice){
  const ocr=titleQuality(ocrTitle);
  const web=titleQuality(webTitle);
  const similarity=ocr.title&&web.title
    ?tokenSimilarity(ocr.title,web.title)
    :0;

  let title="";
  let titleSource="none";

  if(ocr.valid&&web.valid){
    if(similarity>=.35){
      title=ocr.score+2>=web.score?ocr.title:web.title;
      titleSource=title===ocr.title?"ocr":"web";
    }else if(web.hasUnit&&web.score>=ocr.score+1){
      title=web.title;
      titleSource="web";
    }else if(ocr.hasUnit&&ocr.score>=web.score+2){
      title=ocr.title;
      titleSource="ocr";
    }
  }else if(ocr.valid){
    title=ocr.title;
    titleSource="ocr";
  }else if(web.valid){
    title=web.title;
    titleSource="web";
  }

  let imagePrice=formatWon(ocrPrice);
  let verifiedPrice=formatWon(webPrice);

  if(imagePrice&&isSuspiciousBundlePrice(title||ocr.title,imagePrice)){
    imagePrice="";
  }
  if(verifiedPrice&&isSuspiciousBundlePrice(title||web.title,verifiedPrice)){
    verifiedPrice="";
  }

  let price=imagePrice;
  let priceSource=imagePrice?"ocr":"none";

  const webMatchesTitle=Boolean(
    title&&web.valid&&tokenSimilarity(title,web.title)>=.35
  );

  if(!price&&verifiedPrice&&webMatchesTitle){
    price=verifiedPrice;
    priceSource="web";
  }else if(price&&verifiedPrice&&webMatchesTitle){
    const imageNumber=Number(price.replace(/[^\d]/g,""));
    const webNumber=Number(verifiedPrice.replace(/[^\d]/g,""));
    const ratio=imageNumber/webNumber;

    if(ratio<.62||ratio>1.62){
      price=verifiedPrice;
      priceSource="web";
    }
  }

  return{
    title,
    price,
    titleSource,
    priceSource,
    similarity,
    ocrQuality:ocr,
    webQuality:web
  };
}

function scoreTitleLine(line,distance){
  const quality=titleQuality(line);
  if(isNoiseLine(line)||!quality.title)return-100;

  let score=quality.score;
  if(quality.hasUnit)score+=4;
  if(/[,/]/.test(quality.title))score+=1;
  score+=Math.max(0,4-distance*.55);
  return score;
}

function extractTitleFromOcr(text,price){
  const lines=linesFromText(text);
  if(!lines.length)return"";

  let priceIndex=findReferencePriceIndex(lines,price);
  if(priceIndex<0){
    const firstPriceLine=lines.findIndex(line=>
      /\d{1,3}(?:,\d{3})+\s*원|\d{4,8}\s*원/.test(line)
    );
    priceIndex=firstPriceLine>=0?firstPriceLine:Math.min(lines.length,18);
  }

  const start=Math.max(0,priceIndex-12);
  const pool=lines.slice(start,priceIndex);
  const candidates=[];

  for(let end=pool.length-1;end>=0;end--){
    if(isNoiseLine(pool[end]))continue;

    for(let size=1;size<=2;size++){
      const begin=end-size+1;
      if(begin<0)continue;

      const group=pool.slice(begin,end+1);
      if(group.some(isNoiseLine))continue;

      const joined=sanitizeProductTitle(group.join(" "));
      const quality=titleQuality(joined);
      if(!quality.valid)continue;

      const distance=pool.length-1-end;
      let score=quality.score*2;

      if(quality.hasUnit)score+=7;
      score+=Math.max(0,5-distance*.7);

      candidates.push({
        title:quality.title,
        score,
        distance,
        hasUnit:quality.hasUnit
      });
    }
  }

  candidates.sort(
    (a,b)=>
      b.score-a.score||
      Number(b.hasUnit)-Number(a.hasUnit)||
      a.distance-b.distance||
      b.title.length-a.title.length
  );

  return candidates[0]?.title||"";
}

function parseOcrText(text){
  const priceCandidates=extractPriceCandidates(text);
  const provisionalPrice=priceCandidates[0]?.price||"";
  const title=extractTitleFromOcr(text,provisionalPrice);
  const price=chooseOcrPrice(priceCandidates,title);
  const quality=titleQuality(title);

  return{
    title:quality.valid?quality.title:"",
    price,
    category:classify(quality.title),
    titleQuality:quality,
    priceCandidates
  };
}

function cleanPageTitle(title){
  return clean(title)
    .replace(/\s*[-|:]\s*쿠팡!?[\s\S]*$/i,"")
    .replace(/\s*쿠팡!?\s*$/i,"")
    .replace(/\s*-\s*Coupang[\s\S]*$/i,"")
    .replace(/^쿠팡!\s*/i,"")
    .trim();
}

function isPlausibleTitle(candidate,reference){
  const quality=titleQuality(cleanPageTitle(candidate));
  if(!quality.valid)return false;

  const referenceQuality=titleQuality(reference);
  if(!referenceQuality.title)return quality.hasUnit;

  return(
    tokenSimilarity(quality.title,referenceQuality.title)>=.25||
    hasProductEvidence(quality.title,referenceQuality.title)
  );
}

function extractTitleFromReader(text,reference){
  if(!text)return"";
  const lines=linesFromText(text);
  const titleLine=lines.find(line=>/^Title:\s*/i.test(line));

  if(titleLine){
    const candidate=cleanPageTitle(titleLine.replace(/^Title:\s*/i,""));
    if(isPlausibleTitle(candidate,reference))return candidate;
  }

  let best={title:"",score:0};
  for(const line of lines.slice(0,220)){
    if(line.length<5||line.length>180||isNoiseLine(line))continue;
    let score=tokenSimilarity(line,reference)*10;
    if(/\d+(?:\.\d+)?\s*(?:ml|mL|l|L|g|kg|개|팩|봉|캔|병|입)/.test(line))score+=2;
    if(score>best.score)best={title:cleanPageTitle(line.replace(/^#+\s*/,"")),score};
  }
  return best.score>=3.5?best.title:"";
}

function extractMetadataTitle(metadata,reference){
  const candidate=cleanPageTitle(metadata?.data?.title||"");
  return isPlausibleTitle(candidate,reference)?candidate:"";
}

function extractWebPrice(text,title){
  if(!text)return"";
  const lines=linesFromText(text);
  const titleIndex=lines.findIndex(line=>hasProductEvidence(line,title));
  const candidates=extractPriceCandidates(text);

  candidates.forEach(candidate=>{
    if(titleIndex>=0){
      const distance=candidate.lineIndex-titleIndex;
      if(distance>=0&&distance<=8)candidate.score+=7-distance*.55;
      else if(distance<0&&distance>=-2)candidate.score+=2;
    }
  });

  candidates.sort((a,b)=>b.score-a.score||a.lineIndex-b.lineIndex);
  return candidates[0]&&candidates[0].score>=2?candidates[0].price:"";
}

function hasRequiredSpecification(title){
  return /\d+(?:\.\d+)?\s*(?:ml|mL|l|L|g|kg|mg|개|팩|봉|캔|병|매|롤|박스|세트|입|포)/.test(
    clean(title)
  );
}

function hasBrokenLatinFragments(title){
  const fragments=clean(title).match(/\b[A-Za-z]{1,3}\b/g)||[];
  return fragments.length>=2;
}

function confirmationTitleQuality(raw){
  const quality=titleQuality(raw);
  const hasSpec=hasRequiredSpecification(quality.title);
  const brokenLatin=hasBrokenLatinFragments(quality.title);

  return{
    ...quality,
    hasSpec,
    brokenLatin,
    confirmable:Boolean(
      quality.valid&&
      hasSpec&&
      !brokenLatin
    )
  };
}

function updateConfirmationUi(){
  const box=$("titleConfirmationBox");
  const status=$("titleConfirmStatus");
  const confirmButton=$("confirmTitleBtn");

  box.classList.toggle("confirmed",state.titleConfirmed);

  if(state.titleConfirmed){
    status.textContent="상품명·규격 확정 완료";
    confirmButton.textContent="확정 완료";
    confirmButton.disabled=false;
  }else{
    status.textContent="상품명·규격 확인 후 확정 필요";
    confirmButton.textContent="이 상품명으로 확정";
    confirmButton.disabled=!clean($("recognizedTitle").value);
  }

  $("useWebTitleBtn").disabled=!clean($("webTitle").value);
}

function invalidateTitleConfirmation(message="상품명이 변경되어 다시 확인해야 합니다."){
  state.titleConfirmed=false;
  state.confirmedTitle="";
  $("threadBody").value="";
  $("bodyCount").textContent="0";
  updateConfirmationUi();

  if($("progressPanel")&&!$("progressPanel").classList.contains("hidden")){
    setStep("stepBody","","상품명·규격 확정 대기");
  }

  if(message){
    const notice=$("resultNotice");
    notice.classList.remove("hidden");
    notice.textContent=message;
  }

  saveDraft();
}

function useWebTitle(){
  const webTitle=clean($("webTitle").value);
  if(!webTitle){
    showToast("링크에서 확인된 상품명이 없습니다.");
    return;
  }

  $("recognizedTitle").value=webTitle;
  $("recognizedCategory").value=classify(webTitle);
  invalidateTitleConfirmation("링크에서 확인된 상품명을 넣었습니다. 용량·수량을 확인한 뒤 확정하세요.");
  $("recognizedTitle").focus();
}

function confirmProductTitle(){
  const checked=confirmationTitleQuality($("recognizedTitle").value);

  if(!checked.title){
    showToast("상품명을 입력하거나 수정하세요.");
    $("recognizedTitle").focus();
    return;
  }

  if(checked.blocked||!checked.valid){
    showToast("순위·리뷰 문구 또는 깨진 상품명이 포함되어 있습니다.");
    $("recognizedTitle").focus();
    return;
  }

  if(checked.brokenLatin){
    showToast("깨진 영문 조각이 보입니다. 상품명을 수정한 뒤 다시 확정하세요.");
    $("recognizedTitle").focus();
    return;
  }

  if(!checked.hasSpec){
    showToast("용량·중량·수량을 상품명에 포함해 주세요. 예: 120g, 5개");
    $("recognizedTitle").focus();
    return;
  }

  $("recognizedTitle").value=checked.title;
  $("recognizedCategory").value=classify(checked.title);
  state.titleConfirmed=true;
  state.confirmedTitle=checked.title;
  updateConfirmationUi();
  refreshBody();

  setStep("stepBody","done","확정된 상품명으로 Threads 본문 작성 완료");

  const notice=$("resultNotice");
  notice.classList.remove("hidden");
  notice.textContent=
    "상품명·규격이 확정되어 본문을 생성했습니다. 게시 전 가격과 링크를 마지막으로 확인하세요.";

  showToast("상품명·규격을 확정했습니다.");
  saveDraft();
}

function buildBody(){
  if(!state.titleConfirmed)return"";

  const quality=confirmationTitleQuality(state.confirmedTitle);
  const link=clean($("partnerLink").value);

  if(!quality.confirmable||!link)return"";

  let price=formatWon($("recognizedPrice").value);
  if(price&&isSuspiciousBundlePrice(quality.title,price)){
    price="";
  }

  const lines=[state.confirmedTitle];
  if(price)lines.push(price);
  lines.push(link);

  if($("includeDisclosure").checked){
    lines.push(DISCLOSURE);
  }

  return lines.join("\n");
}

function refreshBody(){
  $("threadBody").value=buildBody();
  $("bodyCount").textContent=$("threadBody").value.length;
  saveDraft();
}

function validate(){
  if(!state.files.length){
    showToast("쿠팡 캡처 이미지를 선택하세요.");
    return false;
  }

  const link=clean($("partnerLink").value);
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

function setProgress(percent,message){
  $("progressPanel").classList.remove("hidden");
  $("progressBar").style.width=`${Math.max(0,Math.min(100,percent))}%`;
  $("progressText").textContent=message;
}

function setStep(id,status,text){
  const element=$(id);
  element.classList.remove("done","fail");
  if(status)element.classList.add(status);
  element.textContent=text;
}

function resetSteps(){
  setStep("stepImage","","캡처 이미지 확인 대기");
  setStep("stepOcr","","한글 OCR 대기");
  setStep("stepLink","","쿠팡 링크 공개정보 확인 대기");
  setStep("stepSearch","","웹검색 대조 대기");
  setStep("stepBody","","본문 작성 대기");
}

async function fileToImage(file){
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.decoding="async";
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=reject;
      image.src=url;
    });
    return image;
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function preprocessImage(file){
  const image=await fileToImage(file);
  const targetWidth=Math.min(1800,Math.max(image.naturalWidth,1300));
  const scale=Math.min(2.4,targetWidth/image.naturalWidth);
  const width=Math.round(image.naturalWidth*scale);
  const height=Math.round(image.naturalHeight*scale);

  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  context.drawImage(image,0,0,width,height);

  const imageData=context.getImageData(0,0,width,height);
  const data=imageData.data;

  for(let index=0;index<data.length;index+=4){
    const gray=.299*data[index]+.587*data[index+1]+.114*data[index+2];
    const contrast=Math.max(0,Math.min(255,(gray-128)*1.28+128));
    data[index]=contrast;
    data[index+1]=contrast;
    data[index+2]=contrast;
  }

  context.putImageData(imageData,0,0);
  return canvas;
}

async function runOcr(files){
  if(!window.Tesseract)throw new Error("OCR 라이브러리를 불러오지 못했습니다.");

  let currentFile=0;
  const worker=await Tesseract.createWorker("kor+eng",1,{
    logger:message=>{
      if(message.status==="recognizing text"){
        const progress=message.progress||0;
        const overall=(currentFile+progress)/files.length;
        setProgress(
          12+overall*43,
          `한글 OCR 중 ${currentFile+1}/${files.length} · ${Math.round(progress*100)}%`
        );
      }else if(message.status){
        setProgress(
          12+(currentFile/files.length)*43,
          `OCR 준비: ${message.status}`
        );
      }
    }
  });

  const texts=[];
  try{
    for(currentFile=0;currentFile<files.length;currentFile++){
      const canvas=await preprocessImage(files[currentFile]);
      const result=await worker.recognize(canvas,{},{
        text:true,
        blocks:false,
        hocr:false,
        tsv:false
      });
      texts.push(result.data.text||"");
    }
  }finally{
    await worker.terminate();
  }

  return texts.join("\n\n===== 다음 캡처 =====\n\n");
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

async function fetchSearch(reference){
  const query=encodeURIComponent(`${reference} 쿠팡`);
  const endpoints=[
    `https://s.jina.ai/${query}`,
    `https://r.jina.ai/https://www.bing.com/search?q=${query}`
  ];

  const results=[];
  for(const endpoint of endpoints){
    try{
      const response=await fetchWithTimeout(endpoint,{
        headers:{"Accept":"text/plain"}
      });
      const text=await response.text();
      if(text&&text.length>100){
        results.push(text);
        if(hasProductEvidence(text,reference))break;
      }
    }catch(error){
      state.logs.push(`웹검색 확인 실패: ${error.message}`);
    }
  }
  return results.join("\n\n");
}

async function analyze(){
  if(!validate())return;

  const button=$("analyzeBtn");
  button.disabled=true;
  resetSteps();
  setProgress(3,"캡처 이미지를 확인하고 있습니다.");

  state.logs=[];
  state.metadata=null;
  state.readerText="";
  state.searchText="";
  state.webTitle="";
  state.webPrice="";
  state.titleConfirmed=false;
  state.confirmedTitle="";
  updateConfirmationUi();

  ["linkTitleStatus","titleMatchStatus","searchStatus","priceMatchStatus"]
    .forEach(id=>$(id).textContent="확인 중");
  $("webTitle").value="";
  $("webPrice").value="";
  $("verificationLog").textContent="분석을 시작합니다.";
  $("resultNotice").classList.add("hidden");

  try{
    setStep("stepImage","done",`${state.files.length}장 캡처 이미지 확인 완료`);

    setProgress(10,"한글 OCR을 준비하고 있습니다.");
    try{
      state.ocrText=await runOcr(state.files);
      $("ocrRawText").value=state.ocrText;
      const parsed=parseOcrText(state.ocrText);

      state.ocrTitle=parsed.title;
      state.ocrPrice=parsed.price;
      state.category=parsed.category;

      $("recognizedTitle").value=state.ocrTitle;
      $("recognizedPrice").value=state.ocrPrice;
      $("recognizedCategory").value=state.category;
      invalidateTitleConfirmation("자동 인식된 상품명 후보입니다. 링크 확인이 끝난 뒤 직접 확인하고 확정하세요.");

      state.logs.push(`OCR 상품명: ${state.ocrTitle||"인식 실패"}`);
      state.logs.push(`OCR 가격: ${state.ocrPrice||"인식 실패"}`);
      if(parsed.priceCandidates.length){
        state.logs.push(
          "OCR 가격 후보: "+
          parsed.priceCandidates.slice(0,4).map(item=>`${item.price} [${item.line}]`).join(" / ")
        );
      }

      if(!state.ocrTitle){
        throw new Error("상품명을 자동 추출하지 못했습니다.");
      }
      setStep("stepOcr","done","한글 OCR 및 상품정보 추출 완료");
    }catch(error){
      setStep("stepOcr","fail","OCR 자동 추출 일부 실패");
      state.logs.push(`OCR 오류: ${error.message}`);
      showToast("OCR 결과를 확인하고 상품명을 직접 수정할 수 있습니다.");
    }

    const link=clean($("partnerLink").value);
    const reference=clean($("recognizedTitle").value)||state.ocrTitle;

    setProgress(59,"쿠팡 링크의 공개정보를 확인하고 있습니다.");
    try{
      state.metadata=await fetchMicrolink(link);
      state.readerText=await fetchJinaReader(link);

      const metadataTitle=extractMetadataTitle(state.metadata,reference);
      const readerTitle=extractTitleFromReader(state.readerText,reference);

      if(metadataTitle&&readerTitle){
        state.webTitle=
          tokenSimilarity(readerTitle,reference)>=tokenSimilarity(metadataTitle,reference)
            ?readerTitle
            :metadataTitle;
      }else{
        state.webTitle=readerTitle||metadataTitle||"";
      }

      state.webPrice=extractWebPrice(state.readerText,state.webTitle||reference);
      $("webTitle").value=state.webTitle;
      $("webPrice").value=state.webPrice;
      updateConfirmationUi();

      $("linkTitleStatus").textContent=
        state.webTitle?"링크에서 확인":"확인하지 못함";

      state.logs.push(`링크 상품명: ${state.webTitle||"확인 실패"}`);
      state.logs.push(`링크 가격: ${state.webPrice||"확인 실패"}`);
      setStep("stepLink","done","쿠팡 링크 공개정보 확인 완료");
    }catch(error){
      $("linkTitleStatus").textContent="확인 실패";
      setStep("stepLink","fail","쿠팡 링크 공개정보 확인 실패");
      state.logs.push(`링크 확인 오류: ${error.message}`);
    }

    setProgress(78,"상품명으로 웹검색 결과를 대조하고 있습니다.");
    try{
      state.searchText=await fetchSearch(reference);
      const searchMatch=hasProductEvidence(state.searchText,reference);
      $("searchStatus").textContent=searchMatch?"검색 결과 일치":"대조 불충분";
      setStep(
        "stepSearch",
        searchMatch?"done":"fail",
        searchMatch?"상품명 웹검색 대조 완료":"웹검색에서 충분한 일치정보를 찾지 못함"
      );
      state.logs.push(`웹검색 일치: ${searchMatch?"예":"아니오"}`);
    }catch(error){
      $("searchStatus").textContent="확인 실패";
      setStep("stepSearch","fail","웹검색 확인 실패");
      state.logs.push(`웹검색 오류: ${error.message}`);
    }

    const originalOcrTitle=clean($("recognizedTitle").value);
    const originalOcrPrice=formatWon($("recognizedPrice").value);

    const reconciled=reconcileProductData(
      originalOcrTitle,
      originalOcrPrice,
      state.webTitle,
      state.webPrice
    );

    $("recognizedTitle").value=reconciled.title;
    $("recognizedPrice").value=reconciled.price;
    $("recognizedCategory").value=classify(reconciled.title);

    $("titleMatchStatus").textContent=
      !reconciled.title?"자동 확정 실패":
      reconciled.titleSource==="web"?"링크 정보로 자동 보정":
      reconciled.similarity>=.48?"이미지·링크 일치":
      state.webTitle?"이미지 우선·확인 필요":
      "이미지 정보 사용";

    $("priceMatchStatus").textContent=
      !reconciled.price?"가격 자동 제외":
      reconciled.priceSource==="web"?"링크 가격으로 자동 보정":
      state.webPrice&&reconciled.price===state.webPrice?"이미지·링크 일치":
      state.webPrice?"이미지 가격 우선":
      "이미지 가격 사용";

    state.logs.push(
      `상품명 후보 선택: ${reconciled.title||"차단"} / 출처: ${reconciled.titleSource}`
    );
    state.logs.push(
      `가격 후보 선택: ${reconciled.price||"생략"} / 출처: ${reconciled.priceSource}`
    );

    state.titleConfirmed=false;
    state.confirmedTitle="";
    $("threadBody").value="";
    $("bodyCount").textContent="0";
    updateConfirmationUi();

    setStep("stepBody","","상품명·규격 확정 대기");
    setProgress(100,"분석 완료 — 상품명·규격을 확인하고 확정하세요.");

    const notice=$("resultNotice");
    notice.classList.remove("hidden");

    const candidateCheck=confirmationTitleQuality($("recognizedTitle").value);

    if(!candidateCheck.valid||candidateCheck.brokenLatin){
      notice.textContent=
        "자동 인식 상품명에 오류 가능성이 있습니다. 상품명·용량·수량을 직접 수정한 뒤 `이 상품명으로 확정`을 누르세요.";
    }else if(!candidateCheck.hasSpec){
      notice.textContent=
        "상품명 후보에 용량·중량·수량이 없습니다. 쿠팡 캡처와 비교해 규격을 추가한 뒤 확정하세요.";
    }else{
      notice.textContent=
        "상품명 후보를 캡처 화면과 비교하세요. 정확하면 `이 상품명으로 확정`을 눌러 본문을 생성하세요.";
    }

    state.logs.push(`확정 대기 상품명 후보: ${clean($("recognizedTitle").value)}`);
    state.logs.push(`확정 대기 가격 후보: ${formatWon($("recognizedPrice").value)||"생략"}`);
    $("verificationLog").textContent=state.logs.join("\n");
    saveDraft();
    showToast("분석이 완료됐습니다. 상품명을 확인하고 확정하세요.");
  }finally{
    button.disabled=false;
  }
}

function reparseRawText(){
  const raw=$("ocrRawText").value;
  if(!clean(raw)){
    showToast("다시 분석할 OCR 원문이 없습니다.");
    return;
  }

  const parsed=parseOcrText(raw);
  if(parsed.title)$("recognizedTitle").value=parsed.title;
  if(parsed.price)$("recognizedPrice").value=parsed.price;
  $("recognizedCategory").value=classify($("recognizedTitle").value);
  invalidateTitleConfirmation("OCR 원문을 다시 분석했습니다. 상품명·규격을 확인하고 다시 확정하세요.");
  showToast("다시 분석했습니다. 상품명을 확인하고 확정하세요.");
}

function renderPreviews(){
  state.objectUrls.forEach(url=>URL.revokeObjectURL(url));
  state.objectUrls=[];
  const grid=$("previewGrid");
  grid.innerHTML="";

  state.files.forEach((file,index)=>{
    const url=URL.createObjectURL(file);
    state.objectUrls.push(url);

    const item=document.createElement("div");
    item.className="preview-item";

    const image=document.createElement("img");
    image.src=url;
    image.alt=`쿠팡 캡처 ${index+1}`;

    const remove=document.createElement("button");
    remove.type="button";
    remove.textContent="×";
    remove.setAttribute("aria-label",`${index+1}번째 이미지 삭제`);
    remove.addEventListener("click",()=>{
      state.files.splice(index,1);
      invalidateTitleConfirmation("캡처 이미지가 변경되었습니다. 다시 분석하고 상품명을 확정하세요.");
      renderPreviews();
    });

    item.append(image,remove);
    grid.append(item);
  });

  grid.classList.toggle("hidden",!state.files.length);
}

function handleFiles(event){
  const selected=[...event.target.files].filter(file=>file.type.startsWith("image/"));
  if(!selected.length)return;

  state.files=selected.slice(0,MAX_FILES);
  invalidateTitleConfirmation("캡처 이미지가 변경되었습니다. 다시 분석하고 상품명을 확정하세요.");
  if(selected.length>MAX_FILES){
    showToast("캡처 이미지는 최대 3장까지 사용할 수 있습니다.");
  }
  renderPreviews();
  event.target.value="";
}

async function copyBody(){
  if(!state.titleConfirmed){
    showToast("먼저 상품명·규격을 확인하고 확정하세요.");
    return;
  }

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

function resetAll(){
  state.objectUrls.forEach(url=>URL.revokeObjectURL(url));
  state.files=[];
  state.objectUrls=[];
  state.ocrText="";
  state.ocrTitle="";
  state.ocrPrice="";
  state.webTitle="";
  state.webPrice="";
  state.titleConfirmed=false;
  state.confirmedTitle="";
  state.logs=[];

  $("previewGrid").innerHTML="";
  $("previewGrid").classList.add("hidden");
  [
    "partnerLink","recognizedTitle","recognizedPrice","recognizedCategory",
    "ocrRawText","webTitle","webPrice","threadBody"
  ].forEach(id=>$(id).value="");

  ["linkTitleStatus","titleMatchStatus","searchStatus","priceMatchStatus"]
    .forEach(id=>$(id).textContent="확인 전");

  $("verificationLog").textContent="아직 확인하지 않았습니다.";
  $("bodyCount").textContent="0";
  $("progressPanel").classList.add("hidden");
  $("resultNotice").classList.add("hidden");
  $("includeDisclosure").checked=true;
  updateConfirmationUi();
  localStorage.removeItem("threadsCaptureV9");
  showToast("초기화했습니다.");
}

function saveDraft(){
  localStorage.setItem("threadsCaptureV9",JSON.stringify({
    partnerLink:$("partnerLink").value,
    recognizedTitle:$("recognizedTitle").value,
    recognizedPrice:$("recognizedPrice").value,
    recognizedCategory:$("recognizedCategory").value,
    ocrRawText:$("ocrRawText").value,
    webTitle:$("webTitle").value,
    webPrice:$("webPrice").value,
    threadBody:$("threadBody").value,
    includeDisclosure:$("includeDisclosure").checked,
    titleConfirmed:false
  }));
}

function restoreDraft(){
  try{
    const data=JSON.parse(localStorage.getItem("threadsCaptureV9")||"{}");
    [
      "partnerLink","recognizedTitle","recognizedPrice","recognizedCategory",
      "ocrRawText","webTitle","webPrice","threadBody"
    ].forEach(id=>{
      if(data[id]!==undefined)$(id).value=data[id];
    });
    $("includeDisclosure").checked=data.includeDisclosure!==false;
    state.titleConfirmed=false;
    state.confirmedTitle="";
    $("threadBody").value="";
    $("bodyCount").textContent="0";
    updateConfirmationUi();
  }catch{
    localStorage.removeItem("threadsCaptureV9");
  }
}

function showToast(message){
  const toast=$("toast");
  toast.textContent=message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove("show"),1900);
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
$("captureFiles").addEventListener("change",handleFiles);
$("analyzeBtn").addEventListener("click",analyze);
$("reparseBtn").addEventListener("click",reparseRawText);
$("copyBtn").addEventListener("click",copyBody);
$("resetBtn").addEventListener("click",resetAll);

["partnerLink","recognizedTitle","recognizedPrice","ocrRawText","threadBody"].forEach(id=>{
  $(id).addEventListener("input",()=>{
    if(id==="recognizedTitle"){
      $("recognizedCategory").value=classify($(id).value);
      invalidateTitleConfirmation("상품명이 수정되었습니다. 정확한지 확인한 뒤 다시 확정하세요.");
    }else if(id==="recognizedPrice"){
      if(state.titleConfirmed)refreshBody();
      else saveDraft();
    }else if(id==="partnerLink"){
      invalidateTitleConfirmation("쿠팡 링크가 변경되었습니다. 다시 분석하고 상품명을 확정하세요.");
    }else if(id==="threadBody"){
      $("bodyCount").textContent=$(id).value.length;
      saveDraft();
    }else{
      saveDraft();
    }
  });
});

$("confirmTitleBtn").addEventListener("click",confirmProductTitle);
$("useWebTitleBtn").addEventListener("click",useWebTitle);
$("includeDisclosure").addEventListener("change",()=>{
  if(state.titleConfirmed)refreshBody();
  else saveDraft();
});

restoreDraft();
updateConfirmationUi();
