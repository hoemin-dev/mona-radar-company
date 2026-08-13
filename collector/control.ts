import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";

export type CollectorAction = "start" | "login" | "nav_test" | "shutdown";
export interface StartRequest { target: string; industryCode?:string; credential?: { username: string; password: string } }
export interface QueuedCollectorAction { action: CollectorAction; request?: StartRequest }
type StateEmitter = (status: "RUNNING" | "PAUSED" | "STOPPED", message: string) => void;

export class CollectorControl {
  paused = false;
  stopped = false;
  private active = false;
  private lines: Interface;
  private actionResolve: ((action: QueuedCollectorAction) => void) | undefined;
  private pendingActions: QueuedCollectorAction[] = [];
  private lastTarget = "액체 펌프 제조업";
  private lastIndustryCode:string|undefined;
  private lastCredential:StartRequest["credential"];
  private resumeGeneration=0;
  shutdownRequested = false;

  constructor(onState: StateEmitter = () => undefined, input: Readable = process.stdin) {
    this.lines = createInterface({ input });
    this.lines.on("line", (line) => {
      let command = line.trim().toLowerCase();
      let request: StartRequest | undefined;
      if (line.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(line) as { command?: string; target?: string; industryCode?:string; credential?: StartRequest["credential"] };
          command = parsed.command?.toLowerCase() ?? "";
          if (command === "start" || command === "login" || command === "resume") {
            request = { target: parsed.target?.trim() || this.lastTarget, industryCode:parsed.industryCode, credential: parsed.credential };
            if (command === "start" || command === "resume") {this.lastTarget=request.target;this.lastIndustryCode=request.industryCode??this.lastIndustryCode;this.lastCredential=request.credential??this.lastCredential;}
          }
        } catch { return; }
      }
      if (command === "start") {
        if (this.active) {
          onState(this.paused ? "PAUSED" : "RUNNING", "Collection is already active");
          return;
        }
        this.stopped = false;
        this.paused = false;
        this.dispatch("start", request ?? { target: this.lastTarget });
        return;
      }
      if (command === "nav_test") {
        if (!this.active) this.dispatch("nav_test");
        return;
      }
      if (command === "login") {
        this.dispatch("login", request ?? { target: this.lastTarget });
        return;
      }
      if (command === "pause") {
        if (this.active && !this.stopped) {
          this.paused = true;
          onState("PAUSED", "Collection paused");
        } else {
          if (this.stopped) onState("STOPPED", "Collection is already stopped");
          else {
            this.paused = true;
            onState("PAUSED", "Collection is paused before start");
          }
        }
        return;
      }
      if (command === "resume") {
        if (!this.paused) {
          onState(this.active ? "RUNNING" : this.stopped ? "STOPPED" : "PAUSED", this.active ? "Collection is already running" : "No paused collection to resume");
          return;
        }
        this.paused = false;
        this.stopped = false;
        this.resumeGeneration++;
        onState("RUNNING", this.active ? "Resume requested; validating browser state" : "Resume requested; recovery collection restarting");
        if (!this.active) this.dispatch("start", request??{ target: this.lastTarget,industryCode:this.lastIndustryCode,credential:this.lastCredential });
        return;
      }
      if (command === "stop") {
        this.stopped = true;
        this.paused = false;
        onState("STOPPED", this.active ? "Stopping collection" : "Collection stopped");
        return;
      }
      if(command === "shutdown"){
        this.shutdownRequested=true;
        this.stopped=true;
        this.paused=false;
        onState("STOPPED","Collector is shutting down");
        if(!this.active)this.dispatch("shutdown");
      }
    });
  }

  waitForAction() {
    const pending = this.pendingActions.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise<QueuedCollectorAction>((resolve) => { this.actionResolve = resolve; });
  }

  private dispatch(action: CollectorAction, request?: StartRequest) {
    const queued = { action, request };
    if (this.actionResolve) { const resolve=this.actionResolve; this.actionResolve=undefined; resolve(queued); }
    else this.pendingActions.push(queued);
  }

  beginCollection() {
    this.active = true;
    this.stopped = false;
    this.paused = false;
  }

  endCollection() {
    this.active = false;
  }

  pauseForRecovery() {
    this.paused = true;
  }

  currentResumeGeneration(){return this.resumeGeneration}

  async checkpoint() {
    while (this.paused && !this.stopped) await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.stopped) throw new Error("COLLECTOR_STOPPED");
  }

  dispose() {
    this.lines.close();
  }
}
