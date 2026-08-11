import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
export const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export const integer = (value: string): number | undefined => { const text=clean(value).replace(/,/g,""); if(!text||text==="-") return undefined; const n=Number(text); return Number.isFinite(n)?n:undefined; };
export function labeledValue($: CheerioAPI, label: string): string | undefined {
  let result: string | undefined;
  $("th, dt, label").each((_, node) => { if(result) return; if(clean($(node).text()).includes(label)){ const el=$(node) as Cheerio<AnyNode>; result=clean(el.is("dt")?el.next("dd").text():el.next("td").text()); }});
  return result || undefined;
}
