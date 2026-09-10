// ==UserScript==
// @name         RASHINBAN GeoGuessr traffic capture
// @namespace    rashinban2026
// @version      0.1.0
// @description  Records GeoGuessr WebSocket frames and API fetches (party broadcast / presenter mode) so the protocol can be analysed offline.
// @match        https://www.geoguessr.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

import { installCapture, type CaptureEvent } from "./capture.ts";

const TAG = "[rb-capture]";
const events: CaptureEvent[] = [];

/** Keep only traffic that can carry game state; drop asset and analytics noise. */
function isInteresting(event: CaptureEvent): boolean {
  if (event.kind !== "fetch") return true;
  try {
    const url = new URL(event.url, location.href);
    return url.hostname.endsWith("geoguessr.com") && !url.pathname.startsWith("/_next/");
  } catch {
    return false;
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function logEvent(event: CaptureEvent): void {
  switch (event.kind) {
    case "ws-connect":
      console.info(TAG, `ws#${event.socket} connect`, event.url);
      break;
    case "ws-send":
    case "ws-recv":
      console.debug(
        TAG,
        `ws#${event.socket} ${event.kind === "ws-send" ? "→" : "←"}`,
        "text" in event.data ? parsed(event.data.text) : `<binary ${event.data.bytes} bytes>`,
      );
      break;
    case "fetch":
      console.debug(TAG, `fetch ${event.method} ${event.status ?? event.error}`, event.url);
      break;
  }
}

function download(): void {
  const capture = {
    capturedAt: new Date().toISOString(),
    page: location.href,
    userAgent: navigator.userAgent,
    events,
  };
  const blob = new Blob([JSON.stringify(capture)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `geoguessr-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clear(): void {
  events.length = 0;
  updatePanel();
}

let counter: HTMLElement | undefined;

function updatePanel(): void {
  if (counter) counter.textContent = `${events.length} events`;
}

function mountPanel(): void {
  const panel = document.createElement("div");
  panel.id = "rb-capture-panel";
  panel.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:2147483647;display:flex;gap:6px;align-items:center;" +
    "padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;font:12px/1.2 monospace;";
  counter = document.createElement("span");
  const downloadButton = document.createElement("button");
  downloadButton.textContent = "Download";
  downloadButton.onclick = download;
  const clearButton = document.createElement("button");
  clearButton.textContent = "Clear";
  clearButton.onclick = clear;
  panel.append(counter, downloadButton, clearButton);
  document.body.append(panel);
  updatePanel();
}

installCapture(window, (event) => {
  if (!isInteresting(event)) return;
  events.push(event);
  logEvent(event);
  updatePanel();
});

(window as Window & { __rbCapture?: unknown }).__rbCapture = { events, download, clear };

if (document.body) mountPanel();
else document.addEventListener("DOMContentLoaded", mountPanel, { once: true });

console.info(TAG, "installed; window.__rbCapture = { events, download(), clear() }");
