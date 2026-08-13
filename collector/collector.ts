import type { Page } from "playwright";
import { readVisiblePageNumber } from "./browser/navigation-test.js";
import { Repository } from "./database/repository.js";
import { parseCompanyDetail } from "./parser/company-detail.js";
import { parseSearchResult } from "./parser/search-result.js";
import { nextDelayMs, wait } from "./rate-limiter/delay.js";
import { RATE_LIMIT, SMINFO } from "./sminfo/constants.js";
import type { CollectorControl } from "./control.js";
import { captureCompanyDetailSections } from "./browser/detail-sections.js";
import { ensureLoggedIn, inspectBrowserState } from "./sminfo/session.js";
import { resolveIndustry, runCompanySearch, type IndustryCandidate } from "./sminfo/industry.js";
import {restoreSearchPage} from "./browser/search-page-recovery.js";

type Emit = (event: unknown) => void;
interface RecoveryOptions { credential?:{username:string;password:string};target:string;industry:IndustryCandidate }
const MAX_RELOGIN_ATTEMPTS=2;
const MAX_CONTEXT_RECOVERY_ATTEMPTS=2;
const restricted = (text: string, status?: number) =>
  status === 403 || status === 429 || /\uC811\uC18D\s*\uC81C\uD55C|\uBE44\uC815\uC0C1\s*\uC811\uADFC|\uB85C\uADF8\uC778.*(?:\uD544\uC694|\uB9CC\uB8CC)/.test(text);

async function clickPageNumber(page: Page, pageNumber: number,emit:Emit=()=>undefined) {await restoreSearchPage(page,pageNumber,emit)}

async function clickCompany(page: Page, kcd: string) {
  const selector = `a[onclick*="onMoveView01('${kcd}')"]`;
  const link = page.locator(selector).filter({ visible: true }).first();
  if (!(await link.count())) throw new Error(`COMPANY_LINK_NOT_FOUND kcd=${kcd}`);
  const navigation=page.waitForURL((url) => url.pathname === SMINFO.detailPath, { timeout: 30_000 }).then(()=>"DETAIL" as const);
  const disclosure=page.waitForEvent("dialog",{timeout:30_000,predicate:dialog=>dialog.message().includes("요청 정보비공개 업체")}).then(async dialog=>{await dialog.accept().catch(()=>undefined);return "DISCLOSURE_DENIED" as const}).catch(()=>new Promise<never>(()=>undefined));
  await link.click();
  const result=await Promise.race([navigation,disclosure]);
  if(result==="DISCLOSURE_DENIED")throw new Error("DISCLOSURE_DENIED");
}

export type CollectorErrorClass="SKIP"|"COMPANY_ERROR"|"SYSTEM_ERROR";
export function classifyCollectorError(code:string):CollectorErrorClass{
  if(code==="DISCLOSURE_DENIED"||code==="PRIVATE")return "SKIP";
  if(code==="COMPANY_LINK_NOT_FOUND"||code==="DETAIL_NAVIGATION_TIMEOUT"||code==="DETAIL_FAILED"||code==="ACCESS_RESTRICTED")return "COMPANY_ERROR";
  return "SYSTEM_ERROR";
}

export function classifyNavigationState(state:Awaited<ReturnType<typeof inspectBrowserState>>,original:string){
  if(state.sessionStatus==="EXPIRED"||state.sessionStatus==="LOGGED_OUT")return {code:"SESSION_EXPIRED",state};
  if(/PAGINATION_|SEARCH_PAGE_STATE_MISMATCH|SEARCH_RESULT_STATE_LOST/.test(original))return {code:"SEARCH_PAGE_STATE_MISMATCH",state};
  if(state.path!==SMINFO.searchPath&&!state.detailPage)return {code:"SEARCH_CONTEXT_LOST",state};
  if(original.includes("COMPANY_LINK_NOT_FOUND"))return {code:"COMPANY_LINK_NOT_FOUND",state};
  if(original.includes("Timeout")||original.includes("timeout"))return {code:"DETAIL_NAVIGATION_TIMEOUT",state};
  return {code:"UNKNOWN_NAVIGATION_STATE",state};
}
async function classifyNavigationFailure(page:Page,original:string){return classifyNavigationState(await inspectBrowserState(page),original)}
export const isRecoverableNavigationCode=(code:string)=>code==="SESSION_EXPIRED"||code==="SEARCH_CONTEXT_LOST"||code==="SEARCH_PAGE_STATE_MISMATCH";
export const recoveryFailureCode=(message:string)=>message.includes("CREDENTIAL_REQUIRED")?"CREDENTIAL_REQUIRED":message.includes("LOGIN_FAILED")?"LOGIN_FAILED":"SEARCH_CONTEXT_RECOVERY_FAILED";

async function recoverSearchContext(page:Page,repo:Repository,job:string,item:{collection_item_id:string;sminfo_kcd:string;company_name_snapshot:string;source_page_number?:number},options:RecoveryOptions,emit:Emit,cause:"SESSION_EXPIRED"|"SEARCH_CONTEXT_LOST"|"SEARCH_PAGE_STATE_MISMATCH"){
  const state=await inspectBrowserState(page);
  emit({type:"recovery",status:cause,message:cause==="SESSION_EXPIRED"?"SMINFO login session expired":"SMINFO search context was lost",kcd:item.sminfo_kcd,url:state.url});
  repo.event(job,item.collection_item_id,cause,`kcd=${item.sminfo_kcd} url=${state.url}`);
  if(!options.credential)throw new Error("CREDENTIAL_REQUIRED");
  let loggedIn=false;let loginError="";
  for(let attempt=1;attempt<=MAX_RELOGIN_ATTEMPTS;attempt++){
    emit({type:"recovery",status:"REAUTHENTICATING",message:"Saved credential found; automatic re-login started",attempt,kcd:item.sminfo_kcd});
    repo.event(job,item.collection_item_id,"RELOGIN_STARTED",`attempt=${attempt} kcd=${item.sminfo_kcd}`);
    try{await ensureLoggedIn(page,options.credential,emit);loggedIn=true;repo.event(job,item.collection_item_id,"RELOGIN_SUCCESS",`attempt=${attempt} kcd=${item.sminfo_kcd}`);emit({type:"login_status",loggedIn:true,sessionStatus:"LOGGED_IN",message:"Automatic re-login succeeded"});break}catch(error){loginError=error instanceof Error?error.message:String(error);repo.event(job,item.collection_item_id,"RELOGIN_FAILED",`attempt=${attempt} kcd=${item.sminfo_kcd} error=${loginError}`)}
  }
  if(!loggedIn)throw new Error(`LOGIN_FAILED ${loginError}`);
  for(let attempt=1;attempt<=MAX_CONTEXT_RECOVERY_ATTEMPTS;attempt++){
    emit({type:"recovery",status:"REBUILDING_SEARCH_CONTEXT",message:"Rebuilding Target search context",attempt,kcd:item.sminfo_kcd});
    repo.event(job,item.collection_item_id,"SEARCH_CONTEXT_RECOVERY_STARTED",`attempt=${attempt} kcd=${item.sminfo_kcd}`);
    try{
      const industry=await resolveIndustry(page,options.target,emit,options.industry.code);
      await runCompanySearch(page,industry,emit);
      if(item.source_page_number&&item.source_page_number>1)await restoreSearchPage(page,item.source_page_number,emit);
      repo.event(job,item.collection_item_id,"SEARCH_CONTEXT_RECOVERY_SUCCESS",`attempt=${attempt} kcd=${item.sminfo_kcd}`);
      emit({type:"recovery",status:"RESUMING_COLLECTION",message:`Search context restored; resuming kcd=${item.sminfo_kcd}`,kcd:item.sminfo_kcd});
      return;
    }catch(error){const message=error instanceof Error?error.message:String(error);repo.event(job,item.collection_item_id,"SEARCH_CONTEXT_RECOVERY_FAILED",`attempt=${attempt} kcd=${item.sminfo_kcd} error=${message}`);if(attempt===MAX_CONTEXT_RECOVERY_ATTEMPTS)throw new Error(`SEARCH_CONTEXT_RECOVERY_FAILED ${message}`)}
  }
}

async function clickListAndRestore(page: Page, workPage: number,emit:Emit) {
  const textButton = page.getByText("\uBAA9\uB85D", { exact: true }).filter({ visible: true }).first();
  const inputButton = page.locator(
    'input[type=button][value="\uBAA9\uB85D"],input[type=submit][value="\uBAA9\uB85D"]',
  ).filter({ visible: true }).first();
  const button = (await textButton.count()) ? textButton : inputButton;
  if (!(await button.count())) throw new Error("LIST_BUTTON_NOT_FOUND");
  await Promise.all([
    page.waitForURL((url) => url.pathname === SMINFO.searchPath, { timeout: 30_000 }),
    button.click(),
  ]);
  const returnedPage = await readVisiblePageNumber(page);
  if (returnedPage === undefined) throw new Error("RETURNED_PAGE_NOT_FOUND");
  if (returnedPage !== workPage) await clickPageNumber(page, workPage,emit);
}

export async function collectCurrentSearch(
  page: Page,
  repo: Repository,
  emit: Emit,
  limit: number | undefined,
  control: CollectorControl,
  targetId?: string,
  recovery?:RecoveryOptions,
) {
  const initial = parseSearchResult(await page.content());
  const firstPage = await readVisiblePageNumber(page);
  if (firstPage === undefined) throw new Error("CURRENT_PAGE_NOT_FOUND");
  const totalPages = initial.totalPages ?? firstPage;
  const job = repo.createJob(initial.total, totalPages, undefined, limit);
  if (targetId) { repo.attachJob(targetId, job); repo.targetStatus(targetId, "RUNNING", initial.total, totalPages); }
  repo.jobStatus(job, "RUNNING");
  let processed = 0;
  let consecutiveSystemErrors = 0;
  let seenResumeGeneration=control.currentResumeGeneration();
  const validateManualResume=async(pageNumber?:number,item?:{sminfo_kcd:string;company_name_snapshot:string})=>{
    const generation=control.currentResumeGeneration();if(generation===seenResumeGeneration)return;
    seenResumeGeneration=generation;consecutiveSystemErrors=0;
    emit({type:"recovery",status:"RESUME_REQUESTED",message:"resume requested"});
    emit({type:"recovery",status:"RECOVERY_STATE_RESET",message:"recovery state reset; system error count 0/3"});
    const state=await inspectBrowserState(page);
    emit({type:"recovery",status:"BROWSER_STATE_DETECTED",message:`browser state detected session=${state.sessionStatus} url=${state.url} searchResults=${state.searchResults}`});
    if(!recovery)throw new Error("SEARCH_CONTEXT_RECOVERY_FAILED recovery options unavailable");
    await ensureLoggedIn(page,recovery.credential,emit);
    const industry=await resolveIndustry(page,recovery.target,emit,recovery.industry.code);
    await runCompanySearch(page,industry,emit);
    if(pageNumber&&pageNumber>1)await clickPageNumber(page,pageNumber,emit);
    emit({type:"recovery",status:"SEARCH_PAGE_RECOVERED",message:`search page recovered page=${pageNumber??1}`});
    if(item)emit({type:"recovery",status:"RESUMING_COLLECTION",message:`resume collection from company ${item.company_name_snapshot} kcd=${item.sminfo_kcd}`});
  };
  const checkpoint=async(pageNumber?:number,item?:{sminfo_kcd:string;company_name_snapshot:string})=>{
    while(true){
      await control.checkpoint();
      try{await validateManualResume(pageNumber,item);return}catch(error){
        const message=error instanceof Error?error.message:String(error);consecutiveSystemErrors++;
        emit({type:"error",code:"SEARCH_CONTEXT_RECOVERY_FAILED",errorClass:"SYSTEM_ERROR",message:`manual resume recovery failed: ${message}; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}`});
        control.pauseForRecovery();repo.jobStatus(job,"PAUSED");emit({type:"status",status:"PAUSED",message:`pause reason=SEARCH_CONTEXT_RECOVERY_FAILED; retry Resume after checking browser`});
      }
    }
  };
  const restoreWithSearchRecovery=async(targetPage:number)=>{
    try{await restoreSearchPage(page,targetPage,emit);return}catch(firstError){
      if(!recovery)throw firstError;
      emit({type:"status",status:"RECOVERING",message:`search_recovery_started targetPage=${targetPage}`});
      await ensureLoggedIn(page,recovery.credential,emit);
      const industry=await resolveIndustry(page,recovery.target,emit,recovery.industry.code);
      await runCompanySearch(page,industry,emit);
      await restoreSearchPage(page,targetPage,emit);
      emit({type:"status",status:"RUNNING",message:`search_recovery_success targetPage=${targetPage}`});
    }
  };

  try {
    for (let pageNumber = firstPage; pageNumber <= totalPages; pageNumber++) {
      await checkpoint(pageNumber);
      if ((await readVisiblePageNumber(page)) !== pageNumber) await restoreWithSearchRecovery(pageNumber);
      const search = parseSearchResult(await page.content());
      repo.enqueue(job, pageNumber, search.companies);
      if (targetId) repo.linkQueuedCompanies(targetId, job);
      emit({ type: "status", status: "RUNNING", message: `Search page ${pageNumber}: ${search.companies.length} companies queued` });

      while (true) {
        await checkpoint(pageNumber);
        if (limit && processed >= limit) {
          repo.jobStatus(job, "STOPPED");
          emit({ type: "status", status: "STOPPED", message: `Safety limit reached: ${limit}` });
          return;
        }
        const item = repo.next(job);
        if (!item) break;
        repo.markRunning(item.collection_item_id);
        let recoveryAttempts=0;
        let companySaved=false;
        while(true)try {
          const expectedPage=item.source_page_number;
          const actualPage=await readVisiblePageNumber(page);
          emit({type:"company_page_check",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,expectedPage,actualPage,url:page.url(),message:`company_page_check company=${item.company_name_snapshot} kcd=${item.sminfo_kcd} expectedPage=${expectedPage} actualPage=${actualPage??"unknown"}`});
          if(actualPage!==expectedPage){
            emit({type:"recovery",status:"SEARCH_PAGE_STATE_MISMATCH",message:`search_page_state_mismatch expected=${expectedPage} actual=${actualPage??"unknown"}`});
            emit({type:"status",status:"RECOVERING",message:`search_recovery_started targetPage=${expectedPage}`});
            await restoreWithSearchRecovery(expectedPage);
            emit({type:"status",status:"RUNNING",message:`search_recovery_success targetPage=${expectedPage}`});
          }
          emit({ type: "status", status: "RUNNING", companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,message: `Collecting ${item.company_name_snapshot}` });
          await clickCompany(page, item.sminfo_kcd);
          const html = await captureCompanyDetailSections(page,emit);
          if (restricted(html)) throw new Error("ACCESS_RESTRICTED");
          const detail = parseCompanyDetail(html);
          if (!detail.kcd) detail.kcd = item.sminfo_kcd;
          if (!detail.companyName) detail.companyName = item.company_name_snapshot;
          emit({type:"detail_parsed",companyName:detail.companyName,message:`Detail parsed: quality=${detail.collectionQuality}, sections=${Object.entries(detail.sectionStatuses).map(([name,result])=>`${name}:${result.status}`).join(",")}, financials=${detail.financialStatements.length}, sites=${detail.businessSites?.length??0}, histories=${detail.histories?.length??0}, executives=${detail.executives?.length??0}, certifications=${detail.certifications?.length??0}, designations=${detail.designations?.length??0}`});
          repo.saveCompany(item.collection_item_id, detail);
          companySaved=true;
          if (targetId) repo.linkCollectedCompany(targetId, item.collection_item_id, detail.ksicCode);
          processed++;
          consecutiveSystemErrors = 0;
          const stats = repo.stats(job);
          if (targetId) repo.checkpoint(targetId, expectedPage, item.source_row_number, item.sminfo_kcd, stats);
          emit({
            type: "company_collected",
            kcd: detail.kcd,
            companyName: detail.companyName,
            completed: stats.completed,
            total: initial.total,
          });
          await clickListAndRestore(page, pageNumber,emit);

          const delay = nextDelayMs();
          let remainingDelay = delay;
          while (remainingDelay > 0) {
            await checkpoint(pageNumber,item);
            emit({ type: "countdown", seconds: Math.ceil(remainingDelay / 1000) });
            const step = Math.min(1000, remainingDelay);
            await wait(step);
            remainingDelay -= step;
          }
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "COLLECTOR_STOPPED") {
            repo.jobStatus(job, "STOPPED");
            emit({ type: "status", status: "STOPPED", message: "Collection stopped" });
            return;
          }
          const classified=await classifyNavigationFailure(page,message);
          if(recovery&&isRecoverableNavigationCode(classified.code)&&recoveryAttempts<1){
            recoveryAttempts++;
            emit({type:"status",status:"RECOVERING",message:"SMINFO session expired; recovering automatically"});
            try{await recoverSearchContext(page,repo,job,item,recovery,emit,classified.code);consecutiveSystemErrors=0;repo.event(job,item.collection_item_id,"COLLECTION_RESUMED",`kcd=${item.sminfo_kcd}`);if(companySaved)break;continue}catch(recoveryError){
              const recoveryMessage=recoveryError instanceof Error?recoveryError.message:String(recoveryError);
              const recoveryCode=recoveryFailureCode(recoveryMessage);
              consecutiveSystemErrors++;
              emit({type:"error",code:recoveryCode,message:`${recoveryMessage}; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}`});
              control.pauseForRecovery();repo.jobStatus(job,"PAUSED");emit({type:"status",status:"PAUSED",message:`pause reason=${recoveryCode}; browser/search recovery required`});return;
            }
          }
          const effectiveCode=message.includes("DISCLOSURE_DENIED")?"DISCLOSURE_DENIED":message==="ACCESS_RESTRICTED"?"ACCESS_RESTRICTED":classified.code === "UNKNOWN_NAVIGATION_STATE" ? "DETAIL_FAILED" : classified.code;
          const errorClass=classifyCollectorError(effectiveCode);
          if(errorClass==="SKIP")repo.skip(item.collection_item_id,"DISCLOSURE_DENIED","업체가 요청 정보비공개 업체입니다.");else repo.fail(item.collection_item_id,effectiveCode,`${message} url=${classified.state.url}`);
          if(errorClass==="SYSTEM_ERROR")consecutiveSystemErrors++;else consecutiveSystemErrors=0;
          emit({ type:errorClass==="SKIP"?"company_skipped":"error",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,sourcePage:item.source_page_number,actualPage:classified.state.path===SMINFO.searchPath?await readVisiblePageNumber(page):undefined,url:classified.state.url, code:effectiveCode,errorClass, message:`${message} url=${classified.state.url}${errorClass==="SYSTEM_ERROR"?`; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}`:""}` });
          if (page.url().includes(SMINFO.detailPath)) {
            await clickListAndRestore(page, pageNumber,emit).catch(() => undefined);
          }
          if (errorClass==="SYSTEM_ERROR"&&consecutiveSystemErrors >= RATE_LIMIT.maxConsecutiveErrors) {
            control.pauseForRecovery();
            repo.jobStatus(job, "PAUSED");
            emit({ type: "status", status: "PAUSED", message: `pause reason=${effectiveCode}; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}` });
            return;
          }
          break;
        }
      }
    }
    const result=repo.finishJob(job);
    if (targetId) repo.targetStatus(targetId, result.status);
    emit({ type: "status", status: result.status, message: result.status === "COMPLETED" ? "Collection completed" : `Collection completed with ${result.failed} failure(s)` });
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);
    if(/PAGINATION_|SEARCH_PAGE_STATE_MISMATCH|SEARCH_RESULT_STATE_LOST/.test(message)){
      control.pauseForRecovery();repo.jobStatus(job,"PAUSED");if(targetId)repo.targetStatus(targetId,"PAUSED");
      emit({type:"status",status:"PAUSED",message:`search_recovery_failed; queue consumption stopped; ${message}`});return;
    }
    repo.jobStatus(job, "ERROR");
    if (targetId) repo.targetStatus(targetId, "ERROR");
    throw error;
  }
}
