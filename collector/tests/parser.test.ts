import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCompanyDetail } from "../parser/company-detail.js";
import { parseSearchResult } from "../parser/search-result.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("SMINFO semantic parsers", () => {
  it("keeps search-form options out of 대한기계 basic fields",()=>{
    const result=parseCompanyDetail(fixture("daehan-machinery-detail.html"));
    expect(result).toMatchObject({kcd:"0001087424",companyName:"대한기계",companyType:"개인사업자",establishedDate:"2007-04-26",sourceUpdatedAt:"2021-06-25"});
    expect(result.businessSites).toEqual([{siteName:"본사",siteAddress:undefined},{siteName:"공장",siteAddress:"충남 천안시 서북구 신당동 453-4"}]);
    expect(`${result.companyType} ${result.establishedDate}`).not.toMatch(/조건없음|유가증권시장|코스닥시장|코넥스|1개월내|3개월내/);
    expect(result.sectionStatuses.basic_info.status).toBe("VERIFIED");
  });
  it("marks unresolved search-form label collisions as non-verified",()=>{
    const result=parseCompanyDetail(`<input name="comNm" value="회사"><input name="ksic11BzcCdNm" value="액체펌프제조업"><table><tr><th>기업형태</th><td><select><option>조건없음</option><option>코스닥시장</option></select></td></tr><tr><th>설립일</th><td><select><option>조건없음</option><option>1개월내</option></select></td></tr></table>`);
    expect(result.companyType).toBeUndefined();
    expect(result.establishedDate).toBeUndefined();
    expect(result.sectionStatuses.basic_info).toMatchObject({status:"PARTIAL",error:"BASIC_INFO_SANITY_FAILED"});
  });
  it("reads search totals, pages and company identifiers", () => {
    const result = parseSearchResult(fixture("search-result.html"));
    expect(result.total).toBeGreaterThan(0);
    expect(result.totalPages).toBe(126);
    expect(result.companies[0]?.kcd).toBe("0007802354");
  });

  it("reads Korean detail labels, financial years and subordinate tables", () => {
    const result = parseCompanyDetail(fixture("company-detail.html"));
    expect(result).toMatchObject({
      kcd: "0007802354",
      companyName: "주식회사 동원산업",
      businessNumber: "123-45-67890",
      representativeName: "홍길동",
      companyType: "주식회사",
      companyStatus: "영업중",
      establishedDate: "2015-07-16",
      roadAddress: "경기도 안산시",
      mainProducts: "모터 펌프",
      industryName: "액체 펌프 제조업",
    });
    expect(result.financialStatements).toEqual([
      expect.objectContaining({ fiscalYear: 2025, totalAssets: 6092, revenue: 4728, operatingIncome: 238, netIncome: 43 }),
      expect.objectContaining({ fiscalYear: 2024, totalAssets: 5865, revenue: 5106 }),
    ]);
    expect(result.businessSites).toContainEqual({ siteName: "제1공장", siteAddress: "경기도 안산시" });
    expect(result.executives).toEqual([{ positionTitle: "대표이사", maskedName: "홍**" }]);
    expect(result.histories).toEqual([{ eventDate: "2024-03", description: "신공장 준공" }]);
    expect(result.certifications).toEqual([{ certificationName: "ISO 9001", certificationNumber: "ISO-001", certificationScope: undefined, validityPeriod: "2027-01-01", certificationAuthority: "KAB" }]);
    expect(result.designations).toEqual([{ designationName: "벤처기업", designationNumber: "V-001", validityPeriod: undefined, operatingAuthority: "중소벤처기업부" }]);
  });

  it("reads legacy td-only tables from captured detail sections",()=>{
    const result=parseCompanyDetail(`<section data-sminfo-section="매출현황"><table><tr><td>연도</td><td>매출액</td><td>영업이익</td></tr><tr><td>2025</td><td>1,258</td><td>73</td></tr></table></section><section data-sminfo-section="연혁"><table><tr><td>일자</td><td>내용</td></tr><tr><td>2024-01</td><td>공장 준공</td></tr></table></section>`);
    expect(result.financialStatements).toEqual([expect.objectContaining({fiscalYear:2025,revenue:1258,operatingIncome:73})]);
    expect(result.histories).toEqual([{eventDate:"2024-01",description:"공장 준공"}]);
  });

  it("reads financial tables whose years are arranged horizontally",()=>{
    const result=parseCompanyDetail(`<section data-sminfo-section="매출현황"><table><tr><th>구분</th><th>2024</th><th>2025</th></tr><tr><td>총자산</td><td>900</td><td>1,000</td></tr><tr><td>매출액</td><td>700</td><td>800</td></tr><tr><td>영업이익</td><td>50</td><td>60</td></tr><tr><td>당기순이익</td><td>30</td><td>40</td></tr></table></section>`);
    expect(result.financialStatements).toEqual([
      expect.objectContaining({fiscalYear:2024,totalAssets:900,revenue:700,operatingIncome:50,netIncome:30}),
      expect.objectContaining({fiscalYear:2025,totalAssets:1000,revenue:800,operatingIncome:60,netIncome:40}),
    ]);
  });

  it("reads SMINFO tables that contain a title row before their column headers",()=>{
    const result=parseCompanyDetail(`<html><body>
      <table><tr><th colspan="3">사업장정보</th></tr><tr><td>번호</td><td>공장명</td><td>사업장 소재지</td></tr><tr><td>1</td><td>본사</td><td>광주광역시</td></tr></table>
      <table><tr><th colspan="3">연혁</th></tr><tr><td>번호</td><td>년월일</td><td>연혁</td></tr><tr><td>1</td><td>2022-03</td><td>법인 설립</td></tr></table>
      <table><tr><th colspan="3">경영진</th></tr><tr><td>번호</td><td>직위</td><td>성명</td></tr><tr><td>1</td><td>대표이사</td><td>홍**</td></tr></table>
      <table><tr><th colspan="7">매출현황</th></tr><tr><td>결산년도</td><td>총자산</td><td>자본금</td><td>자본총계</td><td>매출액</td><td>영업이익</td><td>당기순이익</td></tr><tr><td>2024-12-31</td><td>10,000</td><td>500</td><td>8,000</td><td>7,000</td><td>600</td><td>400</td></tr></table>
    </body></html>`);
    expect(result.businessSites).toEqual([{siteName:"본사",siteAddress:"광주광역시"}]);
    expect(result.histories).toEqual([{sourceNumber:"1",eventDate:"2022-03",description:"법인 설립"}]);
    expect(result.executives).toEqual([{sourceNumber:"1",positionTitle:"대표이사",maskedName:"홍**"}]);
    expect(result.financialStatements).toEqual([expect.objectContaining({fiscalYear:2024,totalAssets:10000,revenue:7000,operatingIncome:600,netIncome:400})]);
  });

  it("reads SMINFO tables whose headers and data use separate thead and tbody",()=>{
    const result=parseCompanyDetail(`<html><body>
      <h3>매출현황</h3><table><thead><tr><th>결산년도</th><th>총자산</th><th>매출액</th><th>영업이익</th><th>당기순이익</th></tr></thead><tbody><tr><td>2024-12-31</td><td>10,000</td><td>7,000</td><td>600</td><td>400</td></tr></tbody></table>
      <h3>경영진</h3><table><thead><tr><th>번호</th><th>직위</th><th>성명</th></tr></thead><tbody><tr><td>1</td><td>대표이사</td><td>홍**</td></tr></tbody></table>
    </body></html>`);
    expect(result.financialStatements).toEqual([expect.objectContaining({fiscalYear:2024,totalAssets:10000,revenue:7000,operatingIncome:600,netIncome:400})]);
    expect(result.executives).toEqual([{sourceNumber:"1",positionTitle:"대표이사",maskedName:"홍**"}]);
  });

  it("treats explicit empty business-site evidence as confirmed empty",()=>{
    const result=parseCompanyDetail(`<h3>사업장정보</h3><p>등록된 정보가 없습니다.</p>`);
    expect(result.businessSites).toEqual([]);
    expect(result.sectionStatuses.business_site.status).toBe("CONFIRMED_EMPTY");
  });

  it("pairs one or multiple vertical business-site entries in source order",()=>{
    const one=parseCompanyDetail(`<table><tr><th>공장명</th><td>본사</td></tr><tr><th>사업장소재지</th><td>서울</td></tr></table>`);
    expect(one.businessSites).toEqual([{siteName:"본사",siteAddress:"서울"}]);
    const many=parseCompanyDetail(`<table><tr><th>공장명</th><td>1공장</td></tr><tr><th>사업장소재지</th><td>서울</td></tr><tr><th>공장명</th><td>2공장</td></tr><tr><th>사업장소재지</th><td>부산</td></tr></table>`);
    expect(many.businessSites).toEqual([{siteName:"1공장",siteAddress:"서울"},{siteName:"2공장",siteAddress:"부산"}]);
  });

  it("preserves a source business-site row whose address is blank",()=>{
    const result=parseCompanyDetail(`<h3>사업장정보</h3><table><tr><th>공장명</th><td>본사</td></tr></table>`);
    expect(result.businessSites).toHaveLength(1);
    expect(result.businessSites[0]?.siteAddress).toBeUndefined();
    expect(result.sectionStatuses.business_site.status).toBe("VERIFIED");
  });

  it("keeps certification and designation validity periods as raw strings",()=>{
    const result=parseCompanyDetail(`<table><tr><th>인증명</th><th>인증번호</th><th>인증범위</th><th>유효기간</th><th>인증기관</th></tr><tr><td>ISO</td><td>C-1</td><td>펌프</td><td>2024.01.01 ~ 2027.01.01</td><td>KAB</td></tr></table><table><tr><th>지정명</th><th>지정번호</th><th>유효기간</th><th>운영기관</th></tr><tr><td>벤처기업</td><td>D-1</td><td>2025년부터 계속</td><td>중기부</td></tr></table>`);
    expect(result.certifications[0]?.validityPeriod).toBe("2024.01.01 ~ 2027.01.01");
    expect(result.designations[0]?.validityPeriod).toBe("2025년부터 계속");
  });
});
