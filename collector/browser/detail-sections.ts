import type { Locator, Page } from "playwright";

const DETAIL_SECTIONS = [
  {label:"사업장정보",aliases:["사업장정보","사업장 정보","사업장현황"]},
  {label:"연혁",aliases:["연혁","주요연혁","기업연혁"]},
  {label:"경영진",aliases:["경영진","경영진현황","임원현황","임원정보","임원 정보"]},
  {label:"매출현황",aliases:["매출현황","재무현황","재무정보","재무 정보","재무제표"]},
  {label:"인증",aliases:["인증","인증현황","보유인증"]},
  {label:"지정",aliases:["지정","지정현황","기업지정"]},
] as const;

const normalized=(value:string)=>value.replace(/\s+/g,"").trim();

async function findSectionControl(page:Page,aliases:readonly string[]):Promise<Locator|undefined>{
  const controls=page.locator('a:visible,button:visible,[role="tab"]:visible,[onclick]:visible');
  const texts=await controls.evaluateAll(elements=>elements.map(element=>(element.textContent??"").replace(/\s+/g,"").trim()));
  const wanted=aliases.map(normalized);
  const index=texts.findIndex(text=>wanted.some(alias=>text===alias||text.startsWith(alias)));
  return index>=0?controls.nth(index):undefined;
}

export async function captureCompanyDetailSections(page:Page,emit:(event:unknown)=>void){
  const captured:string[]=[];
  const seen=new Set<string>();
  const capture=async(label:string)=>{
    const body=await page.locator("body").innerHTML();
    const key=body.replace(/\s+/g," ");
    if(!seen.has(key)){
      seen.add(key);
      captured.push(`<section data-sminfo-section="${label}"><h2>${label}</h2>${body}</section>`);
      return true;
    }
    return false;
  };

  await capture("기본정보");
  for(const section of DETAIL_SECTIONS){
    const control=await findSectionControl(page,section.aliases);
    if(!control){
      emit({type:"detail_section",section:section.label,found:false,message:`Detail section control not found: ${section.label}`});
      continue;
    }
    const before=(await page.locator("body").innerText()).replace(/\s+/g," ");
    await control.click({timeout:10_000});
    await page.waitForLoadState("domcontentloaded").catch(()=>undefined);
    const deadline=Date.now()+10_000;
    while(Date.now()<deadline){
      const after=(await page.locator("body").innerText()).replace(/\s+/g," ");
      if(after!==before)break;
      await page.waitForTimeout(200);
    }
    const changed=await capture(section.label);
    emit({type:"detail_section",section:section.label,found:true,changed,message:`Detail section captured: ${section.label}${changed?"":" (same page content)"}`});
  }
  return `<html><body>${captured.join("\n")}</body></html>`;
}
