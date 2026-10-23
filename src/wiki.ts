interface WikiTemplate {
  raw: string;
  fields: Map<string, string>;
}

// Split only top-level parameters, never pipes inside nested templates or links.
export function findTemplate(text: string, name: string): WikiTemplate | null {
  const match = new RegExp(`\\{\\{\\s*${name}\\s*(?=\\||\\r?\\n)`, 'i').exec(text);
  if (!match) return null;
  let depth = 1, links = 0, part = match.index + 2;
  const parts: string[] = [];
  for (let i = part; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') { depth++; i++; }
    else if (pair === '}}') {
      depth--; i++;
      if (depth === 0) {
        parts.push(text.slice(part, i - 1));
        const fields = new Map<string, string>();
        for (const value of parts.slice(1)) {
          const equals = value.indexOf('=');
          if (equals < 0) continue;
          const key = value.slice(0, equals).trim().toLowerCase();
          if (fields.has(key)) return null;
          fields.set(key, value.slice(equals + 1).trim());
        }
        return { raw: text.slice(match.index, i + 1), fields };
      }
    } else if (pair === '[[') { links++; i++; }
    else if (pair === ']]') { links--; i++; }
    else if (text[i] === '|' && depth === 1 && links === 0) {
      parts.push(text.slice(part, i)); part = i + 1;
    }
  }
  return null;
}
