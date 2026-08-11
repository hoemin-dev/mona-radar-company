import type { Page } from "playwright";

const DETAIL_SECTIONS = ["기본정보", "사업장정보", "연혁", "경영진", "매출현황", "인증", "지정"] as const;

export async function captureCompanyDetailSections(page:Page,emit:(event:unknown)=>void){
  const captured:string[]=[];
  const seen=new Set<string>();
  const capture=async(label:string)=>{
    const body=await page.locator("body").innerHTML();
    const key=body.replace(/\s+/g," ");
    if(!seen.has(key)){seen.add(key);captured.push(`<section data-sminfo-section="${label}"><h2>${label}</h2>${body}</section>`);}
  };
  await capture("기본정보");
  for(const label of DETAIL_SECTIONS.slice(1)){
    const tab=page.locator("a:visible,button:visible").filter({hasText:new RegExp(`^\\s*${label}\\s*$`)}).first();
    if(!(await tab.count())){emit({type:"detail_section",section:label,found:false});continue;}
    await tab.click();
    await page.waitForLoadState("domcontentloaded").catch(()=>undefined);
    await page.waitForTimeout(350);
    await capture(label);
    emit({type:"detail_section",section:label,found:true});
  }
  return `<html><body>${captured.join("\n")}</body></html>`;
}
