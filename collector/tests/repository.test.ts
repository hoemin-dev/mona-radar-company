import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Repository } from "../database/repository.js";

const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));

describe("SQLite repository",()=>{
  it("persists atomically and skips an already collected kcd in a later job",()=>{
    const dir=mkdtempSync(join(tmpdir(),"mona-radar-"));dirs.push(dir);
    const migration=["001_initial.sql","002_collector_automation.sql","003_company_detail_sections.sql"].map(name=>readFileSync(join(process.cwd(),"src-tauri","migrations",name),"utf8")).join("\n");
    const repo=new Repository(join(dir,"test.sqlite3"),migration);
    const job=repo.createJob(1,1,"fixture",1);
    repo.enqueue(job,1,[{kcd:"0007802354",companyName:"Mona Pumps"}]);
    const item=repo.next(job)!;repo.markRunning(item.collection_item_id);
    repo.saveCompany(item.collection_item_id,{kcd:item.sminfo_kcd,companyName:item.company_name_snapshot,industryName:"Pump manufacturing",financialStatements:[{fiscalYear:2025,revenue:4728,unit:"KRW_MILLION"}]});
    expect(repo.stats(job)).toMatchObject({total:1,completed:1,failed:0,pending:0});
    const resumed=repo.createJob(1,1,"fixture",1);repo.enqueue(resumed,1,[{kcd:"0007802354",companyName:"Mona Pumps"}]);
    expect(repo.next(resumed)).toBeUndefined();expect(repo.stats(resumed)).toMatchObject({total:1,pending:0});repo.close();
  });
});
