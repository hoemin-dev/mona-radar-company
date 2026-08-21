import type { Page } from "playwright";
import { SMINFO } from "../sminfo/constants.js";

const DETAIL_WINDOW_NAME="monaRadarDetail";
export async function createDetailPage(searchPage:Page):Promise<Page>{
 const existing=searchPage.context().pages().find(candidate=>candidate!==searchPage&&!candidate.isClosed()&&candidate.url()==="about:blank");
 const detailPage=existing??await searchPage.context().newPage();
 await detailPage.evaluate(name=>{window.name=name},DETAIL_WINDOW_NAME);
 await searchPage.bringToFront();
 return detailPage;
}
async function ensureDetailPage(searchPage:Page,detailPage?:Page):Promise<Page>{if(detailPage && !detailPage.isClosed()) return detailPage; return createDetailPage(searchPage);}
export async function openCompanyDetail(searchPage:Page,detailPage:Page|undefined,kcd:string):Promise<Page>{
 if(searchPage.isClosed()) throw new Error("SEARCH_PAGE_CLOSED");
 detailPage=await ensureDetailPage(searchPage,detailPage);
 await searchPage.evaluate(({windowName,detailPath})=>{const scope=window as unknown as {onMoveView02?:(kedCd:string,bzno:string,pub:string)=>unknown;__monaOriginalMove02?:typeof scope.onMoveView02};if(!scope.__monaOriginalMove02)scope.__monaOriginalMove02=scope.onMoveView02;const original=scope.__monaOriginalMove02;if(typeof original!=="function")throw new Error("ON_MOVE_VIEW_02_NOT_FOUND");scope.onMoveView02=function(kedCd,bzno,pub){const form=document.forms.namedItem("frm") as HTMLFormElement|null;if(!form)throw new Error("SEARCH_FORM_NOT_FOUND");const pageInput=form.elements.namedItem("cmPageNo") as HTMLInputElement|null;const saved={action:form.action,method:form.method,target:form.target,page:pageInput?.value};const nativeSubmit=HTMLFormElement.prototype.submit;HTMLFormElement.prototype.submit=function(){const action=new URL(this.action,location.href);if(action.pathname===detailPath)this.target=windowName;return nativeSubmit.call(this)};try{return original.call(this,kedCd,bzno,pub)}finally{HTMLFormElement.prototype.submit=nativeSubmit;form.action=saved.action;form.method=saved.method;form.target=saved.target;if(pageInput&&saved.page!==undefined)pageInput.value=saved.page}}},{windowName:DETAIL_WINDOW_NAME,detailPath:SMINFO.detailPath});
 const selector=`a[onclick*="onMoveView01('${kcd}')"],a[onclick*='onMoveView01("${kcd}")']`;const link=searchPage.locator(selector).first();if(!await link.count())throw new Error("COMPANY_LINK_NOT_FOUND");
 const navigated=detailPage.waitForURL(url=>url.pathname===SMINFO.detailPath,{timeout:30_000}).then(()=>detailPage);const opened=searchPage.context().waitForEvent("page",{timeout:30_000}).then(async page=>{await page.waitForURL(url=>url.pathname===SMINFO.detailPath,{timeout:30_000});return page});const disclosure=searchPage.waitForEvent("dialog",{timeout:30_000,predicate:dialog=>dialog.message().includes("요청 정보비공개 업체")}).then(async dialog=>{await dialog.accept().catch(()=>undefined);return "DISCLOSURE_DENIED" as const}).catch(()=>new Promise<never>(()=>undefined));await link.click();const active=await Promise.race([Promise.any([navigated,opened]).catch(()=>{throw new Error("DETAIL_NAVIGATION_TIMEOUT")}),disclosure]);if(active==="DISCLOSURE_DENIED")throw new Error("DISCLOSURE_DENIED");await active.waitForLoadState("domcontentloaded");return active;
}
