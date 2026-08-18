import {chromium} from "playwright";
import {describe,expect,it} from "vitest";
import {visibleTextInput} from "../sminfo/industry.js";

describe("industry recovery keyword locator",()=>{
  it.skipIf(!process.env.RUN_BROWSER_TESTS)("never selects the labelled search-option select for fill",async()=>{
    const browser=await chromium.launch({channel:"msedge",headless:true,chromiumSandbox:true});const page=await browser.newPage();
    await page.setContent(`<label for="cmQueryOptionCombo">검색어</label><select id="cmQueryOptionCombo"><option>산업명</option></select><label for="industryKeyword">산업명</label><input id="industryKeyword" name="searchKeyword" type="text">`);
    const locator=await visibleTextInput(page);expect(await locator.evaluate(element=>element.tagName)).toBe("INPUT");await locator.fill("액체 펌프 제조업");expect(await locator.inputValue()).toBe("액체 펌프 제조업");await browser.close();
  },30_000);

  it.skipIf(!process.env.RUN_BROWSER_TESTS)("reports a specific error when no editable keyword element exists",async()=>{
    const browser=await chromium.launch({channel:"msedge",headless:true,chromiumSandbox:true});const page=await browser.newPage();await page.setContent(`<label for="cmQueryOptionCombo">검색어</label><select id="cmQueryOptionCombo"><option>산업명</option></select>`);await expect(visibleTextInput(page)).rejects.toThrow("INDUSTRY_KEYWORD_INPUT_NOT_FOUND");await browser.close();
  },30_000);
});
