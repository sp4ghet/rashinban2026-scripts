import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { installCapture, type CaptureEvent } from "./capture.ts";

/** Tiny echo server; every text or binary frame is sent straight back. */
async function startEchoServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => wss.close(() => resolve())),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("records outbound and inbound text frames with the socket url", async () => {
  const server = await startEchoServer();
  const events: CaptureEvent[] = [];
  const target = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch };
  installCapture(target, (event) => events.push(event));

  const ws = new target.WebSocket(server.url);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const echoed = new Promise((resolve) => ws.addEventListener("message", resolve, { once: true }));
  ws.send('{"code":"HeartBeat"}');
  await echoed;
  await settle();
  ws.close();
  await server.close();

  const connect = events.find((e) => e.kind === "ws-connect");
  assert.ok(connect, "ws-connect event recorded");
  assert.equal(connect.url, server.url);

  const sent = events.find((e) => e.kind === "ws-send");
  assert.ok(sent, "ws-send event recorded");
  assert.deepEqual(sent.data, { text: '{"code":"HeartBeat"}' });
  assert.equal(sent.socket, connect.socket);

  const received = events.find((e) => e.kind === "ws-recv");
  assert.ok(received, "ws-recv event recorded");
  assert.deepEqual(received.data, { text: '{"code":"HeartBeat"}' });
  assert.equal(received.socket, connect.socket);
});

test("records binary frames as base64 with their byte count", async () => {
  const server = await startEchoServer();
  const events: CaptureEvent[] = [];
  const target = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch };
  installCapture(target, (event) => events.push(event));

  const ws = new target.WebSocket(server.url);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const echoed = new Promise((resolve) => ws.addEventListener("message", resolve, { once: true }));
  ws.send(new Uint8Array([1, 2, 3]));
  await echoed;
  await settle();
  ws.close();
  await server.close();

  const sent = events.find((e) => e.kind === "ws-send");
  assert.ok(sent, "ws-send event recorded");
  assert.deepEqual(sent.data, { binary: true, bytes: 3, base64: "AQID" });

  const received = events.find((e) => e.kind === "ws-recv");
  assert.ok(received, "ws-recv event recorded");
  assert.deepEqual(received.data, { binary: true, bytes: 3, base64: "AQID" });
});

test("records Blob frames (the browser default binaryType) as base64", async () => {
  const server = await startEchoServer();
  const events: CaptureEvent[] = [];
  const target = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch };
  installCapture(target, (event) => events.push(event));

  const ws = new target.WebSocket(server.url);
  assert.equal(ws.binaryType, "blob");
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const echoed = new Promise((resolve) => ws.addEventListener("message", resolve, { once: true }));
  ws.send(new Blob([new Uint8Array([4, 5, 6])]));
  await echoed;
  await settle();
  ws.close();
  await server.close();

  const received = events.find((e) => e.kind === "ws-recv");
  assert.ok(received, "ws-recv event recorded");
  assert.deepEqual(received.data, { binary: true, bytes: 3, base64: "BAUG" });
});

test("records fetch requests with status and response body without consuming it", async () => {
  const http = await import("node:http");
  const httpServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ gameState: "Ongoing", path: req.url, method: req.method }));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as { port: number };
  const url = `http://127.0.0.1:${port}/api/v4/parties/v2/abc`;

  const events: CaptureEvent[] = [];
  const target = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch };
  installCapture(target, (event) => events.push(event));

  const response = await target.fetch(url, { method: "POST", body: '{"hello":1}' });
  const body = await response.json();
  await settle();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  assert.deepEqual(body, { gameState: "Ongoing", path: "/api/v4/parties/v2/abc", method: "POST" });
  const event = events.find((e) => e.kind === "fetch");
  assert.ok(event, "fetch event recorded");
  assert.equal(event.url, url);
  assert.equal(event.method, "POST");
  assert.equal(event.status, 200);
  assert.equal(event.requestBody, '{"hello":1}');
  assert.equal(event.responseBody, JSON.stringify({ gameState: "Ongoing", path: "/api/v4/parties/v2/abc", method: "POST" }));
});
