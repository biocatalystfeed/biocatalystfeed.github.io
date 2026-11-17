export async function loadHeadlines() {
  const response = await fetch("/data/headlines.json", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Headlines file returned ${response.status}`);
  return response.json();
}

export function formatDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function itemLink(item, className) {
  return el("a", {
    href: item.source_url,
    class: className || "",
    text: item.headline,
    rel: "noopener noreferrer",
  });
}

export function sourceLine(item) {
  const when = formatDay(item.published_at) || item.published_at;
  return el("p", { class: "meta", text: `${item.source_name} · ${when}` });
}
