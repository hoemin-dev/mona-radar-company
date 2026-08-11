import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";

export type CollectorAction = "start" | "login" | "nav_test";
export interface StartRequest { target: string; credential?: { username: string; password: string } }
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

  constructor(onState: StateEmitter = () => undefined, input: Readable = process.stdin) {
    this.lines = createInterface({ input });
    this.lines.on("line", (line) => {
      let command = line.trim().toLowerCase();
      let request: StartRequest | undefined;
      if (line.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(line) as { command?: string; target?: string; credential?: StartRequest["credential"] };
          command = parsed.command?.toLowerCase() ?? "";
          if (command === "start" || command === "login") {
            request = { target: parsed.target?.trim() || this.lastTarget, credential: parsed.credential };
            if (command === "start") this.lastTarget = request.target;
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
        onState("RUNNING", this.active ? "Collection resumed" : "Recovery collection restarted");
        if (!this.active) this.dispatch("start", { target: this.lastTarget });
        return;
      }
      if (command === "stop") {
        this.stopped = true;
        this.paused = false;
        onState("STOPPED", this.active ? "Stopping collection" : "Collection stopped");
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

  async checkpoint() {
    while (this.paused && !this.stopped) await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.stopped) throw new Error("COLLECTOR_STOPPED");
  }

  dispose() {
    this.lines.close();
  }
}
