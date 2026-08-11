import { RATE_LIMIT } from "../sminfo/constants.js";
export const nextDelayMs=()=>RATE_LIMIT.minDelayMs+Math.floor(Math.random()*(RATE_LIMIT.jitterMs+1));
export const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
