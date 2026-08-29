import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "videos");
const rawDir = join(outDir, "raw");
const pollyPartsDir = join(outDir, "polly-parts");
const narrationPath = join(outDir, "narration.ssml");
const audioPath = join(outDir, "nepal-flash-flood-demo-voiceover.mp3");
const rawVideoPath = join(rawDir, "dynamic-walkthrough.webm");
const finalVideoPath = join(outDir, "nepal-flash-flood-demo.mp4");
const port = Number(process.env.DEMO_VIDEO_PORT ?? 4182);
const baseUrl = `http://127.0.0.1:${port}/`;

const commandSpec = (name, args) => {
  if (process.platform === "win32" && ["npm", "npx"].includes(name)) return { command: "cmd", args: ["/c", name, ...args] };
  return { command: name, args };
};

mkdirSync(outDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });

function run(command, args, options = {}) {
  const spec = commandSpec(command, args);
  execFileSync(spec.command, spec.args, { cwd: root, stdio: "inherit", ...options });
}

function output(command, args) {
  const spec = commandSpec(command, args);
  return execFileSync(spec.command, spec.args, { cwd: root, encoding: "utf8" }).trim();
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`Local server did not start at ${baseUrl}`);
}

async function setValue(page, id, value) {
  await page.evaluate(
    ({ id: elementId, value: nextValue }) => {
      const element = document.querySelector(`#${elementId}`);
      if (!element) throw new Error(`Missing #${elementId}`);
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { id, value },
  );
}

async function setChecked(page, selector, checked) {
  await page.evaluate(
    ({ selector: target, checked: nextChecked }) => {
      const input = document.querySelector(target);
      if (!input) throw new Error(`Missing ${target}`);
      input.checked = nextChecked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, checked },
  );
}

async function click(page, selector) {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`Missing ${target}`);
    element.click();
  }, selector);
}

async function smoothScrollTo(page, selector) {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`Missing ${target}`);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }, selector);
  await wait(2200);
}

async function routeLocalCesium(page) {
  const cesiumRoot = join(root, "node_modules", "cesium", "Build", "Cesium");
  const mimeTypes = new Map([
    [".css", "text/css"],
    [".js", "application/javascript"],
    [".json", "application/json"],
    [".wasm", "application/wasm"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".svg", "image/svg+xml"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
    [".ttf", "font/ttf"],
  ]);
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/cesium@1\.121[^/]*\/Build\/Cesium\/.*/, async (route) => {
    const url = route.request().url();
    const relative = decodeURIComponent(url.slice(url.indexOf("/Build/Cesium/") + "/Build/Cesium/".length).split("?")[0]);
    const localPath = join(cesiumRoot, relative);
    if (!existsSync(localPath)) {
      await route.continue();
      return;
    }
    const extension = localPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
    await route.fulfill({
      status: 200,
      contentType: mimeTypes.get(extension) ?? "application/octet-stream",
      body: readFileSync(localPath),
    });
  });
}

function synthesizeNarration() {
  rmSync(pollyPartsDir, { recursive: true, force: true });
  mkdirSync(pollyPartsDir, { recursive: true });
  const ssml = readFileSync(narrationPath, "utf8");
  const body = ssml.replace(/<\/?speak>/g, "").replace(/<prosody rate="94%">/g, "").replace(/<\/prosody>/g, "").trim();
  const paragraphs = body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 2400 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  const partPaths = chunks.map((chunk, index) => {
    const partPath = join(pollyPartsDir, `part-${String(index + 1).padStart(2, "0")}.mp3`);
    run("aws", [
      "polly",
      "synthesize-speech",
      "--engine",
      "neural",
      "--voice-id",
      "Kajal",
      "--language-code",
      "en-IN",
      "--output-format",
      "mp3",
      "--text-type",
      "ssml",
      "--text",
      `<speak><prosody rate="94%">${chunk}</prosody></speak>`,
      partPath,
    ]);
    return partPath;
  });

  const listPath = join(pollyPartsDir, "concat.txt");
  writeFileSync(listPath, partPaths.map((partPath) => `file '${partPath.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n"));
  rmSync(audioPath, { force: true });
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-b:a", "160k", audioPath]);
}

function mediaDurationSeconds(path) {
  return Number(output("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]));
}

async function waitForFluid(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("#flowCanvas");
      return canvas?.dataset?.particlesDrawn && Number(canvas.dataset.particlesDrawn) > 20;
    },
    null,
    { timeout: 60_000 },
  );
}

async function recordDynamicWalkthrough(audioDuration) {
  rmSync(rawVideoPath, { force: true });
  const server = spawn("cmd", ["/c", "npx", "http-server", ".", "-p", String(port), "-c-1", "--silent"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      reducedMotion: "no-preference",
      recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
    });
    const page = await context.newPage();
    await routeLocalCesium(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!url.includes("favicon")) errors.push(`${url}: ${request.failure()?.errorText ?? "failed"}`);
    });

    const startedAt = Date.now();
    console.log("Recording dynamic title slate...");
    await page.setContent(`
      <style>
        body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#07111f;color:#e5eefb;font-family:Inter,Arial,sans-serif}
        main{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#07111f,#17324a 58%,#244c5a)}
        section{max-width:880px;text-align:center}
        span{display:block;color:#7dd3fc;text-transform:uppercase;letter-spacing:.18em;font-weight:800;font-size:18px;margin-bottom:20px}
        h1{font-size:58px;line-height:1.04;margin:0 0 18px}
        p{font-size:25px;line-height:1.45;margin:0;color:#dbeafe}
      </style>
      <main><section><span>Nebula Cloud Studio Showcase</span><h1>Nepal Flash Flood Digital Twin</h1><p>Live replay of terrain-constrained flood movement, downstream exposure, and scenario simulation.</p></section></main>
    `);
    await wait(9000);

    console.log("Loading live application...");
    await page.goto(`${baseUrl}?dynamic-demo=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => window.Cesium && window.NEPAL_FLOOD_CONFIG?.viewer, null, { timeout: 60_000 });
    await page.waitForFunction(() => window.NEPAL_FLOOD_CONFIG?.staticLayersReady, null, { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll(".metric").length > 0, null, { timeout: 60_000 });
    await page.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("/World_Imagery/MapServer/tile/")), null, { timeout: 60_000 });
    await wait(9000);

    console.log("Showing map controls, tilt, zoom and recenter...");
    await click(page, "#tiltView");
    await wait(5000);
    await click(page, "#zoomIn");
    await wait(4000);
    await click(page, "#zoomOut");
    await wait(4000);
    await click(page, "#focusCorridor");
    await wait(5000);

    console.log("Running slow fluidic replay...");
    await page.evaluate(() => {
      const speed = document.querySelector("#speed");
      const guidedOption = document.createElement("option");
      guidedOption.value = "0.035";
      guidedOption.textContent = "guided";
      speed.append(guidedOption);
      speed.value = "0.035";
      speed.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(page, "#replay");
    await waitForFluid(page);
    await wait(72_000);

    console.log("Scrubbing through source-to-downstream flood stages...");
    for (const value of ["12", "28", "47", "65", "82", "104", "120"]) {
      await setValue(page, "timeline", value);
      await wait(5500);
    }

    console.log("Toggling flood behavior layers...");
    for (const layer of ["waterDepth", "velocity", "hazard", "observedEvidence", "river", "roads", "bridges", "settlements", "critical"]) {
      await setChecked(page, `[data-layer="${layer}"]`, true);
      await wait(3500);
    }
    await setChecked(page, `[data-layer="velocity"]`, false);
    await wait(3000);
    await setChecked(page, `[data-layer="velocity"]`, true);
    await wait(8500);

    console.log("Moving into the source-to-downstream and what-if panels...");
    await smoothScrollTo(page, ".side-panel");
    await page.evaluate(() => {
      const panel = document.querySelector(".side-panel");
      panel.scrollTo({ top: 320, behavior: "smooth" });
    });
    await wait(10_000);
    await smoothScrollTo(page, ".workbench");
    await wait(8000);

    console.log("Demonstrating scenario presets...");
    for (const id of ["S1", "S4", "S5", "S7"]) {
      await setValue(page, "presetScenario", id);
      await waitForFluid(page);
      await wait(13_000);
    }

    console.log("Building and running a high-impact custom scenario...");
    await setValue(page, "presetScenario", "");
    await setValue(page, "lakeVolume", "5");
    await setValue(page, "breachMechanism", "catastrophic_breach");
    await setValue(page, "breachDuration", "20");
    await setValue(page, "breachWidth", "extreme");
    await setValue(page, "rainfall", "2");
    await setValue(page, "antecedentFlow", "extreme");
    await setValue(page, "debris", "45");
    await setValue(page, "roughness", "high");
    await setValue(page, "bridgeCondition", "fully_blocked");
    await setChecked(page, "#secondaryBlockage", true);
    await wait(9000);
    await click(page, "#runScenario");
    await page.waitForFunction(() => document.querySelectorAll("#missionLog li.complete").length === 11, null, { timeout: 60_000 });
    await waitForFluid(page);
    await wait(32_000);

    console.log("Comparing results and exposing methodology...");
    await click(page, "#compareReference");
    await wait(16_000);
    await smoothScrollTo(page, ".methodology-panel");
    await click(page, "#methodologyToggle");
    await wait(28_000);

    console.log("Recording closing slate...");
    await page.setContent(`
      <style>
        body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#07111f;color:#e5eefb;font-family:Inter,Arial,sans-serif}
        main{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#07111f,#17324a 58%,#244c5a)}
        section{max-width:900px;text-align:center}
        span{display:block;color:#7dd3fc;text-transform:uppercase;letter-spacing:.18em;font-weight:800;font-size:18px;margin-bottom:20px}
        h1{font-size:50px;line-height:1.1;margin:0 0 18px}
        p{font-size:25px;line-height:1.45;margin:0;color:#dbeafe}
      </style>
      <main><section><span>Closing Notes</span><h1>Explainable Digital Twins for Disaster Response</h1><p>See the source, follow the flood downstream, test scenarios, and understand what data improves the decision next.</p></section></main>
    `);
    const elapsed = Date.now() - startedAt;
    await wait(Math.max(12_000, audioDuration * 1000 + 1500 - elapsed));

    if (errors.length) {
      console.warn("Browser capture warnings:");
      console.warn(errors.join("\n"));
    }

    const video = page.video();
    if (!video) throw new Error("Playwright did not create a video artifact.");
    await page.close();
    await video.saveAs(rawVideoPath);
    await context.close();
    await browser.close();
    return rawVideoPath;
  } finally {
    server.kill();
  }
}

function mergeAudioVideo() {
  const audioDuration = mediaDurationSeconds(audioPath);
  run("ffmpeg", [
    "-y",
    "-i",
    rawVideoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-t",
    audioDuration.toFixed(3),
    "-shortest",
    finalVideoPath,
  ]);
}

console.log("Building current app bundle...");
run("npm", ["run", "build"]);

console.log("Synthesizing AWS Polly narration with Kajal...");
synthesizeNarration();
const audioDuration = mediaDurationSeconds(audioPath);
console.log(`Narration duration: ${audioDuration.toFixed(1)}s`);

console.log("Recording dynamic product walkthrough...");
await recordDynamicWalkthrough(audioDuration);
const rawDuration = mediaDurationSeconds(rawVideoPath);
console.log(`Raw dynamic video duration: ${rawDuration.toFixed(1)}s`);

console.log("Merging dynamic video and voiceover...");
mergeAudioVideo();

const finalDuration = mediaDurationSeconds(finalVideoPath);
const sizeMb = (Number(output("node", ["-e", `process.stdout.write(String(require('fs').statSync(${JSON.stringify(finalVideoPath)}).size / 1024 / 1024))`]))).toFixed(1);
console.log(`Created ${finalVideoPath}`);
console.log(`Duration: ${finalDuration.toFixed(1)}s, size: ${sizeMb} MB`);
