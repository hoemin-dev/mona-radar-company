import { describe,expect,it } from "vitest";
import { parseIndustryHtml } from "../industry-master.js";

describe("industry master parser",()=>{
  it("extracts and deduplicates the codes actually provided by SMINFO",()=>{
    const rows=parseIndustryHtml(`<table><tr><th>분류</th><th>업종코드</th><th>업종명</th></tr><tr><td>대</td><td>A</td><td>농업, 임업 및 어업</td></tr><tr><td>세세</td><td>C29131</td><td>액체 펌프 제조업</td></tr><tr><td>세세</td><td>C29131</td><td>액체 펌프 제조업</td></tr><tr><td>소</td><td>A011</td><td>작물 재배업</td></tr></table>`);
    expect(rows).toEqual([{code:"A",name:"농업, 임업 및 어업",level:"대"},{code:"C29131",name:"액체 펌프 제조업",level:"세세"},{code:"A011",name:"작물 재배업",level:"소"}]);
  });

  it("collects all 21 letter-only top-level divisions",()=>{
    const divisions="ABCDEFGHIJKLMNOPQRSTU".split("").map(code=>`<tr><td>대</td><td>${code}</td><td>${code} 산업</td></tr>`).join("");
    expect(parseIndustryHtml(`<table>${divisions}</table>`)).toHaveLength(21);
  });

  it("ignores headers and rows without a real code/name pair",()=>{
    expect(parseIndustryHtml(`<table><tr><th>업종코드</th><th>업종명</th></tr><tr><td>-</td><td>구분없음</td></tr></table>`)).toEqual([]);
  });
});
