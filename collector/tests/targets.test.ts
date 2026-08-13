import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Repository } from "../database/repository.js";
import { DatabaseSync } from "node:sqlite";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("collector targets", () => {
  it("persists a checkpoint and links one company to multiple targets without duplicating it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mona-targets-")); dirs.push(dir);
    const migration1 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "001_initial.sql"), "utf8");
    const migration2 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "002_collector_automation.sql"), "utf8");
    const migration3 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "003_company_detail_sections.sql"), "utf8");
    const migration4 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "004_collection_quality.sql"), "utf8");
    const migration5 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "005_industry_master.sql"), "utf8");
    const migration6 = readFileSync(join(process.cwd(), "src-tauri", "migrations", "006_source_detail_model.sql"), "utf8");
    const dbPath=join(dir,"test.sqlite3");
    const repo = new Repository(dbPath, `${migration1}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}`);
    const first = repo.upsertTarget("액체펌프", "29131", "액체 펌프 제조업");
    const second = repo.upsertTarget("산업기계", "29299", "기타 특수 목적용 기계 제조업");
    const job = repo.createJob(1, 1); repo.attachJob(first, job);
    repo.enqueue(job, 1, [{ kcd: "KCD-1", companyName: "테스트펌프" }]);
    const item = repo.next(job)!; repo.markRunning(item.collection_item_id);
    repo.saveCompany(item.collection_item_id, { kcd: "KCD-1", companyName: "테스트펌프", financialStatements: [], executives: [{positionTitle:"대표",maskedName:"김**"}],businessSites:[{siteName:"본사",siteAddress:"서울"}],histories:[{eventDate:"2025",description:"설립"}],certifications:[{certificationName:"ISO"}],designations:[{designationName:"벤처기업"}] });
    repo.linkCollectedCompany(first, item.collection_item_id, "29131");
    repo.linkCollectedCompany(second, item.collection_item_id, "29299");
    repo.checkpoint(first, 3, 7, "KCD-1", { completed: 1, failed: 0 });
    repo.close();
    expect(first).not.toBe(second);
    const db=new DatabaseSync(dbPath);expect((db.prepare("SELECT COUNT(*) count FROM company_source_business_sites").get() as {count:number}).count).toBe(1);expect((db.prepare("SELECT COUNT(*) count FROM company_source_histories").get() as {count:number}).count).toBe(1);expect((db.prepare("SELECT COUNT(*) count FROM company_source_certifications").get() as {count:number}).count).toBe(1);expect((db.prepare("SELECT COUNT(*) count FROM company_source_designations").get() as {count:number}).count).toBe(1);db.close();
  });
});
