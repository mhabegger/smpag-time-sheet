/**
 * Verifies the TimeField (keyboard entry + quarter-hour dropdown) and the
 * gap-absorbing merge button on scratch day /day/2026-04-26.
 * Run: pnpm exec tsx scripts/verify-ui-fixes.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9224;
const URL = "http://localhost:3344/day/2026-04-26";
const SHOTS = "tmp-shots-verify";

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  spawn(
    EDGE,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${process.env.TEMP}\\verify-profile`,
      "--no-first-run",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${CDP_PORT}`,
    defaultViewport: { width: 1500, height: 1000 },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForSelector("[data-entry-id='testrow1']", { timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}/01-initial.png` });

  const rowTimes = (id: string) =>
    page.$$eval(`[data-entry-id='${id}'] input:not([type])`, (els) =>
      (els as HTMLInputElement[]).map((e) => e.value)
    );

  // --- 1. Keyboard entry: select-all, type a raw time, blur -> snapped value
  const fromSel = "[data-entry-id='testrow1'] input:not([type])";
  const selectAll = async () => {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
  };
  await page.click(fromSel);
  await selectAll();
  await page.type(fromSel, "8:23");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 300));
  let [from] = await rowTimes("testrow1");
  check("keyboard entry snaps 8:23 -> 08:30", from === "08:30", `got ${from}`);

  // restore 09:00 by typing again (also re-tests typing)
  await page.click(fromSel);
  await selectAll();
  await page.type(fromSel, "0900");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 300));
  [from] = await rowTimes("testrow1");
  check("keyboard entry accepts 0900 -> 09:00", from === "09:00", `got ${from}`);

  // --- 2. Clock dropdown minute options are exactly 00/15/30/45
  await page.click("[data-entry-id='testrow1'] button[title='Pick a time (15-min steps)']");
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${SHOTS}/02-dropdown.png` });
  const minuteOpts = await page.$$eval(
    "[data-entry-id='testrow1'] .border-l.border-border > div",
    (els) => els.map((e) => e.textContent?.trim())
  );
  check(
    "dropdown minutes are 00/15/30/45",
    JSON.stringify(minuteOpts) === JSON.stringify(["00", "15", "30", "45"]),
    JSON.stringify(minuteOpts)
  );

  // pick minute 15 from the dropdown -> from becomes 09:15
  const minuteEls = await page.$$("[data-entry-id='testrow1'] .border-l.border-border > div");
  await minuteEls[1].click();
  await new Promise((r) => setTimeout(r, 300));
  [from] = await rowTimes("testrow1");
  check("dropdown pick :15 -> 09:15", from === "09:15", `got ${from}`);
  // restore
  await page.click(fromSel);
  await selectAll();
  await page.type(fromSel, "09:00");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 300));

  // --- 3. Merge: first click absorbs the 10:00-10:30 gap, second merges row B
  const mergeSel =
    "[data-entry-id='testrow1'] button[title^='Merge down']";
  await page.click(mergeSel);
  await new Promise((r) => setTimeout(r, 300));
  let [f, t] = await rowTimes("testrow1");
  const rowBAlive = (await page.$("[data-entry-id='testrow2']")) !== null;
  check(
    "1st merge click absorbs gap (09:00-10:30, row B intact)",
    f === "09:00" && t === "10:30" && rowBAlive,
    `row A ${f}-${t}, row B present: ${rowBAlive}`
  );
  await page.screenshot({ path: `${SHOTS}/03-after-first-merge.png` });

  await page.click(mergeSel);
  await new Promise((r) => setTimeout(r, 300));
  [f, t] = await rowTimes("testrow1");
  const rowBGone = (await page.$("[data-entry-id='testrow2']")) === null;
  check(
    "2nd merge click merges row B (09:00-11:00, row B gone)",
    f === "09:00" && t === "11:00" && rowBGone,
    `row A ${f}-${t}, row B gone: ${rowBGone}`
  );
  await page.screenshot({ path: `${SHOTS}/04-after-second-merge.png` });

  await browser.disconnect();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
