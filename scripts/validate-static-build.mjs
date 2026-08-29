import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const required = [
  "index.html",
  "catalogue.json",
  "showcase/nepal-flash-flood/index.html",
  "showcase/nepal-flash-flood/app.js",
  "showcase/nepal-flash-flood/styles.css",
  "showcase/nepal-flash-flood/data/scenarios.json",
  "showcase/nepal-flash-flood/data/infrastructure.geojson",
  "showcase/nepal-flash-flood/data/observed-evidence.geojson",
];

for (const file of required) {
  await access(join(process.cwd(), file));
}

const catalogue = JSON.parse(await readFile(join(process.cwd(), "catalogue.json"), "utf8"));
if (!catalogue.demos.some((demo) => demo.repo_name === "nepal-flash-flood-digital-twin")) {
  throw new Error("Nepal Flash Flood Digital Twin is missing from catalogue.json");
}

const html = await readFile(join(process.cwd(), "showcase/nepal-flash-flood/index.html"), "utf8");
for (const needle of ["Scenario-based research simulation", "Source to Downstream", "Legend", "Observed evidence", "What-If Lab", "Model & Data", "Powered by Nebula Cloud Studio"]) {
  if (!html.includes(needle)) throw new Error(`Nepal page missing required text: ${needle}`);
}

const rootHtml = await readFile(join(process.cwd(), "index.html"), "utf8");
for (const needle of ["Featured Showcase", "Nepal Flash Flood", "nepal-flash-flood-digital-twin"]) {
  if (!rootHtml.includes(needle)) throw new Error(`Showcase index missing Nepal launch surface: ${needle}`);
}

console.log("Static showcase build validated.");
