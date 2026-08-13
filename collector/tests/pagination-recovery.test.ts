import {describe,expect,it} from "vitest";
import {choosePaginationControl,type PaginationSnapshot} from "../browser/search-page-recovery.js";
import {restoreSearchPage} from "../browser/search-page-recovery.js";
import {chromium} from "playwright";

const block=(current:number,start:number,end:number,next?:number):PaginationSnapshot=>({current,blockStart:start,blockEnd:end,controls:[...Array.from({length:end-start+1},(_,index)=>({text:String(start+index),target:start+index})),...(next?[{text:"다음",target:next}]:[])]});

describe("pagination block recovery",()=>{
  it("selects a visible target in the current block",()=>expect(choosePaginationControl(block(9,1,10,11),10)?.target).toBe(10));
  it("uses the next-block control when restoring page 11 from page 1",()=>expect(choosePaginationControl(block(1,1,10,11),11)).toEqual({text:"다음",target:11}));
  it("selects page 12 after entering the 11-20 block",()=>expect(choosePaginationControl(block(11,11,20,21),12)?.target).toBe(12));
  it("uses the previous-block control when moving backwards",()=>{const state:blockReturn={current:11,blockStart:11,blockEnd:20,controls:[{text:"이전",target:10},...Array.from({length:10},(_,i)=>({text:String(11+i),target:11+i}))]};expect(choosePaginationControl(state,1)?.target).toBe(10)});
  it("returns undefined instead of consuming a queue when no usable control exists",()=>expect(choosePaginationControl({current:1,controls:[],blockStart:1,blockEnd:1},11)).toBeUndefined());
});

type blockReturn=PaginationSnapshot;

it.skipIf(!process.env.RUN_BROWSER_TESTS)("restores page 11 through the next block and then reaches page 12",async()=>{
  const browser=await chromium.launch({channel:"msedge",headless:true,chromiumSandbox:true});const context=await browser.newContext();const page=await context.newPage();
  const html=`<div id="app"></div><script>
    function searchByTarget(page){window.pageNo=Number(page);render()}
    function render(){const p=window.pageNo||1,start=Math.floor((p-1)/10)*10+1,end=start+9;let links='';if(start>1)links+='<a onclick="searchByTarget('+(start-1)+')">이전</a>';for(let n=start;n<=end;n++)links+=n===p?'<strong class="current">'+n+'</strong>':'<a onclick="searchByTarget('+n+')">'+n+'</a>';links+='<a onclick="searchByTarget('+(end+1)+')">다음</a>';document.querySelector('#app').innerHTML='<div class="paging">'+links+'</div><table><tr><td><a onclick="onMoveView01(\\'k'+p+'\\')">Company '+p+'</a></td></tr></table>'}render();
  <\/script>`;
  await context.route("https://sminfo.mss.go.kr/gc/sf/GSF002R0.print",route=>route.fulfill({contentType:"text/html",body:html}));await page.goto("https://sminfo.mss.go.kr/gc/sf/GSF002R0.print");
  await restoreSearchPage(page,11,()=>undefined);expect(await page.locator("strong.current").textContent()).toBe("11");
  await restoreSearchPage(page,12,()=>undefined);expect(await page.locator("strong.current").textContent()).toBe("12");
  await browser.close();
});
