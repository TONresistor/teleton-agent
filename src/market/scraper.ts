/**
 * MarketApp.ws Gift Price Scraper
 * Scrapes all gift collections and models using Playwright
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import {
  initScraperDb,
  upsertCollection,
  getCollectionId,
  upsertModel,
  addPriceHistory,
  getScraperStats,
  type Collection,
  type Model,
} from "./scraper-db.js";
import type Database from "better-sqlite3";
import {
  BROWSER_NAVIGATION_TIMEOUT_MS,
  SCRAPER_PAGE_LOAD_MS,
  SCRAPER_FILTER_CLICK_MS,
  SCRAPER_MODEL_CLICK_MS,
  SCRAPER_FILTER_OPEN_MS,
  SCRAPER_MODEL_OPEN_MS,
  SCRAPER_SCROLL_STEP_MS,
  SCRAPER_SCROLL_INCREMENT_PX,
  SCRAPER_SCROLL_PADDING_PX,
  SCRAPER_PRE_SCROLL_MS,
  SCRAPER_COLLECTION_SCROLL_MS,
  SCRAPER_MAX_SCROLL_ITERATIONS,
  SCRAPER_COLLECTION_NAV_MS,
} from "../constants/timeouts.js";
import { MARKETAPP_BASE_URL } from "../constants/api-endpoints.js";
import { SCRAPER_PARALLEL_WORKERS } from "../constants/limits.js";

interface CollectionWithAddress extends Collection {
  address: string;
}

interface Worker {
  page: Page;
  scrape(collection: CollectionWithAddress): Promise<number>;
  close(): Promise<void>;
}

/**
 * Scrape all models from a collection (with scroll in filter panel)
 */
async function scrapeAllModels(
  page: Page,
  collection: CollectionWithAddress,
  db: Database.Database
): Promise<number> {
  try {
    const url = `${MARKETAPP_BASE_URL}/collection/${collection.address}/?tab=nfts`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(SCRAPER_PAGE_LOAD_MS);

    // Open Filters
    try {
      await page.click('button:has-text("Filters")', { timeout: SCRAPER_FILTER_CLICK_MS });
      await page.waitForTimeout(SCRAPER_FILTER_OPEN_MS);
    } catch (e) {
      return 0;
    }

    // Click on Model to open list
    try {
      await page.click("text=Model", { timeout: SCRAPER_MODEL_CLICK_MS });
      await page.waitForTimeout(SCRAPER_MODEL_OPEN_MS);
    } catch (e) {
      return 0;
    }

    // Collect all models by scrolling virtual-scroll-wrapper
    const allModels = new Map<string, Model>();

    // Get wrapper height to know how far to scroll
    const wrapperHeight = await page.evaluate(() => {
      const wrappers = document.querySelectorAll(".virtual-scroll-wrapper");
      const wrapper = wrappers[1]; // 2nd wrapper contains models
      return wrapper ? wrapper.scrollHeight : 0;
    });

    // Scroll through entire wrapper
    for (
      let scrollPos = 0;
      scrollPos <= wrapperHeight + SCRAPER_SCROLL_PADDING_PX;
      scrollPos += SCRAPER_SCROLL_INCREMENT_PX
    ) {
      const text = await page.evaluate((pos) => {
        const wrappers = document.querySelectorAll(".virtual-scroll-wrapper");
        const wrapper = wrappers[1] as HTMLElement;
        if (wrapper) {
          wrapper.scrollTop = pos;
          return wrapper.innerText;
        }
        return "";
      }, scrollPos);

      if (text) {
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l);
        let currentModel: Model | null = null;

        for (const line of lines) {
          if (
            line.length > 1 &&
            line.length < 50 &&
            !line.match(/^[\d,.]+$/) &&
            !line.startsWith("Floor:") &&
            !line.includes("%")
          ) {
            currentModel = { name: line, floor: null, count: null, pct: null };
          }
          if (line.startsWith("Floor:") && currentModel) {
            const match = line.match(/Floor:\s*([\d,.]+)/);
            if (match) currentModel.floor = parseFloat(match[1].replace(/,/g, ""));
          }
          if (currentModel && line.match(/^\d+$/) && !currentModel.count) {
            currentModel.count = parseInt(line);
          }
          if (line.includes("%") && currentModel) {
            currentModel.pct = line;
            if (currentModel.name && currentModel.floor) {
              allModels.set(currentModel.name, { ...currentModel });
            }
            currentModel = null;
          }
        }
      }
      await page.waitForTimeout(SCRAPER_SCROLL_STEP_MS);
    }

    const models = [...allModels.values()];

    // Get collection ID (already saved by getCollections with floor prices)
    const collectionId = getCollectionId(db, collection.address);
    if (!collectionId) return 0;

    for (const model of models) {
      const modelId = upsertModel(db, collectionId, model);
      if (model.floor) {
        addPriceHistory(db, collectionId, modelId, model.floor);
      }
    }

    return models.length;
  } catch (error) {
    return -1;
  }
}

/**
 * Create a worker with its own browser context
 */
async function createWorker(browser: Browser, db: Database.Database): Promise<Worker> {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  return {
    page,
    async scrape(collection: CollectionWithAddress): Promise<number> {
      return await scrapeAllModels(page, collection, db);
    },
    async close(): Promise<void> {
      await context.close();
    },
  };
}

/**
 * Get all collections from main page
 */
async function getCollections(page: Page, db: Database.Database): Promise<CollectionWithAddress[]> {
  await page.goto(`${MARKETAPP_BASE_URL}/?tab=gifts&sort_by=floor_desc`, {
    waitUntil: "domcontentloaded",
    timeout: SCRAPER_COLLECTION_NAV_MS,
  });
  await page.waitForTimeout(SCRAPER_PRE_SCROLL_MS);

  // Scroll to load all collections
  for (let i = 0; i < SCRAPER_MAX_SCROLL_ITERATIONS; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(SCRAPER_COLLECTION_SCROLL_MS);
  }

  const collections = await page.evaluate(() => {
    const results: Array<{
      name: string;
      floorTON: number | null;
      floorUSD: number | null;
      volume7d: number | null;
      address: string | null;
    }> = [];
    const text = document.body.innerText;
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "1% fee" && i > 0) {
        const name = lines[i - 1];
        if (name.length < 3 || name.length > 40 || name === "Name") continue;

        let floorTON: number | null = null;
        let floorUSD: number | null = null;
        let volume7d: number | null = null;
        let skipNext = 0;

        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const val = lines[j];
          if (floorTON === null && val.match(/^[\d,.]+$/)) {
            floorTON = parseFloat(val.replace(/,/g, ""));
            continue;
          }
          if (floorTON !== null && floorUSD === null && val.startsWith("~$")) {
            floorUSD = parseFloat(val.replace("~$", "").replace(/,/g, ""));
            skipNext = 2;
            continue;
          }
          if (skipNext > 0 && (val.match(/^[\d,.]+$/) || val.startsWith("~$"))) {
            skipNext--;
            continue;
          }
          if (floorUSD !== null && volume7d === null && skipNext === 0) {
            const volMatch = val.match(/^([\d,.]+)(K|M)?$/);
            if (volMatch) {
              let vol = parseFloat(volMatch[1].replace(/,/g, ""));
              if (volMatch[2] === "K") vol *= 1000;
              if (volMatch[2] === "M") vol *= 1000000;
              volume7d = vol;
              break;
            }
          }
          if (val === "1% fee") break;
        }

        if (name && floorTON) {
          results.push({ name, floorTON, floorUSD, volume7d, address: null });
        }
      }
    }

    // Extract addresses from links
    const links = document.querySelectorAll('a[href*="/collection/"]');
    const addressMap = new Map<string, string>();
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      const match = href.match(/\/collection\/([^/?]+)/);
      if (match) {
        const text = link.textContent?.trim().split("\n")[0];
        if (text && text.length > 2) addressMap.set(text, match[1]);
      }
    });

    return results
      .map((r) => ({
        ...r,
        address:
          addressMap.get(r.name) ||
          [...addressMap.entries()].find(([k]) =>
            k.toLowerCase().includes(r.name.toLowerCase().slice(0, 10))
          )?.[1] ||
          null,
      }))
      .filter((r) => r.address) as Array<{
      name: string;
      floorTON: number;
      floorUSD: number | null;
      volume7d: number | null;
      address: string;
    }>;
  });

  // Save collections to DB
  for (const col of collections) {
    const collectionId = upsertCollection(db, col);
    addPriceHistory(db, collectionId, null, col.floorTON, col.floorUSD);
  }

  return collections;
}

/**
 * Main scraper function
 */
export async function runScraper(options: { workers?: number; limit?: number }): Promise<{
  success: boolean;
  collections: number;
  models: number;
  duration: number;
  error?: string;
}> {
  const workers = options.workers || SCRAPER_PARALLEL_WORKERS;
  const limit = options.limit || 0;

  console.log("=".repeat(60));
  console.log(`SCRAPING ALL MODELS (${workers} workers)`);
  console.log("=".repeat(60));

  const db = initScraperDb();
  const startTime = Date.now();

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });

    console.log("\n1. Collections...");
    const mainCtx = await browser.newContext({
      userAgent: "Mozilla/5.0",
      viewport: { width: 1920, height: 1080 },
    });
    const mainPage = await mainCtx.newPage();
    const collections = await getCollections(mainPage, db);
    await mainCtx.close();
    console.log(`   ✓ ${collections.length} collections`);

    console.log(`\n2. Workers (${workers})...`);
    const workerPool = await Promise.all(
      Array(workers)
        .fill(null)
        .map(() => createWorker(browser!, db))
    );

    const toProcess = limit > 0 ? collections.slice(0, limit) : collections;
    console.log(`\n3. Scraping ${toProcess.length} collections (all models)...\n`);

    let completed = 0;
    let totalModels = 0;
    const queue = [...toProcess];

    async function processNext(worker: Worker): Promise<void> {
      while (queue.length > 0) {
        const col = queue.shift();
        if (!col) break;

        const count = await worker.scrape(col);
        completed++;

        const status =
          count > 0 ? `✓ ${count.toString().padStart(2)}` : count === 0 ? "- 0 " : "✗   ";
        if (count > 0) totalModels += count;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `   [${completed.toString().padStart(3)}/${toProcess.length}] ${col.name.padEnd(
            22
          )} ${status} (${elapsed}s)`
        );
      }
    }

    await Promise.all(workerPool.map((w) => processNext(w)));
    await Promise.all(workerPool.map((w) => w.close()));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = getScraperStats(db);

    console.log("\n" + "=".repeat(60));
    console.log(`DONE in ${elapsed}s`);
    console.log("=".repeat(60));
    console.log(`Collections: ${stats.collections}`);
    console.log(`Models: ${stats.models}`);
    console.log(`History entries: ${stats.historyEntries}`);

    return {
      success: true,
      collections: stats.collections,
      models: stats.models,
      duration: parseInt(elapsed),
    };
  } catch (error) {
    return {
      success: false,
      collections: 0,
      models: 0,
      duration: Math.round((Date.now() - startTime) / 1000),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
    db.close();
  }
}
