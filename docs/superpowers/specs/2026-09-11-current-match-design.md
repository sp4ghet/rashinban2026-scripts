# Unified current match

Approved in conversation on 2026-09-11, including player dropdown labels such as
`Eurya (65fc3453702bba73b4c0a398)` and an upcoming start.gg matches table below
the selector.

One persisted current match owns the two competitors, their GeoGuessr UIDs,
display overrides, series wins, and match label. start.gg imports are explicit
snapshots; polling must not replace the selected match. Google Sheets supplies
profiles, joined by `geoguessr_player_uid`, with unique entrant ID/tag fallback
for legacy rows. Ambiguous identities are reported instead of picked arbitrarily.

A Current Match dashboard contains two player dropdowns, manual name/UID entry,
display overrides, wins, label, Apply and Swap. Below it is the upcoming matches
table with Load actions. Source configuration is kept in collapsible sections.
Other dashboards retain their overlay controls and show the shared identities.
Presenter maps venue game accounts independently of personal profile UIDs, with
left-blue/right-red defaults and explicit account overrides. Player Cards uses the resolved sheet profile.
Ban & Pick uses the same left/right names for A/B. Swapping moves the entire
competitor, including wins. The operator must reset an in-progress ban/pick draft
before replacing its participants or swapping sides, preserving the rulebook's
fixed A/B turn order.

Sheet refreshes update profile details while retaining explicit display overrides.
Missing personal UIDs remain usable for manual labels and team-based live mapping.
Registration URLs will be read only if the configured start.gg API exposes them;
the system must remain usable with spreadsheet/manual UIDs if unavailable.

Validation covers UID parsing, unique profile matching, immutable imports,
side swaps, migration, shared publication, and dashboard interactions. Existing
presenter scoring and timing behavior is preserved.
