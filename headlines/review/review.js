import { el, formatDay, itemLink, loadHeadlines, sourceLine } from "../render.js";

const STORAGE = "bcf-headlines-feedback-v1";
const main = document.querySelector("#main");
const preview = document.querySelector("#preview");
const status = document.querySelector("#export-status");

function blank() {
  return { votes: {}, sizes: {}, notes: {}, overall: "" };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    return {
      votes: saved.votes || {},
      sizes: saved.sizes || {},
      notes: saved.notes || {},
      overall: typeof saved.overall === "string" ? saved.overall : "",
    };
  } catch {
    return blank();
  }
}

function writeState(state) {
  localStorage.setItem(STORAGE, JSON.stringify(state));
}

function feedbackDocument(state, data) {
  const ids = new Set([
    ...(data.items || []).map((item) => item.id),
    ...Object.keys(state.votes),
    ...Object.keys(state.sizes),
    ...Object.keys(state.notes),
  ]);
  const items = [];
  for (const id of ids) {
    const vote = state.votes[id] === "up" || state.votes[id] === "down" ? state.votes[id] : null;
    const size = ["bigger", "smaller", "dropped"].includes(state.sizes[id]) ? state.sizes[id] : null;
    const note = state.notes[id] || "";
    if (!vote && !size && !note) continue;
    items.push({ id, vote, size, note });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema: "biocat-headlines-feedback/1",
    exported_at: new Date().toISOString(),
    headlines_generated_at: data.generated_at || null,
    sample: false,
    overall_notes: state.overall || "",
    items,
  };
}

function renderPreview(state, data) {
  preview.textContent = JSON.stringify(feedbackDocument(state, data), null, 2);
}

const data = await loadHeadlines().catch((error) => {
  main.replaceChildren(el("p", { class: "empty", text: error instanceof Error ? error.message : "Could not load headlines." }));
  return null;
});
if (!data) {
  /* load failed */
} else {
  const state = readState();
  document.querySelector("#dateline").textContent = data.generated_at ? `File generated ${formatDay(data.generated_at)}` : "";
  const disabled = (data.sources || []).filter((source) => !source.enabled).map((source) => `${source.id}: ${source.note}`);
  const failed = (data.sources || []).filter((source) => source.enabled && source.status !== "ok").map((source) => `${source.id}: ${source.note}`);
  main.replaceChildren();
  if (disabled.length || failed.length) {
    main.append(el("p", { class: "sources", text: [...disabled, ...failed].join(" ") }));
  }
  for (const item of data.items || []) {
    const up = el("button", { type: "button", class: "vote", text: "Thumbs up", "aria-pressed": state.votes[item.id] === "up" ? "true" : "false" });
    const down = el("button", { type: "button", class: "vote", text: "Thumbs down", "aria-pressed": state.votes[item.id] === "down" ? "true" : "false" });
    const setVote = (vote) => {
      state.votes[item.id] = state.votes[item.id] === vote ? "" : vote;
      up.setAttribute("aria-pressed", state.votes[item.id] === "up" ? "true" : "false");
      down.setAttribute("aria-pressed", state.votes[item.id] === "down" ? "true" : "false");
      writeState(state);
      renderPreview(state, data);
    };
    up.addEventListener("click", () => setVote("up"));
    down.addEventListener("click", () => setVote("down"));
    const sizes = el("fieldset", { class: "size" }, [el("legend", { text: "Should be" })]);
    for (const [value, label] of [["", "No size change"], ["bigger", "Bigger"], ["smaller", "Smaller"], ["dropped", "Dropped"]]) {
      const input = el("input", { type: "radio", name: `size-${item.id}`, value });
      if ((state.sizes[item.id] || "") === value) input.checked = true;
      input.addEventListener("change", () => {
        state.sizes[item.id] = value;
        writeState(state);
        renderPreview(state, data);
      });
      sizes.append(el("label", {}, [input, document.createTextNode(` ${label}`)]));
    }
    const note = el("textarea", { class: "note", rows: "2", placeholder: "Note for this item. Not parsed automatically." });
    note.value = state.notes[item.id] || "";
    note.addEventListener("input", () => {
      state.notes[item.id] = note.value;
      writeState(state);
      renderPreview(state, data);
    });
    main.append(el("article", { class: "card" }, [
      itemLink(item),
      el("p", { class: "scoreline" }, [
        document.createTextNode("Significance "),
        el("strong", { text: String(item.significance) }),
        document.createTextNode(` · tier ${item.tier}`),
      ]),
      el("p", { class: "rationale", text: item.significance_rationale || "" }),
      sourceLine(item),
      el("div", { class: "controls" }, [up, down, sizes]),
      note,
    ]));
  }
  const overall = document.querySelector("#overall");
  overall.value = state.overall;
  overall.addEventListener("input", () => {
    state.overall = overall.value;
    writeState(state);
    renderPreview(state, data);
  });
  document.querySelector("#download").addEventListener("click", () => {
    const doc = feedbackDocument(state, data);
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" });
    const link = el("a", { href: URL.createObjectURL(blob), download: `headlines-feedback-${(data.generated_at || "export").slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    status.textContent = "Download started.";
  });
  document.querySelector("#copy").addEventListener("click", async () => {
    const text = preview.textContent;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "Copied.";
    } catch {
      preview.focus();
      status.textContent = "Clipboard unavailable. The JSON is selected in the box below.";
      const range = document.createRange();
      range.selectNodeContents(preview);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  document.querySelector("#clear").addEventListener("click", () => {
    if (!confirm("Clear headline feedback stored in this browser?")) return;
    localStorage.removeItem(STORAGE);
    location.reload();
  });
  renderPreview(state, data);
}
