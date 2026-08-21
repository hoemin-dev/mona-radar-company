import { load, type CheerioAPI } from "cheerio";
import type {
  CompanyDetail,
  BusinessSiteInfo,
  CompanyHistoryInfo,
  CertificationInfo,
  DesignationInfo,
  ExecutiveInfo,
  FinancialStatement,
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
  roadAddress: ["\uB3C4\uB85C\uBA85\uC8FC\uC18C", "\uC8FC\uC18C(\uB3C4\uB85C\uBA85)"],
  homepage: ["\uD648\uD398\uC774\uC9C0", "\uD648\uD398\uC774\uC9C0URL"],
  mainProducts: ["\uC8FC\uC0DD\uC0B0\uD488", "\uC8FC\uC694\uC81C\uD488", "\uC8FC\uC694\uC0DD\uC0B0\uD488"],
  industryName: ["\uD45C\uC900\uC0B0\uC5C5", "\uC0B0\uC5C5\uBA85", "\uC8FC\uC5C5\uC885"],
  sourceUpdatedAt: ["\uC815\uBCF4\uC218\uC815\uC77C\uC790"],
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
  $("th,td,dt").each((_, node) => {
    if (result) return;
    const label = clean($(node).text()).replace(/[\s:：]/g, "");
    if (!candidates.some((candidate) => label === candidate)) return;
    const valueNode = $(node).is("dt") ? $(node).next("dd") : $(node).next("td");
    if (!valueNode.length || valueNode.find("select,option,input,textarea").length) return;
    const value = clean(valueNode.text());
    if (value && !isSearchUiContamination(value)) result = value;
  });
  return result || undefined;
}

function hasSearchControlByLabel($:CheerioAPI,candidates:readonly string[]){
  return $("th,td,dt").toArray().some(node=>{
    const label=clean($(node).text()).replace(/[\s:：]/g,"");
    if(!candidates.some(candidate=>label===candidate))return false;
    const valueNode=$(node).is("dt")?$(node).next("dd"):$(node).next("td");
    return valueNode.find("select,option,input,textarea").length>0;
  });
}

const searchUiTokens=["\uC870\uAC74\uC5C6\uC74C","\uC720\uAC00\uC99D\uAD8C\uC2DC\uC7A5","\uCF54\uC2A4\uB2E5\uC2DC\uC7A5","\uCF54\uB125\uC2A4","1\uAC1C\uC6D4\uB0B4","3\uAC1C\uC6D4\uB0B4","6\uAC1C\uC6D4\uB0B4"];
export const isSearchUiContamination=(value:string|undefined)=>Boolean(value&&searchUiTokens.some(token=>value.includes(token)));
const sourceValue=(value:string|undefined)=>value&&value!=="-"&&value!=="--"&&!isSearchUiContamination(value)?value:undefined;
const validDate=(value:string|undefined)=>!value||/^\d{4}-\d{2}-\d{2}$/.test(value);

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
    if (factoryNameAt >= 0 && factoryAddressAt >= 0) {
      recognized.add("business_site");
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        const siteName=cells[factoryNameAt],siteAddress=cells[factoryAddressAt];
        if (siteName||siteAddress) businessSites.push({siteName:siteName||undefined,siteAddress:siteAddress||undefined});
      });
      return;
    }

    const siteNameAt = headerIndex(headers, ["사업장명", "사업체명", "지점명"]);
    const siteAddressAt = headerIndex(headers, ["사업장주소", "소재지", "주소"]);
    if (siteNameAt >= 0 || (sectionText.includes("사업장") && siteAddressAt >= 0)) {
      recognized.add("business_site");
      rows.each((__, row) => { const cells=cellsFor(row); const siteName=cells[siteNameAt],siteAddress=cells[siteAddressAt];if(siteName||siteAddress) businessSites.push({siteName:siteName||undefined,siteAddress:siteAddress||undefined}); });
      return;
    }

    const positionAt = headerIndex(headers, ["\uC9C1\uC704", "\uC9C1\uCC45"]);
    const executiveAt = headerIndex(headers, ["\uC131\uBA85", "\uC784\uC6D0\uBA85"]);
    if (positionAt >= 0 && executiveAt >= 0) {
      recognized.add("executive");
      rows.each((__, row) => {
        const cells = $(row).find("td").map((___, cell) => clean($(cell).text())).get();
        if (cells.length) executives.push({ sourceNumber:textAt(cells,["\uBC88\uD638"]),positionTitle: cells[positionAt], maskedName: cells[executiveAt] });
      });
      return;
    }

    const eventDateAt=headerIndex(headers,["일자","년월일","연월","연도","발생일"]);
    const descriptionAt=headerIndex(headers,["연혁내용","주요내용","내용","연혁"]);
    if((sectionText.includes("연혁") || headers.some(x=>x.includes("연혁"))) && descriptionAt>=0){
      recognized.add("history");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))histories.push({sourceNumber:textAt(cells,["\uBC88\uD638"]),eventDate:cells[eventDateAt],description:cells[descriptionAt]});});
      return;
    }

    const certNameAt=headerIndex(headers,["인증명","인증종류","인증구분"]);
    if(sectionText.includes("인증") || certNameAt>=0){
      recognized.add("certification");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))certifications.push({certificationNumber:textAt(cells,["\uC778\uC99D\uBC88\uD638"]),certificationName:cells[certNameAt],certificationScope:textAt(cells,["\uC778\uC99D\uBC94\uC704"]),validityPeriod:textAt(cells,["\uC720\uD6A8\uAE30\uAC04","\uC720\uD6A8\uAE30\uD55C","\uB9CC\uB8CC\uC77C","\uC874\uC18D\uAE30\uAC04"]),certificationAuthority:textAt(cells,["\uC778\uC99D\uAE30\uAD00","\uBC1C\uAE09\uAE30\uAD00"])});});
      return;
    }

    const designationNameAt=headerIndex(headers,["지정명","지정종류","지정구분"]);
    if(sectionText.includes("지정") || designationNameAt>=0){
      recognized.add("designation");
      rows.each((__,row)=>{const cells=cellsFor(row);if(cells.some(Boolean))designations.push({designationNumber:textAt(cells,["\uC9C0\uC815\uBC88\uD638"]),designationName:cells[designationNameAt],validityPeriod:textAt(cells,["\uC720\uD6A8\uAE30\uAC04","\uC720\uD6A8\uAE30\uD55C","\uC874\uC18D\uAE30\uAC04"]),operatingAuthority:textAt(cells,["\uC6B4\uC601\uAE30\uAD00","\uC8FC\uAD00\uAE30\uAD00","\uC9C0\uC815\uAE30\uAD00"])});});
    }
  });

  // Some SMINFO pages render business sites as repeating label/value rows
  // instead of one conventional header table. Pair each 공장명 with the next
  // 사업장소재지 and preserve the source order.
  let pendingSiteName:string|undefined;
  $("tr").each((_,row)=>{
    const headers=$(row).children("th");
    if(headers.length!==1)return;
    const header=headers.first();
    const label=clean(header.text()).replace(/\s/g,"");
    const value=clean(header.next("td").text());
    if(label.includes("\uACF5\uC7A5\uBA85")&&value){if(pendingSiteName)businessSites.push({siteName:pendingSiteName});pendingSiteName=value;recognized.add("business_site");return;}
    if(label.includes("\uC0AC\uC5C5\uC7A5\uC18C\uC7AC\uC9C0")&&value){recognized.add("business_site");if(pendingSiteName)businessSites.push({siteName:pendingSiteName,siteAddress:value});pendingSiteName=undefined;}
  });
  if(pendingSiteName)businessSites.push({siteName:pendingSiteName});

  const rawCompanyType=valueByLabel($,labels.companyType);
  const rawEstablishedDate=valueByLabel($,labels.establishedDate);
  const rawSourceUpdatedAt=valueByLabel($,labels.sourceUpdatedAt);
  const parsed = {
    kcd: input($, "kcd", "kedCd") ?? "",
    companyName: input($, "comNm", "entrprsNm") ?? valueByLabel($, labels.companyName) ?? "",
    businessNumber: input($, "busiNo", "bizrno") ?? valueByLabel($, labels.businessNumber),
    representativeName: valueByLabel($, labels.representativeName),
    companyType: sourceValue(rawCompanyType),
    companyStatus: valueByLabel($, labels.companyStatus),
    establishedDate: sourceValue(rawEstablishedDate),
    address: valueByLabel($, labels.address),
    roadAddress: valueByLabel($, labels.roadAddress),
    homepage: valueByLabel($, labels.homepage),
    mainProducts: valueByLabel($, labels.mainProducts),
    ksicCode: input($, "ksic11BzcCd", "ksicCd"),
    industryName: input($, "ksic11BzcCdNm", "ksicNm") ?? valueByLabel($, labels.industryName),
    sourceUpdatedAt:sourceValue(rawSourceUpdatedAt),
    financialStatements:unique(financialStatements),
    executives:unique(executives),
    businessSites:unique(businessSites),
    histories:unique(histories),
    certifications:unique(certifications),
    designations:unique(designations),
  };
  const normalizedText=clean($("body").text()).replace(/\s/g,"");
  const headingNames:Record<Exclude<DetailSectionName,"basic_info">,string[]>={
    financial:["매출현황","재무현황","재무정보"],executive:["경영진","임원현황"],business_site:["사업장정보","사업장현황"],history:["연혁","주요연혁"],certification:["인증","인증현황"],designation:["지정","지정현황"],
  };
  const hasHeading=(section:Exclude<DetailSectionName,"basic_info">)=>headingNames[section].some(name=>normalizedText.includes(name));
  const hasEmptyEvidence=(section:Exclude<DetailSectionName,"basic_info">)=>headingNames[section].some(name=>new RegExp(`${name}.{0,80}(?:정보가없|내역이없|등록된.{0,10}없|조회된.{0,10}없)`).test(normalizedText));
  const listStatus=(section:Exclude<DetailSectionName,"basic_info"|"financial">,count:number):SectionCollectionResult=>{
    if(count>0)return {status:"VERIFIED"};
    if(hasEmptyEvidence(section))return {status:"CONFIRMED_EMPTY"};
    if(recognized.has(section)||hasHeading(section))return {status:"PARTIAL",error:"SECTION_PRESENT_WITHOUT_COMPLETE_ROWS"};
    return {status:"NOT_CHECKED",error:"SECTION_NOT_FOUND"};
  };
  const hasBasicIdentity=Boolean(parsed.companyName);
  const basicValues=[parsed.companyName,parsed.representativeName,parsed.companyType,parsed.establishedDate,parsed.address,parsed.roadAddress,parsed.industryName,parsed.sourceUpdatedAt];
  const unresolvedSearchCollision=(!rawCompanyType&&hasSearchControlByLabel($,labels.companyType))||(!rawEstablishedDate&&hasSearchControlByLabel($,labels.establishedDate));
  const basicSanity=!unresolvedSearchCollision&&basicValues.every(value=>!isSearchUiContamination(value))&&validDate(parsed.establishedDate)&&validDate(parsed.sourceUpdatedAt)&&(!parsed.companyType||parsed.companyType.length<=80);
  const financialHasValue=parsed.financialStatements.some(row=>row.totalAssets!==undefined||row.equity!==undefined||row.totalCapital!==undefined||row.revenue!==undefined||row.operatingIncome!==undefined||row.netIncome!==undefined);
  let financialStatus:SectionCollectionResult;
  if(parsed.financialStatements.length&&financialHasValue)financialStatus={status:"VERIFIED"};
  else if(hasEmptyEvidence("financial"))financialStatus={status:"CONFIRMED_EMPTY"};
  else if(recognized.has("financial")||hasHeading("financial"))financialStatus={status:"PARTIAL",error:"FINANCIAL_TABLE_OR_VALUES_NOT_FULLY_PARSED"};
  else financialStatus={status:"NOT_CHECKED",error:"FINANCIAL_SECTION_NOT_FOUND"};
  const sectionStatuses:Record<DetailSectionName,SectionCollectionResult>={
    basic_info:hasBasicIdentity&&basicSanity?{status:"VERIFIED"}:{status:"PARTIAL",error:basicSanity?"BASIC_INFO_IDENTITY_MISSING":"BASIC_INFO_SANITY_FAILED"},
    financial:financialStatus,
    executive:listStatus("executive",parsed.executives.length),
    business_site:listStatus("business_site",parsed.businessSites.length),
    history:listStatus("history",parsed.histories.length),
    certification:listStatus("certification",parsed.certifications.length),
    designation:listStatus("designation",parsed.designations.length),
  };
  // Optional fields and sections may legitimately be blank or undisclosed.
  // A parsed detail is fresh when its identity exists and its basic values pass
  // sanity checks; per-section statuses continue to describe data completeness.
  const collectionQuality=sectionStatuses.basic_info.status==="VERIFIED"?"VERIFIED":"PARTIAL";
  return {...parsed,sectionStatuses,collectionQuality};
}
