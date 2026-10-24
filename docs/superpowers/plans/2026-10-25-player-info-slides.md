# Player info slides implementation plan

Implement the supplied two-page Top 8 introduction design in the existing NodeCG graphics.

1. Add a hidden-by-default player-info layer to Stream and EN with stable player identity, results/profile page and independent Preview/TAKE state. Add the Stream row immediately after Slides. Make Day 2 opening cue 24 enable this layer and the next cue disable it, matching bracket behavior.
2. Build a pure data model using shared player sheets, English identity-based translations and start.gg Day 1 groups. Include group placement, completed set/game records and opponent scores, excluding Day 2, byes and incomplete results. Never infer unresolved standings.
3. Register a NodeCG image asset category. Match uploaded blank artwork by player tag/UID/entrant ID, with optional page-specific photos and one-photo fallback. Preserve the supplied full-frame image and overlay text in its red panel.
4. Mount the graphic in info-stream and a separate player-info-en source; add EN monitor selection. Match Kaneda typography and supplied proportions at 1920x1080; fit long text without clipping.
5. Test reducers/data calculations, run typecheck/full suite/build, exercise both built sources and switcher in isolated browser fixtures, inspect screenshots, and document upload naming and operation. Keep production runtime state untouched.

The user supplied the design and control behavior. Use the existing sheet/start.gg integration and asset uploader, without introducing another data-entry workflow. One image can serve both pages; named results/profile variants can override it.
