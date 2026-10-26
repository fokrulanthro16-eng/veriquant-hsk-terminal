/**
 * VeriQuant HSK - Automated UI Screenshot Engine
 * Captures 4 high-resolution (1920x1080) presentation screenshots for Hackathon Documentation.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'docs', 'screenshots');

async function captureScreenshots() {
  console.log('📸 Starting Automated UI Screenshot Capture Engine...');

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', '--hide-scrollbars']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  console.log('🌐 Loading http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Screenshot 01: Initial Dashboard with HSK Mainnet & Custody Architecture
  console.log('📷 Capturing 01_custody_mainnet.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01_custody_mainnet.png'),
    fullPage: false
  });
  console.log('  ✅ Saved docs/screenshots/01_custody_mainnet.png');

  // 2. Screenshot 02: Mumbai Quant Desk Hinglish -> EVM ABI Calldata & Monte Carlo Fan Chart
  console.log('📷 Triggering Mumbai Quant Desk & Monte Carlo Fan Chart...');
  await page.click('.special-mumbai-btn');
  await page.waitForTimeout(1000);
  await page.click('#tab-mc');
  await page.waitForTimeout(2000);

  console.log('📷 Capturing 02_calldata_montecarlo.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02_calldata_montecarlo.png'),
    fullPage: false
  });
  console.log('  ✅ Saved docs/screenshots/02_calldata_montecarlo.png');

  // 3. Screenshot 03: Stress Backrun, Circuit Breaker & Chainlink CCIP
  console.log('📷 Triggering Whale Dump Atomic Backrun, Black-Swan Crash & CCIP Hedge...');
  await page.click('.whale-btn');
  await page.waitForTimeout(1000);
  await page.click('.alert-scenario');
  await page.waitForTimeout(1000);
  await page.click('.btn-micro');
  await page.waitForTimeout(2000);

  console.log('📷 Capturing 03_stress_backrun_ccip.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03_stress_backrun_ccip.png'),
    fullPage: false
  });
  console.log('  ✅ Saved docs/screenshots/03_stress_backrun_ccip.png');

  // 4. Screenshot 04: HSP Settlement & Export Institutional Audit Modal
  console.log('📷 Opening HashKey Institutional Compliance & Audit Modal...');
  await page.click('#btn-export-dossier');
  await page.waitForSelector('#audit-dossier-modal', { state: 'visible' });
  await page.waitForTimeout(1500);

  console.log('📷 Capturing 04_hsp_audit_modal.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04_hsp_audit_modal.png'),
    fullPage: false
  });
  console.log('  ✅ Saved docs/screenshots/04_hsp_audit_modal.png');

  await browser.close();
  console.log('\n🎉 All 4 presentation screenshots captured successfully in docs/screenshots/!');
}

if (require.main === module) {
  captureScreenshots().catch(err => {
    console.error('Screenshot capture failed:', err);
    process.exit(1);
  });
}

module.exports = { captureScreenshots };
