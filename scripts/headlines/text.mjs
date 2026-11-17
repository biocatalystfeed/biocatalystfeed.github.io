const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const BANNED = [
  /\bcures?\b/i,
  /\bbreakthrough\b/i,
  /\bgame[- ]?chang/i,
  /\brevolutionary\b/i,
  /\bpromising\b/i,
  /\bmiracle\b/i,
  /\bfirst[- ]in[- ]class\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\blife[- ]saving\b/i,
  /\bsuperior to\b/i,
  /\bhighly effective\b/i,
];

export function isoFromYmd(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || "").trim());
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function isoFromUs(value) {
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(String(value || "").trim());
  if (!m) return "";
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return "";
  const day = Number(m[2]);
  if (day < 1 || day > 31) return "";
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoFromDmy(value) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(value || ""));
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function isoFromMdy(value) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(value || ""));
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function titleCaseCaps(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

export function factualViolation(value) {
  const text = String(value || "");
  for (const re of BANNED) if (re.test(text)) return re.source;
  return "";
}

export function assertFactual(value, label) {
  const hit = factualViolation(value);
  if (hit) throw new Error(`${label} matched ${hit}`);
}

export function httpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (!url.hostname || url.hostname === "example.com" || url.hostname.endsWith(".example")) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export function addDays(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return t.toISOString().slice(0, 10);
}
