/**
 * Headless browser test of the web app using the locally installed Edge.
 * Run: npx tsx scripts/browser-test.ts [baseUrl]
 */
import puppeteer, { type Page } from "puppeteer-core";
import { mkdirSync } from "fs";

const BASE = process.argv[2] || "http://localhost:3344";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

mkdirSync("tmp-shots", { recursive: true });
const errors: string[] = [];

function watch(page: Page, label: string) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("WebSocket") || text.includes("hmr")) return;
    errors.push(`[${label}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => errors.push(`[${label}] pageerror: ${String(err).slice(0, 300)}`));
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--window-size=1700,1100"],
    defaultViewport: { width: 1700, height: 1100 },
  });
  const page = await browser.newPage();
  watch(page, "app");

  // dashboard (single month)
  console.log("1) dashboard single-month...");
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.waitForSelector("[data-date]", { timeout: 60_000 });
  const monthTitle = await page.$eval("h2", (el) => el.textContent);
  const cells = await page.$$eval("[data-date]", (els) => els.length);
  console.log(`   month=${JSON.stringify(monthTitle)} cells=${cells}`);
  await page.screenshot({ path: "tmp-shots/01-dashboard.png" });

  // prev month navigation
  await page.click("button[title='Previous month ([)']");
  await page.waitForFunction(
    (prev) => document.querySelector("h2")?.textContent !== prev,
    { timeout: 30_000 },
    monthTitle
  );
  const prevMonth = await page.$eval("h2", (el) => el.textContent);
  console.log(`   after prev: ${JSON.stringify(prevMonth)}, url=${new URL(page.url()).search}`);

  // single-click opens a day (standard behavior)
  console.log("2) single-click opens day...");
  await page.goto(`${BASE}/?month=2026-06`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector("[data-date='2026-06-30']", { timeout: 30_000 });
  await page.click("[data-date='2026-06-30']");
  await page.waitForFunction(() => location.pathname.includes("2026-06-30"), { timeout: 30_000 });
  console.log("   single-click navigated to day OK");

  // day view
  await page.waitForSelector("table", { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2500)); // let thumbnails load
  const rows = await page.$$eval("[data-entry-id]", (els) => els.length);
  const inlineThumbs = await page.$$eval("[data-entry-id] img", (els) => els.length);
  const billChecks = await page.$$eval(
    "[data-entry-id] input[type=checkbox]",
    (els) => els.length
  );
  console.log(`   entries=${rows} inlineThumbs=${inlineThumbs} checkboxes=${billChecks}`);
  await page.screenshot({ path: "tmp-shots/02-day.png", fullPage: true });

  // approve an entry -> row turns green (bg-ok)
  const firstApprove = "[data-entry-id]:first-child td:first-child input[type=checkbox]";
  await page.click(firstApprove);
  await new Promise((r) => setTimeout(r, 300));
  const approvedGreen = await page.$eval(
    "[data-entry-id]:first-child",
    (el) => el.className.includes("bg-ok")
  );
  console.log(`   approve -> green row: ${approvedGreen}`);

  // tier selector present
  const tiers = await page.$$eval("button", (els) =>
    els.filter((e) => ["Fast", "Balanced", "Best"].includes(e.textContent?.trim() || "")).map((e) => e.textContent?.trim())
  );
  console.log(`   tier buttons: ${tiers.join(",")}`);

  // chat-edit box present + focus via "/"
  const chatBox = await page.$("[data-chat-edit] input");
  console.log(`   chat-edit box present: ${!!chatBox}`);
  await page.keyboard.press("/");
  const focused = await page.evaluate(() =>
    document.activeElement?.closest("[data-chat-edit]") ? "chat" : document.activeElement?.tagName
  );
  console.log(`   '/' focuses chat: ${focused}`);
  await page.keyboard.press("Escape");

  // open a screenshot viewer from an inline thumb
  const thumb = await page.$("[data-entry-id] img");
  if (thumb) {
    await thumb.click();
    const viewer = await page.waitForSelector("[role='dialog']", { timeout: 5000 }).then(() => true).catch(() => false);
    console.log(`   inline thumb opens viewer: ${viewer}`);
    await page.screenshot({ path: "tmp-shots/03-viewer.png" });
    await page.keyboard.press("Escape");
  }

  // submit dialog
  await page.keyboard.press("s");
  const dlg = await page.waitForSelector("[role='dialog']", { timeout: 5000 }).then(() => true).catch(() => false);
  console.log(`   submit dialog opens: ${dlg}`);
  await page.screenshot({ path: "tmp-shots/04-submit.png" });
  await page.keyboard.press("Escape");

  // timeline alignment: compare an hour-label x with a gridline x (should match closely)
  const align = await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find((d) =>
      d.className.includes("select-none") && d.className.includes("rounded-md")
    );
    if (!card) return "no timeline";
    const grids = card.querySelectorAll(":scope > div");
    // axis is grids[0], rows is grids[1]
    const axisPlot = grids[0]?.children[1] as HTMLElement | undefined;
    const label = axisPlot?.querySelector("span") as HTMLElement | undefined;
    const gridline = card.querySelector("div[style*='left']") as HTMLElement | undefined;
    if (!label || !gridline) return "missing parts";
    const lb = label.getBoundingClientRect();
    const gb = gridline.getBoundingClientRect();
    return `labelCenterX=${Math.round(lb.left + lb.width / 2)} firstGridlineX=${Math.round(gb.left)}`;
  });
  console.log(`   timeline: ${align}`);

  await browser.close();
  console.log("\nConsole/page errors:", errors.length);
  errors.slice(0, 10).forEach((e) => console.log("  " + e));
  console.log(errors.length === 0 ? "BROWSER TEST PASSED" : "SEE ERRORS ABOVE");
}

main().catch((err) => {
  console.error("BROWSER TEST FAILED:", err);
  process.exit(1);
});
