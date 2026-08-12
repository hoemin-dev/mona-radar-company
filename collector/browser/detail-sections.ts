import type { Page } from "playwright";

const DETAIL_SECTIONS = ["사업장정보", "연혁", "경영진", "매출현황", "인증", "지정"] as const;

/**
 * SMINFO renders the company sections in one detail document. They are headings,
 * not navigation controls, so clicking text-matched buttons loses data on the
 * current site. Capture the settled document once and let the parser read every
 * table in it.
 */
export async function captureCompanyDetailSections(page:Page,emit:(event:unknown)=>void){
  await page.waitForLoadState("domcontentloaded");
  await page.locator("body").waitFor({state:"visible",timeout:10_000});
  const text=(await page.locator("body").innerText()).replace(/\s+/g," ");
  for(const section of DETAIL_SECTIONS){
    const found=text.includes(section);
    emit({
      type:"detail_section",
      section,
      found,
      message:found?`Detail section present: ${section}`:`Detail section heading not present: ${section}`,
    });
  }
  return page.content();
}
