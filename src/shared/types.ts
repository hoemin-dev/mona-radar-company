export type CollectorStatus = "IDLE" | "CREDENTIAL_REQUIRED" | "BROWSER_STARTING" | "WAITING_FOR_BROWSER" | "LOGIN_CHECKING" | "WAITING_FOR_LOGIN" | "LOGIN_IN_PROGRESS" | "LOGGED_IN" | "LOGIN_FAILED" | "INDUSTRY_SEARCHING" | "INDUSTRY_SELECTION_REQUIRED" | "TARGET_NOT_FOUND" | "TARGET_TOO_BROAD" | "COMPANY_SEARCHING" | "WAITING_FOR_SEARCH" | "READY" | "RUNNING" | "COLLECTING" | "RECOVERING" | "PAUSED" | "STOPPED" | "COMPLETED" | "ERROR";
export interface CompanySourceSummary { kcd: string; companyName: string; representativeName?: string; companyType?: string; industryName?: string; roadAddress?: string; }
export interface FinancialStatement { fiscalYear: number; totalAssets?: number; equity?: number; totalCapital?: number; revenue?: number; operatingIncome?: number; netIncome?: number; unit: "KRW_MILLION"; }
export interface FactoryInfo { factoryName?: string; locationAddress?: string; }
export interface PatentInfo { patentDate?: string; description?: string; }
export interface ExecutiveInfo { positionTitle?: string; maskedName?: string; }
export interface BusinessSiteInfo { siteName?: string; siteType?: string; businessNumber?: string; address?: string; }
export interface CompanyHistoryInfo { eventDate?: string; description?: string; }
export interface CertificationInfo { certificationName?: string; certificationNumber?: string; issuer?: string; acquiredDate?: string; validUntil?: string; }
export interface DesignationInfo { designationName?: string; designationNumber?: string; authority?: string; designatedDate?: string; validUntil?: string; }
export type SectionStatus = "NOT_CHECKED" | "VERIFIED" | "CONFIRMED_EMPTY" | "PARTIAL" | "FAILED";
export type CollectionQuality = "UNKNOWN" | "PARTIAL" | "VERIFIED" | "FAILED";
export type DetailSectionName = "basic_info" | "financial" | "factory" | "patent" | "executive" | "business_site" | "history" | "certification" | "designation";
export interface SectionCollectionResult { status: SectionStatus; error?: string; }
export interface CompanyDetail extends CompanySourceSummary { businessNumber?: string; companyStatus?: string; establishedDate?: string; address?: string; homepage?: string; mainProducts?: string; ksicCode?: string; financialStatements: FinancialStatement[]; factories?: FactoryInfo[]; patents?: PatentInfo[]; executives?: ExecutiveInfo[]; businessSites?: BusinessSiteInfo[]; histories?: CompanyHistoryInfo[]; certifications?: CertificationInfo[]; designations?: DesignationInfo[]; sectionStatuses: Record<DetailSectionName,SectionCollectionResult>; collectionQuality: CollectionQuality; }
export interface CollectionJob { id: string; status: CollectorStatus; total: number; completed: number; failed: number; pending: number; }
export interface CollectionItem { kcd: string; status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED"; errorCode?: string; errorMessage?: string; }
export type CollectorEvent =
  | { type: "status"; status: CollectorStatus; message: string }
  | { type: "search_detected"; total: number; summary?: string }
  | { type: "company_collected"; kcd: string; companyName: string; completed: number; total: number }
  | { type: "countdown"; seconds: number }
  | { type: "error"; code: string; message: string };
