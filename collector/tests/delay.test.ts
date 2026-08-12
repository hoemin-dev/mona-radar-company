import { afterEach, describe, expect, it, vi } from "vitest";
import { nextDelayMs } from "../rate-limiter/delay.js";

afterEach(()=>vi.restoreAllMocks());

describe("company collection interval",()=>{
  it("uses 35 seconds as the minimum",()=>{
    vi.spyOn(Math,"random").mockReturnValue(0);
    expect(nextDelayMs()).toBe(35_000);
  });

  it("never exceeds 40 seconds",()=>{
    vi.spyOn(Math,"random").mockReturnValue(0.999999999);
    expect(nextDelayMs()).toBe(40_000);
  });

  it("generates a new random value for every company",()=>{
    vi.spyOn(Math,"random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.8);
    expect(nextDelayMs()).toBe(35_500);
    expect(nextDelayMs()).toBe(39_000);
  });
});
