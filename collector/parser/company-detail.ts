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
  DetailSectionName,
  SectionCollectionResult,
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
const headerHints=["결산년도","기준연도","회계연도","연도","총자산","자본금","자본총계","매출액","영업이익","당기순이익","공장명","사업장명","사업장소재지","소재지","사업장구분","사업자번호","번호","일자","년월일","연월","연혁","내용","직위","직책","성명","임원명","특허명","발명의명칭","출원일","등록일","인증명","인증종류","인증구분","인증번호","인증기관","취득일","유효기간","지정명","지정종류","지정구분","지정번호","지정기관","지정일"];
const yearValue=(value:string)=>{
  const match=clean(value).match(/(?:19|20)\d{2}/);
  return match?Number(match[0]):undefined;
};

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
  const recognized=new Set<DetailSectionName>();

  $("table").each((_, table) => {
    const tableRows=$(table).find("tr");
    let headerRow=tableRows.first();
    let bestScore=-1;
    tableRows.each((__,row)=>{
      const values=$(row).find("th,td").map((___,cell)=>clean($(cell).text()).replace(/\s/g,"")) .get();
      const score=values.reduce((sum,value)=>sum+(headerHints.some(hint=>value.includes(hint))?1:0)+(/^(?:19|20)\d{2}$/.test(value)?1:0),0);
      if(score>bestScore){bestScore=score;headerRow=$(row);}
    });
    const headers = headerRow.find("th,td").map((__, cell) => clean($(cell).text())).get();
    if (!headers.length) return;
    // SMINFO commonly separates column headers into <thead> and values into
    // <tbody>. nextAll("tr") only sees siblings inside the same section and
    // therefore returned no data rows. Slice from the table-wide row list.
    const headerPosition=tableRows.toArray().indexOf(headerRow.get(0)!);
    const rows=tableRows.slice(headerPosition+1);
    const sectionText = clean($(table).closest("section[data-sminfo-section]").attr("data-sminfo-section") ?? $(table).prevAll("h1,h2,h3,h4,h5,strong,.title,.tit").first().text());
    const cellsFor = (row: any) => $(row).find("td").map((___, cell) => clean($(cell).text())).get();
    const textAt = (cells:string[],names:string[]) => { const at=headerIndex(headers,names); return at<0?undefined:(cells[at]||undefined); };

    const yearAt = headerIndex(headers, ["\uACB0\uC0B0\uC5F0\uB3C4", "결산년도", "\uAE30\uC900\uC5F0\uB3C4", "기준년도", "\uD68C\uACC4\uC5F0\uB3C4", "연도"]);
    if (yearAt >= 0) {
      recognized.add("financial");
      rows.each((__, row) => {
        const values = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        const at = (names: string[]) => {
          const index = headerIndex(headers, names);
          return index < 0 ? undefined : integer(values[index] ?? "");
        };
        const fiscalYear = yearValue(values[yearAt] ?? "");
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

    const horizontalYears=headers.map((header,index)=>({year:integer(header),index})).filter((item):item is {year:number;index:number}=>Boolean(item.year&&item.year>=1900&&item.year<=2100));
    if(horizontalYears.length){
      recognized.add("financial");
      const matrix:string[][]=[];
      rows.each((__,row)=>{matrix.push($(row).find("th,td").map((___,cell)=>clean($(cell).text())).get());});
      const metric=(names:string[])=>matrix.find(row=>names.some(name=>(row[0]??"").replace(/\s/g,"").includes(name)));
      const totalAssets=metric(["총자산","자산총계"]),equity=metric(["자본금"]),totalCapital=metric(["자본총계","자본"]),revenue=metric(["매출액","매출"]),operatingIncome=metric(["영업이익"]),netIncome=metric(["당기순이익","순이익"]);
      if(totalAssets||revenue||operatingIncome||netIncome){
        for(const {year,index} of horizontalYears) financialStatements.push({fiscalYear:year,totalAssets:integer(totalAssets?.[index]??""),equity:integer(equity?.[index]??""),totalCapital:integer(totalCapital?.[index]??""),revenue:integer(revenue?.[index]??""),operatingIncome:integer(operatingIncome?.[index]??""),netIncome:integer(netIncome?.[index]??""),unit:"KRW_MILLION"});
        return;
      }
    }

    const factoryNameAt = headerIndex(headers, ["\uACF5\uC7A5\uBA85"]);
    const factoryAddressAt = headerIndex(headers, ["\uC0AC\uC5C5\uC7A5\uC18C\uC7AC\uC9C0", "\uC18C\uC7AC\uC9C0", "\uACF5\uC7A5\uC8FC\uC18C"]);
    const isBusinessSiteTable=headers.some(header=>header.replace(/\s/g,"").includes("사업장소재지"));
    if (factoryNameAt >= 0 || factoryAddressAt >= 0) {
      recognized.add("factory");
      if(isBusinessSiteTable)recognized.add("business_site");
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) {
          factories.push({ factoryName: cells[factoryNameAt], locationAddress: cells[factoryAddressAt] });
          if(isBusinessSiteTable) businessSites.push({siteName:cells[factoryNameAt],siteType:cells[factoryNameAt],address:cells[factoryAddressAt]});
        }
      });
      return;
    }

    const siteNameAt = headerIndex(headers, ["사업장명", "사업체명", "지점명"]);
    const siteAddressAt = headerIndex(headers, ["사업장주소", "소재지", "주소"]);
    if (siteNameAt >= 0 || (sectionText.includes("사업장") && siteAddressAt >= 0)) {
      recognized.add("business_site");
      rows.each((__, row) => { const cells=cellsFor(row); if(cells.some(Boolean)) businessSites.push({siteName:cells[siteNameAt],siteType:textAt(cells,["사업장구분","구분","사업장유형"]),businessNumber:textAt(cells,["사업자번호","사업자등록번호"]),address:cells[siteAddressAt]}); });
      return;
    }

    const patentAt = headerIndex(headers, ["\uD2B9\uD5C8\uBA85", "\uBC1C\uBA85\uC758\uBA85\uCE6D", "\uB0B4\uC6A9"]);
    const patentDateAt = headerIndex(headers, ["\uCD9C\uC6D0\uC77C", "\uB4F1\uB85D\uC77C", "\uD2B9\uD5C8\uC77C\uC790"]);
    if (patentAt >= 0 && headers.some((header) => header.includes("\uD2B9\uD5C8") || header.includes("\uBC1C\uBA85"))) {
      recognized.add("patent");
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) patents.push({ patentDate: cells[patentDateAt], description: cells[patentAt] });
      });
      return;
    }

    const positionAt = headerIndex(headers, ["\uC9C1\uC704", "\uC9C1\uCC45"]);
    const executiveAt = headerIndex(headers, ["\uC131\uBA85", "\uC784\uC6D0\uBA85"]);
    if (positionAt >= 0 && executiveAt >= 0) {
      recognized.add("executive");
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) executives.push({ positionTitle: cells[positionAt], maskedName: cells[executiveAt] });
      });
      return;
    }

    const eventDateAt=headerIndex(headers,["일자","년월일","연월","연도","발생일"]);
    const descriptionAt=headerIndex(headers,["연혁내용","주요내용","내용","연혁"]);
    if((sectionText.includes("연혁") || headers.some(x=>x.includes("연혁"))) && descriptionAt>=0){
      recognized.add("history");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))histories.push({eventDate:cells[eventDateAt],description:cells[descriptionAt]});});
      return;
    }

    const certNameAt=headerIndex(headers,["인증명","인증종류","인증구분"]);
    if(sectionText.includes("인증") || certNameAt>=0){
      recognized.add("certification");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))certifications.push({certificationName:cells[certNameAt],certificationNumber:textAt(cells,["인증번호","등록번호"]),issuer:textAt(cells,["인증기관","발급기관","기관명"]),acquiredDate:textAt(cells,["인증일","취득일","발급일"]),validUntil:textAt(cells,["유효기간","만료일"])});});
      return;
    }

    const designationNameAt=headerIndex(headers,["지정명","지정종류","지정구분"]);
    if(sectionText.includes("지정") || designationNameAt>=0){
      recognized.add("designation");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))designations.push({designationName:cells[designationNameAt],designationNumber:textAt(cells,["지정번호","등록번호"]),authority:textAt(cells,["지정기관","주관기관","기관명"]),designatedDate:textAt(cells,["지정일","등록일"]),validUntil:textAt(cells,["유효기간","만료일"])});});
    }
  });

  const parsed = {
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
  const normalizedText=clean($("body").text()).replace(/\s/g,"");
  const headingNames:Record<Exclude<DetailSectionName,"basic_info">,string[]>={
    financial:["매출현황","재무현황","재무정보"],factory:["공장","공장정보"],patent:["특허","특허정보"],executive:["경영진","임원현황"],business_site:["사업장정보","사업장현황"],history:["연혁","주요연혁"],certification:["인증","인증현황"],designation:["지정","지정현황"],
  };
  const hasHeading=(section:Exclude<DetailSectionName,"basic_info">)=>headingNames[section].some(name=>normalizedText.includes(name));
  const hasEmptyEvidence=(section:Exclude<DetailSectionName,"basic_info">)=>headingNames[section].some(name=>new RegExp(`${name}.{0,80}(?:정보가없|내역이없|등록된.{0,10}없|조회된.{0,10}없)`).test(normalizedText));
  const listStatus=(section:Exclude<DetailSectionName,"basic_info"|"financial">,count:number):SectionCollectionResult=>{
    if(count>0)return {status:"VERIFIED"};
    if(recognized.has(section)||hasEmptyEvidence(section))return {status:"CONFIRMED_EMPTY"};
    if(hasHeading(section))return {status:"PARTIAL",error:"SECTION_PRESENT_BUT_TABLE_NOT_RECOGNIZED"};
    return {status:"NOT_CHECKED",error:"SECTION_NOT_FOUND"};
  };
  const hasBasicIdentity=Boolean(parsed.companyName);
  const hasBasicFields=Boolean(parsed.businessNumber||parsed.representativeName||parsed.companyType||parsed.establishedDate||parsed.address||parsed.roadAddress||parsed.industryName);
  const financialHasValue=parsed.financialStatements.some(row=>row.totalAssets!==undefined||row.equity!==undefined||row.totalCapital!==undefined||row.revenue!==undefined||row.operatingIncome!==undefined||row.netIncome!==undefined);
  let financialStatus:SectionCollectionResult;
  if(parsed.financialStatements.length&&financialHasValue)financialStatus={status:"VERIFIED"};
  else if(recognized.has("financial")&&!parsed.financialStatements.length)financialStatus={status:"CONFIRMED_EMPTY"};
  else if(hasEmptyEvidence("financial"))financialStatus={status:"CONFIRMED_EMPTY"};
  else if(recognized.has("financial")||hasHeading("financial"))financialStatus={status:"PARTIAL",error:"FINANCIAL_TABLE_OR_VALUES_NOT_FULLY_PARSED"};
  else financialStatus={status:"NOT_CHECKED",error:"FINANCIAL_SECTION_NOT_FOUND"};
  const sectionStatuses:Record<DetailSectionName,SectionCollectionResult>={
    basic_info:hasBasicIdentity&&hasBasicFields?{status:"VERIFIED"}:{status:"PARTIAL",error:"BASIC_INFO_INCOMPLETE"},
    financial:financialStatus,
    factory:listStatus("factory",parsed.factories.length),
    patent:listStatus("patent",parsed.patents.length),
    executive:listStatus("executive",parsed.executives.length),
    business_site:listStatus("business_site",parsed.businessSites.length),
    history:listStatus("history",parsed.histories.length),
    certification:listStatus("certification",parsed.certifications.length),
    designation:listStatus("designation",parsed.designations.length),
  };
  const acceptable=new Set(["VERIFIED","CONFIRMED_EMPTY"]);
  const collectionQuality=Object.values(sectionStatuses).every(result=>acceptable.has(result.status))?"VERIFIED":"PARTIAL";
  return {...parsed,sectionStatuses,collectionQuality};
}
