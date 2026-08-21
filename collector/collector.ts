import type { Locator, Page } from "playwright";
import { readVisiblePageNumber } from "./browser/navigation-test.js";
import { Repository } from "./database/repository.js";
import { parseCompanyDetail } from "./parser/company-detail.js";
import { parseSearchResult } from "./parser/search-result.js";
import { nextDelayMs, wait } from "./rate-limiter/delay.js";
import { RATE_LIMIT, SMINFO } from "./sminfo/constants.js";
import type { CollectorControl } from "./control.js";
import { captureCompanyDetailSections } from "./browser/detail-sections.js";
import { createDetailPage, openCompanyDetail } from "./browser/detail-navigation.js";
import { inspectBrowserState } from "./sminfo/session.js";
import type { IndustryCandidate } from "./sminfo/industry.js";
import {restoreSearchPage} from "./browser/search-page-recovery.js";
import {HardRecoveryRequired,requiresHardRecovery} from "./hard-recovery.js";

type Emit = (event: unknown) => void;
interface RecoveryOptions { credential?:{username:string;password:string};target:string;industry:IndustryCandidate;hardRecover:(reason:string)=>Promise<{page:Page;industry:IndustryCandidate}> }
const normalizedIdentityName=(value:string)=>value.replace(/\s/g,"").toLocaleLowerCase();
export const detailIdentityMatches=(detail:{kcd:string;companyName:string},expected:{kcd:string;companyName:string})=>
  detail.kcd ? detail.kcd===expected.kcd : Boolean(detail.companyName)&&normalizedIdentityName(detail.companyName)===normalizedIdentityName(expected.companyName);
const restricted = (text: string, status?: number) =>
  status === 403 || status === 429 || /\uC811\uC18D\s*\uC81C\uD55C|\uBE44\uC815\uC0C1\s*\uC811\uADFC|\uB85C\uADF8\uC778.*(?:\uD544\uC694|\uB9CC\uB8CC)/.test(text);

async function companyLink(page:Page,kcd:string){
  const selector = `a[onclick*="onMoveView01('${kcd}')"]`;
  const link = page.locator(selector).filter({ visible: true }).first();
  if (!(await link.count())) throw new Error(`COMPANY_LINK_NOT_FOUND kcd=${kcd}`);
  return link;
}

export type CollectorErrorClass="SKIP"|"COMPANY_ERROR"|"SYSTEM_ERROR";
export function classifyCollectorError(code:string):CollectorErrorClass{
  if(code==="DISCLOSURE_DENIED"||code==="PRIVATE")return "SKIP";
  if(code==="COMPANY_LINK_NOT_FOUND"||code==="DETAIL_NAVIGATION_TIMEOUT"||code==="DETAIL_FAILED"||code==="DETAIL_IDENTITY_MISMATCH"||code==="ACCESS_RESTRICTED")return "COMPANY_ERROR";
  return "SYSTEM_ERROR";
}

export function classifyNavigationState(state:Awaited<ReturnType<typeof inspectBrowserState>>,original:string){
  if(state.sessionStatus==="EXPIRED"||state.sessionStatus==="LOGGED_OUT")return {code:"SESSION_EXPIRED",state};
  if(/PAGINATION_|SEARCH_PAGE_STATE_MISMATCH|SEARCH_RESULT_STATE_LOST/.test(original))return {code:"SEARCH_PAGE_STATE_MISMATCH",state};
  if(state.path!==SMINFO.searchPath&&!state.detailPage)return {code:"SEARCH_CONTEXT_LOST",state};
  if(original.includes("COMPANY_LINK_NOT_FOUND"))return {code:"COMPANY_LINK_NOT_FOUND",state};
  if(original.includes("DETAIL_IDENTITY_MISMATCH"))return {code:"DETAIL_IDENTITY_MISMATCH",state};
  if(original.includes("DETAIL_NAVIGATION_TIMEOUT")||/timeout/i.test(original))return {code:"DETAIL_NAVIGATION_TIMEOUT",state};
  return {code:"UNKNOWN_NAVIGATION_STATE",state};
}
async function classifyNavigationFailure(page:Page,original:string){return classifyNavigationState(await inspectBrowserState(page),original)}
export const isRecoverableNavigationCode=(code:string)=>code==="SESSION_EXPIRED"||code==="SEARCH_CONTEXT_LOST"||code==="SEARCH_PAGE_STATE_MISMATCH";
export const recoveryFailureCode=(message:string)=>message.includes("CREDENTIAL_REQUIRED")?"CREDENTIAL_REQUIRED":message.includes("LOGIN_STATE_UNCERTAIN")?"LOGIN_STATE_UNCERTAIN":message.includes("LOGIN_FAILED")?"LOGIN_FAILED":"SEARCH_CONTEXT_RECOVERY_FAILED";

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
  emit({type:"search_context_mode",mode:"preserved",reason:"detail_return",returnedPage,workPage,message:`search_context_mode mode=preserved reason=detail_return returnedPage=${returnedPage} workPage=${workPage}`});
  if (returnedPage !== workPage) {
    emit({type:"pagination_restore_reason",reason:"detail_return",target:workPage,message:`pagination_restore_reason reason=detail_return target=${workPage}`});
    await restoreSearchPage(page,workPage,emit,3,"detail_return");
  }
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
  let totalPages = initial.totalPages ?? firstPage;
  let sourceTotal=initial.total;
  const job = repo.createJob(initial.total, totalPages, undefined, limit);
  if (targetId) { repo.attachJob(targetId, job); repo.targetStatus(targetId, "RUNNING", initial.total, totalPages); }
  repo.jobStatus(job, "RUNNING");
  let processed = 0;
  let consecutiveSystemErrors = 0;
  let detailPage: Page | undefined;
  let restartRequired=false;
  let restartReason="";
  let hardRecoveryFailures=0;
  let seenResumeGeneration=control.currentResumeGeneration();
  const performHardRecovery=async(reason:string)=>{
    if(!recovery)throw new HardRecoveryRequired(`${reason}; recovery options unavailable`);
    await resetDetailPage();
    emit({type:"recovery",status:"HARD_RECOVERY_STARTED",reason,message:`hard recovery started reason=${reason}`});
    try{
      const rebuilt=await recovery.hardRecover(reason);
      page=rebuilt.page;recovery.industry=rebuilt.industry;hardRecoveryFailures=0;consecutiveSystemErrors=0;
      restartRequired=true;restartReason=`hard_recovery:${reason}`;
      emit({type:"recovery",status:"HARD_RECOVERY_SUCCEEDED",message:"hard recovery succeeded; restarting search from page=1"});
    }catch(error){
      hardRecoveryFailures++;
      throw new HardRecoveryRequired(`${reason}; attempt=${hardRecoveryFailures}; ${error instanceof Error?error.message:String(error)}`);
    }
  };
  const validateManualResume=async(pageNumber?:number,item?:{sminfo_kcd:string;company_name_snapshot:string})=>{
    const generation=control.currentResumeGeneration();if(generation===seenResumeGeneration)return;
    seenResumeGeneration=generation;consecutiveSystemErrors=0;
    emit({type:"recovery",status:"RESUME_REQUESTED",message:"resume requested"});
    emit({type:"recovery",status:"RECOVERY_STATE_RESET",message:"recovery state reset; system error count 0/3"});
    const state=page.isClosed()?undefined:await inspectBrowserState(page).catch(()=>undefined);
    emit({type:"recovery",status:"BROWSER_STATE_DETECTED",message:`browser state detected session=${state?.sessionStatus??"BROKEN"} url=${state?.url??"unavailable"} searchResults=${state?.searchResults??false}`});
    const healthy=Boolean(state&&state.sessionStatus==="LOGGED_IN"&&state.path===SMINFO.searchPath&&state.searchResults&&page.context().pages().filter(candidate=>!candidate.isClosed()).length===1);
    if(healthy){emit({type:"recovery",status:"CONTEXT_HEALTHY",message:"resume kept the current search page and position"});return;}
    await performHardRecovery("MANUAL_RESUME_CONTEXT_UNHEALTHY");
    if(item)emit({type:"recovery",status:"RESUMING_COLLECTION",message:`resume collection from company ${item.company_name_snapshot} kcd=${item.sminfo_kcd}`});
  };
  const checkpoint=async(pageNumber?:number,item?:{sminfo_kcd:string;company_name_snapshot:string})=>{
    while(true){
      await control.checkpoint();
      try{await validateManualResume(pageNumber,item);return}catch(error){
        const message=error instanceof Error?error.message:String(error);consecutiveSystemErrors++;
        emit({type:"error",code:"SEARCH_CONTEXT_RECOVERY_FAILED",errorClass:"SYSTEM_ERROR",message:`manual resume recovery failed: ${message}; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}`});
        if(hardRecoveryFailures>=3){repo.jobStatus(job,"ERROR");throw error}
        await wait(5_000);
      }
    }
  };
  const waitBeforeDetailAccess=async(pageNumber:number,item:{sminfo_kcd:string;company_name_snapshot:string})=>{
    let delay=nextDelayMs();let remainingDelay=delay;let delayGeneration=control.currentResumeGeneration();
    const announce=()=>{const delaySeconds=Math.ceil(delay/1000);emit({type:"company_pre_delay",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,delaySeconds,reason:"detail_access",message:`company_pre_delay company=${item.company_name_snapshot} kcd=${item.sminfo_kcd} delaySeconds=${delaySeconds} reason=detail_access`});emit({type:"status",status:"RUNNING",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,message:`Waiting ${delaySeconds}s before collecting ${item.company_name_snapshot}`})};
    announce();
    while(remainingDelay>0){
      await checkpoint(pageNumber,item);
      const generation=control.currentResumeGeneration();
      if(generation!==delayGeneration){delayGeneration=generation;delay=nextDelayMs();remainingDelay=delay;announce()}
      emit({type:"countdown",seconds:Math.ceil(remainingDelay/1000)});
      const step=Math.min(1000,remainingDelay);await wait(step);remainingDelay-=step;
    }
  };
  const restoreWithSearchRecovery=async(targetPage:number)=>{
    try{await restoreSearchPage(page,targetPage,emit);return false}catch(firstError){
      await performHardRecovery(`PAGINATION_OR_SEARCH_RESTORE_FAILED target=${targetPage} cause=${firstError instanceof Error?firstError.message:String(firstError)}`);
      return true;
    }
  };

  const resetDetailPage=async()=>{
    if(!detailPage||detailPage.isClosed()){
      detailPage=void 0;
      return;
    }
    await detailPage.goto("about:blank",{waitUntil:"commit",timeout:10_000}).catch(()=>undefined);
    if(detailPage.isClosed()){
      detailPage=void 0;
      await page.bringToFront().catch(()=>undefined);
      return;
    }
    if(detailPage.url()==="about:blank"){
      await detailPage.close().catch(()=>undefined);
      detailPage=void 0;
    }
    await page.bringToFront().catch(()=>undefined);
  };
  const verifyDetailReturn=async(expectedPage:number)=>{
    const actualPage=await readVisiblePageNumber(page);
    emit({type:"detail_return",context:"PRESERVED",expectedPage,actualPage,message:`detail_return expectedPage=${expectedPage} actualPage=${actualPage??"unknown"} context=PRESERVED`});
    if(actualPage!==expectedPage){
      emit({type:"recovery",status:"SEARCH_PAGE_STATE_MISMATCH",message:`search_page_state_mismatch expected=${expectedPage} actual=${actualPage??"unknown"}`});
      await restoreWithSearchRecovery(expectedPage);
    }
  };
  try {
    let pageNumber=firstPage;
    searchPages: while (pageNumber <= totalPages) {
      await checkpoint(pageNumber);
      if(restartRequired){const rebuilt=parseSearchResult(await page.content());const rebuiltFirstPage=await readVisiblePageNumber(page);if(rebuiltFirstPage!==1)throw new Error(`NEW_SEARCH_NOT_ON_PAGE_ONE actual=${rebuiltFirstPage??"unknown"}`);totalPages=rebuilt.totalPages??1;sourceTotal=rebuilt.total;repo.restartSearchExecution(job,sourceTotal,totalPages,restartReason);emit({type:"search_context_rebuilt",reason:restartReason,total:sourceTotal,totalPages,message:`search_context_rebuilt reason=${restartReason} page=1 total=${sourceTotal} pages=${totalPages}`});restartRequired=false;restartReason="";pageNumber=1;continue searchPages;}
      if ((await readVisiblePageNumber(page)) !== pageNumber) {const rebuilt=await restoreWithSearchRecovery(pageNumber);if(rebuilt){restartRequired=true;restartReason="search_recovery";continue searchPages;}}
      const search = parseSearchResult(await page.content());
      try{repo.enqueue(job, pageNumber, search.companies)}catch(error){const message=error instanceof Error?error.message:String(error);emit({type:"db_write_failed",operation:"enqueue",page:pageNumber,error:message,message:`db_write_failed operation=enqueue page=${pageNumber} error=${message}`});throw error}
      if (targetId)try{repo.linkQueuedCompanies(targetId, job)}catch(error){const message=error instanceof Error?error.message:String(error);emit({type:"db_write_failed",operation:"linkQueuedCompanies",page:pageNumber,error:message,message:`db_write_failed operation=linkQueuedCompanies page=${pageNumber} error=${message}`});throw error}
      emit({ type: "status", status: "RUNNING", message: `Search page ${pageNumber}: ${search.companies.length} companies queued` });

      while (true) {
        await checkpoint(pageNumber);
        if(restartRequired)continue searchPages;
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
            const rebuilt=await restoreWithSearchRecovery(expectedPage);
            if(rebuilt){restartRequired=true;restartReason="search_recovery";continue searchPages;}
            emit({type:"status",status:"RUNNING",message:`search_recovery_success targetPage=${expectedPage}`});
          }
          await companyLink(page,item.sminfo_kcd);
          await waitBeforeDetailAccess(pageNumber,item);
          emit({ type: "status", status: "RUNNING", companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,message: `Collecting ${item.company_name_snapshot}` });
          detailPage=await openCompanyDetail(page,detailPage,item.sminfo_kcd);
          const html = await captureCompanyDetailSections(detailPage,emit);
          if (/정상적인\s*화면\s*접근\s*방법이\s*아닙니다|비정상\s*접근/.test(html)) throw new HardRecoveryRequired("ABNORMAL_ACCESS_PAGE");
          if (restricted(html)) throw new Error("ACCESS_RESTRICTED");
          const detail = parseCompanyDetail(html);
          if(!detailIdentityMatches(detail,{kcd:item.sminfo_kcd,companyName:item.company_name_snapshot}))throw new Error(`DETAIL_IDENTITY_MISMATCH expected_kcd=${item.sminfo_kcd} actual_kcd=${detail.kcd||"missing"}`);
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
            total: sourceTotal,
          });
          await resetDetailPage();
          await verifyDetailReturn(expectedPage);

          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "COLLECTOR_STOPPED") {
            repo.jobStatus(job, "STOPPED");
            emit({ type: "status", status: "STOPPED", message: "Collection stopped" });
            return;
          }
          const classified=await classifyNavigationFailure(page,message);
          if(recovery&&(isRecoverableNavigationCode(classified.code)||requiresHardRecovery(error))&&recoveryAttempts<1){
            recoveryAttempts++;
            emit({type:"status",status:"RECOVERING",message:"SMINFO session expired; recovering automatically"});
            try{await performHardRecovery(classified.code);repo.event(job,item.collection_item_id,"COLLECTION_RESUMED",`kcd=${item.sminfo_kcd}`);continue searchPages}catch(recoveryError){
              if(control.paused||control.stopped)throw recoveryError;
              const recoveryMessage=recoveryError instanceof Error?recoveryError.message:String(recoveryError);
              const recoveryCode=recoveryFailureCode(recoveryMessage);
              consecutiveSystemErrors++;
              emit({type:"error",code:recoveryCode,message:`${recoveryMessage}; system error count ${consecutiveSystemErrors}/${RATE_LIMIT.maxConsecutiveErrors}`});
              repo.jobStatus(job,"ERROR");emit({type:"status",status:"ERROR",message:`hard recovery failed after bounded retries: ${recoveryCode}`});return;
            }
          }
          const effectiveCode=message.includes("DISCLOSURE_DENIED")?"DISCLOSURE_DENIED":message==="ACCESS_RESTRICTED"?"ACCESS_RESTRICTED":classified.code === "UNKNOWN_NAVIGATION_STATE" ? "DETAIL_FAILED" : classified.code;
          const errorClass=classifyCollectorError(effectiveCode);
          if(errorClass==="SYSTEM_ERROR"){
            await performHardRecovery(`${effectiveCode} ${message}`);
            continue searchPages;
          }
          if(errorClass==="SKIP")try{repo.skipDisclosureDenied(item.collection_item_id,"업체가 요청 정보비공개 업체입니다.")}catch(dbError){const dbMessage=dbError instanceof Error?dbError.message:String(dbError);emit({type:"db_write_failed",operation:"skipDisclosureDenied",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,error:dbMessage,message:`db_write_failed operation=skipDisclosureDenied company=${item.company_name_snapshot} kcd=${item.sminfo_kcd} error=${dbMessage}`});throw dbError}else repo.fail(item.collection_item_id,effectiveCode,`${message} url=${classified.state.url}`);
          consecutiveSystemErrors=0;
          emit({ type:errorClass==="SKIP"?"company_skipped":"error",companyName:item.company_name_snapshot,kcd:item.sminfo_kcd,sourcePage:item.source_page_number,actualPage:classified.state.path===SMINFO.searchPath?await readVisiblePageNumber(page):undefined,url:classified.state.url, code:effectiveCode,errorClass, message:`${message} url=${classified.state.url}` });
          await resetDetailPage();
          await verifyDetailReturn(item.source_page_number).catch(() => undefined);
          break;
        }
      }
      pageNumber++;
    }
    const result=repo.finishJob(job);
    if (targetId) repo.targetStatus(targetId, result.status);
    emit({ type: "status", status: result.status, message: result.status === "COMPLETED" ? "Collection completed" : `Collection completed with ${result.failed} failure(s)` });
  } catch (error) {
    if(control.paused||control.stopped){
      const interruptedStatus=control.paused?"PAUSED":"STOPPED";
      repo.jobStatus(job,interruptedStatus);
      if(targetId)repo.targetStatus(targetId,interruptedStatus);
      return;
    }
    const message=error instanceof Error?error.message:String(error);
    repo.jobStatus(job, "ERROR");
    if (targetId) repo.targetStatus(targetId, "ERROR");
    throw error;
  } finally {
    if(detailPage && !detailPage.isClosed()) await detailPage.close().catch(()=>undefined);
  }
}
