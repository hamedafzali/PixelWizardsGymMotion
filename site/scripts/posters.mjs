// Renders a still of every exercise to public/posters/<slug>.jpg, plus
// public/og.jpg. The pages show these until the live 3D body has built.
//
//   npm run posters                 # all exercises
//   npm run posters -- legpress row # just these slugs
//
// It starts `astro dev` itself and drives Chromium with Playwright. Set
// PLAYWRIGHT to a playwright module path if it isn't installed here. Use a
// GPU: software WebGL renders the same frame but takes far longer.
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}public/posters`;
const port = 4399;
const base = `http://localhost:${port}`;
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");

const dev = spawn("npx", ["astro", "dev", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, fail) => {
  dev.stdout.on("data", (d) => String(d).includes(`localhost:${port}`) && ok());
  dev.on("exit", (c) => fail(new Error(`astro dev exited (${c})`)));
});

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  // Reduced motion makes the viewer hold each exercise at its peak, so stills are repeatable.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  // The list comes from the gallery page, so this script and the site never disagree.
  await page.goto(`${base}/exercises`);
  const all = await page.$$eval(".cards a", (as) => as.map((a) => a.getAttribute("href").split("/").pop()));
  const want = process.argv.slice(2);
  const slugs = want.length ? all.filter((s) => want.includes(s)) : all;
  await mkdir(out, { recursive: true });

  async function shoot(slug, file, size) {
    await page.setViewportSize(size);
    await page.goto(`${base}/exercises/${slug}`);
    await page.addStyleTag({
      content:
        "#stage{position:fixed!important;inset:0!important;z-index:99;border-radius:0!important;aspect-ratio:auto!important;border:0!important}" +
        "#stage .tag,#stage .poster{display:none!important}",
    });
    await page.waitForSelector("#stage.live", { timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.locator("#stage").screenshot({ path: file, type: "jpeg", quality: 78 });
  }

  let bytes = 0;
  for (const [i, slug] of slugs.entries()) {
    const file = `${out}/${slug}.jpg`;
    await shoot(slug, file, { width: 960, height: 600 });
    bytes += (await stat(file)).size;
    process.stdout.write(`\r${i + 1}/${slugs.length} ${slug}            `);
  }
  if (!want.length || want.includes("legpress")) await shoot("legpress", `${root}public/og.jpg`, { width: 1200, height: 630 });
  console.log(`\nwrote ${slugs.length} posters, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
} finally {
  await browser.close();
  dev.kill();
}
