import { chromium, type BrowserContext, type Page } from "playwright";
import { SMINFO } from "../sminfo/constants.js";
export async function openPersistentSminfo(profilePath:string,emit:(event:unknown)=>void=()=>undefined):Promise<{context:BrowserContext;page:Page}>{
 const context=await chromium.launchPersistentContext(profilePath,{headless:false,channel:"msedge",chromiumSandbox:true,args:["--disable-save-password-bubble","--disable-password-generation","--disable-features=PasswordLeakDetection,PasswordManagerOnboarding"]});
 const pages=context.pages();
 const page=pages.find(candidate=>candidate.url()!=="about:blank") ?? pages[0] ?? await context.newPage();
 for(const candidate of pages.filter(candidate=>candidate!==page && candidate.url()==="about:blank")){
  await candidate.close().catch(()=>undefined);
 }
 page.on("dialog",dialog=>{
  emit({type:"sminfo_dialog",dialogType:dialog.type(),message:dialog.message(),url:page.url()});
  void (dialog.type()==="alert"?dialog.accept():dialog.dismiss()).catch(()=>undefined);
 });
 return {context,page};
}
export async function waitForSearch(page:Page){ await page.waitForURL(url=>url.pathname===SMINFO.searchPath,{timeout:0}); await page.locator("a[onclick*='onMoveView01']").first().waitFor({timeout:0}); }
