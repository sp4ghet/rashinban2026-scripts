import type { Round } from '../../types/presenter.ts';

/** Derive the dial from the same server deadline as the digits, including first-guess shortening. */
export function timerPresentation(remainingMs: number | null, round?: Round, style: 'radial' | 'pill' = 'radial') {
  const remaining = Math.max(0, remainingMs ?? 0);
  const seconds = Math.ceil(remaining / 1000);
  const start = round?.timerStartAtMs ?? round?.startAtMs;
  const duration = round?.endAtMs != null && start != null ? Math.max(1, round.endAtMs - start) : 60000;
  const critical = remainingMs !== null && seconds <= 15;
  return {
    text: style === 'pill' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
      : seconds <= 60 ? String(seconds) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    long: seconds > 60, critical,
    dial: remainingMs !== null && !critical && remaining < duration,
    sweep: 360 * Math.min(1, remaining / duration),
  };
}

export function paintTimer(root: HTMLElement, remainingMs: number | null, round?: Round): void {
  const timer = root.querySelector<HTMLElement>('#timer')!;
  const value = root.querySelector<HTMLElement>('#timer-value')!;
  const face = timerPresentation(remainingMs, round, 'pill');
  timer.hidden = remainingMs === null;
  timer.classList.toggle('critical', face.critical);
  timer.classList.toggle('long', face.long);
  timer.classList.toggle('with-dial', face.dial);
  timer.style.setProperty('--timer-sweep', `${face.sweep}deg`);
  // The SVG path starts at twelve o'clock and travels clockwise. A negative
  // offset erases its elapsed portion; the last half-second fades out cleanly.
  timer.style.setProperty('--timer-offset', String(-(100 - face.sweep / 3.6)));
  timer.style.setProperty('--timer-opacity', String(Math.max(0, Math.min(1, (remainingMs ?? 0) / 500))));
  if (value.textContent !== face.text) value.textContent = face.text;
}
