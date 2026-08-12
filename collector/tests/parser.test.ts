import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCompanyDetail } from "../parser/company-detail.js";
import { parseSearchResult } from "../parser/search-result.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("SMINFO semantic parsers", () => {
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
    expect(result.factories).toEqual([{ factoryName: "제1공장", locationAddress: "경기도 안산시" }]);
    expect(result.patents).toEqual([{ patentDate: "2025-01-01", description: "고효율 펌프" }]);
    expect(result.executives).toEqual([{ positionTitle: "대표이사", maskedName: "홍**" }]);
    expect(result.businessSites).toEqual([{ siteName: "본사", siteType: "본점", businessNumber: "123-45-67890", address: "경기도 안산시" }]);
    expect(result.histories).toEqual([{ eventDate: "2024-03", description: "신공장 준공" }]);
    expect(result.certifications).toEqual([{ certificationName: "ISO 9001", certificationNumber: "ISO-001", issuer: "KAB", acquiredDate: "2024-01-01", validUntil: "2027-01-01" }]);
    expect(result.designations).toEqual([{ designationName: "벤처기업", designationNumber: "V-001", authority: "중소벤처기업부", designatedDate: "2025-01-01", validUntil: undefined }]);
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
    expect(result.businessSites).toEqual([{siteName:"본사",siteType:"본사",address:"광주광역시"}]);
    expect(result.histories).toEqual([{eventDate:"2022-03",description:"법인 설립"}]);
    expect(result.executives).toEqual([{positionTitle:"대표이사",maskedName:"홍**"}]);
    expect(result.financialStatements).toEqual([expect.objectContaining({fiscalYear:2024,totalAssets:10000,revenue:7000,operatingIncome:600,netIncome:400})]);
  });

  it("reads SMINFO tables whose headers and data use separate thead and tbody",()=>{
    const result=parseCompanyDetail(`<html><body>
      <h3>매출현황</h3><table><thead><tr><th>결산년도</th><th>총자산</th><th>매출액</th><th>영업이익</th><th>당기순이익</th></tr></thead><tbody><tr><td>2024-12-31</td><td>10,000</td><td>7,000</td><td>600</td><td>400</td></tr></tbody></table>
      <h3>경영진</h3><table><thead><tr><th>번호</th><th>직위</th><th>성명</th></tr></thead><tbody><tr><td>1</td><td>대표이사</td><td>홍**</td></tr></tbody></table>
    </body></html>`);
    expect(result.financialStatements).toEqual([expect.objectContaining({fiscalYear:2024,totalAssets:10000,revenue:7000,operatingIncome:600,netIncome:400})]);
    expect(result.executives).toEqual([{positionTitle:"대표이사",maskedName:"홍**"}]);
  });
});
