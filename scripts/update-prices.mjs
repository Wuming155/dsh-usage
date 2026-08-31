/**
 * 爬取 https://tokenrhythm.studio/models 的模型价格，更新本地价格文件
 *
 * 用法:
 *   node scripts/update-prices.mjs
 *
 * playwright 加载策略（自动选择，无需手动配置）:
 *   - 优先使用项目/CI 中的 npm 包 playwright（GitHub Actions 场景）
 *   - 回退使用全局 @playwright/cli 内置的 playwright（本地已安装场景）
 *
 * 可选环境变量:
 *   PLAYWRIGHT_PATH         playwright 模块路径（仅本地回退时使用）
 *   PLAYWRIGHT_BROWSERS_PATH  playwright 浏览器目录（默认按平台自动探测）
 *   CHROMIUM_PATH           chrom 可执行文件完整路径（最高优先级）
 *   HEADLESS                是否无头模式, 默认 1 (0 则显示浏览器窗口)
 *   OUTPUT                  价格文件输出路径, 默认 src/quota/prices.json
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// playwright 加载策略: 优先项目/CI 的 npm 包 playwright，回退到全局 @playwright/cli 内置 playwright
const PLAYWRIGHT_CLI_PATH =
  process.env.PLAYWRIGHT_PATH ||
  'C:/Users/baiyun/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';

const TARGET_URL = 'https://tokenrhythm.studio/models';
const PRICE_FILE = resolve(__dirname, process.env.OUTPUT || '../src/quota/prices.json');
const HEADLESS = (process.env.HEADLESS ?? '1') !== '0';

// 自动探测 ms-playwright 目录中可用的 chromium 可执行文件（跨平台）
function findChromiumExecutable() {
  const home = homedir();
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  roots.push(
    resolve(home, 'AppData/Local/ms-playwright'), // Windows
    resolve(home, '.cache/ms-playwright'), // Linux
    resolve(home, 'Library/Caches/ms-playwright'), // macOS
    '/opt/ms-playwright'
  );
  const subs = [
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
  ];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort();
    for (const d of dirs.reverse()) {
      for (const sub of subs) {
        const p = resolve(base, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  // 直接指定的完整路径
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  return null;
}

// 在页面上下文中提取所有模型卡片
function extractor() {
  return Array.from(document.querySelectorAll('article')).map((a) => {
    const qs = (sel) => a.querySelector(sel);
    const spec = {};
    a.querySelectorAll('.model-spec-list > div').forEach((d) => {
      const dd = d.querySelector('dd');
      const exact = dd.querySelector('[data-exact-value]');
      spec[d.querySelector('dt').textContent.trim()] = {
        text: dd.textContent.trim(),
        exact: exact ? exact.getAttribute('data-exact-value') : null,
      };
    });
    const price = {};
    a.querySelectorAll('.model-price-list > div').forEach((d) => {
      const dd = d.querySelector('dd');
      const del = dd.querySelector('del');
      const cur = dd.querySelector('strong') || dd.querySelector('.model-price-current');
      price[d.querySelector('dt').textContent.trim()] = {
        current: (cur || dd).textContent.trim(),
        original: del ? del.textContent.trim() : null,
      };
    });
    return {
      name: a.querySelector('h2').textContent.trim(),
      status: a.querySelector('.model-status-pill').textContent.trim(),
      id: qs('.model-card-id').textContent.replace('模型 ID:', '').trim(),
      provider: a.querySelector('.model-card-subline span:last-child').textContent.trim(),
      spec,
      price,
    };
  });
}

// 解析 "¥3.00/M Tokens" -> { amount: 3, unit: 'M Tokens' }
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).match(/^¥\s*([\d.]+)\s*(?:\/\s*(.+))?$/);
  if (!m) return null;
  return { amount: Number(m[1]), unit: m[2] ? m[2].trim() : null };
}

// 解析 "1,000,000 Token" / "131,072 Token" -> 数字
function parseTokens(text) {
  if (!text) return null;
  const m = String(text).match(/([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// 标准价格类型 -> 输出键名映射；未识别的价格标签放入 pricing.extra
const PRICE_KEY_MAP = {
  '输入单价': 'input',
  '输出单价': 'output',
  '缓存命中单价': 'cacheHit',
  '图片单价': 'perImage',
  '视频单价': 'perVideo',
  '音频单价': 'perAudio',
};

// 页面用 "/" 表示无此价格；只保留生效中的折扣价，不输出原价
function mkPrice(v) {
  if (!v || !v.current || v.current.trim() === '/') return null;
  const cur = parsePrice(v.current);
  if (!cur) return null;
  return { amount: cur.amount, unit: cur.unit };
}

function normalize(raw) {
  const s = raw.spec;
  const pricing = {};
  const extra = [];
  for (const [label, v] of Object.entries(raw.price || {})) {
    const parsed = mkPrice(v);
    if (parsed === null) continue;
    const key = PRICE_KEY_MAP[label];
    if (key) pricing[key] = parsed;
    else extra.push({ label, ...parsed });
  }
  if (extra.length) pricing.extra = extra;
  const ctx = s['序列长度'] ? parseTokens(s['序列长度'].exact || s['序列长度'].text) : null;
  return {
    id: raw.id,
    name: raw.name,
    provider: raw.provider,
    status: raw.status,
    // 0 Token 表示该模型无序列长度概念（如图像模型），归一化为 null
    contextLength: ctx === 0 ? null : ctx,
    maxOutputTokens: s['最大输出长度']
      ? parseTokens(s['最大输出长度'].exact || s['最大输出长度'].text)
      : null,
    modalities: s['支持模态']
      ? s['支持模态'].text.split(/\s*\/\s*/).filter(Boolean)
      : [],
    responsesApi: s['Responses API'] ? s['Responses API'].text : null,
    pricing,
  };
}

async function main() {
  // 加载 playwright：优先 npm 包（CI / 本地 npm install），回退全局 @playwright/cli
  let chromium;
  try {
    chromium = (await import('playwright')).chromium;
    console.log('  使用项目/CI 的 playwright 包');
  } catch {
    chromium = require(PLAYWRIGHT_CLI_PATH).chromium;
    console.log('  使用全局 @playwright/cli 内置 playwright');
  }

  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    console.warn('未找到已安装的 chromium，尝试使用 playwright 默认浏览器');
  }
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: executablePath || undefined,
  });
  const page = await browser.newPage();
  console.log(`[1/4] 打开 ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('article', { timeout: 30000 });

  // 尝试把每页条数设为 50，尽量一页抓完；失败则走翻页逻辑
  try {
    const selects = page.locator('select');
    const n = await selects.count();
    const pageSize = selects.nth(n - 1);
    await pageSize.selectOption({ label: '每页 50 条' });
    await page.waitForTimeout(1000);
  } catch {
    console.log('  (未能切换每页条数，将使用翻页方式)');
  }

  console.log('[2/4] 抓取模型列表...');
  const all = [];
  let guard = 0;
  while (true) {
    await page.waitForSelector('article', { timeout: 15000 });
    const pageModels = await page.evaluate(extractor);
    all.push(...pageModels);
    const nextBtn = page.locator('button:has-text("下一页")');
    const count = await nextBtn.count();
    if (!count || (await nextBtn.isDisabled())) break;
    if (++guard > 20) {
      console.warn('  翻页超过 20 次，提前停止');
      break;
    }
    await nextBtn.first().click();
    await page.waitForTimeout(900);
  }

  // 去重（按模型 id），并解析页码总数做校验
  const seen = new Set();
  const models = all
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .map(normalize)
    .sort((a, b) => a.id.localeCompare(b.id));

  console.log(`[3/4] 抓取到 ${models.length} 个模型`);
  if (!models.length) {
    throw new Error('未抓到任何模型数据，请检查页面结构是否变化');
  }

  // 从页面解析总条数做 sanity check
  const totalText = await page.evaluate(() => {
    const el = document.body.innerText.match(/共\s*(\d+)\s*条/);
    return el ? el[1] : null;
  });
  if (totalText && Number(totalText) !== models.length) {
    console.warn(`  页面显示共 ${totalText} 条，实际抓到 ${models.length} 条，请人工核对`);
  }

  // 更新本地价格文件
  mkdirSync(dirname(PRICE_FILE), { recursive: true });
  const prev = existsSync(PRICE_FILE) ? JSON.parse(readFileSync(PRICE_FILE, 'utf8')) : {};
  const data = {
    source: TARGET_URL,
    updatedAt: new Date().toISOString(),
    currency: 'CNY',
    modelCount: models.length,
    models,
  };
  const prevCount = prev.models ? prev.models.length : 0;
  writeFileSync(PRICE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`[4/4] 已写入 ${PRICE_FILE} (之前 ${prevCount} 条 -> 现在 ${models.length} 条)`);

  await browser.close();
}

main().catch((e) => {
  console.error('爬取失败:', e);
  process.exit(1);
});
