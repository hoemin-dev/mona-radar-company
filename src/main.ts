import "./styles.css";
import "./search.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CollectorStatus } from "./shared/types";

type View = "collector" | "search" | "dash" | "analysis";
interface CompanyRow {
  companyId: string; sminfoKcd: string; businessNumber?: string; companyName: string;
  representativeName?: string; companyType?: string; companyStatus?: string; establishedDate?: string;
  address?: string; roadAddress?: string; homepageUrl?: string; mainProducts?: string;
  ksicCode?: string; industryName?: string; fiscalYear?: number; totalAssetsKrwMillion?: number;
  revenueKrwMillion?: number; operatingIncomeKrwMillion?: number; netIncomeKrwMillion?: number;
  disclosureStatus?: "DISCLOSURE_DENIED"; disclosureConfirmedAt?: string;
}
interface SearchResponse { rows: CompanyRow[]; total: number; page: number; totalPages: number; }
interface CredentialStatus { saved: boolean; username?: string; credentialStatus?:string; }
interface TargetOption { targetId: string; name: string; }
interface IndustryCodeOption { industryCode:string; industryName:string; classificationLevel?:string; }
interface IndustryMasterStatus { count:number; lastRefreshedAt?:string; status:string; }
interface CompanyFullDetail { company: CompanyRow & { lastCollectedAt?:string; sourceUpdatedAt?:string }; financialStatements:Array<Record<string,unknown>>; businessSites:Array<Record<string,unknown>>; histories:Array<Record<string,unknown>>; executives:Array<Record<string,unknown>>; certifications:Array<Record<string,unknown>>; designations:Array<Record<string,unknown>>; }

const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "collector";
let status: CollectorStatus = "IDLE";
let collectorStatusMessage = "";
let currentCompany = "수집 대기";
let lastCollectedCompany = "—";
let countdown = "—";
let logs: string[] = [];
let searchQuery = "";
let searchData: SearchResponse = { rows: [], total: 0, page: 1, totalPages: 1 };
let searchError = "";
let searchTimer: number | undefined;
let searchSequence = 0;
let credential: CredentialStatus = { saved: false };
let loggedIn = false;
let sessionStatus:"LOGGED_IN"|"LOGGED_OUT"|"EXPIRED"|"REAUTHENTICATING"|"LOGIN_FAILED"|"UNKNOWN"="UNKNOWN";
let editingCredential = false;
let collectorTarget = "액체 펌프 제조업";
let selectedIndustry:IndustryCodeOption|undefined;
let industryOptions:IndustryCodeOption[]=[];
let industryStatus:IndustryMasterStatus={count:0,status:"IDLE"};
let industryRefreshRunning=false;
let industrySearchTimer:number|undefined;
let industrySearchSequence=0;
let targetOptions: TargetOption[] = [];
let searchTargetId = "";
let selectedCompany: CompanyFullDetail | undefined;
type FinancialUnit = "million" | "eok";
let financialUnit: FinancialUnit = "million";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
const amount = (value?: number) => value === undefined || value === null ? "—" : `${value.toLocaleString()}백만원`;
const financialKeys = new Set(["totalAssets", "paidInCapital", "totalEquity", "revenue", "operatingIncome", "netIncome"]);
const formatFinancialAmount = (value: unknown) => {
  if (value === null || value === undefined) return "—";
  if (value === "") return "";
  const numeric = typeof value === "number" ? value : Number(String(value).replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return String(value);
  return financialUnit === "million"
    ? numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : (numeric / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const normalizeHomepageUrl = (value?: string) => {
  const homepage = value?.trim();
  if (!homepage) return undefined;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(homepage) && !/^https?:\/\//i.test(homepage)) return undefined;
  const candidate = /^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`;
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const homepageLink = (value?: string) => {
  const url = normalizeHomepageUrl(value);
  return url ? `<a class="homepage" href="${escapeHtml(url)}" data-homepage-url="${escapeHtml(url)}" title="홈페이지" rel="noreferrer">${escapeHtml(value!.trim())}</a>` : "";
};
const openHomepage = async (value?: string) => {
  const url = normalizeHomepageUrl(value);
  if (!url) {
    console.error("홈페이지 URL이 유효하지 않습니다.", value);
    return;
  }
  try {
    await openUrl(url);
  } catch (error) {
    console.error(`기본 브라우저로 홈페이지를 열지 못했습니다: ${url}`, error);
  }
};

async function copyLogs(){
  const text=logs.join("\r\n");
  if(!text)return;
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const area=document.createElement("textarea");
    area.value=text;
    area.setAttribute("readonly","");
    area.style.position="fixed";
    area.style.opacity="0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const button=document.querySelector<HTMLButtonElement>("[data-action=copy_logs]");
  if(button){button.textContent="복사됨";window.setTimeout(()=>{if(button.isConnected)button.textContent="전체 복사";},1200);}
}

function setupWindowChrome() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const appWindow = getCurrentWindow();
  const titlebar = document.querySelector<HTMLElement>("#window-titlebar");
  const minimize = document.querySelector<HTMLButtonElement>("#window-minimize");
  const maximize = document.querySelector<HTMLButtonElement>("#window-maximize");
  const maximizeIcon = document.querySelector<HTMLElement>("#window-maximize-icon");
  const close = document.querySelector<HTMLButtonElement>("#window-close");
  if (!titlebar || !minimize || !maximize || !maximizeIcon || !close) return;

  const updateMaximizeState = async () => {
    const isMaximized = await appWindow.isMaximized();
    maximizeIcon.classList.toggle("is-restore", isMaximized);
    maximize.ariaLabel = isMaximized ? "복원" : "최대화";
  };
  minimize.addEventListener("click", () => void appWindow.minimize());
  maximize.addEventListener("click", () => void appWindow.toggleMaximize().then(updateMaximizeState));
  close.addEventListener("click", () => void appWindow.close());
  titlebar.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".window-controls")) return;
    void appWindow.toggleMaximize().then(updateMaximizeState);
  });
  void updateMaximizeState();
  void appWindow.onResized(() => void updateMaximizeState());
}

const accountPanel = () => credential.saved && !editingCredential ? `
  <div class="account-panel"><div><b>SMINFO Account</b><span>ID: <strong>${escapeHtml(credential.username ?? "")}</strong></span><span>Password: <strong class="good">● Windows에 저장됨</strong></span><span>저장 계정: <strong class="good">● 저장됨</strong></span><span>로그인 상태: <strong class="${loggedIn ? "good" : sessionStatus==="LOGIN_FAILED" ? "error" : "muted"}">${sessionStatus==="LOGGED_IN"?"● 로그인됨":sessionStatus==="EXPIRED"?"○ 세션 만료":sessionStatus==="REAUTHENTICATING"?"○ 자동 재로그인 중…":sessionStatus==="LOGIN_FAILED"?"! 로그인 실패":"○ 로그인되지 않음"}</strong></span></div><div class="account-actions"><button data-action="edit_account">계정 변경</button><button data-action="delete_account">저장정보 삭제</button></div></div>` : `
  <div class="account-panel account-form"><div><b>SMINFO Account</b><span>저장된 비밀번호는 보안상 다시 표시하지 않습니다. 계정 변경 시 새 비밀번호를 입력하세요.</span></div><label>ID<input id="sminfo-id" autocomplete="username" value="${escapeHtml(credential.username ?? "")}"></label><label>Password<input id="sminfo-password" type="password" autocomplete="current-password"></label><div class="account-actions"><button class="primary" data-action="save_account">계정 저장</button>${credential.saved ? '<button data-action="cancel_account">취소</button>' : ""}</div></div>`;

const industryOptionsHtml=()=>industryOptions.length?`<div class="industry-options">${industryOptions.map(item=>`<button type="button" data-industry-code="${escapeHtml(item.industryCode)}"><b>${escapeHtml(item.industryName)}</b><span>${escapeHtml(item.industryCode)}${item.classificationLevel?` · ${escapeHtml(item.classificationLevel)}`:""}</span></button>`).join("")}</div>`:"";
const industrySelectionHtml=()=>selectedIndustry?`<small class="selected-industry">선택됨: ${escapeHtml(selectedIndustry.industryName)} (${escapeHtml(selectedIndustry.industryCode)})</small>`:industryStatus.count?'<small>검색 결과에서 산업을 선택해야 수집을 시작할 수 있습니다.</small>':'<small>산업코드 데이터가 없습니다. 먼저 산업코드를 갱신하세요.</small>';
const industryTargetPanel=()=>`<div class="target-panel industry-target"><div class="industry-picker"><label><b>Collector Target</b><input id="collector-target" value="${escapeHtml(collectorTarget)}" autocomplete="off" placeholder="산업명 또는 산업코드 검색"></label><div id="industry-options-host">${industryOptionsHtml()}</div><div id="industry-selection-host">${industrySelectionHtml()}</div></div><div class="industry-master-actions"><button type="button" data-action="refresh_industries" ${industryRefreshRunning||!credential.saved?"disabled":""}>${industryRefreshRunning?"갱신 중…":"산업코드 갱신"}</button><small>${industryStatus.count.toLocaleString()}개 · ${industryStatus.lastRefreshedAt?new Date(industryStatus.lastRefreshedAt).toLocaleString():"갱신 기록 없음"}</small></div></div>`;

const collector = () => `
  <section class="page">
    <header><p class="eyebrow">LOCAL COLLECTION ENGINE</p><h2>Collector</h2><p>SMINFO 화면의 실제 기업·목록·페이지 버튼을 이용해 상세정보를 저장합니다.</p></header>
    ${accountPanel()}
    ${industryTargetPanel()}
    ${status === "TARGET_NOT_FOUND" ? '<div class="target-error"><b>Target이 잘못되었습니다.</b><span>Collector Target을 바꾸고 다시 수집 시작을 눌러주세요.</span></div>' : ""}
    <div class="guide"><b>자동 순서</b><span>1. 세션 확인</span><span>2. 필요 시 자동 로그인</span><span>3. Target 업종 검색</span><span>4. 기업 수집</span></div>
    <div class="status-grid">
      <article><span>브라우저</span><strong>${status === "IDLE" ? "닫힘" : "실행 중"}</strong><small>로그인 프로필 유지</small></article>
      <article><span>SMINFO 상태</span><strong>${status}</strong><small>${escapeHtml(collectorStatusMessage || (status === "READY" ? "수집 가능" : "브라우저 상태를 확인하세요"))}</small></article>
      <article><span>현재 기업</span><strong>${escapeHtml(currentCompany)}</strong><small>처리 중 · 최근 저장 ${escapeHtml(lastCollectedCompany)}</small></article>
      <article><span>다음 조회</span><strong id="countdown-value">${countdown}</strong><small>35–40초 간격</small></article>
    </div>
    <div class="workspace">
      <div class="actions">
        <button class="primary" data-action="start" ${!selectedIndustry || !credential.saved || editingCredential || ["BROWSER_STARTING", "WAITING_FOR_BROWSER", "RUNNING", "COLLECTING", "PAUSED", "LOGIN_IN_PROGRESS", "LOGIN_CHECKING", "INDUSTRY_SEARCHING", "COMPANY_SEARCHING", "RECOVERING", "RECOVERY_COOLDOWN", "LOGIN_FAILED", "CREDENTIAL_REQUIRED"].includes(status) ? "disabled" : ""}>수집 시작</button>
        <button data-action="pause" ${status !== "RUNNING" && status !== "RECOVERING" && status !== "RECOVERY_COOLDOWN" ? "disabled" : ""}>일시정지</button>
        <button data-action="resume" ${status !== "PAUSED" ? "disabled" : ""}>재개</button>
        <button data-action="stop" ${status === "IDLE" ? "disabled" : ""}>중단</button>
      </div>
    </div>
    <div class="log"><div class="log-head"><h3>작업 로그</h3><div><span>최근 이벤트</span><button type="button" data-action="copy_logs" ${logs.length?"":"disabled"}>전체 복사</button></div></div>${logs.length ? logs.slice(-30).reverse().map((line) => `<div class="event-row">${escapeHtml(line)}</div>`).join("") : '<div class="empty">수집 시작을 눌러 시작하세요.</div>'}</div>
  </section>`;

const resultCard = (row: CompanyRow) => `
  <article class="company-card" data-company-id="${escapeHtml(row.companyId)}" tabindex="0" role="button" aria-label="${escapeHtml(row.companyName)} 상세정보">
    <div class="company-title"><div><b>${escapeHtml(row.companyName)}</b><small>${escapeHtml(row.businessNumber ?? "사업자번호 없음")}</small></div>${row.disclosureStatus==="DISCLOSURE_DENIED"?'<span>정보 비공개</span>':row.companyStatus?`<span>${escapeHtml(row.companyStatus)}</span>`:""}</div>
    <div class="company-grid">
      <dl><dt>대표자</dt><dd>${escapeHtml(row.representativeName ?? "—")}</dd><dt>기업형태</dt><dd>${escapeHtml(row.companyType ?? "—")}</dd><dt>설립일</dt><dd>${escapeHtml(row.establishedDate ?? "—")}</dd></dl>
      <dl><dt>업종</dt><dd>${escapeHtml(row.industryName ?? "—")}${row.ksicCode ? ` <small>${escapeHtml(row.ksicCode)}</small>` : ""}</dd><dt>주요제품</dt><dd>${escapeHtml(row.mainProducts ?? "—")}</dd><dt>주소</dt><dd>${escapeHtml(row.roadAddress ?? row.address ?? "—")}</dd></dl>
      <dl class="financial"><dt>최근 결산</dt><dd>${escapeHtml(row.fiscalYear ?? "—")}</dd><dt>매출액</dt><dd>${amount(row.revenueKrwMillion)}</dd><dt>영업이익</dt><dd>${amount(row.operatingIncomeKrwMillion)}</dd><dt>당기순이익</dt><dd>${amount(row.netIncomeKrwMillion)}</dd></dl>
    </div>
    ${homepageLink(row.homepageUrl)}
  </article>`;

const pagination = () => {
  if (searchData.totalPages <= 1) return "";
  const start = Math.max(1, searchData.page - 2);
  const end = Math.min(searchData.totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `<nav class="pagination-controls"><button data-page="${searchData.page - 1}" ${searchData.page <= 1 ? "disabled" : ""}>이전</button>${pages.map((page) => `<button data-page="${page}" class="${page === searchData.page ? "active" : ""}">${page}</button>`).join("")}<button data-page="${searchData.page + 1}" ${searchData.page >= searchData.totalPages ? "disabled" : ""}>다음</button></nav>`;
};

const detailRows=(rows:Array<Record<string,unknown>>,columns:Array<[string,string]>)=>{
  const isFinancialTable=columns.some(([key])=>financialKeys.has(key));
  const unitToggle=isFinancialTable?`<div class="financial-unit-row"><div class="unit-toggle" role="group" aria-label="재무 단위"><button type="button" data-financial-unit="million" class="${financialUnit==="million"?"active":""}" aria-pressed="${financialUnit==="million"}">백만원</button><button type="button" data-financial-unit="eok" class="${financialUnit==="eok"?"active":""}" aria-pressed="${financialUnit==="eok"}">억원</button></div></div>`:"";
  if(!rows.length)return `${unitToggle}<div class="detail-empty">수집된 정보가 없습니다.</div>`;
  const cell=(row:Record<string,unknown>,key:string)=>{
    const value=row[key];
    if(!isFinancialTable||!financialKeys.has(key))return `<span>${escapeHtml(value??"—")}</span>`;
    const rawValue=value===null||value===undefined?'data-financial-null':`data-financial-value="${escapeHtml(value)}"`;
    return `<span ${rawValue}>${escapeHtml(formatFinancialAmount(value))}</span>`;
  };
  return `${unitToggle}<div class="detail-table"><div class="detail-row detail-head">${columns.map(([,label])=>`<b>${label}</b>`).join("")}</div>${rows.map(row=>`<div class="detail-row">${columns.map(([key])=>cell(row,key)).join("")}</div>`).join("")}</div>`;
};
const companyDetail=()=>{const d=selectedCompany!,c=d.company;if(c.disclosureStatus==="DISCLOSURE_DENIED")return `<section class="page company-detail-page"><button class="detail-back" data-action="back_to_search">← Search로 돌아가기</button><header><p class="eyebrow">COMPANY DETAIL</p><h2>${escapeHtml(c.companyName)} <em class="disclosure-badge">정보비공개</em></h2><p>${escapeHtml(c.sminfoKcd)} · 확인 ${escapeHtml(c.disclosureConfirmedAt??"—")}</p></header><article class="detail-section disclosure-notice"><h3>정보비공개</h3><p>SMINFO에서 업체 요청으로 상세정보가 공개되지 않습니다.</p></article><article class="detail-section"><h3>기본정보</h3><div class="detail-facts"><dl><dt>기업명</dt><dd>${escapeHtml(c.companyName)}</dd><dt>KCD</dt><dd>${escapeHtml(c.sminfoKcd)}</dd></dl><dl><dt>업종</dt><dd>${escapeHtml(c.industryName??"—")}</dd><dt>주소</dt><dd>${escapeHtml(c.roadAddress??c.address??"—")}</dd></dl></div></article></section>`;return `<section class="page company-detail-page"><button class="detail-back" data-action="back_to_search">← Search로 돌아가기</button><header><p class="eyebrow">COLLECTED COMPANY DETAIL</p><h2>${escapeHtml(c.companyName)}</h2><p>${escapeHtml(c.businessNumber??"사업자번호 없음")} · 마지막 수집 ${escapeHtml(c.lastCollectedAt??"—")}</p></header><article class="detail-section"><h3>기본정보</h3><div class="detail-facts"><dl><dt>대표자</dt><dd>${escapeHtml(c.representativeName??"—")}</dd><dt>기업형태</dt><dd>${escapeHtml(c.companyType??"—")}</dd><dt>상태</dt><dd>${escapeHtml(c.companyStatus??"—")}</dd><dt>설립일</dt><dd>${escapeHtml(c.establishedDate??"—")}</dd><dt>정보수정일자</dt><dd>${escapeHtml(c.sourceUpdatedAt??"—")}</dd></dl><dl><dt>업종</dt><dd>${escapeHtml(c.industryName??"—")} ${escapeHtml(c.ksicCode??"")}</dd><dt>주요제품</dt><dd>${escapeHtml(c.mainProducts??"—")}</dd><dt>주소</dt><dd>${escapeHtml(c.address??"—")}</dd><dt>도로명주소</dt><dd>${escapeHtml(c.roadAddress??"—")}</dd><dt>홈페이지</dt><dd>${homepageLink(c.homepageUrl)||"—"}</dd></dl></div></article><article class="detail-section"><h3>사업장정보</h3>${detailRows(d.businessSites,[["siteName","공장명"],["siteAddress","사업장소재지"]])}</article><article class="detail-section"><h3>연혁</h3>${detailRows(d.histories,[["sourceNumber","번호"],["eventDate","일자"],["description","내용"]])}</article><article class="detail-section"><h3>경영진</h3>${detailRows(d.executives,[["sourceNumber","번호"],["positionTitle","직위"],["maskedName","성명"]])}</article><article class="detail-section"><h3>매출현황</h3>${detailRows(d.financialStatements,[["fiscalYear","연도"],["totalAssets","자산총계"],["paidInCapital","납입자본금"],["totalEquity","자본총계"],["revenue","매출액"],["operatingIncome","영업이익"],["netIncome","당기순이익"]])}</article><article class="detail-section"><h3>인증</h3><h4>인증항목</h4>${detailRows(d.certifications,[["certificationNumber","인증번호"],["certificationName","인증명"],["certificationScope","인증범위"],["validityPeriod","유효기간"],["certificationAuthority","인증기관"]])}<h4>지정</h4>${detailRows(d.designations,[["designationNumber","지정번호"],["designationName","지정명"],["validityPeriod","유효기간"],["operatingAuthority","운영기관"]])}</article></section>`};

const search = () => selectedCompany ? companyDetail() : `
  <section class="page">
    <header><p class="eyebrow">LOCAL COMPANY INDEX</p><h2>Search</h2><p>가나다순 다음 ABC순으로 표시되며, 한 글자 입력부터 즉시 검색합니다.</p></header>
    <div class="searchbar"><select id="industry-filter"><option value="">전체 업종</option>${targetOptions.map((x)=>`<option value="${escapeHtml(x.targetId)}" ${x.targetId===searchTargetId?"selected":""}>${escapeHtml(x.name)}</option>`).join("")}</select><div class="search-input-wrap"><input id="live-search" value="${escapeHtml(searchQuery)}" placeholder="기업명·대표자·사업자번호·제품·주소·업종 검색" autocomplete="off"><button id="clear-search" type="button" aria-label="검색어 지우기" ${searchQuery ? "" : "hidden"}>×</button></div><span id="search-count">${searchData.total.toLocaleString()}개 기업 · 페이지당 10개</span></div>
    <div id="search-error">${searchError ? `<div class="error">${escapeHtml(searchError)}</div>` : ""}</div>
    <div id="search-results" class="results company-results">${searchData.rows.length ? searchData.rows.map(resultCard).join("") : '<div class="empty">검색 결과가 없습니다.</div>'}</div>
    <div id="search-pagination">${pagination()}</div>
  </section>`;

const soon = (name: string) => `<section class="page centered"><p class="eyebrow">MONA RADAR / COMPANY</p><h2>${name}</h2><div class="orb"></div><h3>Coming Soon</h3></section>`;

async function loadSearch(page = 1) {
  const sequence = ++searchSequence;
  try {
    const result = await invoke<SearchResponse>("search_companies", { query: searchQuery || null, page, targetId: searchTargetId || null });
    if (sequence !== searchSequence) return;
    searchData = result;
    searchError = "";
  } catch (error) {
    if (sequence !== searchSequence) return;
    searchError = `Database error: ${String(error)}`;
  }
  if (view === "search") updateSearchResults();
}

function bindPagination() {
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.page);
    if (Number.isInteger(page) && page > 0) void loadSearch(page);
  }));
}

function bindCompanyDetails(){
  document.querySelector<HTMLElement>("[data-action=back_to_search]")?.addEventListener("click",()=>{selectedCompany=undefined;render();void loadSearch(searchData.page);});
  document.querySelectorAll<HTMLButtonElement>("[data-financial-unit]").forEach(button=>button.addEventListener("click",()=>{
    const unit=button.dataset.financialUnit;
    if((unit!=="million"&&unit!=="eok")||unit===financialUnit)return;
    financialUnit=unit;
    document.querySelectorAll<HTMLElement>("[data-financial-value],[data-financial-null]").forEach(cell=>{
      cell.textContent=formatFinancialAmount(cell.hasAttribute("data-financial-null")?undefined:cell.dataset.financialValue);
    });
    document.querySelectorAll<HTMLButtonElement>("[data-financial-unit]").forEach(unitButton=>{
      const active=unitButton.dataset.financialUnit===financialUnit;
      unitButton.classList.toggle("active",active);
      unitButton.setAttribute("aria-pressed",String(active));
    });
  }));
  document.querySelectorAll<HTMLAnchorElement>("[data-homepage-url]").forEach(link=>link.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    void openHomepage(link.dataset.homepageUrl);
  }));
  document.querySelectorAll<HTMLElement>("[data-company-id]").forEach(card=>{
    const open=async()=>{try{selectedCompany=await invoke<CompanyFullDetail>("get_company_detail",{companyId:card.dataset.companyId});financialUnit="million";render();}catch(error){searchError=`상세정보 오류: ${String(error)}`;updateSearchResults();}};
    card.addEventListener("click",()=>void open());
    card.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();void open();}});
  });
}

function updateSearchResults() {
  const count = document.querySelector<HTMLElement>("#search-count");
  const error = document.querySelector<HTMLElement>("#search-error");
  const results = document.querySelector<HTMLElement>("#search-results");
  const pages = document.querySelector<HTMLElement>("#search-pagination");
  if (!count || !error || !results || !pages) return;
  count.textContent = `${searchData.total.toLocaleString()}개 기업 · 페이지당 10개`;
  error.innerHTML = searchError ? `<div class="error">${escapeHtml(searchError)}</div>` : "";
  results.innerHTML = searchData.rows.length ? searchData.rows.map(resultCard).join("") : '<div class="empty">검색 결과가 없습니다.</div>';
  pages.innerHTML = pagination();
  bindPagination();
  bindCompanyDetails();
}

function scheduleSearch(value: string) {
  searchQuery = value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadSearch(1), 180);
}

function bindSearch() {
  const input = document.querySelector<HTMLInputElement>("#live-search");
  if (!input) return;
  const clear = document.querySelector<HTMLButtonElement>("#clear-search");
  const updateClearVisibility=()=>{if(clear)clear.hidden=input.value.length===0;};
  document.querySelector<HTMLSelectElement>("#industry-filter")?.addEventListener("change",(event)=>{searchTargetId=(event.target as HTMLSelectElement).value;void loadSearch(1);});
  input.addEventListener("compositionupdate", () => { scheduleSearch(input.value); });
  input.addEventListener("compositionend", () => {
    updateClearVisibility();
    scheduleSearch(input.value);
  });
  input.addEventListener("input", () => {
    updateClearVisibility();
    scheduleSearch(input.value);
  });
  clear?.addEventListener("pointerdown",event=>event.preventDefault());
  clear?.addEventListener("click",()=>{window.clearTimeout(searchTimer);input.value="";searchQuery="";updateClearVisibility();input.focus();void loadSearch(1);});
  bindPagination();
}

function render() {
  app.innerHTML = `<aside><div class="brand"><span>MR</span><div><b>MONA RADAR</b><small>Company</small></div></div><nav>${(["collector", "search", "dash", "analysis"] as View[]).map((item) => `<button data-view="${item}" class="${item === view ? "active" : ""}">${item[0]!.toUpperCase() + item.slice(1)}</button>`).join("")}</nav><footer>LOCAL-FIRST<br><span>single-tab collector</span></footer></aside><main>${view === "collector" ? collector() : view === "search" ? search() : soon(view === "dash" ? "Dash" : "Analysis")}</main>`;
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((element) => element.addEventListener("click", () => {
    view = element.dataset.view as View;
    if(view === "search") selectedCompany=undefined;
    render();
    if (view === "search") void loadSearch(1);
  }));
  const bindIndustryOptions=()=>document.querySelectorAll<HTMLButtonElement>("[data-industry-code]").forEach(button=>button.addEventListener("click",()=>{const item=industryOptions.find(value=>value.industryCode===button.dataset.industryCode);if(!item)return;selectedIndustry=item;collectorTarget=item.industryName;localStorage.setItem("mona-selected-industry",JSON.stringify(item));industryOptions=[];render()}));
  const updateIndustryResults=()=>{const host=document.querySelector<HTMLElement>("#industry-options-host");if(host)host.innerHTML=industryOptionsHtml();const selected=document.querySelector<HTMLElement>("#industry-selection-host");if(selected)selected.innerHTML=industrySelectionHtml();const start=document.querySelector<HTMLButtonElement>("[data-action=start]");if(start&&!selectedIndustry)start.disabled=true;bindIndustryOptions()};
  const performIndustrySearch=(value:string)=>{collectorTarget=value;selectedIndustry=undefined;localStorage.removeItem("mona-selected-industry");if(industrySearchTimer)window.clearTimeout(industrySearchTimer);const sequence=++industrySearchSequence;industrySearchTimer=window.setTimeout(async()=>{try{const rows=await invoke<IndustryCodeOption[]>("search_industry_codes",{query:value});if(sequence!==industrySearchSequence)return;industryOptions=rows;if(view==="collector")updateIndustryResults()}catch(error){logs.push(`ERROR ${String(error)}`)}},120)};
  const targetInput=document.querySelector<HTMLInputElement>("#collector-target");
  if(targetInput){let composing=false;targetInput.addEventListener("compositionstart",()=>{composing=true});targetInput.addEventListener("compositionupdate",()=>{composing=true;queueMicrotask(()=>performIndustrySearch(targetInput.value))});targetInput.addEventListener("compositionend",()=>{composing=false;queueMicrotask(()=>performIndustrySearch(targetInput.value))});targetInput.addEventListener("input",event=>{if(composing||(event as InputEvent).isComposing){queueMicrotask(()=>performIndustrySearch(targetInput.value));return}performIndustrySearch(targetInput.value)})}
  bindIndustryOptions();
  document.querySelector<HTMLButtonElement>("[data-action=refresh_industries]")?.addEventListener("click",async()=>{try{industryRefreshRunning=true;render();await invoke("refresh_industry_master")}catch(error){industryRefreshRunning=false;logs.push(`ERROR ${String(error)}`);render()}});
  document.querySelector<HTMLButtonElement>("[data-action=copy_logs]")?.addEventListener("click",()=>void copyLogs());
  document.querySelector<HTMLElement>("[data-action=edit_account]")?.addEventListener("click", () => { editingCredential = true; render(); });
  document.querySelector<HTMLElement>("[data-action=cancel_account]")?.addEventListener("click", () => {
    editingCredential = false;
    render();
  });
  document.querySelector<HTMLElement>("[data-action=delete_account]")?.addEventListener("click", async () => {
    try { credential = await invoke<CredentialStatus>("delete_sminfo_credential"); loggedIn = false; editingCredential = true; } catch (error) { logs.push(`ERROR ${String(error)}`); }
    render();
  });
  document.querySelector<HTMLElement>("[data-action=save_account]")?.addEventListener("click", async () => {
    const username = document.querySelector<HTMLInputElement>("#sminfo-id")?.value ?? "";
    const passwordInput = document.querySelector<HTMLInputElement>("#sminfo-password");
    const password = passwordInput?.value ?? "";
    try {
      credential = await invoke<CredentialStatus>("save_sminfo_credential", { username, password });
      editingCredential = false;
      loggedIn = false;
      status = "IDLE";
      logs.push(`${new Date().toLocaleTimeString()} credential SMINFO 계정이 Windows Credential Manager에 저장되었습니다. 수집 시작 시 로그인합니다.`);
    }
    catch (error) { logs.push(`ERROR ${String(error)}`); }
    if (passwordInput) passwordInput.value = "";
    render();
  });
  for (const action of ["start", "pause", "resume", "stop"]) {
    document.querySelector<HTMLElement>(`[data-action=${action}]`)?.addEventListener("click", async () => {
      const command = { start: "start_collection", pause: "pause_collection", resume: "resume_collection", stop: "stop_collection" }[action]!;
       if(action === "start") {
         try {
           credential = await invoke<CredentialStatus>("credential_status");
           if(!credential.saved) {
             editingCredential=true;
             status="CREDENTIAL_REQUIRED";
             logs.push(`${new Date().toLocaleTimeString()} credential SMINFO 계정 등록이 필요합니다.`);
             render();
             return;
           }
         } catch(error) {
           logs.push(`ERROR ${String(error)}`);
           render();
           return;
         }
         status="BROWSER_STARTING";
         loggedIn=false;
         render();
       }
       try {
         if(action === "start") await invoke("open_collector");
         await invoke(command, action === "start" ? { target: selectedIndustry!.industryName, industryCode:selectedIndustry!.industryCode } : undefined);
       } catch (error) { logs.push(`ERROR ${String(error)}`); }
      render();
    });
  }
  if (view === "search") bindSearch();
  if (view === "search") bindCompanyDetails();
}

function renderPreservingScroll(){
  const scrolling=document.scrollingElement;
  const top=scrolling?.scrollTop??0;
  const left=scrolling?.scrollLeft??0;
  render();
  scrolling?.scrollTo({top,left,behavior:"instant"});
}

setupWindowChrome();
render();
void invoke<CredentialStatus>("credential_status").then((value) => { credential = value; if (!value.saved) editingCredential = true; if (view === "collector") render(); }).catch((error) => logs.push(`ERROR ${String(error)}`));
void invoke<TargetOption[]>("list_collector_targets").then((value)=>{targetOptions=value;if(view==="search")render();}).catch(()=>undefined);
void invoke<IndustryMasterStatus>("industry_master_status").then(value=>{industryStatus=value;if(view==="collector")render()}).catch(()=>undefined);
try{const saved=localStorage.getItem("mona-selected-industry");if(saved){const value=JSON.parse(saved) as IndustryCodeOption;void invoke<IndustryCodeOption[]>("search_industry_codes",{query:value.industryCode}).then(rows=>{const valid=rows.find(row=>row.industryCode===value.industryCode);if(valid){selectedIndustry=valid;collectorTarget=valid.industryName}else localStorage.removeItem("mona-selected-industry");if(view==="collector")render()})}}catch{localStorage.removeItem("mona-selected-industry")}
void listen<Record<string,unknown>>("industry-event",event=>{const data=event.payload;industryRefreshRunning=String(data.status)==="RUNNING";logs.push(`${new Date().toLocaleTimeString()} industry ${String(data.message??data.status??"")}`);if(String(data.status)==="COMPLETED")void invoke<IndustryMasterStatus>("industry_master_status").then(value=>{industryStatus=value;industryOptions=[];if(view==="collector")render()});else if(view==="collector")renderPreservingScroll()});
void listen<Record<string, unknown>>("collector-event", (event) => {
  const data = event.payload;
  if (data.type === "status") { status = String(data.status) as CollectorStatus; collectorStatusMessage=String(data.message??""); if(status === "CREDENTIAL_REQUIRED") { editingCredential=true; loggedIn=false; sessionStatus="LOGGED_OUT"; } }
  if (data.type === "status"&&data.companyName) currentCompany=String(data.companyName);
  if (data.type === "company_collected") {lastCollectedCompany=String(data.companyName);currentCompany="다음 기업 대기";}
  if(data.type==="company_skipped"){lastCollectedCompany=`${String(data.companyName??currentCompany)} (건너뜀)`;currentCompany="다음 기업 대기";}
  if (data.type === "login_status") {loggedIn = Boolean(data.loggedIn);sessionStatus=(String(data.sessionStatus??(loggedIn?"LOGGED_IN":"LOGIN_FAILED")) as typeof sessionStatus);}
  if(data.type==="recovery"){
    const recoveryStatus=String(data.status);
    if(recoveryStatus==="SESSION_EXPIRED")sessionStatus="EXPIRED";
    else if(recoveryStatus==="REAUTHENTICATING")sessionStatus="REAUTHENTICATING";
    else if(recoveryStatus==="RESUMING_COLLECTION")sessionStatus="LOGGED_IN";
  }
  if (data.type === "countdown") {
    // The countdown changes every second and already has a dedicated status
    // card. Do not let it evict useful collector diagnostics from the log.
    countdown = `${String(data.seconds)}초`;
    if (view === "collector") {
      const value=document.querySelector<HTMLElement>("#countdown-value");
      if(value)value.textContent=countdown;
    }
    return;
  }
  const message = data.type === "error" ? `${String(data.code ?? "UNKNOWN")}: ${String(data.message ?? "오류 내용 없음")}` : String(data.message ?? data.companyName ?? "");
  logs.push(`${new Date().toLocaleTimeString()} ${String(data.type)} ${message}`);
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  if (view === "collector") renderPreservingScroll();
});
