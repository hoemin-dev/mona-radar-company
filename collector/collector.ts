import type { Page } from "playwright";
import { readVisiblePageNumber } from "./browser/navigation-test.js";
import { Repository } from "./database/repository.js";
import { parseCompanyDetail } from "./parser/company-detail.js";
import { parseSearchResult } from "./parser/search-result.js";
import { nextDelayMs, wait } from "./rate-limiter/delay.js";
import { RATE_LIMIT, SMINFO } from "./sminfo/constants.js";
import type { CollectorControl } from "./control.js";
import { captureCompanyDetailSections } from "./browser/detail-sections.js";

type Emit = (event: unknown) => void;
const restricted = (text: string, status?: number) =>
  status === 403 || status === 429 || /\uC811\uC18D\s*\uC81C\uD55C|\uBE44\uC815\uC0C1\s*\uC811\uADFC|\uB85C\uADF8\uC778.*(?:\uD544\uC694|\uB9CC\uB8CC)/.test(text);

async function clickPageNumber(page: Page, pageNumber: number) {
  const selector = `a[onclick*="searchByTarget('${pageNumber}')"],a[onclick*='searchByTarget("${pageNumber}")']`;
  const link = page.locator(selector).filter({ visible: true }).first();
  if (!(await link.count())) throw new Error(`PAGINATION_LINK_NOT_FOUND page=${pageNumber}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
    link.click(),
  ]);
  const actual = await readVisiblePageNumber(page);
  if (actual !== pageNumber) throw new Error(`SEARCH_PAGE_MISMATCH expected=${pageNumber} actual=${actual}`);
}

async function clickCompany(page: Page, kcd: string) {
  const selector = `a[onclick*="onMoveView01('${kcd}')"]`;
  const link = page.locator(selector).filter({ visible: true }).first();
  if (!(await link.count())) throw new Error(`COMPANY_LINK_NOT_FOUND kcd=${kcd}`);
  await Promise.all([
    page.waitForURL((url) => url.pathname === SMINFO.detailPath, { timeout: 30_000 }),
    link.click(),
  ]);
}

async function clickListAndRestore(page: Page, workPage: number) {
  const textButton = page.getByText("\uBAA9\uB85D", { exact: true }).filter({ visible: true }).first();
  const inputButton = page.locator(
    'input[type=button][value="\uBAA9\uB85D"],input[type=submit][value="\uBAA9\uB85D"]',
  ).filter({ visible: true }).first();
  const button = (await textButton.count()) ? textButton : inputButton;
  if (!(await button.count())) throw new Error("LIST_BUTTON_NOT_FOUND");
  await Promise.all([
    page.waitForURL((url) => url.pathname === SMINFO.searchPath, { timeout: 30_000 }),
    button.click(),
  ]);
  const returnedPage = await readVisiblePageNumber(page);
  if (returnedPage === undefined) throw new Error("RETURNED_PAGE_NOT_FOUND");
  if (returnedPage !== workPage) await clickPageNumber(page, workPage);
}

export async function collectCurrentSearch(
  page: Page,
  repo: Repository,
  emit: Emit,
  limit: number | undefined,
  control: CollectorControl,
  targetId?: string,
) {
  const initial = parseSearchResult(await page.content());
  const firstPage = await readVisiblePageNumber(page);
  if (firstPage === undefined) throw new Error("CURRENT_PAGE_NOT_FOUND");
  const totalPages = initial.totalPages ?? firstPage;
  const job = repo.createJob(initial.total, totalPages, undefined, limit);
  if (targetId) { repo.attachJob(targetId, job); repo.targetStatus(targetId, "RUNNING", initial.total, totalPages); }
  repo.jobStatus(job, "RUNNING");
  let processed = 0;
  let consecutiveErrors = 0;

  try {
    for (let pageNumber = firstPage; pageNumber <= totalPages; pageNumber++) {
      await control.checkpoint();
      if ((await readVisiblePageNumber(page)) !== pageNumber) await clickPageNumber(page, pageNumber);
      const search = parseSearchResult(await page.content());
      repo.enqueue(job, pageNumber, search.companies);
      if (targetId) repo.linkQueuedCompanies(targetId, job);
      emit({ type: "status", status: "RUNNING", message: `Search page ${pageNumber}: ${search.companies.length} companies queued` });

      while (true) {
        await control.checkpoint();
        if (limit && processed >= limit) {
          repo.jobStatus(job, "STOPPED");
          emit({ type: "status", status: "STOPPED", message: `Safety limit reached: ${limit}` });
          return;
        }
        const item = repo.next(job);
        if (!item) break;
        repo.markRunning(item.collection_item_id);
        try {
          emit({ type: "status", status: "RUNNING", message: `Collecting ${item.company_name_snapshot}` });
          await clickCompany(page, item.sminfo_kcd);
          const html = await captureCompanyDetailSections(page,emit);
          if (restricted(html)) throw new Error("ACCESS_RESTRICTED");
          const detail = parseCompanyDetail(html);
          if (!detail.kcd) detail.kcd = item.sminfo_kcd;
          if (!detail.companyName) detail.companyName = item.company_name_snapshot;
          repo.saveCompany(item.collection_item_id, detail);
          if (targetId) repo.linkCollectedCompany(targetId, item.collection_item_id, detail.ksicCode);
          processed++;
          consecutiveErrors = 0;
          const stats = repo.stats(job);
          if (targetId) repo.checkpoint(targetId, pageNumber, search.companies.findIndex((x) => x.kcd === item.sminfo_kcd) + 1, item.sminfo_kcd, stats);
          emit({
            type: "company_collected",
            kcd: detail.kcd,
            companyName: detail.companyName,
            completed: stats.completed,
            total: initial.total,
          });
          await clickListAndRestore(page, pageNumber);

          const delay = nextDelayMs();
          for (let seconds = Math.ceil(delay / 1000); seconds > 0; seconds--) {
            await control.checkpoint();
            emit({ type: "countdown", seconds });
            await wait(1000);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "COLLECTOR_STOPPED") {
            repo.jobStatus(job, "STOPPED");
            emit({ type: "status", status: "STOPPED", message: "Collection stopped" });
            return;
          }
          repo.fail(item.collection_item_id, message === "ACCESS_RESTRICTED" ? "ACCESS_RESTRICTED" : "DETAIL_FAILED", message);
          consecutiveErrors++;
          emit({ type: "error", code: message === "ACCESS_RESTRICTED" ? "ACCESS_RESTRICTED" : "DETAIL_FAILED", message });
          if (page.url().includes(SMINFO.detailPath)) {
            await clickListAndRestore(page, pageNumber).catch(() => undefined);
          }
          if (message === "ACCESS_RESTRICTED" || consecutiveErrors >= RATE_LIMIT.maxConsecutiveErrors) {
            control.pauseForRecovery();
            repo.jobStatus(job, "PAUSED");
            emit({ type: "status", status: "PAUSED", message: "Collection paused after repeated errors" });
            return;
          }
        }
      }
    }
    repo.jobStatus(job, "COMPLETED");
    if (targetId) repo.targetStatus(targetId, "COMPLETED");
    emit({ type: "status", status: "COMPLETED", message: "Collection completed" });
  } catch (error) {
    repo.jobStatus(job, "ERROR");
    throw error;
  }
}
