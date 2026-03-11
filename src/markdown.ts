import type { ParsedNote, AttributeRun } from './proto-parser';

const ATTACHMENT_CHAR = '\uFFFC';

interface LineStyle {
  styleType: number;
  indentAmount: number;
  blockQuote: number;
  checklistDone: boolean;
}

function getStyle(run: AttributeRun): LineStyle | null {
  if (!run.paragraphStyle) return null;
  return {
    styleType: run.paragraphStyle.styleType,
    indentAmount: run.paragraphStyle.indentAmount ?? 0,
    blockQuote: run.paragraphStyle.blockQuote ?? 0,
    checklistDone: run.paragraphStyle.checklist?.done === 1,
  };
}

function formatLine(line: string, style: LineStyle | null): string {
  if (!line && !style) return '';
  if (!line) return '';

  let prefix = '';
  let indent = '';

  if (style) {
    indent = ' '.repeat(style.indentAmount * 2);

    if (style.blockQuote > 0) {
      prefix = '> ';
    }

    switch (style.styleType) {
      case 0:
        prefix += '# ';
        break;
      case 1:
        prefix += '## ';
        break;
      case 2:
        prefix += '### ';
        break;
      case 4:
        prefix += '`';
        return indent + prefix + line + '`';
      case 100:
        prefix += '- ';
        break;
      case 101:
        prefix += '- ';
        break;
      case 102:
        prefix += '1. ';
        break;
      case 103:
        prefix += style.checklistDone ? '- [x] ' : '- [ ] ';
        break;
    }
  }

  return indent + prefix + line;
}

export function convertToMarkdown(parsed: ParsedNote): string {
  const { noteText, attributeRuns } = parsed;
  const chars = Array.from(noteText);
  let pos = 0;

  // Build segments: (text, run)
  const segments: { text: string; run: AttributeRun }[] = [];
  for (const run of attributeRuns) {
    const segChars = chars.slice(pos, pos + run.length);
    pos += run.length;
    const text = segChars.join('');
    // Skip attachment characters
    if (text === ATTACHMENT_CHAR) continue;
    segments.push({ text, run });
  }

  let currentLine = '';
  let currentStyle: LineStyle | null = null;
  let result = '';

  for (const { text, run } of segments) {
    if (run.paragraphStyle && currentStyle === null) {
      currentStyle = getStyle(run);
    }

    for (const ch of text) {
      if (ch === '\n') {
        result += formatLine(currentLine, currentStyle) + '\n';
        currentLine = '';
        currentStyle = null;
      } else {
        currentLine += ch;
      }
    }
  }

  if (currentLine) {
    result += formatLine(currentLine, currentStyle);
  }

  return result;
}
