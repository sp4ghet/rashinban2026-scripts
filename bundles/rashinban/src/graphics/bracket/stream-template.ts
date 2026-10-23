// Stream artwork matches the designer's 1920x1080 tournament reference.
// Match boxes, connectors and the championship label position are data-driven.
export const STREAM_BRACKET_SVG = `<svg id="bracket" class="bracket-svg" viewBox="0 0 1920 1080"
  xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Finals bracket">
  <defs>
    <linearGradient id="bracket-upper-ink">
      <stop stop-color="#ff0000"/><stop offset="1" stop-color="#ff0000" stop-opacity=".25"/>
    </linearGradient>
    <linearGradient id="bracket-lower-ink">
      <stop stop-color="#3300ff"/><stop offset="1" stop-color="#3300ff" stop-opacity=".25"/>
    </linearGradient>
  </defs>
  <text class="bracket-band-label" x="76" y="390" fill="url(#bracket-upper-ink)">UPPER</text>
  <text class="bracket-band-label" x="52" y="930" fill="url(#bracket-lower-ink)">LOWER</text>
  <text class="bracket-riser-label" x="1509" y="461">LOWER FINAL WINNER</text>
  <text class="bracket-champion" x="1409.5" y="232">CHAMPION</text>
  <g id="bracket-lines"></g>
  <g id="bracket-matches"></g>
</svg>`;
