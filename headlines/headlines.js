import { el, figureFor, formatLocalDay, formatStamp, formatUpdatedTime, itemLink, keepLastToken, loadHeadlines, sourceLine, tweetEmbed, watchTweetSlots } from "./render.js";
import { mountSearch } from "./search.js";
import { loadTrackedAccounts, renderTrackedAccounts } from "./tracked-accounts.js";

const main = document.querySelector("#main");
const dateline = document.querySelector("#dateline");

function article(item) {
  const nodes = [];
  const shot = figureFor(item);
  if (shot) nodes.push(shot);
  nodes.push(itemLink(item, "hed"));
  const post = tweetEmbed(item);
  if (post) nodes.push(post);
  if (item.blurb) nodes.push(el("p", { class: "blurb", text: keepLastToken(item.blurb) }));
  nodes.push(sourceLine(item));
  return el("article", { class: `item tier-${item.tier || 1}` }, nodes);
}

function showUnavailable(message) {
  main.replaceChildren(
    el("p", { class: "empty", text: message }),
    el("p", { class: "empty-actions" }, [
      el("a", { href: "/headlines/", text: "Try again" }),
      " ",
      el("a", { href: "/", text: "biocat.ai" }),
    ]),
  );
}

const accountsReady = loadTrackedAccounts().catch(() => []);
mountSearch(document, accountsReady);
accountsReady.then((accounts) => renderTrackedAccounts(document.querySelector("#tracked-accounts"), accounts));

try {
  const data = await loadHeadlines();
  if (dateline && data.generated_at) dateline.textContent = formatLocalDay(data.generated_at);
  const updatedLocal = document.querySelector("#updated-local");
  if (updatedLocal && data.generated_at) updatedLocal.textContent = `Updated ${formatUpdatedTime(data.generated_at)}`;
  const updated = document.querySelector("#updated");
  if (updated && data.generated_at) {
    updated.replaceChildren(el("time", { datetime: data.generated_at, text: `Updated ${formatStamp(data.generated_at)}` }));
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    showUnavailable("No headlines in this edition.");
  } else {
    const [lead, ...rest] = items;
    const leadBlock = el("section", { class: "lead" }, [
      el("p", { class: "kicker", text: "Lead" }),
      article(lead),
    ]);
    const columns = [0, 1, 2].map(() => el("div", { class: "col" }));
    rest.forEach((item, index) => columns[index % 3].append(article(item)));
    main.replaceChildren(leadBlock, el("section", { class: "columns" }, columns));
    watchTweetSlots(main);
  }
} catch {
  showUnavailable("Headlines could not be loaded.");
}
