import type {Page} from "playwright";

const MIN_PAGINATION_INTERVAL_MS=500;
const lastPaginationAt=new WeakMap<object,number>();

export async function beforePagination(page:Page){
  const key=page.context();
  const remaining=MIN_PAGINATION_INTERVAL_MS-(Date.now()-(lastPaginationAt.get(key)??0));
  if(remaining>0)await page.waitForTimeout(remaining);
  lastPaginationAt.set(key,Date.now());
}
