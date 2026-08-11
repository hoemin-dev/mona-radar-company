import "./styles.css";
import "./search.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CollectorStatus } from "./shared/types";

type View = "collector" | "search" | "dash" | "analysis";
interface CompanyRow {
  companyId: string; sminfoKcd: string; businessNumber?: string; companyName: string;
  representativeName?: string; companyType?: string; companyStatus?: string; establishedDate?: string;
  address?: string; roadAddress?: string; homepageUrl?: string; mainProducts?: string;
  ksicCode?: string; industryName?: string; fiscalYear?: number; totalAssetsKrwMillion?: number;
  revenueKrwMillion?: number; operatingIncomeKrwMillion?: number; netIncomeKrwMillion?: number;
}
interface SearchResponse { rows: CompanyRow[]; total: number; page: number; totalPages: number; }
interface CredentialStatus { saved: boolean; username?: string; }
interface TargetOption { targetId: string; name: string; }
interface CompanyFullDetail { company: CompanyRow & { lastCollectedAt?:string }; financialStatements:Array<Record<string,unknown>>; businessSites:Array<Record<string,unknown>>; histories:Array<Record<string,unknown>>; executives:Array<Record<string,unknown>>; certifications:Array<Record<string,unknown>>; designations:Array<Record<string,unknown>>; factories:Array<Record<string,unknown>>; patents:Array<Record<string,unknown>>; }

const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "collector";
let status: CollectorStatus = "IDLE";
let currentCompany = "수집 대기";
let countdown = "—";
let logs: string[] = [];
let searchQuery = "";
let searchData: SearchResponse = { rows: [], total: 0, page: 1, totalPages: 1 };
let searchError = "";
let searchTimer: number | undefined;
let searchSequence = 0;
let credential: CredentialStatus = { saved: false };
let loggedIn = false;
let editingCredential = false;
let collectorTarget = "액체 펌프 제조업";
let targetOptions: TargetOption[] = [];
let searchTargetId = "";
let selectedCompany: CompanyFullDetail | undefined;

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
const amount = (value?: number) => value === undefined || value === null ? "—" : `${value.toLocaleString()}백만원`;

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
  <div class="account-panel"><div><b>SMINFO Account</b><span>ID: <strong>${escapeHtml(credential.username ?? "")}</strong></span><span>Password: <strong class="good">● Windows에 저장됨</strong></span><span>Login: <strong class="${loggedIn ? "good" : "muted"}">${loggedIn ? "● Logged in" : "○ 시작 시 자동 확인"}</strong></span></div><div class="account-actions"><button data-action="edit_account">계정 변경</button><button data-action="delete_account">저장정보 삭제</button></div></div>` : `
  <div class="account-panel account-form"><div><b>SMINFO Account</b><span>저장된 비밀번호는 보안상 다시 표시하지 않습니다. 계정 변경 시 새 비밀번호를 입력하세요.</span></div><label>ID<input id="sminfo-id" autocomplete="username" value="${escapeHtml(credential.username ?? "")}"></label><label>Password<input id="sminfo-password" type="password" autocomplete="current-password"></label><div class="account-actions"><button class="primary" data-action="save_account">계정 저장</button>${credential.saved ? '<button data-action="cancel_account">취소</button>' : ""}</div></div>`;

const collector = () => `
  <section class="page">
    <header><p class="eyebrow">LOCAL COLLECTION ENGINE</p><h2>Collector</h2><p>SMINFO 화면의 실제 기업·목록·페이지 버튼을 이용해 상세정보를 저장합니다.</p></header>
    ${accountPanel()}
    <div class="target-panel"><label><b>Collector Target</b><input id="collector-target" value="${escapeHtml(collectorTarget)}" autocomplete="off"></label><small>수집 시작을 누르면 로그인 확인부터 기업 수집까지 자동으로 진행합니다.</small></div>
    ${status === "TARGET_NOT_FOUND" ? '<div class="target-error"><b>Target이 잘못되었습니다.</b><span>Collector Target을 바꾸고 다시 수집 시작을 눌러주세요.</span></div>' : ""}
    <div class="guide"><b>자동 순서</b><span>1. 세션 확인</span><span>2. 필요 시 자동 로그인</span><span>3. Target 업종 검색</span><span>4. 기업 수집</span></div>
    <div class="status-grid">
      <article><span>브라우저</span><strong>${status === "IDLE" ? "닫힘" : "실행 중"}</strong><small>로그인 프로필 유지</small></article>
      <article><span>SMINFO 상태</span><strong>${status}</strong><small>${status === "READY" ? "수집 가능" : "브라우저 상태를 확인하세요"}</small></article>
      <article><span>현재 기업</span><strong>${escapeHtml(currentCompany)}</strong><small>저장 완료 기업</small></article>
      <article><span>다음 조회</span><strong>${countdown}</strong><small>60–90초 간격</small></article>
    </div>
    <div class="workspace">
      <div class="actions">
        <button class="primary" data-action="start" ${!credential.saved || editingCredential || ["BROWSER_STARTING", "WAITING_FOR_BROWSER", "RUNNING", "COLLECTING", "PAUSED", "LOGIN_IN_PROGRESS", "LOGIN_CHECKING", "INDUSTRY_SEARCHING", "COMPANY_SEARCHING", "RECOVERING", "LOGIN_FAILED", "CREDENTIAL_REQUIRED"].includes(status) ? "disabled" : ""}>수집 시작</button>
        <button data-action="pause" ${status !== "RUNNING" ? "disabled" : ""}>일시정지</button>
        <button data-action="resume" ${status !== "PAUSED" ? "disabled" : ""}>재개</button>
        <button data-action="stop" ${status === "IDLE" ? "disabled" : ""}>중단</button>
      </div>
    </div>
    <div class="log"><div class="log-head"><h3>작업 로그</h3><span>최근 이벤트</span></div>${logs.length ? logs.slice(-30).reverse().map((line) => `<div class="event-row">${escapeHtml(line)}</div>`).join("") : '<div class="empty">브라우저 열기를 눌러 시작하세요.</div>'}</div>
  </section>`;

const resultCard = (row: CompanyRow) => `
  <article class="company-card" data-company-id="${escapeHtml(row.companyId)}" tabindex="0" role="button" aria-label="${escapeHtml(row.companyName)} 상세정보">
    <div class="company-title"><div><b>${escapeHtml(row.companyName)}</b><small>${escapeHtml(row.businessNumber ?? row.sminfoKcd)}</small></div><span>${escapeHtml(row.companyStatus ?? "상태 미표시")}</span></div>
    <div class="company-grid">
      <dl><dt>대표자</dt><dd>${escapeHtml(row.representativeName ?? "—")}</dd><dt>기업형태</dt><dd>${escapeHtml(row.companyType ?? "—")}</dd><dt>설립일</dt><dd>${escapeHtml(row.establishedDate ?? "—")}</dd></dl>
      <dl><dt>업종</dt><dd>${escapeHtml(row.industryName ?? "—")}${row.ksicCode ? ` <small>${escapeHtml(row.ksicCode)}</small>` : ""}</dd><dt>주요제품</dt><dd>${escapeHtml(row.mainProducts ?? "—")}</dd><dt>주소</dt><dd>${escapeHtml(row.roadAddress ?? row.address ?? "—")}</dd></dl>
      <dl class="financial"><dt>최근 결산</dt><dd>${escapeHtml(row.fiscalYear ?? "—")}</dd><dt>매출액</dt><dd>${amount(row.revenueKrwMillion)}</dd><dt>영업이익</dt><dd>${amount(row.operatingIncomeKrwMillion)}</dd><dt>당기순이익</dt><dd>${amount(row.netIncomeKrwMillion)}</dd></dl>
    </div>
    ${row.homepageUrl ? `<a class="homepage" href="${escapeHtml(row.homepageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.homepageUrl)}</a>` : ""}
  </article>`;

const pagination = () => {
  if (searchData.totalPages <= 1) return "";
  const start = Math.max(1, searchData.page - 2);
  const end = Math.min(searchData.totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `<nav class="pagination-controls"><button data-page="${searchData.page - 1}" ${searchData.page <= 1 ? "disabled" : ""}>이전</button>${pages.map((page) => `<button data-page="${page}" class="${page === searchData.page ? "active" : ""}">${page}</button>`).join("")}<button data-page="${searchData.page + 1}" ${searchData.page >= searchData.totalPages ? "disabled" : ""}>다음</button></nav>`;
};

const detailRows=(rows:Array<Record<string,unknown>>,columns:Array<[string,string]>)=>rows.length?`<div class="detail-table"><div class="detail-row detail-head">${columns.map(([,label])=>`<b>${label}</b>`).join("")}</div>${rows.map(row=>`<div class="detail-row">${columns.map(([key])=>`<span>${escapeHtml(row[key]??"—")}</span>`).join("")}</div>`).join("")}</div>`:'<div class="detail-empty">수집된 정보가 없습니다.</div>';
const companyDetail=()=>{const d=selectedCompany!,c=d.company;return `<section class="page company-detail-page"><button class="detail-back" data-action="back_to_search">← Search로 돌아가기</button><header><p class="eyebrow">COLLECTED COMPANY DETAIL</p><h2>${escapeHtml(c.companyName)}</h2><p>${escapeHtml(c.businessNumber??c.sminfoKcd)} · 마지막 수집 ${escapeHtml(c.lastCollectedAt??"—")}</p></header><article class="detail-section"><h3>기본정보</h3><div class="detail-facts"><dl><dt>대표자</dt><dd>${escapeHtml(c.representativeName??"—")}</dd><dt>기업형태</dt><dd>${escapeHtml(c.companyType??"—")}</dd><dt>상태</dt><dd>${escapeHtml(c.companyStatus??"—")}</dd><dt>설립일</dt><dd>${escapeHtml(c.establishedDate??"—")}</dd></dl><dl><dt>업종</dt><dd>${escapeHtml(c.industryName??"—")} ${escapeHtml(c.ksicCode??"")}</dd><dt>주요제품</dt><dd>${escapeHtml(c.mainProducts??"—")}</dd><dt>주소</dt><dd>${escapeHtml(c.roadAddress??c.address??"—")}</dd><dt>홈페이지</dt><dd>${escapeHtml(c.homepageUrl??"—")}</dd></dl></div></article><article class="detail-section"><h3>매출현황</h3>${detailRows(d.financialStatements,[["fiscalYear","연도"],["revenue","매출액"],["operatingIncome","영업이익"],["netIncome","당기순이익"],["totalAssets","총자산"]])}</article><article class="detail-section"><h3>사업장정보</h3>${detailRows(d.businessSites,[["siteName","사업장명"],["siteType","구분"],["businessNumber","사업자번호"],["address","주소"]])}</article><article class="detail-section"><h3>연혁</h3>${detailRows(d.histories,[["eventDate","일자"],["description","내용"]])}</article><article class="detail-section"><h3>경영진</h3>${detailRows(d.executives,[["positionTitle","직위"],["maskedName","성명"]])}</article><article class="detail-section"><h3>인증</h3>${detailRows(d.certifications,[["certificationName","인증명"],["certificationNumber","번호"],["issuer","기관"],["acquiredDate","취득일"],["validUntil","유효기간"]])}</article><article class="detail-section"><h3>지정</h3>${detailRows(d.designations,[["designationName","지정명"],["designationNumber","번호"],["authority","기관"],["designatedDate","지정일"],["validUntil","유효기간"]])}</article><article class="detail-section"><h3>공장</h3>${detailRows(d.factories,[["factoryName","공장명"],["locationAddress","소재지"]])}</article><article class="detail-section"><h3>특허</h3>${detailRows(d.patents,[["patentDate","등록일"],["description","내용"]])}</article></section>`};

const search = () => selectedCompany ? companyDetail() : `
  <section class="page">
    <header><p class="eyebrow">LOCAL COMPANY INDEX</p><h2>Search</h2><p>가나다순 다음 ABC순으로 표시되며, 한 글자 입력부터 즉시 검색합니다.</p></header>
    <div class="searchbar"><select id="industry-filter"><option value="">전체 업종</option>${targetOptions.map((x)=>`<option value="${escapeHtml(x.targetId)}" ${x.targetId===searchTargetId?"selected":""}>${escapeHtml(x.name)}</option>`).join("")}</select><input id="live-search" value="${escapeHtml(searchQuery)}" placeholder="기업명·대표자·사업자번호·제품·주소·업종 검색" autocomplete="off"><span id="search-count">${searchData.total.toLocaleString()}개 기업 · 페이지당 10개</span></div>
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
  document.querySelectorAll<HTMLElement>("[data-company-id]").forEach(card=>{
    const open=async()=>{try{selectedCompany=await invoke<CompanyFullDetail>("get_company_detail",{companyId:card.dataset.companyId});render();}catch(error){searchError=`상세정보 오류: ${String(error)}`;updateSearchResults();}};
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
  document.querySelector<HTMLSelectElement>("#industry-filter")?.addEventListener("change",(event)=>{searchTargetId=(event.target as HTMLSelectElement).value;void loadSearch(1);});
  input.addEventListener("compositionupdate", () => { scheduleSearch(input.value); });
  input.addEventListener("compositionend", () => {
    scheduleSearch(input.value);
  });
  input.addEventListener("input", () => {
    scheduleSearch(input.value);
  });
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
  document.querySelector<HTMLInputElement>("#collector-target")?.addEventListener("input", (event) => { collectorTarget = (event.target as HTMLInputElement).value; });
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
         await invoke(command, action === "start" ? { target: collectorTarget.trim() || "액체 펌프 제조업" } : undefined);
       } catch (error) { logs.push(`ERROR ${String(error)}`); }
      render();
    });
  }
  if (view === "search") bindSearch();
  if (view === "search") bindCompanyDetails();
}

setupWindowChrome();
render();
void invoke<CredentialStatus>("credential_status").then((value) => { credential = value; if (!value.saved) editingCredential = true; if (view === "collector") render(); }).catch((error) => logs.push(`ERROR ${String(error)}`));
void invoke<TargetOption[]>("list_collector_targets").then((value)=>{targetOptions=value;if(view==="search")render();}).catch(()=>undefined);
void listen<Record<string, unknown>>("collector-event", (event) => {
  const data = event.payload;
  if (data.type === "status") { status = String(data.status) as CollectorStatus; if(status === "LOGIN_FAILED" || status === "CREDENTIAL_REQUIRED") { editingCredential=true; loggedIn=false; } }
  if (data.type === "company_collected") currentCompany = String(data.companyName);
  if (data.type === "login_status") loggedIn = Boolean(data.loggedIn);
  if (data.type === "countdown") countdown = `${String(data.seconds)}초`;
  const message = data.type === "error" ? `${String(data.code ?? "UNKNOWN")}: ${String(data.message ?? "오류 내용 없음")}` : String(data.message ?? data.companyName ?? "");
  logs.push(`${new Date().toLocaleTimeString()} ${String(data.type)} ${message}`);
  if (view === "collector") render();
});
