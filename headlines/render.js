export async function loadHeadlines() {
  const response = await fetch("/data/headlines.json", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Headlines file returned ${response.status}`);
  return response.json();
}

function utcDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0)));
}

export function formatDay(iso) {
  const date = utcDate(iso);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatStamp(iso) {
  const date = utcDate(iso);
  if (!date) return "";
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
  return `${formatDay(iso)}, ${clock}`;
}

export function keepLastToken(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const match = value.match(/^(.*\S)\s+(\S{1,12})$/);
  return match ? `${match[1]}\u00a0${match[2]}` : value;
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

export const TWEET_RENDER_MS = 7000;
const TWEET_ROOT_MARGIN = 200;
const TWEET_MIN_HEIGHT = 160;

export function loadTwitterWidgets() {
  if (twitterLoader) return twitterLoader;
  twitterLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("widgets.js failed"));
    document.body.append(script);
  });
  twitterLoader.catch(() => {});
  return twitterLoader;
}

export function xStatusUrl(item) {
  const href = String(item?.source_url || "");
  return /\/status\/\d+/.test(href) ? href : "";
}

export function tweetAuthor(item) {
  const match = xStatusUrl(item).match(/\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/\d+/i);
  return match ? `@${match[1]}` : "";
}

export function tweetFallbackText(item) {
  return String(item?.blurb || item?.headline || "").replace(/\s+/g, " ").trim();
}

function fallbackCard(item, tag = "div") {
  const href = xStatusUrl(item) || String(item?.source_url || "");
  const children = [];
  const author = tweetAuthor(item) || String(item?.author || "");
  if (author) children.push(el("p", { class: "tweet-author", text: author }));
  const text = tweetFallbackText(item);
  if (text) children.push(el("p", { class: "tweet-text", text }));
  if (href) children.push(el("a", { class: "tweet-open", href, text: "View on X", rel: "noopener noreferrer" }));
  return el(tag, { class: "tweet-card" }, children);
}

function showFallback(slot) {
  const frame = slot.querySelector("iframe");
  if (frame && frame.getBoundingClientRect().height < TWEET_MIN_HEIGHT) frame.remove();
  let card = slot.querySelector(".tweet-card");
  if (!card) {
    card = fallbackCard({ source_url: slot.dataset.href, blurb: slot.dataset.text, author: slot.dataset.author });
    slot.prepend(card);
  }
  card.hidden = false;
}

function embedRendered(slot) {
  const frame = slot.querySelector("iframe");
  return !!frame && frame.getBoundingClientRect().height >= TWEET_MIN_HEIGHT;
}

function renderTweetSlot(slot) {
  if (slot.dataset.loading === "1") return;
  slot.dataset.loading = "1";
  const started = Date.now();
  let fellBack = false;
  const timer = setInterval(() => {
    if (embedRendered(slot)) {
      clearInterval(timer);
      const card = slot.querySelector(".tweet-card");
      const frame = slot.querySelector("iframe");
      if (card && frame && !card.contains(frame)) card.hidden = true;
      return;
    }
    const elapsed = Date.now() - started;
    if (!fellBack && elapsed >= TWEET_RENDER_MS) {
      fellBack = true;
      showFallback(slot);
    }
    if (elapsed >= TWEET_RENDER_MS * 2) clearInterval(timer);
  }, 250);
  loadTwitterWidgets().then(() => {
    const twttr = window.twttr;
    const paint = () => {
      if (twttr?.widgets?.load) twttr.widgets.load(slot);
      else showFallback(slot);
    };
    if (typeof twttr?.ready === "function") twttr.ready(paint);
    else paint();
  }).catch(() => showFallback(slot));
}

function nearViewport(slot) {
  const rect = slot.getBoundingClientRect();
  if (rect.height < 1) return false;
  const view = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.bottom >= -TWEET_ROOT_MARGIN && rect.top <= view + TWEET_ROOT_MARGIN;
}

export function watchTweetSlots(root = document) {
  const slots = [...root.querySelectorAll(".tweet-slot")];
  if (!slots.length) return;
  if (typeof IntersectionObserver !== "function") {
    for (const slot of slots) {
      const button = el("button", { type: "button", class: "show-post", text: "Show post" });
      button.addEventListener("click", () => renderTweetSlot(slot));
      slot.prepend(button);
    }
    return;
  }
  const pending = new Set(slots);
  const start = (slot) => {
    if (!pending.has(slot)) return;
    pending.delete(slot);
    renderTweetSlot(slot);
    if (!pending.size) stop();
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.boundingClientRect.height < 1) continue;
      observer.unobserve(entry.target);
      start(entry.target);
    }
  }, { rootMargin: "200px" });
  const onScroll = () => {
    for (const slot of pending) {
      if (nearViewport(slot)) start(slot);
    }
  };
  const stop = () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  for (const slot of slots) {
    observer.observe(slot);
    if (nearViewport(slot)) start(slot);
  }
}

export function tweetEmbed(item) {
  const href = xStatusUrl(item);
  if (!href) return null;
  const quote = fallbackCard(item, "blockquote");
  quote.classList.add("twitter-tweet");
  return el("div", {
    class: "tweet-slot",
    "data-href": href,
    "data-author": tweetAuthor(item),
    "data-text": tweetFallbackText(item),
  }, [quote]);
}
