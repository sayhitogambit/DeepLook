import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({
  executablePath: process.env.DEEPLOOK_CHROME || '/opt/google/chrome/chrome',
  headless: true,
  chromiumSandbox: true,
  args: ['--no-proxy-server'],
});
try {
  const page = await browser.newPage({ viewport: { width: 2400, height: 800 }, deviceScaleFactor: 1 });
  for (const lang of ['en', 'pt-BR', 'zh-CN']) {
    const url = new URL('./banner.html', import.meta.url);
    url.searchParams.set('lang', lang);
    await page.goto(url.href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    const fits = await page.locator('h1').evaluate(el => el.getBoundingClientRect().right < 1280);
    if (!fits) throw new Error(`${lang}: headline overlaps illustration`);
    const output = fileURLToPath(new URL(`./deeplook-readme-${lang}-v1.png`, import.meta.url));
    await page.screenshot({ path: output, type: 'png' });
    console.log(JSON.stringify({ lang, output, width: 2400, height: 800, headlineFits: fits }));
  }
} finally {
  await browser.close();
}
