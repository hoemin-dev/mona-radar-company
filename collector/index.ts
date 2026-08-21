import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import migration from "../src-tauri/migrations/001_initial.sql";
import migration2 from "../src-tauri/migrations/002_collector_automation.sql";
import migration3 from "../src-tauri/migrations/003_company_detail_sections.sql";
import migration4 from "../src-tauri/migrations/004_collection_quality.sql";
import migration5 from "../src-tauri/migrations/005_industry_master.sql";
import migration6 from "../src-tauri/migrations/006_source_detail_model.sql";
import migration7 from "../src-tauri/migrations/007_company_disclosure_state.sql";
import { openPersistentSminfo } from "./browser/prototype.js";
import { runNavigationTest } from "./browser/navigation-test.js";
import { collectCurrentSearch } from "./collector.js";
import { CollectorControl } from "./control.js";
import { Repository } from "./database/repository.js";
import { ensureLoggedIn } from "./sminfo/session.js";
import { resolveIndustry, runCompanySearchWithRepair, type IndustryCandidate } from "./sminfo/industry.js";
import { refreshIndustryMaster } from "./industry-master.js";
import {requiresHardRecovery} from "./hard-recovery.js";

const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const profile = path.join(appData, "com.monaradar.company", "collector-browser-profile");
const dataDir = path.join(appData, "com.monaradar.company", "data");
fs.mkdirSync(dataDir, { recursive: true });

if(process.argv.includes("--industry-refresh")){
  const dbFile=path.join(dataDir,"mona-radar-company.sqlite3");
  const repo=new Repository(dbFile,`${migration}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}\n${migration7}`);repo.close();
  const credential=JSON.parse(fs.readFileSync(0,"utf8")) as {username:string;password:string};
  const industryProfile=path.join(appData,"com.monaradar.company","industry-browser-profile");
  try{await refreshIndustryMaster(industryProfile,dbFile,credential,emit)}catch(error){emit({type:"industry_refresh_status",status:"FAILED",message:error instanceof Error?error.message:String(error)});process.exitCode=1}
}else{

emit({ type: "status", status: "WAITING_FOR_BROWSER", message: "Opening SMINFO browser" });
const control = new CollectorControl((status, message) => emit({ type: "status", status, message }));
let browser = await openPersistentSminfo(profile, emit);
emit({ type: "status", status: "READY", message: "Collector browser is ready" });

while (true) {
  const queued = await control.waitForAction();
  if(queued.action === "shutdown")break;
  if (queued.action === "nav_test") {
    try {
      await runNavigationTest(browser.page, emit);
      emit({ type: "status", status: "READY", message: "Navigation Test succeeded; browser remains open" });
    } catch (error) {
      emit({ type: "error", code: "NAV_TEST_FAILED", message: error instanceof Error ? error.message : String(error) });
      emit({ type: "status", status: "READY", message: "Navigation Test failed; browser remains open" });
    }
    continue;
  }

  if (queued.action === "login") {
    const request = queued.request ?? { target: "액체 펌프 제조업" };
    try {
      emit({ type: "status", status: "LOGIN_IN_PROGRESS", message: "Signing in to SMINFO" });
      await ensureLoggedIn(browser.page, request.credential, emit);
      request.credential = undefined;
      emit({ type: "login_status", loggedIn: true, message: "SMINFO login succeeded" });
      emit({ type: "status", status: "READY", message: "SMINFO account is ready; company search page opened" });
    } catch (error) {
      request.credential = undefined;
      emit({ type: "login_status", loggedIn: false, message: "SMINFO login failed" });
      emit({ type: "error", code: error instanceof Error ? error.message : "LOGIN_FAILED", message: "SMINFO 자동 로그인에 실패했습니다. 저장된 계정 정보를 확인해주세요." });
      emit({ type: "status", status: "LOGIN_FAILED", message: "Account update is required" });
    }
    continue;
  }

  const request = queued.request ?? { target: "액체 펌프 제조업" };
  control.beginCollection();
  const repo = new Repository(path.join(dataDir, "mona-radar-company.sqlite3"), `${migration}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}\n${migration7}`);
  try {
    emit({ type: "status", status: "LOGIN_CHECKING", message: "Checking SMINFO login session" });
    const activeCredential=request.credential;
    const loginMode = await ensureLoggedIn(browser.page, activeCredential, emit);
    request.credential = undefined;
    emit({ type: "login_status", loggedIn: true,sessionStatus:"LOGGED_IN", message: loginMode === "SESSION_REUSED" ? "Existing SMINFO session reused" : "SMINFO automatic login succeeded" });
    let industry:IndustryCandidate={name:request.target,code:request.industryCode};
    const hardRecover=async(reason:string)=>{
      while(true){
        for(let attempt=1;attempt<=3;attempt++){
          if(control.paused||control.stopped)throw new Error(control.paused?"COLLECTOR_PAUSED":"COLLECTOR_STOPPED");
          emit({type:"recovery",status:"HARD_RECOVERY_BROWSER_RESTART",reason,attempt,maxAttempts:3,message:`closing and restarting collector browser attempt=${attempt}/3`});
          await browser.context.close().catch(()=>undefined);
          if(attempt>1)await new Promise(resolve=>setTimeout(resolve,5_000));
          if(control.paused||control.stopped)throw new Error(control.paused?"COLLECTOR_PAUSED":"COLLECTOR_STOPPED");
          try{
            browser=await openPersistentSminfo(profile,emit);
            const mode=await ensureLoggedIn(browser.page,activeCredential,emit);
            emit({type:"login_status",loggedIn:true,sessionStatus:"LOGGED_IN",message:mode==="SESSION_REUSED"?"Existing login state verified":"SMINFO re-login succeeded"});
            let selected=await resolveIndustry(browser.page,request.target,emit,request.industryCode??industry.code);
            selected=await runCompanySearchWithRepair(browser.page,selected,{target:request.target,preferredCode:request.industryCode??industry.code},emit);
            return {page:browser.page,industry:selected};
          }catch(error){emit({type:"error",code:"HARD_RECOVERY_ATTEMPT_FAILED",attempt,message:error instanceof Error?error.message:String(error)})}
        }
        emit({type:"hard_recovery_cooldown",cooldown:300,status:"RECOVERY_COOLDOWN",message:"Hard Recovery 3회 실패 — 5분 cooldown 중 (자동 재시도 예정); hard_recovery_cooldown cooldown=300s"});
        emit({type:"status",status:"RECOVERY_COOLDOWN",message:"Hard Recovery 3회 실패 — 5분 cooldown 중 (자동 재시도 예정)"});
        const cooldownEndsAt=Date.now()+300_000;
        while(Date.now()<cooldownEndsAt){
          if(control.paused||control.stopped)throw new Error(control.paused?"COLLECTOR_PAUSED":"COLLECTOR_STOPPED");
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        emit({type:"hard_recovery_cooldown_ended",message:"Hard Recovery cooldown 종료 — 자동 복구 재시도"});
        emit({type:"status",status:"RECOVERING",message:"Hard Recovery cooldown 종료 — 자동 복구 재시도"});
      }
    };
    try{
      emit({ type: "status", status: "INDUSTRY_SEARCHING", message: `Searching SMINFO industry: ${request.target}` });
      industry = await resolveIndustry(browser.page, request.target, emit, request.industryCode);
      emit({ type: "status", status: "COMPANY_SEARCHING", message: `Searching companies: ${industry.name}` });
      industry = await runCompanySearchWithRepair(browser.page,industry,{target:request.target,preferredCode:request.industryCode},emit);
    }catch(error){
      if(!requiresHardRecovery(error))throw error;
      ({industry}=await hardRecover(error instanceof Error?error.message:String(error)));
    }
    const targetId = repo.upsertTarget(request.target, industry.code, industry.name);
    await collectCurrentSearch(browser.page, repo, emit, undefined, control, targetId,{credential:activeCredential,target:request.target,industry,hardRecover});
  } catch (error) {
    if(control.paused||control.stopped)continue;
    const message=error instanceof Error ? error.message : String(error);
    const credentialRequired=message.includes("CREDENTIAL_REQUIRED");
    const targetInvalid=["TARGET_NOT_FOUND","INDUSTRY_SELECTION_REQUIRED","INDUSTRY_NOT_APPLIED","COMPANY_SEARCH_ZERO_RESULTS"].some(code=>message.includes(code));
    const code=credentialRequired?"CREDENTIAL_REQUIRED":targetInvalid?"TARGET_NOT_FOUND":"COLLECTION_FAILED";
    const nextStatus=credentialRequired?"CREDENTIAL_REQUIRED":targetInvalid?"TARGET_NOT_FOUND":"ERROR";
    const statusMessage=credentialRequired
      ?"SMINFO 계정 등록이 필요합니다."
      :targetInvalid
        ?"Target이 잘못되었습니다. Target을 바꾸고 다시 수집 시작을 눌러주세요."
        :"Collection failed; Start or Stop is available";
    emit({ type: "error", code, message });
    emit({ type: "status", status: nextStatus, message: statusMessage });
  } finally {
    control.endCollection();
    repo.close();
  }
  if(control.shutdownRequested)break;
}

control.dispose();
await browser.context.close().catch(()=>undefined);
}
