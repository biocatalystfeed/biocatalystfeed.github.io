const DROP = new Set([
  "background treatment",
  "background chemotherapy",
  "best available therapy",
  "matching dosage",
  "na therapy",
  "standard treatment",
  "supportive care measures",
  "standard lymphodepletion",
  "chemotherapy drug",
  "silodosin control",
  "placebo",
  "comparator",
  "control",
  "vehicle",
]);

const STOP = new Set([
  "immune", "combinations", "combination", "lotion", "suspension", "ophthalmic",
  "preservative", "free", "unit", "attenuated", "live", "qw", "cold", "fever",
  "symptom", "symptoms", "multi-symptom", "freeze-dried", "freeze", "dried",
]);

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function spaces(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripUnbalanced(value) {
  const pairs = { "(": ")", "[": "]", "{": "}", "（": "）" };
  const openerFor = Object.fromEntries(Object.entries(pairs).map(([open, close]) => [close, open]));
  const chars = [...value];
  const stack = [];
  const drop = new Set();
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (pairs[char]) stack.push({ char, i });
    else if (openerFor[char]) {
      if (stack.length && stack[stack.length - 1].char === openerFor[char]) stack.pop();
      else drop.add(i);
    }
  }
  for (const item of stack) drop.add(item.i);
  return spaces(chars.filter((_, i) => !drop.has(i)).join("").replace(/\s+([,.;])/g, "$1"));
}

function stripAffixes(value) {
  let name = spaces(value);
  let previous;
  do {
    previous = name;
    name = name.replace(/^drug:\s*/i, "");
    name = name.replace(/^(?:experimental|investigational)\s+drug\s*,?\s*/i, "");
    name = name.replace(/\s*-\s*study$/i, "");
    name = name.replace(/\s+study drug$/i, "");
    name = name.replace(/\s+drug product$/i, "");
    name = name.replace(/\s+drug$/i, "");
    name = spaces(name);
  } while (name !== previous);
  return name;
}

export function isPlaceholderDrug(value) {
  const name = spaces(decode(value)).toLowerCase();
  if (!name) return true;
  if (DROP.has(name)) return true;
  if (/^test drug\b/.test(name)) return true;
  if (/^(?:placebo|comparator|control|vehicle)\b/.test(name)) return true;
  return false;
}

function drugAtom(value) {
  const name = spaces(value);
  if (name.length < 2 || !/[A-Za-z]/.test(name)) return false;
  if (/%/.test(name)) return false;
  const words = name.toLowerCase().split(" ");
  if (words.length > 4) return false;
  if (words.some((word) => STOP.has(word))) return false;
  return true;
}

function splitPacked(value) {
  const parts = [];
  let buffer = "";
  let depth = 0;
  const mark = (open) => "([（".includes(open);
  const unmark = (close) => ")]）".includes(close);
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (mark(char)) depth += 1;
    else if (unmark(char) && depth) depth -= 1;
    if (depth === 0) {
      const rest = value.slice(i);
      const lower = rest.toLowerCase();
      let size = 0;
      if (lower.startsWith(" or ")) size = 4;
      else if (lower.startsWith(" and ")) size = 5;
      else if (rest.startsWith(" & ") || rest.startsWith("&")) size = rest.startsWith(" & ") ? 3 : 1;
      else if (rest.startsWith(",")) size = 1;
      if (size) {
        parts.push(buffer);
        buffer = "";
        i += size - 1;
        continue;
      }
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map((part) => spaces(part.replace(/^[,]+|[,]+$/g, ""))).filter(Boolean);
}

function oneName(value) {
  let name = stripAffixes(decode(value));
  name = stripUnbalanced(name);
  name = stripAffixes(name);
  name = name.replace(/^.*\bchemotherapy:\s*/i, (prefix) => (/chemotherapy:\s*/i.test(prefix) ? "" : prefix));
  name = name.replace(/([^\s([{])\(/g, "$1 (");
  name = name.replace(/\(\s+/g, "(");
  name = name.replace(/\s+\)/g, ")");
  name = spaces(name);
  return isPlaceholderDrug(name) ? "" : name;
}

export function cleanDrugNames(value) {
  const raw = spaces(decode(value).replace(/（/g, "(").replace(/）/g, ")"));
  if (!raw || isPlaceholderDrug(raw)) return [];
  const pieces = splitPacked(raw);
  if (pieces.length === 1) {
    const name = oneName(pieces[0]);
    return name ? [name] : [];
  }
  const packedWithOr = /\s+or\s+/i.test(raw);
  const cleaned = pieces.map(oneName).filter(Boolean);
  const atoms = cleaned.length === pieces.length && cleaned.every(drugAtom);
  if (atoms) return cleaned;
  if (packedWithOr) return [];
  const whole = oneName(raw);
  return whole ? [whole] : [];
}

export function tidyDrugLists(html) {
  return String(html || "").replace(/Drugs:[\s\S]*?<\/p>/g, (list) => list
    .replace(/,\s*,/g, ",")
    .replace(/Drugs:\s*,/g, "Drugs:")
    .replace(/,\s*\./g, "."));
}

export function drugSlug(name) {
  return spaces(decode(name))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
