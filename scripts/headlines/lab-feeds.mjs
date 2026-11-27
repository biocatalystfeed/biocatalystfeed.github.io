import { rssEntries, isoFromRfc822, preferHttps, safeItems, offTopicText, condenseFact, sentenceCase, stripVenue } from "./copy.mjs";
import { addDays } from "./text.mjs";

export const BIO_TOPIC = /genom|protein|\bdrug|\bdna\b|\brna\b|\bcells?\b|disease|molecul|chemist|cheminform|antibod|vaccin|therap|clinical|pharma|\bcancer\b|virus|peptide|\bfold|alzheimer|diabet|obes|hepatitis|wet-lab|\bhealth(?:care)?\b|medical|\bpatients?\b|\bmedicin|neuralink|brain-computer interface|\bBCI\b|telepathy|blindsight|neural implant/i;
const ADMIN = /\b(outage|services during|office closure|vacancy|recruitment)\b/i;

export const LAB_FEEDS = [
  {
    id: "deepmind",
    name: "Google DeepMind",
    url: "https://deepmind.google/blog/rss.xml",
    source_type: "news",
    rule: "ai-news",
    keywords: BIO_TOPIC,
    note: "Official DeepMind blog RSS. robots.txt allows /. We store the title, link, date, and a one-sentence blurb, not the post.",
  },
  {
    id: "openai-news",
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    source_type: "news",
    rule: "ai-news",
    keywords: BIO_TOPIC,
    note: "Official OpenAI news RSS. robots.txt allows /. Filtered to biology, health, drug, genome, protein, or clinical posts. Title, link, date, and a short blurb only.",
  },
  {
    id: "nvidia-blog",
    name: "NVIDIA Blog",
    url: "https://blogs.nvidia.com/feed/",
    source_type: "news",
    rule: "ai-news",
    keywords: BIO_TOPIC,
    note: "Official NVIDIA blog RSS. The healthcare category feed returned 404, so this feed is filtered to bio and health posts. robots.txt allows /feed/.",
  },
  {
    id: "mhra",
    name: "UK MHRA",
    url: "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=medicines-and-healthcare-products-regulatory-agency",
    source_type: "regulator",
    rule: "mhra-news",
    keywords: null,
    note: "GOV.UK atom feed for MHRA. Content is under the Open Government Licence. robots.txt does not disallow this atom path. Title, link, date, and a short blurb only.",
  },
];

function ownBlurb(entry) {
  const headline = sentenceCase(stripVenue(entry.title || ""));
  return condenseFact(entry.description, headline) || "Details are in the linked post.";
}

export function feedItems(entries, today, feed) {
  const from = addDays(today, -45);
  const rows = [];
  for (const entry of entries) {
    const published = isoFromRfc822(entry.date) || String(entry.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(published) || published < from || published > today) continue;
    const title = String(entry.title || "").replace(/\s+/g, " ").trim();
    if (!title || /^google deepmind news$/i.test(title) || /^openai news$/i.test(title) || /^nvidia blog$/i.test(title)) continue;
    if (offTopicText(`${title} ${entry.description || ""}`) || ADMIN.test(title)) continue;
    if (feed.keywords && !feed.keywords.test(title)) continue;
    const adjustments = [];
    if (/\bfirst\b/i.test(title)) adjustments.push("source-first");
    if (feed.rule === "ai-news" && /\b(model|alpha|genome|protein|fold)\b/i.test(title)) adjustments.push("ai-biology-release");
    rows.push({
      id: `${feed.id}:${entry.link || title}`,
      headline: title,
      blurb: ownBlurb(entry),
      source_url: preferHttps(entry.link),
      source_type: feed.source_type,
      source_name: feed.name,
      published_at: published,
      scout_source: feed.id,
      rule: feed.rule,
      adjustments,
      dedupe_key: `${feed.id}:${title.toLowerCase()}`,
    });
  }
  return safeItems(rows);
}

export function labFeedSources() {
  return LAB_FEEDS.map((feed) => ({
    id: feed.id,
    enabled: true,
    async fetch(ctx) {
      const buf = await ctx.polite.getBuffer(feed.url, { timeout: 45000 });
      if (!buf) throw new Error(`${feed.name} feed was not available`);
      const text = buf.toString("utf8");
      if (!/<rss|<feed|<item|<entry/i.test(text)) throw new Error(`${feed.name} did not return a feed`);
      return { items: feedItems(rssEntries(text), ctx.today, feed), note: feed.note };
    },
  }));
}
