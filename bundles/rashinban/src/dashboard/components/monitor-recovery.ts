/** Recover a dashboard iframe whose NodeCG API failed during page startup. */
export function recoverMonitor(frame: HTMLIFrameElement): void {
  const maxRetries = 2;
  let retries = 0;
  let timer: number | undefined;
  let disposed = false;
  const status = document.createElement("div");
  status.className = "monitor-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const message = document.createElement("span");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "monitor-reload";
  reload.textContent = "Reload monitor";
  reload.setAttribute("aria-label", `Reload ${frame.title}`);
  status.append(message, reload);
  frame.parentElement!.append(status);

  function navigate() {
    if (!disposed) frame.src = frame.src;
  }
  reload.onclick = () => {
    retries = 0;
    reload.hidden = true;
    message.textContent = "Reloading monitor…";
    navigate();
  };
  function loaded() {
    window.clearTimeout(timer);
    const doc = frame.contentDocument;
    // Ignore the initial empty frame and NodeCG's intentional busy/killed pages.
    if (!doc || doc.location.pathname !== new URL(frame.src, location.href).pathname) {
      retries = 0;
      status.hidden = true;
      frame.style.visibility = "";
      return;
    }
    const client = (frame.contentWindow as (Window & { nodecg?: { Replicant?: unknown } }) | null)?.nodecg;
    if (typeof client?.Replicant === "function") {
      retries = 0;
      status.hidden = true;
      frame.style.visibility = "";
      return;
    }
    // A connected socket alone is not readiness: /api.js can fail and leave
    // the graphic partially mounted, showing its default caster banner forever.
    frame.style.visibility = "hidden";
    status.hidden = false;
    reload.hidden = retries < maxRetries;
    if (retries < maxRetries) {
      retries++;
      message.textContent = `Reloading monitor (${retries}/${maxRetries})…`;
      console.warn(`${frame.title}: NodeCG API did not initialize; reloading monitor (${retries}/${maxRetries}).`);
      timer = window.setTimeout(navigate, 1000);
    } else {
      message.textContent = "Monitor failed to initialize.";
      console.error(`${frame.title}: NodeCG API is still unavailable after ${maxRetries} retries.`);
    }
  }
  frame.addEventListener("load", loaded);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    disposed = true;
    window.clearTimeout(timer);
    frame.removeEventListener("load", loaded);
  });
}
