import { el, figureFor, formatDay, itemLink, loadHeadlines, sourceLine, tweetEmbed, watchTweetSlots } from "./render.js";
import { mountSearch } from "./search.js";

const main = document.querySelector("#main");
const dateline = document.querySelector("#dateline");

function article(item) {
  const nodes = [];
  const shot = figureFor(item);
  if (shot) nodes.push(shot);
  nodes.push(itemLink(item, "hed"));
  const post = tweetEmbed(item);
  if (post) nodes.push(post);
  if (item.blurb) nodes.push(el("p", { class: "blurb", text: item.blurb }));
  nodes.push(sourceLine(item));
  return el("article", { class: `item tier-${item.tier || 1}` }, nodes);
}

function footerNotes(data) {
  const live = (data.sources || []).filter((source) => source.enabled && source.status === "ok").map((source) => source.id);
  const disabled = (data.sources || []).filter((source) => !source.enabled).map((source) => source.id);
  const failed = (data.sources || []).filter((source) => source.enabled && source.status !== "ok");
  const bits = [
    live.length ? `Live this run: ${live.join(", ")}.` : "",
    disabled.length ? `Disabled: ${disabled.join(", ")}.` : "",
    failed.length ? `Not fetched: ${failed.map((source) => `${source.id} (${source.note})`).join(" ")}` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

mountSearch(document);

try {
  const data = await loadHeadlines();
  const generated = data.generated_at ? `${formatDay(data.generated_at)}` : "";
  dateline.textContent = generated;
  const items = Array.isArray(data.items) ? data.items : [];
  main.replaceChildren();
  if (!items.length) {
    main.append(el("p", { class: "empty", text: "No headlines in the current file." }));
  } else {
    const [lead, ...rest] = items;
    const leadBlock = el("section", { class: "lead" }, [
      el("p", { class: "kicker", text: "Lead" }),
      article(lead),
    ]);
    const columns = [0, 1, 2].map(() => el("div", { class: "col" }));
    rest.forEach((item, index) => columns[index % 3].append(article(item)));
    main.append(leadBlock, el("section", { class: "columns" }, columns));
    watchTweetSlots(main);
  }
  const foot = document.querySelector("#run");
  foot.textContent = footerNotes(data);
} catch (error) {
  main.replaceChildren(el("p", { class: "empty", text: error instanceof Error ? error.message : "Could not load headlines." }));
}
