# Caster nameplates

In **Config → Caster Nameplates**, choose **Stream** or **English**. Each left,
right, and center card has X/Y sliders, exact pixel inputs, and **Reset position**.
Values are offsets from the existing layout at 1920 × 1080: positive X moves right,
positive Y moves down, and zero restores the original position. English output
scales the offsets with the cards at 4K. Existing saved cards keep their positions.

The panel shows the selected output's Preview. Select a caster and enable its
card in the Stream or English switcher's **Casters** row to see it. Position edits
stage in Preview; **TAKE output preview** publishes all staged layers for that
output. **Revert output preview** restores all staged layers from Program. The
same TAKE/Revert controls in the switcher also work. Settings persist with the
broadcast state; Stream and English settings are independent.

To show someone outside the caster sheet, select **Custom name (name only)**
in any of the three caster dropdowns, enter a name in the field that appears,
and enable that card. Custom cards use the existing name band and animation,
with no role or handle. A blank custom name hides the card. Switching back to a
sheet caster restores the usual role/name/handle card. Custom text and sheet
selections are stored separately, and all content changes wait for TAKE.

After building, restart NodeCG to register the Config panel, then refresh the
dashboard and affected OBS browser sources.
