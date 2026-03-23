#!/usr/bin/env node
import process from "node:process";

let step = 1;

function logStep(message) {
  process.stdout.write(`[thread-app-check] step ${step}: ${message}\n`);
  step += 1;
}

logStep(`script entry pid=${process.pid}`);

logStep("installing uncaughtException handler");
process.on("uncaughtException", (error) => {
  process.stderr.write(`[thread-app-check] uncaughtException: ${error?.stack || error}\n`);
});

logStep("installing unhandledRejection handler");
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[thread-app-check] unhandledRejection: ${reason?.stack || reason}\n`);
});

logStep("importing express");
const { default: express } = await import("express");

logStep("resolving port");
const port = Number(process.env.PORT || process.env.REPO_OPS_THREAD_APP_PORT || 8080);

logStep(`creating express app for port=${port}`);
const app = express();

logStep("registering GET /");
app.get("/", (_req, res) => {
  process.stdout.write("[thread-app-check] route / hit\n");
  res.type("text/plain").send("thread-app-check");
});

logStep("registering GET /healthz");
app.get("/healthz", (_req, res) => {
  process.stdout.write("[thread-app-check] route /healthz hit\n");
  res.type("text/plain").send("ok");
});

logStep("registering GET /setupz");
app.get("/setupz", (_req, res) => {
  process.stdout.write("[thread-app-check] route /setupz hit\n");
  res.type("text/markdown").send(
    [
      "# Setup",
      "- ready: check-mode",
      "- note: AGENTHUB_START_MODE=check bypasses the real app and only verifies container startup, HTTP routing, and the health probe.",
    ].join("\n"),
  );
});

logStep("calling listen on 0.0.0.0");
app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`[thread-app-check] listening on :${port}\n`);
});
