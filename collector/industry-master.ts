import type { Page } from "playwright";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import { openPersistentSminfo } from "./browser/prototype.js";
import { ensureLoggedIn } from "./sminfo/session.js";

type Emit=(event:unknown)=>void;
interface IndustryRow { code:string; name:string; level?:string; parentCode?:string }
const clean=(value:string)=>value.replace(/\s+/g," ").trim();

async function openIndustryPopup(page:Page){
  const before=new Set(page.context().pages());
  const popupPromise=page.waitForEvent("popup",{timeout:10_000});
  await page.getByText("산업코드찾기",{exact:true}).filter({visible:true}).first().click();
  const popup=await popupPromise;
  if(before.has(popup))throw new Error("INDUSTRY_MASTER_POPUP_NOT_OPENED");
  await popup.waitForLoadState("domcontentloaded");
  return popup;
}

export async function parseIndustryRows(page:Page):Promise<IndustryRow[]>{
  return parseIndustryHtml(await page.content());
}

export function parseIndustryHtml(html:string):IndustryRow[]{
  const $=load(html);const rows:IndustryRow[]=[];
  $("tr").each((_,element)=>{
    const cells=$(element).find("th,td").map((__,cell)=>clean($(cell).text())).get().filter(Boolean);
    if(cells.length<2)return;
    // SMINFO includes 21 top-level letter-only divisions (A-U), as well as
    // letter+digit and numeric descendant codes.
    const codeCell=cells.find(value=>/^(?:[A-Z]|[A-Z]\d{1,6}|\d{1,6})$/i.test(value));
    if(!codeCell)return;
    const code=codeCell.toUpperCase();
    const codeIndex=cells.indexOf(codeCell);
    const name=cells.slice(codeIndex+1).find(value=>!/^\d+$/.test(value));
    if(!name||/업종코드|업종명/.test(name))return;
    const level=cells[0]!==codeCell?cells[0]:undefined;
    rows.push({code,name,level});
  });
  return [...new Map(rows.map(row=>[row.code,row])).values()];
}

function applyMaster(dbPath:string,rows:IndustryRow[]){
  if(!rows.length)throw new Error("INDUSTRY_MASTER_EMPTY");
  const db=new DatabaseSync(dbPath);const t=new Date().toISOString(),refreshId=randomUUID();
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
  try{
    db.prepare("INSERT INTO industry_master_refreshes(refresh_id,status,started_at) VALUES(?,'RUNNING',?)").run(refreshId,t);
    const upsert=db.prepare(`INSERT INTO industry_codes(industry_code,industry_name,parent_code,classification_level,is_active,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(industry_code) DO UPDATE SET industry_name=excluded.industry_name,parent_code=COALESCE(excluded.parent_code,industry_codes.parent_code),classification_level=COALESCE(excluded.classification_level,industry_codes.classification_level),is_active=1,last_seen_at=excluded.last_seen_at,changed_at=CASE WHEN industry_codes.industry_name<>excluded.industry_name THEN excluded.updated_at ELSE industry_codes.changed_at END,updated_at=excluded.updated_at`);
    for(const row of rows)upsert.run(row.code,row.name,row.parentCode??null,row.level??null,t,t,t,t);
    const placeholders=rows.map(()=>"?").join(",");
    db.prepare(`UPDATE industry_codes SET is_active=0,updated_at=? WHERE industry_code NOT IN (${placeholders})`).run(t,...rows.map(row=>row.code));
    db.prepare("UPDATE industry_master_refreshes SET status='COMPLETED',code_count=?,completed_at=? WHERE refresh_id=?").run(rows.length,t,refreshId);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error}finally{db.close()}
}

export async function refreshIndustryMaster(profile:string,dbPath:string,credential:{username:string;password:string},emit:Emit){
  emit({type:"industry_refresh_status",status:"RUNNING",message:"산업코드 갱신 브라우저를 여는 중입니다."});
  const {context,page}=await openPersistentSminfo(profile,emit);
  try{
    await ensureLoggedIn(page,credential,emit);
    const popup=await openIndustryPopup(page);
    const rows=await parseIndustryRows(popup);
    applyMaster(dbPath,rows);
    emit({type:"industry_refresh_status",status:"COMPLETED",count:rows.length,message:`산업코드 ${rows.length.toLocaleString()}개를 갱신했습니다.`});
  }finally{await context.close().catch(()=>undefined)}
}
