import { load } from "cheerio";
import type { CompanySourceSummary } from "../../src/shared/types.js";
import { clean, integer } from "./helpers.js";
export interface SearchResultPage { total: number; currentPage?: number; totalPages?: number; companies: CompanySourceSummary[]; }
export function parseSearchResult(html: string): SearchResultPage {
  const $=load(html); const companies: CompanySourceSummary[]=[];
  $("a[onclick*='onMoveView01']").each((_,a)=>{ const onclick=$(a).attr("onclick")??""; const kcd=/onMoveView01\(['\"]([^'\"]+)/.exec(onclick)?.[1]; if(!kcd)return; const cells=$(a).closest("tr").find("td").map((_,td)=>clean($(td).text())).get(); companies.push({kcd,companyName:clean($(a).text()),representativeName:cells[1],companyType:cells[2],industryName:cells[3],roadAddress:cells[4]}); });
  const pageCalls=$("[onclick*='searchByTarget']").map((_,e)=>integer(/searchByTarget\(['\"]?(\d+)/.exec($(e).attr("onclick")??"")?.[1]??"")).get().filter((n):n is number=>n!==undefined);
  const body=clean($("body").text()); const total=integer(/(?:총|전체)\s*([\d,]+)\s*건/.exec(body)?.[1]??"")??companies.length;
  const activePage=integer($("[aria-current=page], .paging .on, .pagination .active, .page_on").first().text())??integer($("input[name=cmPageNo],input[name=pageNo]").first().attr("value")??"");
  return {total,currentPage:activePage,totalPages:pageCalls.length?Math.max(...pageCalls):undefined,companies};
}
