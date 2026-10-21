/** Keep the two previews proportional while giving the controls more room. */
export function mountMonitorResize(monitors: HTMLElement, output: string): void {
  const screen = monitors.querySelector<HTMLElement>(".screen")!;
  const storageKey = `rashinban.switcher.${output}.monitorHeight`;
  let preferredHeight: number | null = null;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved > 0) preferredHeight = saved;
  } catch { /* storage unavailable */ }

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "monitor-resize";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Preview and program monitor height");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.title = "Drag to resize previews, or use Up/Down arrow keys";
  monitors.classList.add("resizable");
  monitors.append(handle);

  function bounds() {
    const gap = parseFloat(getComputedStyle(monitors).columnGap) || 0;
    const max = Math.max(1, (monitors.clientWidth - gap) / 2) * 9 / 16;
    return { min: Math.min(90, max), max };
  }
  function applyHeight() {
    const { min, max } = bounds();
    const height = Math.min(max, Math.max(min, preferredHeight ?? max));
    monitors.style.setProperty("--monitor-width", `${height * 16 / 9}px`);
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(height)));
    handle.setAttribute("aria-valuetext", `${Math.round(height)} pixels`);
  }
  function saveHeight() {
    try { localStorage.setItem(storageKey, String(preferredHeight)); } catch { /* storage unavailable */ }
  }
  function resize(height: number) {
    const { min, max } = bounds();
    preferredHeight = Math.min(max, Math.max(min, height));
    applyHeight();
  }

  let drag: { pointerId: number; y: number; height: number } | null = null;
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, y: event.clientY, height: screen.getBoundingClientRect().height };
    handle.setPointerCapture(event.pointerId);
    monitors.classList.add("resizing");
  });
  handle.addEventListener("pointermove", event => {
    if (drag?.pointerId === event.pointerId) resize(drag.height + event.clientY - drag.y);
  });
  function endDrag(event: PointerEvent) {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    monitors.classList.remove("resizing");
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    saveHeight();
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
  handle.addEventListener("keydown", event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const { min, max } = bounds();
    const height = screen.getBoundingClientRect().height;
    const next = event.key === "ArrowUp" ? height - 16 : event.key === "ArrowDown" ? height + 16
      : event.key === "Home" ? min : event.key === "End" ? max : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    resize(next);
    saveHeight();
  });
  new ResizeObserver(applyHeight).observe(monitors);
  applyHeight();
}
