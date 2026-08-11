import { load, type CheerioAPI } from "cheerio";
import type {
  CompanyDetail,
  BusinessSiteInfo,
  CompanyHistoryInfo,
  CertificationInfo,
  DesignationInfo,
  ExecutiveInfo,
  FactoryInfo,
  FinancialStatement,
  PatentInfo,
} from "../../src/shared/types.js";
import { clean, integer } from "./helpers.js";

const labels = {
  companyName: ["\uAE30\uC5C5\uBA85", "\uC0C1\uD638"],
  businessNumber: ["\uC0AC\uC5C5\uC790\uBC88\uD638"],
  representativeName: ["\uB300\uD45C\uC790\uBA85", "\uB300\uD45C\uC790"],
  companyType: ["\uAE30\uC5C5\uAD6C\uBD84", "\uAE30\uC5C5\uC720\uD615", "\uAE30\uC5C5\uD615\uD0DC"],
  companyStatus: ["\uAE30\uC5C5\uC0C1\uD0DC", "\uC601\uC5C5\uC0C1\uD0DC"],
  establishedDate: ["\uC124\uB9BD\uC77C", "\uC124\uB9BD\uC77C\uC790"],
  address: ["\uC8FC\uC18C", "\uC9C0\uBC88\uC8FC\uC18C"],
  roadAddress: ["\uB3C4\uB85C\uBA85\uC8FC\uC18C"],
  homepage: ["\uD648\uD398\uC774\uC9C0", "\uD648\uD398\uC774\uC9C0URL"],
  mainProducts: ["\uC8FC\uC0DD\uC0B0\uD488", "\uC8FC\uC694\uC81C\uD488", "\uC8FC\uC694\uC0DD\uC0B0\uD488"],
  industryName: ["\uD45C\uC900\uC0B0\uC5C5", "\uC0B0\uC5C5\uBA85", "\uC8FC\uC5C5\uC885"],
} as const;

const input = ($: CheerioAPI, ...names: string[]) => {
  for (const name of names) {
    const value = clean($(`input[name='${name}']`).first().attr("value") ?? "");
    if (value) return value;
  }
  return undefined;
};

function valueByLabel($: CheerioAPI, candidates: readonly string[]): string | undefined {
  let result: string | undefined;
  $("th,dt,label").each((_, node) => {
    if (result) return;
    const label = clean($(node).text()).replace(/[\s:：]/g, "");
    if (!candidates.some((candidate) => label.includes(candidate))) return;
    const value = $(node).is("dt") ? $(node).next("dd").text() : $(node).next("td").text();
    result = clean(value);
  });
  return result || undefined;
}

const headerIndex = (headers: string[], names: string[]) =>
  headers.findIndex((header) => names.some((name) => header.replace(/\s/g, "").includes(name)));
const unique = <T>(items:T[]) => [...new Map(items.map(item=>[JSON.stringify(item),item])).values()];

export function parseCompanyDetail(html: string): CompanyDetail {
  const $ = load(html);
  const financialStatements: FinancialStatement[] = [];
  const factories: FactoryInfo[] = [];
  const patents: PatentInfo[] = [];
  const executives: ExecutiveInfo[] = [];
  const businessSites: BusinessSiteInfo[] = [];
  const histories: CompanyHistoryInfo[] = [];
  const certifications: CertificationInfo[] = [];
  const designations: DesignationInfo[] = [];

  $("table").each((_, table) => {
    let headerRow = $(table).find("tr").filter((__, row) => $(row).find("th").length > 0).first();
    if(!headerRow.length) headerRow=$(table).find("tr").first();
    const headers = headerRow.find("th,td").map((__, cell) => clean($(cell).text())).get();
    if (!headers.length) return;
    const rows = headerRow.nextAll("tr");
    const sectionText = clean($(table).closest("section[data-sminfo-section]").attr("data-sminfo-section") ?? $(table).prevAll("h1,h2,h3,h4,h5,strong,.title,.tit").first().text());
    const cellsFor = (row: any) => $(row).find("td").map((___, cell) => clean($(cell).text())).get();
    const textAt = (cells:string[],names:string[]) => { const at=headerIndex(headers,names); return at<0?undefined:(cells[at]||undefined); };

    const yearAt = headerIndex(headers, ["\uACB0\uC0B0\uC5F0\uB3C4", "\uAE30\uC900\uC5F0\uB3C4", "\uD68C\uACC4\uC5F0\uB3C4", "기준년도", "연도"]);
    if (yearAt >= 0) {
      rows.each((__, row) => {
        const values = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        const at = (names: string[]) => {
          const index = headerIndex(headers, names);
          return index < 0 ? undefined : integer(values[index] ?? "");
        };
        const fiscalYear = integer(values[yearAt] ?? "");
        if (fiscalYear) financialStatements.push({
          fiscalYear,
          totalAssets: at(["\uCD1D\uC790\uC0B0", "\uC790\uC0B0\uCD1D\uACC4"]),
          equity: at(["\uC790\uBCF8\uAE08"]),
          totalCapital: at(["\uC790\uBCF8\uCD1D\uACC4", "\uC790\uBCF8"]),
          revenue: at(["\uB9E4\uCD9C\uC561", "\uB9E4\uCD9C"]),
          operatingIncome: at(["\uC601\uC5C5\uC774\uC775"]),
          netIncome: at(["\uB2F9\uAE30\uC21C\uC774\uC775", "\uC21C\uC774\uC775"]),
          unit: "KRW_MILLION",
        });
      });
      return;
    }

    const factoryNameAt = headerIndex(headers, ["\uACF5\uC7A5\uBA85"]);
    const factoryAddressAt = headerIndex(headers, ["\uC18C\uC7AC\uC9C0", "\uACF5\uC7A5\uC8FC\uC18C"]);
    if (factoryNameAt >= 0 || factoryAddressAt >= 0) {
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) factories.push({ factoryName: cells[factoryNameAt], locationAddress: cells[factoryAddressAt] });
      });
      return;
    }

    const siteNameAt = headerIndex(headers, ["사업장명", "사업체명", "지점명"]);
    const siteAddressAt = headerIndex(headers, ["사업장주소", "소재지", "주소"]);
    if (siteNameAt >= 0 || (sectionText.includes("사업장") && siteAddressAt >= 0)) {
      rows.each((__, row) => { const cells=cellsFor(row); if(cells.some(Boolean)) businessSites.push({siteName:cells[siteNameAt],siteType:textAt(cells,["사업장구분","구분","사업장유형"]),businessNumber:textAt(cells,["사업자번호","사업자등록번호"]),address:cells[siteAddressAt]}); });
      return;
    }

    const patentAt = headerIndex(headers, ["\uD2B9\uD5C8\uBA85", "\uBC1C\uBA85\uC758\uBA85\uCE6D", "\uB0B4\uC6A9"]);
    const patentDateAt = headerIndex(headers, ["\uCD9C\uC6D0\uC77C", "\uB4F1\uB85D\uC77C", "\uD2B9\uD5C8\uC77C\uC790"]);
    if (patentAt >= 0 && headers.some((header) => header.includes("\uD2B9\uD5C8") || header.includes("\uBC1C\uBA85"))) {
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) patents.push({ patentDate: cells[patentDateAt], description: cells[patentAt] });
      });
      return;
    }

    const positionAt = headerIndex(headers, ["\uC9C1\uC704", "\uC9C1\uCC45"]);
    const executiveAt = headerIndex(headers, ["\uC131\uBA85", "\uC784\uC6D0\uBA85"]);
    if (positionAt >= 0 && executiveAt >= 0) {
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) executives.push({ positionTitle: cells[positionAt], maskedName: cells[executiveAt] });
      });
      return;
    }

    const eventDateAt=headerIndex(headers,["일자","연월","연도","발생일"]);
    const descriptionAt=headerIndex(headers,["연혁내용","주요내용","내용"]);
    if((sectionText.includes("연혁") || headers.some(x=>x.includes("연혁"))) && descriptionAt>=0){
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))histories.push({eventDate:cells[eventDateAt],description:cells[descriptionAt]});});
      return;
    }

    const certNameAt=headerIndex(headers,["인증명","인증종류","인증구분"]);
    if(sectionText.includes("인증") || certNameAt>=0){
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))certifications.push({certificationName:cells[certNameAt],certificationNumber:textAt(cells,["인증번호","등록번호"]),issuer:textAt(cells,["인증기관","발급기관","기관명"]),acquiredDate:textAt(cells,["인증일","취득일","발급일"]),validUntil:textAt(cells,["유효기간","만료일"])});});
      return;
    }

    const designationNameAt=headerIndex(headers,["지정명","지정종류","지정구분"]);
    if(sectionText.includes("지정") || designationNameAt>=0){
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))designations.push({designationName:cells[designationNameAt],designationNumber:textAt(cells,["지정번호","등록번호"]),authority:textAt(cells,["지정기관","주관기관","기관명"]),designatedDate:textAt(cells,["지정일","등록일"]),validUntil:textAt(cells,["유효기간","만료일"])});});
    }
  });

  return {
    kcd: input($, "kcd", "kedCd") ?? "",
    companyName: input($, "comNm", "entrprsNm") ?? valueByLabel($, labels.companyName) ?? "",
    businessNumber: input($, "busiNo", "bizrno") ?? valueByLabel($, labels.businessNumber),
    representativeName: valueByLabel($, labels.representativeName),
    companyType: valueByLabel($, labels.companyType),
    companyStatus: valueByLabel($, labels.companyStatus),
    establishedDate: valueByLabel($, labels.establishedDate),
    address: valueByLabel($, labels.address),
    roadAddress: valueByLabel($, labels.roadAddress),
    homepage: valueByLabel($, labels.homepage),
    mainProducts: valueByLabel($, labels.mainProducts),
    ksicCode: input($, "ksic11BzcCd", "ksicCd"),
    industryName: input($, "ksic11BzcCdNm", "ksicNm") ?? valueByLabel($, labels.industryName),
    financialStatements:unique(financialStatements),
    factories:unique(factories),
    patents:unique(patents),
    executives:unique(executives),
    businessSites:unique(businessSites),
    histories:unique(histories),
    certifications:unique(certifications),
    designations:unique(designations),
  };
}
