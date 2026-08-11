import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CollectorControl } from "../control.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Collector control state transitions", () => {
  it("pauses, resumes and stops an active collection immediately", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const control = new CollectorControl((status) => events.push(status), input);
    control.beginCollection();

    input.write("pause\n");
    await tick();
    expect(control.paused).toBe(true);
    expect(events.at(-1)).toBe("PAUSED");

    input.write("resume\n");
    await tick();
    expect(control.paused).toBe(false);
    expect(events.at(-1)).toBe("RUNNING");

    input.write("stop\n");
    await tick();
    expect(control.stopped).toBe(true);
    expect(events.at(-1)).toBe("STOPPED");
    await expect(control.checkpoint()).rejects.toThrow("COLLECTOR_STOPPED");
    control.dispose();
  });

  it("restarts collection when Resume follows an error-induced pause", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const control = new CollectorControl((status) => events.push(status), input);
    control.beginCollection();
    control.pauseForRecovery();
    control.endCollection();
    const action = control.waitForAction();

    input.write("resume\n");
    await expect(action).resolves.toMatchObject({action:"start"});
    expect(events.at(-1)).toBe("RUNNING");
    control.dispose();
  });

  it("allows Start after Stop without restarting the program", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const control = new CollectorControl((status) => events.push(status), input);
    input.write("stop\n");
    await tick();
    expect(events.at(-1)).toBe("STOPPED");
    const action = control.waitForAction();
    input.write("start\n");
    await expect(action).resolves.toMatchObject({action:"start"});
    expect(control.stopped).toBe(false);
    control.dispose();
  });

  it("does not lose Start while the browser is still opening", async () => {
    const input = new PassThrough();
    const control = new CollectorControl(() => undefined, input);
    input.write('{"command":"start","target":"액체 펌프 제조업"}\n');
    await tick();
    await expect(control.waitForAction()).resolves.toMatchObject({action:"start",request:{target:"액체 펌프 제조업"}});
    control.dispose();
  });

  it("queues new credentials while a failed start is unwinding", async()=>{
    const input=new PassThrough();const control=new CollectorControl(()=>undefined,input);control.beginCollection();
    input.write('{"command":"login","credential":{"username":"user","password":"secret"}}\n');await tick();control.endCollection();
    await expect(control.waitForAction()).resolves.toMatchObject({action:"login",request:{credential:{username:"user"}}});control.dispose();
  });

  it("keeps each queued command paired with its own credentials", async()=>{
    const input=new PassThrough();const control=new CollectorControl(()=>undefined,input);
    input.write('{"command":"login","credential":{"username":"first","password":"one"}}\n');
    input.write('{"command":"start","target":"액체 펌프 제조업","credential":{"username":"second","password":"two"}}\n');
    await tick();
    await expect(control.waitForAction()).resolves.toMatchObject({action:"login",request:{credential:{username:"first"}}});
    await expect(control.waitForAction()).resolves.toMatchObject({action:"start",request:{credential:{username:"second"}}});
    control.dispose();
  });
});
