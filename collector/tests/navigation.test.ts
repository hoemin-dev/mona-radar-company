import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { runNavigationTest } from "../browser/navigation-test.js";

let browser: Browser;
let context: BrowserContext;
let searchPage: Page;

beforeAll(async () => {
  if (!process.env.RUN_BROWSER_TESTS) return;
  browser = await chromium.launch({ channel: "msedge", headless: true, chromiumSandbox: true });
  context = await browser.newContext();

  const searchHtml = (pageNo: number) => `
    <form name="frm" method="post">
      <input name="cmPageNo" value="${pageNo}">
      <input name="kedcd">
      <iframe name="hiddenframe"></iframe>
    </form>
    <div class="paging"><a onclick="searchByTarget('1')">1</a><span class="now">${pageNo}</span><a onclick="searchByTarget('3')">3</a></div>
    <a onclick="onMoveView01('0007802354')">Mona Pumps</a>
    <script>
      function searchByTarget(p) {
        frm.cmPageNo.value = p;
        frm.action = '/gc/sf/GSF002R0.print';
        frm.target = '_self';
        frm.submit();
      }
      function onMoveView01(kcd) {
        frm.kedcd.value = kcd;
        frm.method = 'post';
        frm.action = '/gc/sf/GSF002P0.do';
        frm.target = 'hiddenframe';
        frm.submit();
      }
      function onMoveView02(kedCd) {
        frm.cmPageNo.value = '1';
        frm.method = 'post';
        frm.action = '/si/ei/IEI001R0.do?cmd=com&kcd=' + kedCd;
        frm.target = '_self';
        frm.submit();
      }
    </script>`;

  await context.route("https://sminfo.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/gc/sf/GSF002R0.print") {
      const requested = /cmPageNo=(\d+)/.exec(route.request().postData() ?? "")?.[1];
      return route.fulfill({ contentType: "text/html", body: searchHtml(Number(requested ?? 3)) });
    }
    if (path === "/gc/sf/GSF002P0.do") {
      return route.fulfill({
        contentType: "text/html",
        body: `<script>parent.onMoveView02('0007802354')</script>`,
      });
    }
    if (path === "/si/ei/IEI001R0.do") {
      return route.fulfill({
        contentType: "text/html",
        body: `<h1>Company detail</h1><form method="post" action="/gc/sf/GSF002R0.print"><input name="cmPageNo" value="1"><button>&#47785;&#47197;</button></form>`,
      });
    }
    return route.abort();
  });

  searchPage = await context.newPage();
  await searchPage.goto("https://sminfo.test/gc/sf/GSF002R0.print");
}, 30_000);

afterAll(async () => {
  await searchPage?.close();
  await context?.close();
  await browser?.close();
}, 30_000);

describe("A-J single-page navigation diagnostic", () => {
  it.skipIf(!process.env.RUN_BROWSER_TESTS)("uses only visible company, list, and pagination UI", async () => {
    const events: string[] = [];
    await runNavigationTest(searchPage, (event) => {
      const value = event as { message?: string };
      if (value.message) events.push(value.message);
    });

    expect(events).toContain("[NAV TEST] current page = 3");
    expect(events).toContain("[NAV TEST] company = Mona Pumps");
    expect(events).toContain("[NAV TEST] detail entered");
    expect(events).toContain("[NAV TEST] list clicked");
    expect(events).toContain("[NAV TEST] returned page = 1");
    expect(events).toContain("[NAV TEST] restoring page = 3");
    expect(events).toContain("[NAV TEST] restored page = 3");
    expect(events).toContain("[NAV TEST] company found = true");
    expect(events.at(-1)).toBe("[NAV TEST] SUCCESS");
  }, 40_000);
});
