/**
 * Core capture logic: wraps a WebSocket constructor so every connection,
 * outbound frame, and inbound frame is reported to a sink. Framework-free so
 * it can be exercised in Node against a real socket server.
 */

export type FrameData = { text: string } | { binary: true; bytes: number; base64: string };

export type CaptureEvent =
  | { kind: "ws-connect"; t: number; socket: number; url: string }
  | { kind: "ws-send"; t: number; socket: number; data: FrameData }
  | { kind: "ws-recv"; t: number; socket: number; data: FrameData }
  | {
      kind: "fetch";
      t: number;
      method: string;
      url: string;
      status?: number;
      requestBody?: string;
      responseBody?: string;
      error?: string;
    };

export type CaptureSink = (event: CaptureEvent) => void;

export interface CaptureTarget {
  WebSocket: typeof WebSocket;
  fetch: typeof fetch;
}

type SendData = Parameters<WebSocket["send"]>[0];

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function binaryFrame(bytes: Uint8Array): FrameData {
  return { binary: true, bytes: bytes.byteLength, base64: bytesToBase64(bytes) };
}

/** Describe a frame; binary payloads that need async reading (Blob) resolve later. */
function describeFrame(data: unknown): FrameData | Promise<FrameData> {
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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

function installFetchCapture(target: CaptureTarget, sink: CaptureSink): void {
  const nativeFetch = target.fetch;
  target.fetch = async function capturedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const t = Date.now();
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const requestBody = typeof init?.body === "string" ? init.body : undefined;
    let response: Response;
    try {
      response = await nativeFetch.call(target, input, init);
    } catch (error) {
      sink({ kind: "fetch", t, method, url, requestBody, error: String(error) });
      throw error;
    }
    // Read a clone in the background so the page gets its response untouched and undelayed.
    response
      .clone()
      .text()
      .then(
        (responseBody) => sink({ kind: "fetch", t, method, url, status: response.status, requestBody, responseBody }),
        (error) => sink({ kind: "fetch", t, method, url, status: response.status, requestBody, error: String(error) }),
      );
    return response;
  };
}

export function installCapture(target: CaptureTarget, sink: CaptureSink): void {
  installFetchCapture(target, sink);
  const NativeWebSocket = target.WebSocket;
  let nextSocketId = 0;

  class CapturedWebSocket extends NativeWebSocket {
    captureId: number;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.captureId = ++nextSocketId;
      sink({ kind: "ws-connect", t: Date.now(), socket: this.captureId, url: this.url });
      this.addEventListener("message", (event: MessageEvent) => this.report("ws-recv", event.data));
    }

    override send(data: SendData): void {
      this.report("ws-send", data);
      super.send(data);
    }

    private report(kind: "ws-send" | "ws-recv", data: unknown): void {
      const t = Date.now();
      const described = describeFrame(data);
      if (described instanceof Promise) {
        described.then((frame) => sink({ kind, t, socket: this.captureId, data: frame }));
      } else {
        sink({ kind, t, socket: this.captureId, data: described });
      }
    }
  }

  target.WebSocket = CapturedWebSocket as unknown as typeof WebSocket;
}
