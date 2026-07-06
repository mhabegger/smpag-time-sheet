/**
 * One-off verification driver for the 2026-07-06 fixes:
 *  A) ambiguous task name → submit dialog shows candidate picker (no silent pick)
 *  B) autosave failure → "unsaved edits" indicator + retry recovers
 *  C) corrupt day file → moved aside (.corrupt-*), not wiped by next write
 * Run: npx tsx scripts/verify-fixes.ts   (dev server must be on :3344)
 */
import puppeteer from "puppeteer-core";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";

const BASE = "http://localhost:3344";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SHOTS = "tmp-shots-verify";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`   ${ok ? "OK " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  // Edge 150's launcher exits immediately (broker handoff), which breaks
  // puppeteer.launch — spawn headless Edge ourselves and connect over CDP.
  const CDP_PORT = 9224;
  const { spawn } = await import("child_process");
  spawn(
    EDGE,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${process.env.TEMP}\\ts-verify-edge-profile`,
      "--no-first-run",
      "--disable-gpu",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
  let browser!: Awaited<ReturnType<typeof puppeteer.connect>>;
  for (let i = 0; ; i++) {
    try {
      browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${CDP_PORT}`,
        defaultViewport: { width: 1600, height: 1000 },
      });
      break;
    } catch (err) {
      if (i >= 20) throw err;
      await sleep(500);
    }
  }
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  // request interception: dynamic POST blocker for the autosave-failure phase
  let blockPosts = false;
  const postUrls: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.method() === "POST") {
      postUrls.push(req.url());
      if (blockPosts) return void req.abort("failed");
    }
    return void req.continue();
  });

  /* ============ A) ambiguous task → picker ============ */
  console.log("A) ambiguous task flow (26-A-EN / CH-Stadtfilter exists twice)");
  await page.goto(`${BASE}/day/2026-06-07`, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.waitForSelector("[data-entry-id]", { timeout: 30_000 });
  const note = await page.$eval("[data-entry-id] textarea", (el) => (el as HTMLTextAreaElement).value);
  check("scratch entry rendered", note.includes("VERIFY-TEST"), note);

  await page.keyboard.press("s");
  await page.waitForSelector("[role='dialog']", { timeout: 5_000 });
  const submitLabel = await page.$$eval("[role='dialog'] button", (els) =>
    els.map((e) => e.textContent?.trim() ?? "").find((t) => t.startsWith("Submit "))
  );
  check("dialog open, entry pre-checked", submitLabel === "Submit 1 entries", submitLabel);
  await page.screenshot({ path: `${SHOTS}/a1-dialog.png` });

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("[role='dialog'] button")].find((x) =>
      x.textContent?.includes("Submit 1")
    ) as HTMLButtonElement | undefined;
    b?.click();
  });
  await page
    .waitForFunction(() => document.body.innerText.includes("match several ZEP tasks"), {
      timeout: 30_000,
    })
    .catch(() => {});
  const ambiguityShown = await page.evaluate(() =>
    document.body.innerText.includes("Nothing was submitted")
  );
  check("ambiguity block shown, nothing submitted", ambiguityShown);
  const candidates = await page.$$eval("[role='dialog'] button", (els) =>
    els.map((e) => e.textContent?.trim() ?? "").filter((t) => t.includes("Stadtfilter"))
  );
  check(
    "both candidates offered",
    candidates.some((c) => c.startsWith("CH-Stadtfilter")) &&
      candidates.includes("X / CH-Stadtfilter"),
    JSON.stringify(candidates)
  );
  await page.screenshot({ path: `${SHOTS}/a2-ambiguous.png` });

  // pick the parented candidate
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("[role='dialog'] button")].find(
      (x) => x.textContent?.trim() === "X / CH-Stadtfilter"
    ) as HTMLButtonElement | undefined;
    b?.click();
  });
  await sleep(400);
  const afterPick = await page.evaluate(() => ({
    blockGone: !document.body.innerText.includes("match several ZEP tasks"),
    dialogShowsPath: (document.querySelector("[role='dialog']")?.textContent ?? "").includes(
      "X / CH-Stadtfilter"
    ),
  }));
  check("picker resolves the row", afterPick.blockGone && afterPick.dialogShowsPath);
  await page.screenshot({ path: `${SHOTS}/a3-picked.png` });
  await page.keyboard.press("Escape");
  await sleep(1_500); // debounced autosave

  const rec = JSON.parse(readFileSync("data/days/2026-06-07.json", "utf8"));
  const s0 = rec.suggestions[0] ?? {};
  check(
    "pick persisted via autosave",
    s0.task === "X" && s0.subtask === "CH-Stadtfilter" && s0.locked === true,
    `task=${s0.task} subtask=${s0.subtask} locked=${s0.locked}`
  );
  check("no ZEP submit happened", rec.submitResult === undefined);

  /* ============ B) autosave failure → indicator → retry ============ */
  console.log("B) autosave failure indicator + retry");
  blockPosts = true;
  await page.focus("[data-entry-id] textarea");
  await page.keyboard.type(" EDITED-WHILE-OFFLINE");
  const indicator = await page
    .waitForFunction(() => document.body.innerText.includes("unsaved edits"), { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check("failure shows 'unsaved edits' indicator", indicator);
  await page.screenshot({ path: `${SHOTS}/b1-unsaved.png` });

  blockPosts = false;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("unsaved edits")
    ) as HTMLButtonElement | undefined;
    b?.click();
  });
  const recovered = await page
    .waitForFunction(() => !document.body.innerText.includes("unsaved edits"), { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  const rec2 = JSON.parse(readFileSync("data/days/2026-06-07.json", "utf8"));
  check(
    "retry saves the edit",
    recovered && rec2.suggestions[0]?.note?.includes("EDITED-WHILE-OFFLINE"),
    rec2.suggestions[0]?.note
  );
  await page.screenshot({ path: `${SHOTS}/b2-recovered.png` });

  /* ============ C) corrupt day file → moved aside ============ */
  console.log("C) corrupt day file handling (2026-06-01, backed up)");
  const dayFile = "data/days/2026-06-01.json";
  const original = readFileSync(dayFile, "utf8");
  const truncated = original.slice(0, 120); // invalid JSON
  writeFileSync(dayFile, truncated);
  await page.goto(`${BASE}/day/2026-06-01`, { waitUntil: "networkidle2", timeout: 60_000 });
  const dayRenders = await page.evaluate(
    () => !document.body.innerText.includes("Something went wrong")
  );
  check("day view still renders", dayRenders);
  const corruptFiles = readdirSync("data/days").filter((f) =>
    f.startsWith("2026-06-01.json.corrupt")
  );
  check("corrupt file moved aside", corruptFiles.length === 1, corruptFiles.join(","));
  const preserved =
    corruptFiles.length === 1 && readFileSync(`data/days/${corruptFiles[0]}`, "utf8") === truncated;
  check("corrupt content preserved (not wiped)", preserved);
  await page.screenshot({ path: `${SHOTS}/c1-corrupt-day.png` });
  // restore
  writeFileSync(dayFile, original);
  for (const f of corruptFiles) unlinkSync(`data/days/${f}`);

  await browser.close();

  console.log("\nPOST endpoints seen:", [...new Set(postUrls.map((u) => u.replace(BASE, "").slice(0, 60)))].join("  "));
  console.log("Page errors:", pageErrors.length ? pageErrors : "none");
  console.log(failures.length === 0 ? "\nVERIFY PASSED" : `\nVERIFY FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("VERIFY CRASHED:", err);
  process.exit(1);
});
