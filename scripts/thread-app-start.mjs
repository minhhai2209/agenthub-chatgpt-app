#!/usr/bin/env node
import process from "node:process";

const mode = String(process.env.AGENTHUB_START_MODE || "app").trim().toLowerCase();

if (mode === "check") {
  await import("./thread-app-check.mjs");
} else {
  await import("./thread-app.mjs");
}
