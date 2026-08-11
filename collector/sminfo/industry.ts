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
  const confirm=page.getByRole("button",{name:/^(선택|확인|적용)$/}).filter({visible:true}).first();
  if(await confirm.count()) await confirm.click();
}

export async function resolveIndustry(page:Page,target:string,emit:(event:unknown)=>void):Promise<IndustryCandidate>{
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
  emit({type:"industry_candidates",target,candidates:candidates.map(x=>x.candidate)});
  if(!candidates.length) throw new Error(`TARGET_NOT_FOUND target=${target}`);
  const exact=candidates.filter(x=>normalized(x.candidate.name)===normalized(target));
  const selectable=exact.length===1?exact:candidates.length===1?candidates:[];
  if(selectable.length!==1) throw new Error(`INDUSTRY_SELECTION_REQUIRED candidates=${JSON.stringify(candidates.map(x=>x.candidate))}`);
  const closePromise=lookup!==page?lookup.waitForEvent("close",{timeout:10_000}).catch(()=>undefined):undefined;
  await choose(selectable[0]!.row,lookup);
  if(closePromise) await closePromise;
  await page.bringToFront();
  emit({type:"industry_resolved",target,industryName:selectable[0]!.candidate.name,industryCode:selectable[0]!.candidate.code});
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
      emit({type:"industry_applied",industryCode:industry.code,industryName:industry.name,scope:snapshot});
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`INDUSTRY_NOT_APPLIED code=${industry.code??""} name=${industry.name} scope=${JSON.stringify(snapshot)} url=${page.url()}`);
}

export async function runCompanySearch(page:Page,industry?:IndustryCandidate,emit:(event:unknown)=>void=()=>undefined) {
  if(industry?.code||industry?.name) await waitForIndustryApplied(page,industry,emit);
  const controls=page.locator('a:visible,button:visible,input[type="button"]:visible,input[type="submit"]:visible');
  const labels=await controls.evaluateAll(elements=>elements.map(element=>((element as HTMLInputElement).value||element.textContent||"").replace(/\s+/g," ").trim()));
  const resetIndices=labels.map((label,index)=>label==="초기화"?index:-1).filter(index=>index>=0);
  const searchIndices=labels.map((label,index)=>label==="검색"?index:-1).filter(index=>index>=0);
  const chosenIndex=await controls.evaluateAll((elements,{searchIndices,resetIndices})=>{
    const distance=(a:Element,b:Element)=>{
      const ancestors=new Map<Element,number>();let node:Element|null=a;let depth=0;
      while(node){ancestors.set(node,depth++);node=node.parentElement;}
      node=b;depth=0;while(node){const first=ancestors.get(node);if(first!==undefined)return first+depth;node=node.parentElement;depth++;}
      return 100;
    };
    let best:{index:number;score:number}|undefined;
    for(const searchIndex of searchIndices){
      const search=elements[searchIndex]!;let score=resetIndices.length?Number.NEGATIVE_INFINITY:searchIndex;
      if(search.closest("header,nav"))score-=500;
      for(const resetIndex of resetIndices){
        const reset=elements[resetIndex]!;
        let pair=100-distance(search,reset)*10;
        if(search.parentElement===reset.parentElement)pair+=300;
        if(search.closest("form")&&search.closest("form")===reset.closest("form"))pair+=200;
        if(search.compareDocumentPosition(reset)&Node.DOCUMENT_POSITION_FOLLOWING)pair+=25;
        score=Math.max(score,pair);
      }
      if(!resetIndices.length)score=searchIndex;
      if(!best||score>best.score)best={index:searchIndex,score};
    }
    return best?.index;
  },{searchIndices,resetIndices});
  if(chosenIndex===undefined) throw new Error(`COMPANY_SEARCH_BUTTON_NOT_FOUND controls=${JSON.stringify(labels)}`);
  const button=controls.nth(chosenIndex);
  const diagnostic=await button.evaluate((element)=>({tag:element.tagName,id:element.id,className:element.className,onclick:element.getAttribute("onclick"),value:(element as HTMLInputElement).value||undefined}));
  emit({type:"status",status:"COMPANY_SEARCHING",message:`Clicking company search button ${JSON.stringify(diagnostic)}`});
  await button.scrollIntoViewIfNeeded();
  await button.click({timeout:10_000});
  await page.waitForLoadState("domcontentloaded").catch(()=>undefined);
  const results=page.locator(SMINFO_SELECTORS.company.resultLink).filter({visible:true});
  await results.first().waitFor({state:"visible",timeout:30_000}).catch(async()=>{
    const text=clean(await page.locator("body").innerText());
    if(/검색결과가\s*없|조회된\s*데이터가\s*없|0\s*건/.test(text)) throw new Error("COMPANY_SEARCH_ZERO_RESULTS");
    throw new Error(`COMPANY_SEARCH_RESULT_NOT_FOUND url=${page.url()}`);
  });
}
