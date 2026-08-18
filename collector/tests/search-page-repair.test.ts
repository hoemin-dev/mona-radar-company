import {describe,expect,it,vi} from "vitest";
import type {Page} from "playwright";
import {runCompanySearchWithRepair,type SearchRepairHooks} from "../sminfo/industry.js";
import type {BrowserState} from "../sminfo/session.js";

const industry={code:"C29131",name:"액체 펌프 제조업"};
const state=(value:Partial<BrowserState>={}):BrowserState=>({sessionStatus:"LOGGED_IN",url:"https://sminfo.mss.go.kr/gc/sf/GSF002R0.print",path:"/gc/sf/GSF002R0.print",loginForm:false,searchResults:false,detailPage:false,...value});
const page=()=>({url:()=>"https://sminfo.mss.go.kr/gc/sf/GSF002R0.print",locator:()=>{const locator={filter:()=>locator,count:vi.fn(async()=>0)};return locator;}} as unknown as Page);
const setup=(search:SearchRepairHooks["search"],browserState=state())=>{
  let actualPage=1;
  const hooks:SearchRepairHooks={
    inspect:vi.fn(async()=>browserState),conditionPresent:vi.fn(async()=>true),reload:vi.fn(async()=>undefined),ready:vi.fn(async()=>undefined),
    resolve:vi.fn(async()=>industry),search,restore:vi.fn(async(_page,target)=>{actualPage=target;}),currentPage:vi.fn(async()=>actualPage),
  };
  return hooks;
};

describe("incomplete SMINFO search page repair",()=>{
  it("does not reload a normal search page",async()=>{const hooks=setup(vi.fn(async()=>undefined));await runCompanySearchWithRepair(page(),industry,{target:industry.name},()=>undefined,hooks);expect(hooks.reload).not.toHaveBeenCalled();});
  it("reloads once, reapplies Target and restores the requested page",async()=>{let calls=0;const hooks=setup(vi.fn(async()=>{if(calls++===0)throw new Error("COMPANY_SEARCH_BUTTON_NOT_FOUND");}));const events:any[]=[];await runCompanySearchWithRepair(page(),industry,{target:industry.name,targetPage:61},event=>events.push(event),hooks);expect(hooks.reload).toHaveBeenCalledTimes(1);expect(hooks.resolve).toHaveBeenCalledTimes(1);expect(hooks.restore).toHaveBeenCalledWith(expect.anything(),61,expect.anything());expect(events.map(event=>event.type)).toContain("search_page_repair_success");});
  it("never performs a second reload when repair still fails",async()=>{const hooks=setup(vi.fn(async()=>{throw new Error("COMPANY_SEARCH_BUTTON_NOT_FOUND");}));await expect(runCompanySearchWithRepair(page(),industry,{target:industry.name},()=>undefined,hooks)).rejects.toThrow(/SEARCH_PAGE_REPAIR_FAILED/);expect(hooks.reload).toHaveBeenCalledTimes(1);});
  it("does not use search-page repair for an expired login session",async()=>{const hooks=setup(vi.fn(async()=>{throw new Error("COMPANY_SEARCH_BUTTON_NOT_FOUND");}),state({sessionStatus:"EXPIRED",path:"/cm/sv/CSV001R0.do",loginForm:true}));await expect(runCompanySearchWithRepair(page(),industry,{target:industry.name},()=>undefined,hooks)).rejects.toThrow(/COMPANY_SEARCH_BUTTON_NOT_FOUND/);expect(hooks.reload).not.toHaveBeenCalled();});
});
