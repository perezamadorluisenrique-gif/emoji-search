export interface Pos {
  line: number;
  ch: number;
}
export interface Range {
  from: Pos;
  to: Pos;
}
export interface Change {
  from: Pos;
  to: Pos;
  text: string;
}

const cmp = (a: Pos, b: Pos) => a.line - b.line || a.ch - b.ch;

/**
 * One insertion per selection, for a single editor transaction: `changes` are in
 * the coordinates of the document before the edit, `selections` (a caret after
 * each inserted text) in those after it. Selections that overlap or touch are merged
 * first, so two carets at the same spot insert once.
 */
export function planInsert(selections: Range[], text: string): { changes: Change[]; selections: Range[] } {
  const sorted = selections
    .map((s) => (cmp(s.from, s.to) <= 0 ? s : { from: s.to, to: s.from }))
    .sort((a, b) => cmp(a.from, b.from));
  const merged: Range[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && cmp(s.from, last.to) <= 0) {
      if (cmp(s.to, last.to) > 0) last.to = s.to;
    } else merged.push({ from: { ...s.from }, to: { ...s.to } });
  }

  const changes: Change[] = [];
  const carets: Range[] = [];
  const lines = text.split('\n');
  const addedLines = lines.length - 1;
  // After an edit, positions on the line where it ended move: `endLine` (original) now
  // starts at `shiftFrom` characters further along; every later line moves up or down.
  let lineDelta = 0;
  let endLine = -1;
  let chShift = 0;
  for (const r of merged) {
    changes.push({ from: r.from, to: r.to, text });
    const newLine = r.from.line + lineDelta;
    const newCh = r.from.ch + (r.from.line === endLine ? chShift : 0);
    const caret = {
      line: newLine + addedLines,
      ch: addedLines === 0 ? newCh + text.length : lines[addedLines].length,
    };
    carets.push({ from: caret, to: caret });
    lineDelta += addedLines - (r.to.line - r.from.line);
    endLine = r.to.line;
    chShift = caret.ch - r.to.ch;
  }
  return { changes, selections: carets };
}
