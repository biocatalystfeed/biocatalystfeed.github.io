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

export function figureFor(item) {
  const image = item?.image;
  if (!image?.src || !image.alt) return null;
  const img = el("img", {
    src: image.src,
    alt: image.alt,
    width: String(image.width || 480),
    height: String(image.height || 270),
    loading: "lazy",
  });
  const caption = el("figcaption", { class: "credit" });
  caption.append(`${image.credit || ""}. `);
  if (image.basisUrl) caption.append(el("a", { href: image.basisUrl, text: image.licence || "licence", rel: "noopener noreferrer" }));
  if (image.sourcePage) {
    caption.append(" · ");
    caption.append(el("a", { href: image.sourcePage, text: "File page", rel: "noopener noreferrer" }));
  }
  return el("figure", { class: "shot" }, [img, caption]);
}

let twitterLoader = null;

export function loadTwitterWidgets() {
  if (twitterLoader) return twitterLoader;
  twitterLoader = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onload = () => resolve();
    document.body.append(script);
  });
  return twitterLoader;
}

export function xStatusUrl(item) {
  const href = String(item?.source_url || "");
  return /\/status\/\d+/.test(href) ? href : "";
}

function renderTweetSlot(slot) {
  loadTwitterWidgets().then(() => {
    if (window.twttr?.widgets) window.twttr.widgets.load(slot);
  });
}

export function watchTweetSlots(root = document) {
  const slots = [...root.querySelectorAll(".tweet-slot")];
  if (!slots.length) return;
  if (typeof IntersectionObserver !== "function") {
    for (const slot of slots) {
      const button = el("button", { type: "button", class: "show-post", text: "Show post" });
      button.addEventListener("click", () => {
        button.hidden = true;
        renderTweetSlot(slot);
      });
      slot.prepend(button);
    }
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      renderTweetSlot(entry.target);
    }
  }, { rootMargin: "200px" });
  for (const slot of slots) observer.observe(slot);
}

export function tweetEmbed(item) {
  const href = xStatusUrl(item);
  if (!href) return null;
  const quote = el("blockquote", { class: "twitter-tweet" });
  quote.append(el("a", { href, text: href, rel: "noopener noreferrer" }));
  return el("div", { class: "tweet-slot" }, [quote]);
}
