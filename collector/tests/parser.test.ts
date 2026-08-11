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
});
