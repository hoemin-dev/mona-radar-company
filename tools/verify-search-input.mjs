import { chromium } from "playwright";
import { preview } from "vite";

const server = await preview({ preview: { host: "127.0.0.1", port: 4173, strictPort: true } });
const browser = await chromium.launch({ channel: "msedge", headless: true, chromiumSandbox: true });

try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4173");
  await page.locator('[data-view="search"]').click();
  const input = page.locator("#live-search");
  await input.waitFor();
  await input.evaluate((node) => ((window).__monaSearchInput = node));

  await input.click();
  await page.keyboard.type("abcdef");
  await page.waitForTimeout(350);
  if ((await input.inputValue()) !== "abcdef") throw new Error("English continuous input failed");
  if (!(await input.evaluate((node) => (window).__monaSearchInput === node))) throw new Error("Search input node was replaced after English input");

  for (const phrase of ["오제펌프", "액체펌프제조업", "대한민국펌프"]) {
    await page.evaluate((value) => {
      const node = document.querySelector("#live-search");
      if (!(node instanceof HTMLInputElement)) throw new Error("Search input missing");
      node.value = "";
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      for (let index = 1; index <= value.length; index++) {
        node.value = value.slice(0, index);
        node.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: node.value }));
        node.dispatchEvent(new InputEvent("input", { bubbles: true, data: value[index - 1], inputType: "insertCompositionText", isComposing: true }));
      }
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
      node.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText", isComposing: false }));
    }, phrase);
    await page.waitForTimeout(350);
    if ((await input.inputValue()) !== phrase) throw new Error(`Korean composition failed: ${phrase}`);
    if (!(await input.evaluate((node) => (window).__monaSearchInput === node))) throw new Error(`Search input node was replaced: ${phrase}`);
  }

  process.stdout.write("Search input verified: abcdef, 오제펌프, 액체펌프제조업, 대한민국펌프\n");
} finally {
  await browser.close();
  await server.close();
}
