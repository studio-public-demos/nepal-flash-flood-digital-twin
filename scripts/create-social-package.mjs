import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const framesDir = join(root, "videos", "frames");
const outDir = join(root, "videos", "social");
const tmpDir = join(outDir, ".tmp");
const verticalDir = join(tmpDir, "vertical");
const squareDir = join(tmpDir, "square");

const slides = [
  {
    image: "02-satellite-terrain.png",
    kicker: "Digital twin showcase",
    title: "Nepal Flash Flood Replay",
    body: "Follow the Bhote Koshi-Trishuli corridor from source to downstream exposure.",
  },
  {
    image: "04-timeline-3.png",
    kicker: "Terrain + timing",
    title: "Replay The Surge",
    body: "A representative event timeline shows how fast impacts move through the valley.",
  },
  {
    image: "05-layer-toggles.png",
    kicker: "Evidence layers",
    title: "Map What Is Known",
    body: "Satellite acquisition footprints, mapped communities, roads and bridges stay traceable.",
  },
  {
    image: "06-whatif-lab.png",
    kicker: "Scenario lab",
    title: "Test What-If Conditions",
    body: "Change breach, rainfall, debris and bridge conditions without claiming official warnings.",
  },
  {
    image: "10-comparison.png",
    kicker: "Decision support",
    title: "Compare Downstream Risk",
    body: "The output is a research simulation for planning conversations, not evacuation guidance.",
  },
  {
    image: "11-methodology.png",
    kicker: "Publish-ready context",
    title: "Provenance Included",
    body: "The public build cites references and avoids redistributing non-commercial imagery pixels.",
  },
];

const captions = `Primary caption:
Nepal Flash Flood Digital Twin: a research showcase for replaying terrain-constrained flood movement, exploring downstream exposure, and testing what-if conditions across the Bhote Koshi-Trishuli corridor.

Safety line:
Scenario-based research simulation. Not an official flood warning, evacuation, damage assessment, or engineering design tool.

Source/provenance line:
References include OpenStreetMap contributors, public Planet Source Cooperative STAC metadata, and Geopera's published August 2026 reconstruction context. Imagery pixels and non-commercial derived products are not redistributed in this public build.

Suggested hashtags:
#DigitalTwin #FloodRisk #Geospatial #DisasterResponse #Nepal #RemoteSensing #Simulation #InfrastructureResilience
`;

const commandSpec = (name, args) => {
  if (process.platform === "win32" && ["npx"].includes(name)) return { command: "cmd", args: ["/c", name, ...args] };
  return { command: name, args };
};

function run(command, args) {
  const spec = commandSpec(command, args);
  execFileSync(spec.command, spec.args, { cwd: root, stdio: "inherit" });
}

function ffmpegPath(filePath) {
  return filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

function imageDataUrl(imageName) {
  const image = readFileSync(join(framesDir, imageName)).toString("base64");
  return `data:image/png;base64,${image}`;
}

function slideHtml(slide, format) {
  const imageUrl = imageDataUrl(slide.image);
  const isSquare = format === "square";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;font-family:Inter,Arial,sans-serif;background:#07111f;color:#f8fafc}
.stage{position:relative;width:100vw;height:100vh;overflow:hidden;background:#07111f}
.image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(1.05) contrast(1.04)}
.veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,17,31,.18),rgba(7,17,31,.58) 44%,rgba(7,17,31,.94))}
.top{position:absolute;left:${isSquare ? 58 : 70}px;right:${isSquare ? 58 : 70}px;top:${isSquare ? 58 : 82}px;display:flex;justify-content:space-between;gap:32px;align-items:flex-start}
.brand{font-size:${isSquare ? 24 : 29}px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.url{font-size:${isSquare ? 21 : 25}px;font-weight:800;color:#93c5fd}
.copy{position:absolute;left:${isSquare ? 58 : 70}px;right:${isSquare ? 58 : 70}px;bottom:${isSquare ? 92 : 150}px}
.kicker{display:inline-block;margin-bottom:${isSquare ? 22 : 28}px;color:#fbbf24;font-size:${isSquare ? 23 : 30}px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
h1{margin:0 0 ${isSquare ? 20 : 28}px;font-size:${isSquare ? 66 : 92}px;line-height:1.02;letter-spacing:0;max-width:940px}
p{margin:0;max-width:${isSquare ? 900 : 860}px;color:#dbeafe;font-size:${isSquare ? 34 : 45}px;line-height:1.2;font-weight:650}
.safety{position:absolute;left:${isSquare ? 58 : 70}px;right:${isSquare ? 58 : 70}px;bottom:${isSquare ? 36 : 60}px;padding-top:18px;border-top:1px solid rgba(147,197,253,.45);color:#bae6fd;font-size:${isSquare ? 20 : 26}px;font-weight:750}
</style>
</head>
<body>
<main class="stage">
<img class="image" src="${imageUrl}" alt="">
<div class="veil"></div>
<div class="top"><div class="brand">Studio Demos</div><div class="url">nebulacloud.studio</div></div>
<section class="copy"><div class="kicker">${slide.kicker}</div><h1>${slide.title}</h1><p>${slide.body}</p></section>
<div class="safety">Research simulation. Not an official flood warning or evacuation system.</div>
</main>
</body>
</html>`;
}

async function renderSlides(format, width, height, dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const paths = [];
  for (const [index, slide] of slides.entries()) {
    await page.setContent(slideHtml(slide, format), { waitUntil: "load" });
    const path = join(dir, `${String(index + 1).padStart(2, "0")}-${format}.png`);
    await page.screenshot({ path });
    paths.push(path);
  }
  await browser.close();
  return paths;
}

function createVideo(imagePaths, outputPath, secondsPerSlide) {
  const concatPath = join(tmpDir, `${outputPath.includes("vertical") ? "vertical" : "square"}-concat.txt`);
  const lines = imagePaths.flatMap((imagePath) => [`file '${ffmpegPath(imagePath)}'`, `duration ${secondsPerSlide}`]);
  lines.push(`file '${ffmpegPath(imagePaths.at(-1))}'`);
  writeFileSync(concatPath, `${lines.join("\n")}\n`);
  rmSync(outputPath, { force: true });
  run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const verticalSlides = await renderSlides("vertical", 1080, 1920, verticalDir);
const squareSlides = await renderSlides("square", 1080, 1080, squareDir);

createVideo(verticalSlides, join(outDir, "nepal-flash-flood-social-vertical.mp4"), 8);
createVideo(squareSlides, join(outDir, "nepal-flash-flood-social-square.mp4"), 7);
copyFileSync(verticalSlides[0], join(outDir, "nepal-flash-flood-cover-vertical.png"));
copyFileSync(squareSlides[0], join(outDir, "nepal-flash-flood-cover-square.png"));

writeFileSync(join(outDir, "caption-and-safety-copy.txt"), captions);
writeFileSync(join(outDir, "asset-manifest.json"), `${JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
    assets: [
      {
        path: "videos/social/nepal-flash-flood-social-vertical.mp4",
        format: "1080x1920 vertical",
        intendedUse: "Instagram Reels, TikTok, YouTube Shorts, LinkedIn mobile feed",
      },
      {
        path: "videos/social/nepal-flash-flood-social-square.mp4",
        format: "1080x1080 square",
        intendedUse: "LinkedIn, X, Instagram feed",
      },
      {
        path: "videos/social/nepal-flash-flood-cover-vertical.png",
        format: "1080x1920 thumbnail candidate",
        intendedUse: "Vertical cover frame",
      },
      {
        path: "videos/social/nepal-flash-flood-cover-square.png",
        format: "1080x1080 thumbnail candidate",
        intendedUse: "Square cover frame",
      },
      {
        path: "videos/nepal-flash-flood-demo.mp4",
        format: "1280x720 landscape long demo",
        intendedUse: "YouTube, website, long LinkedIn demo post",
      },
    ],
    safetyReview: "No casualty counts are included. Copy says this is a research simulation and not an official warning or evacuation system.",
  },
  null,
  2,
)}\n`);

rmSync(tmpDir, { recursive: true, force: true });
console.log(`Created social package in ${outDir}`);
