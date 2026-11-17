export const SEARCH_API = "https://biocatalystfeed-api.biocatalystfeed.workers.dev";
export const SEARCH_ROUTES = ["trials", "papers", "grants", "ai-discovery"];

export function searchUrls(term) {
  const q = encodeURIComponent(String(term || "").trim());
  return SEARCH_ROUTES.map((route) => `${SEARCH_API}/${route}?q=${q}`);
}

function textOf(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeResults(route, payload) {
  if (route === "trials") {
    return (payload?.studies || []).slice(0, 2).map((study) => {
      const protocol = study.protocolSection || {};
      const id = protocol.identificationModule?.nctId || "";
      return {
        type: "Trial",
        title: textOf(protocol.identificationModule?.briefTitle),
        href: id ? `https://clinicaltrials.gov/study/${id}` : "",
      };
    }).filter((row) => row.title && row.href);
  }
  if (route === "papers") {
    return (payload?.resultList?.result || []).slice(0, 2).map((paper) => ({
      type: paper.source === "PPR" ? "Preprint" : "Paper",
      title: textOf(paper.title),
      href: paper.doi ? `https://doi.org/${paper.doi}` : (paper.source && paper.id ? `https://europepmc.org/article/${paper.source}/${paper.id}` : ""),
    })).filter((row) => row.title && row.href);
  }
  if (route === "grants") {
    return (payload?.results || []).slice(0, 2).map((grant) => ({
      type: "Grant",
      title: textOf(grant.project_title),
      href: grant.appl_id ? `https://reporter.nih.gov/project-details/${grant.appl_id}` : "",
    })).filter((row) => row.title && row.href);
  }
  return (payload?.items || []).slice(0, 2).map((item) => {
    const urls = item.urls || {};
    return {
      type: "AI",
      title: textOf(item.title || item.name),
      href: urls.paper || urls.blog || urls.page || urls.weights || "",
    };
  }).filter((row) => row.title && row.href);
}

export function mountSearch(doc = document) {
  const form = doc.querySelector("#finder");
  const input = doc.querySelector("#hl-q");
  const panel = doc.querySelector("#hl-hits");
  if (!form || !input || !panel) return;
  let timer = 0;
  let controller = null;
  const close = () => { panel.hidden = true; panel.replaceChildren(); };
  const show = (rows, note) => {
    panel.replaceChildren();
    if (note) panel.append(Object.assign(doc.createElement("p"), { className: "finder-note", textContent: note }));
    for (const row of rows) {
      const link = doc.createElement("a");
      link.href = row.href;
      link.rel = "noopener noreferrer";
      link.textContent = row.title;
      const type = doc.createElement("span");
      type.className = "finder-type";
      type.textContent = row.type;
      const line = doc.createElement("div");
      line.className = "finder-row";
      line.append(type, link);
      panel.append(line);
    }
    panel.hidden = panel.childNodes.length === 0;
  };
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) { close(); return; }
    timer = window.setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      show([], "Searching…");
      try {
        const rows = await searchAll(term, (url, options) => fetch(url, { ...options, signal: controller.signal }));
        if (controller.signal.aborted) return;
        show(rows, rows.length ? "" : "No results.");
      } catch (error) {
        if (error?.name === "AbortError") return;
        show([], "Search is unavailable.");
      }
    }, 450);
  });
  doc.addEventListener("click", (event) => {
    if (!form.contains(event.target)) close();
  });
  form.addEventListener("submit", (event) => event.preventDefault());
}

export async function searchAll(term, fetchImpl = fetch) {
  const query = String(term || "").trim();
  if (query.length < 2) return [];
  const rows = await Promise.all(searchUrls(query).map(async (url) => {
    const route = SEARCH_ROUTES.find((name) => url.includes(`/${name}?`));
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      return normalizeResults(route, await response.json());
    } catch {
      return [];
    }
  }));
  return rows.flat();
}
