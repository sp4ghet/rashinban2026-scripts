/// <reference types="google.maps" />
import { createRenderer, type GameRenderer, type RendererAdapter } from './renderer.ts';
import type { Panorama } from '../../types/presenter.ts';

// Round snapshots encode ASCII panorama IDs as hex; movement samples are plain.
// This is format conversion only. The service must still resolve the exact ID.
export function googlePanoId(value: string): string {
  if (value.length >= 40 && /^(?:[a-f\d]{2})+$/i.test(value)) {
    const decoded = value.match(/../g)!.map(pair => String.fromCharCode(parseInt(pair, 16))).join('');
    if (/^[\w-]+$/.test(decoded)) return decoded;
  }
  return value;
}

let apiPromise: Promise<typeof google.maps> | undefined;
const authFailures = new Set<() => void>();
function loadGoogle(apiKey: string): Promise<typeof google.maps> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const host = window as typeof window & { __rashinbanGoogleReady?: () => void; gm_authFailure?: () => void };
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timeout); reject(new Error('Google Maps API unavailable')); };
    const timeout = setTimeout(fail, 15000);
    host.gm_authFailure = () => { fail(); authFailures.forEach(fn => fn()); };
    host.__rashinbanGoogleReady = () => { clearTimeout(timeout); resolve(google.maps); delete host.__rashinbanGoogleReady; };
    script.onerror = fail;
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=quarterly&loading=async&libraries=marker&callback=__rashinbanGoogleReady`;
    document.head.append(script);
  });
  return apiPromise;
}

export function googleAdapter(root: HTMLElement, maps: typeof google.maps, onError: (message: string) => void, onRecovery: () => void = () => {}): RendererAdapter {
  const failedPanos = new Set<symbol>();
  function recovered(id: symbol) { if (failedPanos.delete(id) && failedPanos.size === 0) onRecovery(); }
  function mount(slot: string) {
    const host = root.querySelector<HTMLElement>(`#${slot}`);
    if (!host) throw new Error('Missing map slot');
    const canvas = host.ownerDocument.createElement('div'); canvas.className = 'google-surface'; canvas.inert = true;
    const status = host.ownerDocument.createElement('div'); status.className = 'google-status'; status.textContent = 'Loading view…';
    host.replaceChildren(canvas, status);
    return { host, canvas, status, clear() { host.replaceChildren(); host.style.visibility = ''; host.dataset.inactive = ''; } };
  }
  function release(value: google.maps.MVCObject) { maps.event.clearInstanceListeners(value); value.unbindAll(); }
  function construct<T>(dom: ReturnType<typeof mount>, create: () => T): T {
    try { return create(); } catch (error) { dom.clear(); throw error; }
  }
  return {
    panorama(slot) {
      const surfaceId = Symbol(slot);
      const dom = mount(slot);
      const pano = construct(dom, () => new maps.StreetViewPanorama(dom.canvas, {
        visible: false, disableDefaultUI: true, clickToGo: false, linksControl: false, panControl: false,
        zoomControl: false, scrollwheel: false, disableDoubleClickZoom: true,
        motionTracking: false, motionTrackingControl: false, showRoadLabels: false,
        addressControl: false, fullscreenControl: false, enableCloseButton: false,
      }));
      const service = new maps.StreetViewService();
      let latest: Panorama | null = null; let requested: string | null = null; let resolved = ''; let generation = 0; let disposed = false;
      function unavailable() {
        failedPanos.add(surfaceId);
        pano.setVisible(false); dom.status.hidden = false; dom.status.textContent = 'View unavailable';
        onError('Exact Street View panorama unavailable');
      }
      function applyPov() {
        if (!latest || !resolved) return;
        pano.setPov({ heading: latest.heading, pitch: latest.pitch }); pano.setZoom(latest.zoom);
      }
      pano.addListener('status_changed', () => { if (!disposed && resolved && pano.getStatus() !== 'OK') unavailable(); });
      return {
        render(value) {
          if (disposed) return;
          latest = value;
          if (!value) {
            generation++; requested = null; resolved = ''; pano.setVisible(false);
            dom.status.hidden = false; dom.status.textContent = 'View unavailable'; recovered(surfaceId); return;
          }
          const id = googlePanoId(value.panoId);
          if (id === requested) { applyPov(); return; }
          requested = id; resolved = ''; const token = ++generation;
          pano.setVisible(false); dom.status.hidden = false; dom.status.textContent = 'Loading view…';
          if (!id) { unavailable(); return; }
          service.getPanorama({ pano: id }, (data, status) => {
            if (disposed || token !== generation) return;
            if (status !== 'OK' || data?.location?.pano !== id) { unavailable(); return; }
            resolved = id; pano.setPano(id); applyPov(); pano.setVisible(true); dom.status.hidden = true;
            recovered(surfaceId);
          });
        },
        dispose() { disposed = true; generation++; pano.setVisible(false); release(pano); dom.clear(); recovered(surfaceId); },
      };
    },
    map(slot) {
      const dom = mount(slot);
      const map = construct(dom, () => new maps.Map(dom.canvas, { center: { lat: 0, lng: 0 }, zoom: 1, minZoom: 1, maxZoom: 18,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'none', keyboardShortcuts: false,
        streetViewControl: false, mapTypeControl: false, fullscreenControl: false, tilt: 0 }));
      dom.status.hidden = true;
      let previous = ''; let fit = ''; let visible = false; let disposed = false;
      const overlays: (google.maps.Marker | google.maps.Polyline)[] = [];
      function clearOverlays() { overlays.splice(0).forEach(item => { item.setMap(null); release(item); }); }
      return {
        render(frame) {
          if (disposed) return;
          dom.host.style.visibility = frame.visible ? 'visible' : 'hidden';
          dom.host.dataset.inactive = String(frame.inactive ?? false);
          const bounds = JSON.stringify(frame.bounds);
          if (frame.visible && (!visible || bounds !== fit)) {
            maps.event.trigger(map, 'resize');
            if (frame.bounds) map.fitBounds(frame.bounds, slot === 'results-map' ? 45 : 0);
            else { map.setCenter({ lat: 0, lng: 0 }); map.setZoom(1); }
            fit = bounds;
          }
          visible = frame.visible;
          const content = JSON.stringify([frame.pins, frame.lines]);
          if (content === previous) return;
          previous = content; clearOverlays();
          for (const pin of frame.pins) overlays.push(new maps.Marker({ map, position: pin.point, title: pin.label,
            clickable: false, icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: pin.color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } }));
          for (const line of frame.lines) overlays.push(new maps.Polyline({ map, path: [line.from, line.to], geodesic: true,
            clickable: false, strokeColor: line.color, strokeOpacity: 0.9, strokeWeight: 3 }));
        },
        dispose() { disposed = true; clearOverlays(); release(map); dom.clear(); },
      };
    },
  };
}

export async function createGoogleRenderer(root: HTMLElement, apiKey: string, onError: (message: string) => void, onRecovery: () => void = () => {}): Promise<GameRenderer> {
  if (!apiKey.trim()) { const message = 'Google Maps browser key missing'; onError(message); throw new Error(message); }
  let maps: typeof google.maps;
  try { maps = await loadGoogle(apiKey); }
  catch { const message = 'Google Maps API unavailable'; onError(message); throw new Error(message); }
  let otherFailure = false;
  const renderer = createRenderer(googleAdapter(root, maps, onError, () => { if (!otherFailure) onRecovery(); }), message => { otherFailure = true; onError(message); });
  const failure = () => { otherFailure = true; renderer.dispose(); onError('Google Maps API unavailable'); };
  authFailures.add(failure);
  return { render: frame => renderer.render(frame), dispose() { authFailures.delete(failure); renderer.dispose(); } };
}
