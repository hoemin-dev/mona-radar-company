import type {Page} from "playwright";
import {readVisiblePageNumber} from "./navigation-test.js";
import {SMINFO} from "../sminfo/constants.js";
import {SMINFO_SELECTORS} from "../sminfo/selectors.js";

type Emit=(event:unknown)=>void;
interface PaginationControl {text:string;target:number}
export interface PaginationSnapshot {current?:number;controls:PaginationControl[];blockStart?:number;blockEnd?:number}

export function choosePaginationControl(snapshot:PaginationSnapshot,target:number):PaginationControl|undefined{
  const exact=snapshot.controls.find(control=>control.target===target);if(exact)return exact;
  const current=snapshot.current??0;
  const directional=snapshot.controls.filter(control=>target>current?control.target>current:control.target<current);
  return target>current
    ?directional.filter(control=>control.target<=target).sort((a,b)=>b.target-a.target)[0]
    :directional.filter(control=>control.target>=target).sort((a,b)=>a.target-b.target)[0];
}
export const paginationMoveReady=(snapshot:PaginationSnapshot,target:number,resultRows:number)=>snapshot.current===target&&snapshot.controls.length>0&&resultRows>0;

async function snapshot(page:Page):Promise<PaginationSnapshot>{
  const controls=await page.locator("[onclick*='searchByTarget']").filter({visible:true}).evaluateAll(elements=>elements.map(element=>{const onclick=element.getAttribute("onclick")??"";const match=/searchByTarget\(\s*['\"]?(\d+)/.exec(onclick);return {text:(element.textContent??"").trim(),target:match?Number(match[1]):0}}).filter(value=>value.target>0));
  const current=await readVisiblePageNumber(page);
  const numeric=controls.filter(control=>/^\d+$/.test(control.text)).map(control=>Number(control.text));
  return {current,controls,blockStart:numeric.length?Math.min(...numeric):undefined,blockEnd:numeric.length?Math.max(...numeric):undefined};
}

export async function restoreSearchPage(page:Page,targetPage:number,emit:Emit,maxAttempts=3,reason="page_alignment"){
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const path=(()=>{try{return new URL(page.url()).pathname}catch{return ""}})();
    if(path!==SMINFO.searchPath)throw new Error(`SEARCH_RESULT_STATE_LOST url=${page.url()}`);
    let state=await snapshot(page);
    emit({type:"pagination",stage:"pagination_restore_start",reason,target:targetPage,current:state.current,attempt,message:`pagination_restore_start reason=${reason} target=${targetPage} current=${state.current??"unknown"}`});
    emit({type:"pagination",stage:"pagination_block_detected",start:state.blockStart,end:state.blockEnd,message:`pagination_block_detected start=${state.blockStart??"unknown"} end=${state.blockEnd??"unknown"}`});
    try{
      for(let moves=0;moves<100&&state.current!==targetPage;moves++){
        const action=choosePaginationControl(state,targetPage);
        if(!action)throw new Error(`PAGINATION_LINK_NOT_FOUND page=${targetPage}`);
        emit({type:"pagination",stage:action.target===targetPage?"pagination_target_visible":"pagination_block_move",target:targetPage,moveTarget:action.target,message:action.target===targetPage?`pagination_target_visible target=${targetPage}`:`pagination_block_move direction=${action.target>(state.current??0)?"next":"previous"} target=${action.target}`});
        const clickable=page.locator("[onclick*='searchByTarget']").filter({visible:true}).filter({hasText:new RegExp(`^\\s*${action.text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\s*$`)});
        const candidates=await clickable.all();let selected=undefined as typeof candidates[number]|undefined;
        for(const candidate of candidates){const onclick=await candidate.getAttribute("onclick");if(new RegExp(`searchByTarget\\(\\s*['\"]?${action.target}(?:['\"])?\\s*\\)`).test(onclick??"")){selected=candidate;break}}
        if(!selected)throw new Error(`PAGINATION_CONTROL_NOT_FOUND target=${action.target}`);
        const before=state.current;await selected.click();
        const deadline=Date.now()+30_000;let rows=0;
        do{
          await page.waitForLoadState("domcontentloaded").catch(()=>undefined);
          state=await snapshot(page);
          rows=await page.locator(SMINFO_SELECTORS.company.resultLink).filter({visible:true}).count().catch(()=>0);
          if(paginationMoveReady(state,action.target,rows))break;
          await page.waitForTimeout(200);
        }while(Date.now()<deadline);
        if(!paginationMoveReady(state,action.target,rows))throw new Error(`PAGINATION_NOT_READY from=${before??"unknown"} target=${action.target} actual=${state.current??"unknown"} controls=${state.controls.length} rows=${rows}`);
        emit({type:"pagination",stage:"pagination_move_ready",reason,target:targetPage,moveTarget:action.target,actual:state.current,rows,message:`pagination_move_ready reason=${reason} target=${action.target} actual=${state.current} rows=${rows}`});
      }
      const rows=await page.locator(SMINFO_SELECTORS.company.resultLink).filter({visible:true}).count();
      if(state.current!==targetPage||rows===0)throw new Error(`SEARCH_PAGE_STATE_MISMATCH expected=${targetPage} actual=${state.current??"unknown"} rows=${rows}`);
      emit({type:"pagination",stage:"pagination_restore_success",reason,target:targetPage,actual:state.current,message:`pagination_restore_success reason=${reason} target=${targetPage} actual=${state.current}`});
      return;
    }catch(error){const message=error instanceof Error?error.message:String(error);emit({type:"pagination",stage:"pagination_restore_failed",reason,target:targetPage,attempt,message:`pagination_restore_failed reason=${reason} target=${targetPage} attempt=${attempt}/${maxAttempts} error=${message}`});if(attempt===maxAttempts)throw new Error(`PAGINATION_RESTORE_FAILED target=${targetPage} ${message}`);await page.waitForTimeout(250)}
  }
}
