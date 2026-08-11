import type { Page } from "playwright";
import { SMINFO } from "./constants.js";
import { SMINFO_SELECTORS } from "./selectors.js";

export type LoginFailure = "INVALID_CREDENTIAL" | "LOGIN_DOM_CHANGED" | "NETWORK_ERROR" | "LOGIN_RESULT_UNKNOWN";
type EventEmitter = (event: unknown) => void;

export async function isLoggedIn(page: Page) {
  let navigationError: unknown;
  try {
    await page.goto(SMINFO.searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (error) {
    navigationError = error;
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  }
  const currentPath = new URL(page.url()).pathname;
  if (currentPath === SMINFO.loginPath) return false;
  if (navigationError && currentPath !== SMINFO.searchPath) throw navigationError;
  const onSearch = currentPath === SMINFO.searchPath;
  const finder = await page.getByText("산업코드찾기", { exact: true }).filter({ visible: true }).count();
  return onSearch && finder > 0;
}

export async function login(page: Page, credential: { username: string; password: string }, emit:EventEmitter=()=>undefined) {
  const id = page.locator(SMINFO_SELECTORS.login.id).filter({ visible: true }).first();
  const password = page.locator(SMINFO_SELECTORS.login.password).filter({ visible: true }).first();
  const submit = page.locator(SMINFO_SELECTORS.login.submit).filter({ visible: true }).first();
  if (!(await id.count()) || !(await password.count()) || !(await submit.count())) throw new Error("LOGIN_DOM_CHANGED");
  emit({type:"login_step",stage:"ID_PASSWORD_FILL",message:"Filling SMINFO ID and password",url:page.url()});
  await id.fill(credential.username);
  await password.fill(credential.password);
  if ((await id.inputValue()) !== credential.username || (await password.inputValue()).length !== credential.password.length) throw new Error("LOGIN_FORM_VALUE_MISMATCH");
  emit({type:"login_step",stage:"SUBMIT",message:"Submitting SMINFO login form",url:page.url()});
  await submit.click();
  await Promise.race([
    page.waitForURL((url) => url.pathname !== SMINFO.loginPath, { timeout: 15_000 }),
    id.waitFor({ state: "hidden", timeout: 15_000 }),
  ]).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  if (await page.locator(SMINFO_SELECTORS.login.id).filter({ visible: true }).count()) {
    throw new Error(`INVALID_CREDENTIAL url=${page.url()}`);
  }
  emit({type:"login_step",stage:"SUBMIT_COMPLETED",message:"SMINFO login form submitted",url:page.url()});
}

export async function openCompanySearch(page: Page) {
  for (const extra of page.context().pages()) if (extra !== page) await extra.close().catch(() => undefined);
  await page.goto(SMINFO.searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (await page.locator(SMINFO_SELECTORS.login.id).filter({ visible: true }).count()) throw new Error("SESSION_EXPIRED");
  if (new URL(page.url()).pathname !== SMINFO.searchPath) throw new Error(`COMPANY_SEARCH_NAVIGATION_FAILED url=${page.url()}`);
  await page.getByText("산업코드찾기", { exact: true }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 30_000 });
}

export async function ensureLoggedIn(page: Page, credential?: { username: string; password: string }, emit:EventEmitter=()=>undefined) {
  if (await isLoggedIn(page)) return "SESSION_REUSED" as const;
  if (!credential) throw new Error("CREDENTIAL_REQUIRED");
  emit({type:"status",status:"LOGIN_IN_PROGRESS",message:"Opening the SMINFO login page"});
  emit({type:"login_step",stage:"LOGIN_ENTRY",message:"Entering SMINFO through the main page",url:SMINFO.origin});
  let entryNavigationError:unknown;
  try {
    await page.goto(SMINFO.origin, { waitUntil: "commit", timeout: 30_000 });
  } catch(error) {
    entryNavigationError=error;
  }
  const loginInput=page.locator(SMINFO_SELECTORS.login.id).filter({visible:true}).first();
  await loginInput.waitFor({state:"visible",timeout:30_000}).catch(()=>{
    const cause=entryNavigationError instanceof Error?entryNavigationError.message:String(entryNavigationError??"");
    throw new Error(`LOGIN_PAGE_NOT_READY url=${page.url()} navigation=${cause}`);
  });
  if(new URL(page.url()).pathname!==SMINFO.loginPath){
    throw new Error(`LOGIN_PAGE_NAVIGATION_FAILED url=${page.url()}`);
  }
  if(entryNavigationError){
    emit({type:"login_step",stage:"LOGIN_ENTRY_REDIRECT_COMPLETED",message:"SMINFO redirected to the login page",url:page.url()});
  }
  await login(page, credential, emit);
  await openCompanySearch(page);
  emit({type:"login_step",stage:"SEARCH_PAGE",message:"SMINFO company search page opened",url:page.url()});
  return "AUTO_LOGIN" as const;
}
