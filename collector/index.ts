import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import migration from "../src-tauri/migrations/001_initial.sql";
import migration2 from "../src-tauri/migrations/002_collector_automation.sql";
import migration3 from "../src-tauri/migrations/003_company_detail_sections.sql";
import migration4 from "../src-tauri/migrations/004_collection_quality.sql";
import migration5 from "../src-tauri/migrations/005_industry_master.sql";
import migration6 from "../src-tauri/migrations/006_source_detail_model.sql";
import { openPersistentSminfo } from "./browser/prototype.js";
import { runNavigationTest } from "./browser/navigation-test.js";
import { collectCurrentSearch } from "./collector.js";
import { CollectorControl } from "./control.js";
import { Repository } from "./database/repository.js";
import { ensureLoggedIn } from "./sminfo/session.js";
import { resolveIndustry, runCompanySearch } from "./sminfo/industry.js";
import { refreshIndustryMaster } from "./industry-master.js";

const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const profile = path.join(appData, "com.monaradar.company", "collector-browser-profile");
const dataDir = path.join(appData, "com.monaradar.company", "data");
fs.mkdirSync(dataDir, { recursive: true });

if(process.argv.includes("--industry-refresh")){
  const dbFile=path.join(dataDir,"mona-radar-company.sqlite3");
  const repo=new Repository(dbFile,`${migration}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}`);repo.close();
  const credential=JSON.parse(fs.readFileSync(0,"utf8")) as {username:string;password:string};
  const industryProfile=path.join(appData,"com.monaradar.company","industry-browser-profile");
  try{await refreshIndustryMaster(industryProfile,dbFile,credential,emit)}catch(error){emit({type:"industry_refresh_status",status:"FAILED",message:error instanceof Error?error.message:String(error)});process.exitCode=1}
}else{

emit({ type: "status", status: "WAITING_FOR_BROWSER", message: "Opening SMINFO browser" });
const control = new CollectorControl((status, message) => emit({ type: "status", status, message }));
const { context, page } = await openPersistentSminfo(profile, emit);
emit({ type: "status", status: "READY", message: "Collector browser is ready" });

while (true) {
  const queued = await control.waitForAction();
  if(queued.action === "shutdown")break;
  if (queued.action === "nav_test") {
    try {
      await runNavigationTest(page, emit);
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
      await ensureLoggedIn(page, request.credential, emit);
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
  const repo = new Repository(path.join(dataDir, "mona-radar-company.sqlite3"), `${migration}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}`);
  try {
    emit({ type: "status", status: "LOGIN_CHECKING", message: "Checking SMINFO login session" });
    const activeCredential=request.credential;
    const loginMode = await ensureLoggedIn(page, activeCredential, emit);
    request.credential = undefined;
    emit({ type: "login_status", loggedIn: true,sessionStatus:"LOGGED_IN", message: loginMode === "SESSION_REUSED" ? "Existing SMINFO session reused" : "SMINFO automatic login succeeded" });
    emit({ type: "status", status: "INDUSTRY_SEARCHING", message: `Searching SMINFO industry: ${request.target}` });
    const industry = await resolveIndustry(page, request.target, emit, request.industryCode);
    emit({ type: "status", status: "COMPANY_SEARCHING", message: `Searching companies: ${industry.name}` });
    await runCompanySearch(page, industry, emit);
    const targetId = repo.upsertTarget(request.target, industry.code, industry.name);
    await collectCurrentSearch(page, repo, emit, undefined, control, targetId,{credential:activeCredential,target:request.target,industry});
  } catch (error) {
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
await context.close().catch(()=>undefined);
}
