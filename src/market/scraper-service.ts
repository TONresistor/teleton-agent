/**
 * Service for scraping MarketApp.ws prices using Playwright
 * Uses dynamic import to avoid loading Playwright unless actually needed
 */

export interface ScrapeResult {
  success: boolean;
  collections?: number;
  models?: number;
  duration?: number;
  error?: string;
}

/**
 * Service for scraping MarketApp.ws prices using Playwright
 */
export class MarketScraperService {
  private isScrapingInProgress = false;

  /**
   * Run full refresh of all collections (~10 min)
   */
  async scrapeFullRefresh(): Promise<ScrapeResult> {
    if (this.isScrapingInProgress) {
      console.log("⏸️  Scrape already in progress, skipping");
      return { success: false, error: "Scrape already in progress" };
    }

    this.isScrapingInProgress = true;
    console.log("🔄 Starting full market scrape...");

    try {
      // Dynamic import to avoid loading Playwright unless needed
      const { runScraper } = await import("./scraper.js");

      const result = await runScraper({
        workers: 4,
        limit: 0, // 0 = all collections
      });

      if (result.success) {
        console.log(`✅ Full scrape completed in ${result.duration}s`);
      } else {
        console.error(`❌ Full scrape failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      console.error("❌ Full scrape failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.isScrapingInProgress = false;
    }
  }

  /**
   * Scrape a single collection (~5 sec)
   * Currently not implemented
   * Would require modifications to support single-collection mode
   */
  async scrapeSingleCollection(address: string): Promise<ScrapeResult> {
    console.log(`🔄 Single collection scrape not yet implemented for ${address}`);
    return {
      success: false,
      error: "Single collection scrape not yet implemented",
    };
  }

  /**
   * Check if scrape is currently running
   */
  isScrapingActive(): boolean {
    return this.isScrapingInProgress;
  }

  /**
   * Manual trigger for full refresh
   */
  async manualRefresh(): Promise<ScrapeResult> {
    return await this.scrapeFullRefresh();
  }
}
