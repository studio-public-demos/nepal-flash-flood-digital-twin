import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "videos");
const rawDir = join(outDir, "raw");
const finalVideoPath = join(outDir, "nepal-flash-flood-platform-demo-1080p.mp4");
const rawVideoPath = join(rawDir, "platform-demo-live.webm");
const coverPath = join(outDir, "nepal-flash-flood-platform-demo-cover.png");
const port = Number(process.env.DEMO_VIDEO_PORT ?? 4184);
const baseUrl = `http://127.0.0.1:${port}/`;
const appLoadTimeoutMs = 100_000;
let trimStartSeconds = 0;

const commandSpec = (name, args) => {
  if (process.platform === "win32" && ["npm", "npx"].includes(name)) return { command: "cmd", args: ["/c", name, ...args] };
  return { command: name, args };
};

function run(command, args) {
  const spec = commandSpec(command, args);
  execFileSync(spec.command, spec.args, { cwd: root, stdio: "inherit" });
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
      await wait(400);
    }
  }
  throw new Error(`Local server did not start at ${baseUrl}`);
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

async function dismissOnboarding(page) {
  await page.evaluate(() => document.querySelector("#onboarding")?.remove());
}

async function setReplayMapLayers(page) {
  await setChecked(page, `[data-layer="observedEvidence"]`, false);
  await setChecked(page, `[data-layer="river"]`, true);
  await setChecked(page, `[data-layer="roads"]`, true);
  await setChecked(page, `[data-layer="bridges"]`, true);
  await setChecked(page, `[data-layer="settlements"]`, true);
  await setChecked(page, `[data-layer="waterDepth"]`, true);
  await setChecked(page, `[data-layer="velocity"]`, false);
  await setChecked(page, `[data-layer="hazard"]`, false);
}

async function setCorridorCamera(page, height, duration = 0) {
  await page.evaluate(
    ({ height, duration }) => {
      const config = window.NEPAL_FLOOD_CONFIG;
      const Cesium = window.Cesium;
      if (!config?.viewer || !Cesium) return;
      config.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(85.03, 28.0, height),
        orientation: {
          heading: Cesium.Math.toRadians(332),
          pitch: Cesium.Math.toRadians(-54),
          roll: 0,
        },
        duration,
      });
    },
    { height, duration },
  );
}

async function frameFloodCorridor(page, height = 120_000) {
  await page.evaluate(
    ({ height }) => {
      const config = window.NEPAL_FLOOD_CONFIG;
      const Cesium = window.Cesium;
      if (!config?.viewer || !Cesium) return;
      config.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(84.78, 27.91, height),
        orientation: {
          heading: Cesium.Math.toRadians(332),
          pitch: Cesium.Math.toRadians(-82),
          roll: 0,
        },
      });
    },
    { height },
  );
}

async function caption(page, eyebrow, title, body) {
  await page.evaluate(
    ({ eyebrow, title, body }) => {
      let panel = document.querySelector("#demoCaption");
      if (!panel) {
        panel = document.createElement("aside");
        panel.id = "demoCaption";
        document.body.append(panel);
      }
      panel.innerHTML = `<span>${eyebrow}</span><strong>${title}</strong><p>${body}</p>`;
    },
    { eyebrow, title, body },
  );
}

async function installDemoOverlay(page) {
  await page.addStyleTag({
    content: `
      #demoCaption{position:fixed;left:34px;bottom:30px;z-index:1000;width:min(620px,calc(100vw - 68px));padding:20px 22px;border:1px solid rgba(125,211,252,.4);border-radius:8px;background:rgba(8,13,24,.84);box-shadow:0 16px 48px rgba(8,13,24,.35);color:#f8fafc;font-family:Inter,system-ui,sans-serif;backdrop-filter:blur(10px)}
      #demoCaption span{display:block;margin-bottom:7px;color:#fbbf24;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
      #demoCaption strong{display:block;font-size:28px;line-height:1.08}
      #demoCaption p{margin:8px 0 0;color:#dbeafe;font-size:16px;line-height:1.45}
      .topbar{z-index:900}
    `,
  });
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => window.Cesium && window.NEPAL_FLOOD_CONFIG?.viewer, null, { timeout: appLoadTimeoutMs });
  await page.waitForFunction(() => window.NEPAL_FLOOD_CONFIG?.staticLayersReady, null, { timeout: appLoadTimeoutMs });
  await page.waitForFunction(() => document.querySelectorAll(".metric").length > 0, null, { timeout: appLoadTimeoutMs });
  await page.waitForFunction(
    () => {
      const debug = window.NEPAL_FLOOD_CONFIG?.flowDebug;
      return debug?.particlesDrawn > 20 || document.querySelector("#flowCanvas");
    },
    null,
    { timeout: appLoadTimeoutMs },
  );
}

async function titleSlate(page) {
  await page.setContent(`
    <style>
      html,body{margin:0;width:100%;height:100%;font-family:Inter,Arial,sans-serif;background:#07111f;color:#f8fafc}
      main{width:100vw;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#07111f,#17324a 62%,#204e5a)}
      section{max-width:1120px;text-align:center}
      span{display:block;color:#7dd3fc;text-transform:uppercase;letter-spacing:.18em;font-weight:800;font-size:22px;margin-bottom:28px}
      h1{font-size:84px;line-height:1;margin:0 0 26px;letter-spacing:0}
      p{font-size:31px;line-height:1.35;margin:0;color:#dbeafe}
      small{display:block;margin-top:34px;color:#bae6fd;font-weight:750;font-size:20px}
    </style>
    <main><section><span>Nebula Cloud Studio Showcase</span><h1>Nepal Flash Flood Digital Twin</h1><p>Live platform demo: replay, layers, scenarios, comparison and provenance.</p><small>Research simulation. Not an official warning or evacuation system.</small></section></main>
  `);
}

async function closingSlate(page) {
  await page.setContent(`
    <style>
      html,body{margin:0;width:100%;height:100%;font-family:Inter,Arial,sans-serif;background:#07111f;color:#f8fafc}
      main{width:100vw;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#07111f,#17324a 62%,#204e5a)}
      section{max-width:1040px;text-align:center}
      span{display:block;color:#fbbf24;text-transform:uppercase;letter-spacing:.18em;font-weight:800;font-size:22px;margin-bottom:28px}
      h1{font-size:70px;line-height:1.06;margin:0 0 24px;letter-spacing:0}
      p{font-size:30px;line-height:1.4;margin:0;color:#dbeafe}
    </style>
    <main><section><span>Publish-ready demo</span><h1>Explainable Disaster Digital Twins</h1><p>See the source, follow the flood, test scenarios and communicate model limits clearly.</p></section></main>
  `);
}

async function recordLiveDemo() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });
  rmSync(rawVideoPath, { force: true });
  rmSync(finalVideoPath, { force: true });
  rmSync(coverPath, { force: true });

  const serverSpec = commandSpec("npx", ["http-server", ".", "-p", String(port), "-c-1", "--silent"]);
  const server = spawn(serverSpec.command, serverSpec.args, {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: "no-preference",
      recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
    });
    const page = await context.newPage();
    await routeLocalCesium(page);
    const recordingStartedAt = Date.now();

    console.log("Recording title slate...");
    await titleSlate(page);
    await wait(4500);

    console.log("Loading live app...");
    await page.goto(`${baseUrl}?platform-demo=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: appLoadTimeoutMs });
    await waitForAppReady(page);
    await installDemoOverlay(page);
    await dismissOnboarding(page);
    await setReplayMapLayers(page);

    await caption(page, "Mode 1", "Terrain-constrained replay", "The flood surface follows the mapped Bhote Koshi-Trishuli corridor with broad, visible downstream water.");
    await setValue(page, "timeline", "18");
    await frameFloodCorridor(page, 58_000);
    trimStartSeconds = Math.max(0, (Date.now() - recordingStartedAt) / 1000 - 1);
    await wait(3000);
    for (const value of ["35", "55", "72", "90", "108", "120"]) {
      await setValue(page, "timeline", value);
      if (["55", "90", "120"].includes(value)) await frameFloodCorridor(page, value === "120" ? 78_000 : 52_000);
      await wait(2600);
    }
    await page.screenshot({ path: coverPath, fullPage: false, timeout: 90_000 });

    await caption(page, "Mode 2", "Evidence and hydraulic layers", "Switch between water depth, velocity, hazard proxy, source coverage, roads, bridges and settlements.");
    await setChecked(page, `[data-layer="velocity"]`, true);
    await wait(3200);
    await setChecked(page, `[data-layer="hazard"]`, true);
    await wait(3200);
    await setChecked(page, `[data-layer="hazard"]`, false);
    await setChecked(page, `[data-layer="waterDepth"]`, true);
    await setChecked(page, `[data-layer="observedEvidence"]`, true);
    await wait(3000);

    await caption(page, "Mode 3", "What-if lab", "Users can change release volume, breach behavior, rainfall, debris and bridge obstruction directly in the platform.");
    await page.evaluate(() => document.querySelector(".workbench")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await wait(3000);
    await setValue(page, "presetScenario", "S4");
    await wait(3500);
    await setValue(page, "presetScenario", "S7");
    await wait(3500);

    await caption(page, "Custom run", "High-impact scenario", "A custom visitor scenario recomputes downstream exposure and mission steps in the browser.");
    await setValue(page, "presetScenario", "");
    await setValue(page, "lakeVolume", "5");
    await setValue(page, "breachMechanism", "catastrophic_breach");
    await setValue(page, "breachDuration", "20");
    await setValue(page, "breachWidth", "extreme");
    await setValue(page, "rainfall", "2");
    await setValue(page, "antecedentFlow", "extreme");
    await setValue(page, "debris", "45");
    await setValue(page, "bridgeCondition", "fully_blocked");
    await setChecked(page, "#secondaryBlockage", true);
    await wait(2000);
    await click(page, "#runScenario");
    await page.waitForFunction(() => document.querySelectorAll("#missionLog li.complete").length === 11, null, { timeout: 60_000 });
    await wait(5500);

    await caption(page, "Mode 4", "Compare and explain", "The demo keeps estimates, provenance and limitations visible so the model is understandable before operational use.");
    await click(page, "#compareReference");
    await wait(4500);
    await page.evaluate(() => document.querySelector(".methodology-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await wait(2400);
    await click(page, "#methodologyToggle");
    await wait(6200);

    console.log("Recording closing slate...");
    await closingSlate(page);
    await wait(4500);

    const video = page.video();
    if (!video) throw new Error("Playwright did not create a video artifact.");
    await page.close();
    await video.saveAs(rawVideoPath);
    await context.close();
    await browser.close();
  } finally {
    server.kill();
  }
}

function transcode() {
  run("ffmpeg", [
    "-y",
    "-ss",
    trimStartSeconds.toFixed(2),
    "-i",
    rawVideoPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    finalVideoPath,
  ]);
}

console.log("Building current app bundle...");
run("npm", ["run", "build"]);
await recordLiveDemo();
console.log("Transcoding 1080p MP4...");
transcode();
writeFileSync(join(outDir, "nepal-flash-flood-platform-demo-caption.txt"), "Nepal Flash Flood Digital Twin live platform demo: terrain-constrained replay, evidence layers, what-if scenarios, downstream comparison and methodology. Scenario-based research simulation; not an official flood warning, evacuation, damage assessment or engineering design tool.\n");
console.log(`Created ${finalVideoPath}`);
