#!/usr/bin/env node
import process from "node:process";

import express from "express";

const port = Number(process.env.PORT || process.env.REPO_OPS_THREAD_APP_PORT || 8080);
const app = express();

process.on("uncaughtException", (error) => {
  process.stderr.write(`[thread-app-check] uncaughtException: ${error?.stack || error}\n`);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[thread-app-check] unhandledRejection: ${reason?.stack || reason}\n`);
});

process.stdout.write(`[thread-app-check] booting pid=${process.pid} port=${port}\n`);

app.get("/", (_req, res) => {
  res.type("text/plain").send("thread-app-check");
});

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/setupz", (_req, res) => {
  res.type("text/markdown").send(
    [
      "# Setup",
      "- ready: check-mode",
      "- note: AGENTHUB_START_MODE=check bypasses the real app and only verifies container startup, HTTP routing, and the health probe.",
    ].join("\n"),
  );
});

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`[thread-app-check] listening on :${port}\n`);
});
