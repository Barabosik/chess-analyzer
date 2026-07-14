// The classification marks, drawn as SVG instead of font glyphs.
//
// They used to be text (★ ✓ • ◇ !! ?!) centred with flexbox — but each of those
// characters comes from whatever fallback font happens to supply it, and every font
// puts them at a different place in the em box. The star sat low, the diamond high,
// the exclamation marks thin and off-centre, and no amount of line-height fixes a
// glyph that is simply drawn off-middle in its own font. Drawing them ourselves puts
// every mark dead-centre in the same 24×24 box, everywhere, on every platform — and
// lets the ! and !! be as fat as they deserve to be.
//
// The move LIST keeps text glyphs (they sit inline with text, aligned by baseline);
// these are for the boxed badges: board, breakdown, legend, coach card, flourish.

// A question mark and an exclamation mark, both centred on (12,12) in a 24×24 box.
const Q =
  '<path d="M7.9 8.6C7.9 3.7 16.1 3.7 16.1 8.8C16.1 12.4 12.1 12.2 12.1 15.4" ' +
  'fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>' +
  '<circle cx="12.1" cy="20" r="2.3"/>';
const BANG =
  '<rect x="10.1" y="3.2" width="3.8" height="12" rx="1.9"/>' +
  '<circle cx="12" cy="19.9" r="2.4"/>';

// Scale-and-place a 24×24 glyph so its centre lands on (cx, 12).
const at = (inner, cx, s) =>
  '<g transform="translate(' + (cx - 12 * s) + ' ' + (12 - 12 * s) + ') scale(' + s + ')">' +
  inner + "</g>";

const MARKS = {
  brilliant: at(BANG, 7.4, 0.92) + at(BANG, 16.6, 0.92),
  great: BANG,
  best:
    '<polygon points="12,2.8 14.59,9.04 21.32,9.57 16.18,13.96 17.76,20.53 ' +
    '12,17 6.24,20.53 7.82,13.96 2.68,9.57 9.41,9.04"/>',
  excellent:
    '<polyline points="5.2,13.2 9.9,17.8 18.8,6.8" fill="none" stroke="currentColor" ' +
    'stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>',
  good: '<circle cx="12" cy="12" r="4.8"/>',
  book:
    '<path d="M12 4.4L19.6 12L12 19.6L4.4 12Z" fill="none" stroke="currentColor" ' +
    'stroke-width="2.8" stroke-linejoin="round"/>',
  inaccuracy: at(Q, 7.2, 0.82) + at(BANG, 16.8, 0.82),
  mistake: Q,
  blunder: at(Q, 7.2, 0.82) + at(Q, 16.8, 0.82),
};

// Inline SVG for a class id ("brilliant"…"blunder"). Inherits currentColor, so the
// container's `color` paints it — the boxes set color:#fff and stay in charge.
export function glyphSvg(cls) {
  const inner = MARKS[cls];
  if (!inner) return "";
  return '<svg class="clsglyph" viewBox="0 0 24 24" fill="currentColor" ' +
    'aria-hidden="true" focusable="false">' + inner + "</svg>";
}
