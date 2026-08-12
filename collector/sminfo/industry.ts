import type { Locator, Page } from "playwright";
import { SMINFO_SELECTORS } from "./selectors.js";

export interface IndustryCandidate { code?: string; name: string }
const clean = (value:string) => value.replace(/\s+/g," ").trim();
const normalized = (value:string) => clean(value).replace(/\s/g,"").toLowerCase();

async function visibleTextInput(page:Page) {
  const labelled = page.getByLabel(/검색어|산업명|업종명|산업코드/i).filter({visible:true}).first();
  if (await labelled.count()) return labelled;
  const inputs = page.locator('input[type="text"]:visible');
  if (!(await inputs.count())) throw new Error("INDUSTRY_KEYWORD_INPUT_NOT_FOUND");
  return inputs.last();
}

async function clickExactButton(page:Page,name:string) {
  const role = page.getByRole("button",{name,exact:true}).filter({visible:true}).first();
  if (await role.count()) { await role.click(); return; }
  const text = page.getByText(name,{exact:true}).filter({visible:true}).first();
  if (!(await text.count())) throw new Error(`BUTTON_NOT_FOUND name=${name}`);
  await text.click();
}

async function readCandidates(page:Page,target:string):Promise<Array<{candidate:IndustryCandidate;row:Locator}>> {
  const rows = await page.locator("tr:visible").all();
  const result:Array<{candidate:IndustryCandidate;row:Locator}>=[];
  for(const row of rows){
    const text=clean(await row.innerText().catch(()=>""));
    if(!text || !normalized(text).includes(normalized(target))) continue;
    const cells=await row.locator("th,td").allInnerTexts().catch(()=>[]);
    const parts=(cells.length?cells:text.split(/\s{2,}|\t|\n/)).map(clean).filter(Boolean);
    const code=parts.map(x=>x.match(/\b[A-Z]?\d{3,8}\b/i)?.[0]).find(Boolean)?.toUpperCase();
    const names=parts.filter(x=>normalized(x).includes(normalized(target))&&!/^[A-Z]?\d{3,8}$/i.test(x));
    const name=names.sort((a,b)=>a.length-b.length)[0]??target;
    result.push({candidate:{code,name},row});
  }
  return result;
}

async function choose(row:Locator,page:Page) {
  const clickable=row.locator('a,button,input[type="radio"],input[type="button"]').filter({visible:true}).first();
  if(await clickable.count()) await clickable.click(); else await row.click();
  if(page.isClosed()) return;
  const confirm=page.getByRole("button",{name:/^(선택|확인|적용)$/}).filter({visible:true}).first();
  const confirmCount=await confirm.count().catch((error)=>{
    if(page.isClosed()) return 0;
    throw error;
  });
  if(confirmCount) await confirm.click();
}

export async function resolveIndustry(page:Page,target:string,emit:(event:unknown)=>void,preferredCode?:string):Promise<IndustryCandidate>{
  const before=new Set(page.context().pages());
  const popupPromise=page.waitForEvent("popup",{timeout:3_000}).catch(()=>undefined);
  await page.getByText("산업코드찾기",{exact:true}).filter({visible:true}).first().click();
  const popup=await popupPromise;
  const lookup=popup??page.context().pages().find(x=>!before.has(x))??page;
  await lookup.waitForLoadState("domcontentloaded").catch(()=>undefined);
  const input=await visibleTextInput(lookup);
  await input.fill(target);
  await clickExactButton(lookup,"검색");
  await lookup.waitForTimeout(500);
  const candidates=await readCandidates(lookup,target);
  emit({type:"industry_candidates",target,candidates:candidates.map(x=>x.candidate),message:`Industry candidates found: ${candidates.length}`});
  if(!candidates.length) throw new Error(`TARGET_NOT_FOUND target=${target}`);
  const byCode=preferredCode?candidates.filter(x=>normalized(x.candidate.code??"")===normalized(preferredCode)):[];
  const exact=candidates.filter(x=>normalized(x.candidate.name)===normalized(target));
  const selectable=byCode.length===1?byCode:exact.length===1?exact:candidates.length===1?candidates:[];
  if(selectable.length!==1) throw new Error(`INDUSTRY_SELECTION_REQUIRED candidates=${JSON.stringify(candidates.map(x=>x.candidate))}`);
  const closePromise=lookup!==page?lookup.waitForEvent("close",{timeout:10_000}).catch(()=>undefined):undefined;
  await choose(selectable[0]!.row,lookup);
  if(closePromise) await closePromise;
  await page.bringToFront();
  emit({type:"industry_resolved",target,industryName:selectable[0]!.candidate.name,industryCode:selectable[0]!.candidate.code,message:`Industry selected: ${selectable[0]!.candidate.name} (${selectable[0]!.candidate.code??"code unavailable"})`});
  return selectable[0]!.candidate;
}

async function waitForIndustryApplied(page:Page,industry:IndustryCandidate,emit:(event:unknown)=>void) {
  const finder=page.getByText("산업코드찾기",{exact:true}).filter({visible:true}).first();
  const row=finder.locator("xpath=ancestor::tr[1]");
  const scope=await row.count()?row:finder.locator("xpath=.." );
  const deadline=Date.now()+15_000;
  let snapshot:{text:string;values:string[]}={text:"",values:[]};
  while(Date.now()<deadline){
    snapshot=await scope.evaluate((element)=>({
      text:(element.textContent??"").replace(/\s+/g," ").trim(),
      values:Array.from(element.querySelectorAll<HTMLInputElement>("input")).map(input=>input.value.trim()).filter(Boolean),
    })).catch(()=>({text:"",values:[]}));
    const haystack=normalized([snapshot.text,...snapshot.values].join(" "));
    const code=industry.code?normalized(industry.code):"";
    const name=normalized(industry.name);
    if((code&&haystack.includes(code))||haystack.includes(name)){
      emit({type:"industry_applied",industryCode:industry.code,industryName:industry.name,scope:snapshot,message:`Industry applied to company search: ${industry.name}`});
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`INDUSTRY_NOT_APPLIED code=${industry.code??""} name=${industry.name} scope=${JSON.stringify(snapshot)} url=${page.url()}`);
}

export async function runCompanySearch(page:Page,industry?:IndustryCandidate,emit:(event:unknown)=>void=()=>undefined) {
  if(industry?.code||industry?.name) await waitForIndustryApplied(page,industry,emit);
  const button=page.locator('button.btn.btn_blue[onclick*="doSelect"]')
    .filter({visible:true,hasText:/^\s*검색\s*$/});
  const buttonCount=await button.count();
  if(buttonCount!==1) throw new Error(`COMPANY_SEARCH_BUTTON_NOT_FOUND selector=button.btn.btn_blue[onclick*="doSelect"] count=${buttonCount}`);
  const searchButton=button.first();
  const diagnostic=await searchButton.evaluate((element)=>({tag:element.tagName,id:element.id,className:element.className,onclick:element.getAttribute("onclick"),text:element.textContent?.trim()}));
  emit({type:"status",status:"COMPANY_SEARCHING",message:`Clicking company search button ${JSON.stringify(diagnostic)}`});
  await searchButton.scrollIntoViewIfNeeded();
  await searchButton.click({timeout:10_000});
  await page.waitForLoadState("domcontentloaded").catch(()=>undefined);
  const results=page.locator(SMINFO_SELECTORS.company.resultLink).filter({visible:true});
  await results.first().waitFor({state:"visible",timeout:30_000}).catch(async()=>{
    const text=clean(await page.locator("body").innerText());
    if(/검색결과가\s*없|조회된\s*데이터가\s*없|0\s*건/.test(text)) throw new Error("COMPANY_SEARCH_ZERO_RESULTS");
    throw new Error(`COMPANY_SEARCH_RESULT_NOT_FOUND url=${page.url()}`);
  });
  const bodyText=clean(await page.locator("body").innerText());
  const totalText=bodyText.match(/검색결과\s*([\d,]+)\s*건/)?.[1];
  const total=totalText?Number(totalText.replace(/,/g,"")):undefined;
  emit({type:"company_search_ready",total,message:total===undefined?"SMINFO company search results loaded":`SMINFO company search results: ${total.toLocaleString()} companies`});
}
