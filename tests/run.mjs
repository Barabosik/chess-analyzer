// Runs every suite against a freshly served copy of the app.
//   npm test              all suites
//   npm test drag links   only the named ones
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2);

const suites = readdirSync(HERE)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !filter.length || filter.some((k) => f.includes(k)))
  .sort();

if (!suites.length) {
  console.error("no suites matched " + filter.join(", "));
  process.exit(1);
}

const server = await startServer(8787);
console.log("serving the app at " + server.url + "\n");

const run = (file) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(HERE, file)], {
    stdio: "inherit",
    env: { ...process.env, BASE: server.url },
  });
  p.on("exit", (code) => resolve(code === 0));
});

const failed = [];
for (const s of suites) {
  console.log("── " + s.replace(".test.mjs", ""));
  if (!(await run(s))) failed.push(s);
  console.log("");
}

await server.close();

if (failed.length) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("all " + suites.length + " suites passed");
