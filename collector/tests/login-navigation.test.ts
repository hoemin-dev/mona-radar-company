import {describe,expect,it,vi} from "vitest";
import type {Page} from "playwright";
import {waitForLoginNavigation} from "../sminfo/session.js";

type FixtureOptions={
  initialUrl?:string;
  landedUrl?:string;
  bodyText?:string;
  authenticatedMarker?:boolean;
  waitForUrlTimesOut?:boolean;
  recheck?:{url?:string;bodyText?:string;authenticatedMarker?:boolean}|"timeout";
};

function pageFixture(options:FixtureOptions={}){
  let current=options.initialUrl??"https://sminfo.mss.go.kr/cm/sv/CSV001R0.do";
  let bodyText=options.bodyText??"";
  let authenticatedMarker=options.authenticatedMarker??false;
  const makeLocator=(kind:"body"|"login"|"other")=>{
    const locator={
      filter:()=>locator,
      first:()=>locator,
      count:vi.fn(async()=>kind==="login"&&new URL(current).pathname==="/cm/sv/CSV001R0.do"?1:0),
      innerText:vi.fn(async()=>kind==="body"?bodyText:""),
    };
    return locator;
  };
  return {
    url:()=>current,
    waitForURL:vi.fn(async(predicate:(url:URL)=>boolean)=>{
      expect(predicate(new URL(current))).toBe(false);
      if(options.waitForUrlTimesOut)throw new Error("Timeout");
      current=options.landedUrl??"https://sminfo.mss.go.kr/cm/mm/CMM001R0.do";
      expect(predicate(new URL(current))).toBe(true);
    }),
    waitForLoadState:vi.fn(async()=>undefined),
    waitForFunction:vi.fn(async()=>{
      if(options.recheck==="timeout"||!options.recheck)throw new Error("Timeout");
      current=options.recheck.url??current;
      bodyText=options.recheck.bodyText??bodyText;
      authenticatedMarker=options.recheck.authenticatedMarker??authenticatedMarker;
    }),
    locator:vi.fn((selector:string)=>makeLocator(selector==="body"?"body":selector.includes("login_")?"login":"other")),
    getByText:vi.fn(()=>{const locator=makeLocator("other");locator.count=vi.fn(async()=>authenticatedMarker?1:0);return locator;}),
  } as unknown as Page;
}

describe("login navigation stabilization",()=>{
  it("accepts a normal fast login after SMINFO leaves the login URL",async()=>{
    const page=pageFixture();
    const events:any[]=[];
    await waitForLoginNavigation(page,event=>events.push(event));
    expect(events.map(event=>event.type)).toEqual(["login_navigation_wait_start","login_navigation_landed","login_auth_check","login_authenticated","login_navigation_stable"]);
  });

  it("rechecks state without resubmitting credentials when a slow login eventually succeeds",async()=>{
    const page=pageFixture({waitForUrlTimesOut:true,recheck:{url:"https://sminfo.mss.go.kr/cm/mm/CMM001R0.do",authenticatedMarker:true}});
    const events:any[]=[];
    await expect(waitForLoginNavigation(page,event=>events.push(event))).resolves.toBeUndefined();
    expect(events.map(event=>event.type)).toContain("login_auth_recheck");
    expect(events.map(event=>event.type)).toContain("login_authenticated");
    expect(events.map(event=>event.type)).not.toContain("login_auth_failed");
  });

  it("keeps INVALID_CREDENTIAL for an explicit SMINFO authentication failure",async()=>{
    const page=pageFixture({waitForUrlTimesOut:true,bodyText:"아이디 또는 비밀번호가 잘못되었습니다."});
    const events:any[]=[];
    await expect(waitForLoginNavigation(page,event=>events.push(event))).rejects.toThrow(/INVALID_CREDENTIAL/);
    expect(events).toContainEqual(expect.objectContaining({type:"login_auth_failed",reason:"explicit_invalid_credential"}));
  });

  it("reports an unresolved login state separately from invalid credentials",async()=>{
    const page=pageFixture({waitForUrlTimesOut:true,recheck:"timeout"});
    const events:any[]=[];
    await expect(waitForLoginNavigation(page,event=>events.push(event))).rejects.toThrow(/LOGIN_STATE_UNCERTAIN/);
    expect(events).toContainEqual(expect.objectContaining({type:"login_auth_uncertain"}));
    expect(events.map(event=>event.type)).not.toContain("login_auth_failed");
  });
});
