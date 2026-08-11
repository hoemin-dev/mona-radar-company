import { chromium, type BrowserContext, type Page } from "playwright";
import { SMINFO } from "../sminfo/constants.js";
export async function openPersistentSminfo(profilePath:string,emit:(event:unknown)=>void=()=>undefined):Promise<{context:BrowserContext;page:Page}>{
 const context=await chromium.launchPersistentContext(profilePath,{headless:false,channel:"msedge",chromiumSandbox:true,args:["--disable-save-password-bubble","--disable-password-generation","--disable-features=PasswordLeakDetection,PasswordManagerOnboarding"]});
 const page=context.pages()[0]??await context.newPage();
 page.on("dialog",dialog=>{
  emit({type:"sminfo_dialog",dialogType:dialog.type(),message:dialog.message(),url:page.url()});
  void (dialog.type()==="alert"?dialog.accept():dialog.dismiss()).catch(()=>undefined);
 });
 return {context,page};
}
export async function waitForSearch(page:Page){ await page.waitForURL(url=>url.pathname===SMINFO.searchPath,{timeout:0}); await page.locator("a[onclick*='onMoveView01']").first().waitFor({timeout:0}); }
