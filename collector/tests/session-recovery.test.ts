import {describe,expect,it} from "vitest";
import {classifyCollectorError,classifyNavigationState,detailIdentityMatches,isRecoverableNavigationCode,recoveryFailureCode} from "../collector.js";
import type {BrowserState} from "../sminfo/session.js";

const state=(value:Partial<BrowserState>):BrowserState=>({sessionStatus:"UNKNOWN",url:"https://sminfo.mss.go.kr/other",path:"/other",loginForm:false,searchResults:false,detailPage:false,...value});

describe("SMINFO session recovery classification",()=>{
  it("classifies a login redirect as SESSION_EXPIRED",()=>expect(classifyNavigationState(state({sessionStatus:"EXPIRED",path:"/cm/sv/CSV001R0.do",loginForm:true}),"Timeout").code).toBe("SESSION_EXPIRED"));
  it("classifies logged-out state as SESSION_EXPIRED",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_OUT"}),"COMPANY_LINK_NOT_FOUND").code).toBe("SESSION_EXPIRED"));
  it("classifies a non-search page as SEARCH_CONTEXT_LOST",()=>expect(classifyNavigationState(state({}),"COMPANY_LINK_NOT_FOUND").code).toBe("SEARCH_CONTEXT_LOST"));
  it("keeps true missing links distinct on search results",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/gc/sf/GSF002R0.print",searchResults:true}),"COMPANY_LINK_NOT_FOUND").code).toBe("COMPANY_LINK_NOT_FOUND"));
  it("classifies search-page navigation timeout",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/gc/sf/GSF002R0.print"}),"Timeout 30000ms").code).toBe("DETAIL_NAVIGATION_TIMEOUT"));
  it("classifies detail-page navigation timeout",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/si/ei/IEI001R0.do",detailPage:true}),"page.waitForURL timeout").code).toBe("DETAIL_NAVIGATION_TIMEOUT"));
  it("preserves the explicit detail navigation timeout code",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/gc/sf/GSF002R0.print"}),"DETAIL_NAVIGATION_TIMEOUT").code).toBe("DETAIL_NAVIGATION_TIMEOUT"));
  it("preserves a detail identity mismatch for a company-local retry",()=>expect(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/si/ei/IEI001R0.do",detailPage:true}),"DETAIL_IDENTITY_MISMATCH").code).toBe("DETAIL_IDENTITY_MISMATCH"));
  it("does not treat an unknown detail failure as recoverable",()=>expect(isRecoverableNavigationCode(classifyNavigationState(state({sessionStatus:"LOGGED_IN",path:"/si/ei/IEI001R0.do",detailPage:true}),"parse error").code)).toBe(false));
  it("treats session expiration and context loss as recoverable",()=>expect([isRecoverableNavigationCode("SESSION_EXPIRED"),isRecoverableNavigationCode("SEARCH_CONTEXT_LOST")]).toEqual([true,true]));
  it("uses CREDENTIAL_REQUIRED only when credential is missing",()=>expect(recoveryFailureCode("CREDENTIAL_REQUIRED")).toBe("CREDENTIAL_REQUIRED"));
  it("distinguishes saved-credential login failure from missing credentials",()=>expect(recoveryFailureCode("LOGIN_FAILED INVALID_CREDENTIAL")).toBe("LOGIN_FAILED"));
  it("keeps an uncertain authentication outcome distinct during recovery",()=>expect(recoveryFailureCode("LOGIN_FAILED LOGIN_STATE_UNCERTAIN")).toBe("LOGIN_STATE_UNCERTAIN"));
  it("classifies disclosure denial as a normal skip",()=>expect(classifyCollectorError("DISCLOSURE_DENIED")).toBe("SKIP"));
  it("classifies missing company links as company-local errors",()=>expect(classifyCollectorError("COMPANY_LINK_NOT_FOUND")).toBe("COMPANY_ERROR"));
  it("accepts the expected detail identity and rejects mismatched or missing identities",()=>{
    expect(detailIdentityMatches({kcd:"expected",companyName:"회사"},{kcd:"expected",companyName:"회사"})).toBe(true);
    expect(detailIdentityMatches({kcd:"",companyName:"회 사"},{kcd:"expected",companyName:"회사"})).toBe(true);
    expect(detailIdentityMatches({kcd:"other",companyName:"회사"},{kcd:"expected",companyName:"회사"})).toBe(false);
    expect(detailIdentityMatches({kcd:"",companyName:""},{kcd:"expected",companyName:"회사"})).toBe(false);
    expect(classifyCollectorError("DETAIL_IDENTITY_MISMATCH")).toBe("COMPANY_ERROR");
  });
  it("classifies lost search context as a system error",()=>expect(classifyCollectorError("SEARCH_CONTEXT_LOST")).toBe("SYSTEM_ERROR"));
});
