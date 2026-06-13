export interface UxControlCandidate {
  readonly index: number;
  readonly kind: "input" | "select";
  readonly fragment: string;
  readonly label?: string;
}

function labelBlockText(block: string): string | undefined {
  return block.match(/<label[^>]*>\s*([^<]+)/)?.[1]?.trim();
}

export function controlCandidates(line: string): readonly UxControlCandidate[] {
  const candidates: UxControlCandidate[] = [];
  const ranges: Array<readonly [number, number]> = [];
  const control = /<(input|select)\b[^>]*(?:>.*?<\/select>)?|<(DatePicker|TextField|ComboBox)\b[^>]*/g;
  for (const block of line.matchAll(/<label[^>]*>.*?<\/label>/g)) {
    const start = block.index ?? 0;
    const hit = control.exec(block[0]);
    control.lastIndex = 0;
    if (!hit) continue;
    const index = start + (hit.index ?? 0);
    ranges.push([start, start + block[0].length]);
    candidates.push({ index, kind: hit[1] === "select" ? "select" : "input", fragment: hit[0], label: labelBlockText(block[0]) });
  }
  for (const hit of line.matchAll(control)) {
    const index = hit.index ?? 0;
    if (ranges.some(([start, end]) => index >= start && index < end)) continue;
    candidates.push({ index, kind: hit[1] === "select" ? "select" : "input", fragment: hit[0] });
  }
  return candidates.sort((left, right) => left.index - right.index);
}
