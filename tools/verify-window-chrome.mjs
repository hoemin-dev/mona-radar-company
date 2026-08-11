import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const executable = new URL("../src-tauri/target/release/mona-radar-company.exe", import.meta.url).pathname.slice(1);
const port = 9333;
const child = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: "ignore",
});

let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!browser) throw new Error("WebView2 debugging endpoint was not available");
  let page;
  for (let attempt = 0; attempt < 40 && !page; attempt++) {
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (await candidate.locator("#window-titlebar").count().catch(() => 0)) { page = candidate; break; }
    }
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("MonaRadar WebView page was not found");
  page.on("console", (message) => process.stderr.write(`[webview console] ${message.type()}: ${message.text()}\n`));
  page.on("pageerror", (error) => process.stderr.write(`[webview error] ${error.message}\n`));
  await page.locator("#window-titlebar").waitFor();
  const nativeHandle = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${child.pid}).MainWindowHandle`], { encoding: "utf8" }).trim();

  await page.locator("#window-maximize").click();
  await page.locator("#window-maximize-icon.is-restore").waitFor({ timeout: 5000 });
  const withinWorkArea = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Add-Type 'using System;using System.Runtime.InteropServices;public static class W{[StructLayout(LayoutKind.Sequential)]public struct R{public int L,T,Right,B;}[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport(\"user32.dll\")]public static extern bool SystemParametersInfo(uint a,uint p,out R r,uint u);}';$h=[IntPtr]::new(${nativeHandle});[W+R]$r=New-Object W+R;[W+R]$w=New-Object W+R;[W]::GetWindowRect($h,[ref]$r)|Out-Null;[W]::SystemParametersInfo(48,0,[ref]$w,0)|Out-Null;($r.L-ge($w.L-8)-and$r.T-ge($w.T-8)-and$r.Right-le($w.Right+8)-and$r.B-le($w.B+8))`], { encoding: "utf8" }).trim();
  if (withinWorkArea !== "True") throw new Error("Maximized window exceeded the Windows work area");
  await page.locator("#window-maximize").click();
  await page.locator("#window-maximize-icon:not(.is-restore)").waitFor();
  await page.locator("#window-titlebar").evaluate((titlebar) => titlebar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await page.locator("#window-maximize-icon.is-restore").waitFor({ timeout: 5000 });
  await page.locator("#window-maximize").click();
  await page.locator("#window-maximize-icon:not(.is-restore)").waitFor();
  await page.locator("#window-minimize").click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const minimized = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Add-Type 'using System;using System.Runtime.InteropServices;public static class W{[DllImport(\"user32.dll\")]public static extern bool IsIconic(IntPtr h);[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int n);}';$h=[IntPtr]::new(${nativeHandle});$value=[W]::IsIconic($h);[W]::ShowWindow($h,9)|Out-Null;$value`], { encoding: "utf8" }).trim();
  if (minimized !== "True") throw new Error("Minimize button did not iconify the native window");
  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.locator("#window-close").click();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Close button did not exit the app")), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  process.stdout.write("Window chrome verified: minimize, maximize, restore, double-click maximize, close\n");
} finally {
  await browser?.close().catch(() => undefined);
  if (!child.killed) child.kill();
}
