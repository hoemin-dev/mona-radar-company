import type { Page } from "playwright";
import { parseSearchResult } from "../parser/search-result.js";
import { SMINFO } from "../sminfo/constants.js";

type Emit = (event: unknown) => void;

const log = (emit: Emit, message: string) =>
  emit({ type: "nav_test", message: `[NAV TEST] ${message}` });

export async function readVisiblePageNumber(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("[onclick*='searchByTarget']")) as HTMLElement[];
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const numberOf = (element: HTMLElement) => {
      const text = element.textContent?.trim() ?? "";
      return /^\d+$/.test(text) ? Number(text) : undefined;
    };
    const roots = links
      .map((link) => {
        let root: HTMLElement | null = link.parentElement;
        while (root && root.querySelectorAll("[onclick*='searchByTarget']").length < 2) root = root.parentElement;
        return root;
      })
      .filter((root): root is HTMLElement => root !== null);
    const root = roots[0] ?? links[0]?.parentElement;
    if (!root) return undefined;

    const candidates = (Array.from(root.querySelectorAll("a,span,strong,b,em,li")) as HTMLElement[])
      .filter(visible)
      .map((element) => ({
        element,
        value: numberOf(element),
        marker: `${element.className} ${element.getAttribute("aria-current") ?? ""}`.toLowerCase(),
      }))
      .filter((item): item is typeof item & { value: number } => item.value !== undefined);
    const marked = candidates.find((item) =>
      /(^|[\s_-])(on|active|current|now|selected|select|sel)([\s_-]|$)|page_on/.test(item.marker),
    );
    if (marked) return marked.value;
    const semantic = candidates.find((item) => ["STRONG", "B", "EM"].includes(item.element.tagName));
    if (semantic) return semantic.value;
    const unlinked = candidates.find(
      (item) => item.element.tagName !== "A" && !item.element.closest("[onclick*='searchByTarget']"),
    );
    return unlinked?.value;
  });
}

export async function runNavigationTest(page: Page, emit: Emit): Promise<void> {
  let stage = "A_READ_CURRENT_PAGE";
  let selector = "active pagination";
  let workPage: number | undefined;
  let companyName = "";

  try {
    const initial = parseSearchResult(await page.content());
    workPage = await readVisiblePageNumber(page);
    if (workPage === undefined) throw new Error("CURRENT_PAGE_NOT_FOUND");
    log(emit, `current page = ${workPage}`);

    const company = initial.companies[0];
    if (!company) throw new Error("FIRST_COMPANY_NOT_FOUND");
    companyName = company.companyName;
    log(emit, `company = ${companyName}`);

    stage = "C_CLICK_COMPANY";
    selector = `a[onclick*="onMoveView01('${company.kcd}')"]`;
    const companyLink = page.locator(selector).first();
    if (!(await companyLink.count())) throw new Error("COMPANY_LINK_NOT_FOUND");
    await Promise.all([
      page.waitForURL((url) => url.pathname === SMINFO.detailPath, { timeout: 30_000 }),
      companyLink.click(),
    ]);

    stage = "D_DETAIL_ENTERED";
    log(emit, "detail entered");

    stage = "E_CLICK_LIST";
    selector = "visible a/button/input with label \\uBAA9\\uB85D";
    const listButton = page.getByText("\uBAA9\uB85D", { exact: true }).first();
    const inputListButton = page.locator(
      'input[type=button][value="\uBAA9\uB85D"],input[type=submit][value="\uBAA9\uB85D"]',
    );
    const actualListButton = (await listButton.count()) ? listButton : inputListButton.first();
    if (!(await actualListButton.count())) throw new Error("LIST_BUTTON_NOT_FOUND");
    await Promise.all([
      page.waitForURL((url) => url.pathname === SMINFO.searchPath, { timeout: 30_000 }),
      actualListButton.click(),
    ]);
    log(emit, "list clicked");

    stage = "F_VERIFY_RETURN";
    const returnedPage = await readVisiblePageNumber(page);
    if (returnedPage === undefined) throw new Error("RETURNED_PAGE_NOT_FOUND");
    log(emit, `returned page = ${returnedPage}`);

    stage = "G_RESTORE_PAGE";
    selector = `a[onclick*="searchByTarget('${workPage}')"],a[onclick*='searchByTarget("${workPage}")']`;
    log(emit, `restoring page = ${workPage}`);
    const pageLink = page.locator(selector).first();
    if (!(await pageLink.count())) throw new Error("PAGINATION_LINK_NOT_FOUND");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
      pageLink.click(),
    ]);

    stage = "H_VERIFY_RESTORED";
    const restored = parseSearchResult(await page.content());
    const restoredPage = await readVisiblePageNumber(page);
    if (restoredPage !== workPage) {
      throw new Error(`RESTORED_PAGE_MISMATCH expected=${workPage} actual=${restoredPage}`);
    }
    log(emit, `restored page = ${restoredPage}`);

    stage = "I_VERIFY_COMPANY";
    const found = restored.companies.some((item) => item.companyName === companyName);
    log(emit, `company found = ${found}`);
    if (!found) throw new Error("ORIGINAL_COMPANY_NOT_FOUND");

    stage = "J_SUCCESS";
    log(emit, "SUCCESS");
  } catch (error) {
    let currentPage: number | undefined;
    try {
      currentPage = await readVisiblePageNumber(page);
    } catch {}
    const message = error instanceof Error ? error.message : String(error);
    log(
      emit,
      `FAILED stage=${stage} url=${page.url()} current_page=${currentPage ?? "unknown"} selector=${selector} error=${message}`,
    );
    throw error;
  }
}
