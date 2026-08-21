export class HardRecoveryRequired extends Error{
  constructor(reason:string){super(`HARD_RECOVERY_REQUIRED ${reason}`);this.name="HardRecoveryRequired"}
}

const HARD_RECOVERY_PATTERN=/HARD_RECOVERY_REQUIRED|SESSION_EXPIRED|SEARCH_CONTEXT_LOST|SEARCH_CONTEXT_RECOVERY_FAILED|SEARCH_RECOVERY_FAILED|SEARCH_PAGE_REPAIR_FAILED|PAGINATION_|SEARCH_PAGE_STATE_MISMATCH|SEARCH_RESULT_STATE_LOST|COMPANY_SEARCH_NAVIGATION_FAILED|INDUSTRY_(?:POPUP|FLOW|NOT_APPLIED)|비정상\s*접근|정상적인\s*화면\s*접근|Target page, context or browser has been closed|Browser has been closed/i;
export const requiresHardRecovery=(error:unknown)=>error instanceof HardRecoveryRequired||HARD_RECOVERY_PATTERN.test(error instanceof Error?error.message:String(error));
