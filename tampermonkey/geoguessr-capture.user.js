// ==UserScript==
// @name         RASHINBAN GeoGuessr traffic capture
// @namespace    rashinban2026
// @version      0.1.0
// @description  Records GeoGuessr WebSocket frames and API fetches (party broadcast / presenter mode) so the protocol can be analysed offline.
// @match        https://www.geoguessr.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // tampermonkey/src/capture.ts
  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function binaryFrame(bytes) {
    return { binary: true, bytes: bytes.byteLength, base64: bytesToBase64(bytes) };
  }
  function describeFrame(data) {
    if (typeof data === "string") return { text: data };
    if (data instanceof ArrayBuffer) return binaryFrame(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) {
      return binaryFrame(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return data.arrayBuffer().then((buf) => binaryFrame(new Uint8Array(buf)));
    }
    return { text: String(data) };
  }
  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }
  function requestMethod(input, init) {
    const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
    return method.toUpperCase();
  }
  function installFetchCapture(target, sink) {
    const nativeFetch = target.fetch;
    target.fetch = async function capturedFetch(input, init) {
      const t = Date.now();
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const requestBody = typeof init?.body === "string" ? init.body : void 0;
      let response;
      try {
        response = await nativeFetch.call(target, input, init);
      } catch (error) {
        sink({ kind: "fetch", t, method, url, requestBody, error: String(error) });
        throw error;
      }
      response.clone().text().then(
        (responseBody) => sink({ kind: "fetch", t, method, url, status: response.status, requestBody, responseBody }),
        (error) => sink({ kind: "fetch", t, method, url, status: response.status, requestBody, error: String(error) })
      );
      return response;
    };
  }
  function installCapture(target, sink) {
    installFetchCapture(target, sink);
    const NativeWebSocket = target.WebSocket;
    let nextSocketId = 0;
    class CapturedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        __publicField(this, "captureId");
        this.captureId = ++nextSocketId;
        sink({ kind: "ws-connect", t: Date.now(), socket: this.captureId, url: this.url });
        this.addEventListener("message", (event) => this.report("ws-recv", event.data));
      }
      send(data) {
        this.report("ws-send", data);
        super.send(data);
      }
      report(kind, data) {
        const t = Date.now();
        const described = describeFrame(data);
        if (described instanceof Promise) {
          described.then((frame) => sink({ kind, t, socket: this.captureId, data: frame }));
        } else {
          sink({ kind, t, socket: this.captureId, data: described });
        }
      }
    }
    target.WebSocket = CapturedWebSocket;
  }

  // tampermonkey/src/geoguessr-capture.user.ts
  var TAG = "[rb-capture]";
  var events = [];
  function isInteresting(event) {
    if (event.kind !== "fetch") return true;
    try {
      const url = new URL(event.url, location.href);
      return url.hostname.endsWith("geoguessr.com") && !url.pathname.startsWith("/_next/");
    } catch {
      return false;
    }
  }
  function parsed(text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  function logEvent(event) {
    switch (event.kind) {
      case "ws-connect":
        console.info(TAG, `ws#${event.socket} connect`, event.url);
        break;
      case "ws-send":
      case "ws-recv":
        console.debug(
          TAG,
          `ws#${event.socket} ${event.kind === "ws-send" ? "\u2192" : "\u2190"}`,
          "text" in event.data ? parsed(event.data.text) : `<binary ${event.data.bytes} bytes>`
        );
        break;
      case "fetch":
        console.debug(TAG, `fetch ${event.method} ${event.status ?? event.error}`, event.url);
        break;
    }
  }
  function download() {
    const capture = {
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      page: location.href,
      userAgent: navigator.userAgent,
      events
    };
    const blob = new Blob([JSON.stringify(capture)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geoguessr-capture-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function clear() {
    events.length = 0;
    updatePanel();
  }
  var counter;
  function updatePanel() {
    if (counter) counter.textContent = `${events.length} events`;
  }
  function mountPanel() {
    const panel = document.createElement("div");
    panel.id = "rb-capture-panel";
    panel.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;font:12px/1.2 monospace;";
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
  window.__rbCapture = { events, download, clear };
  if (document.body) mountPanel();
  else document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
  console.info(TAG, "installed; window.__rbCapture = { events, download(), clear() }");
})();
