// BioCatalystFeed live demo. Trials and papers hit public CORS-enabled APIs directly.
// NIH RePORTER has no CORS, so grants go through the Cloudflare Worker once deployed:
// set API_BASE to the Worker URL (e.g. "https://api.biocatalystfeed.com").
(() => {
  const API_BASE = "";
  const $ = (s) => document.querySelector(s);
  const q = $("#q"), out = $("#results"), status = $("#status");
  let tab = "trials", timer, ctrl, seq = 0;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const item = (title, url, meta, pills = []) =>
    `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a><div class="meta">${pills.filter(Boolean).map((p) => `<span class="pill">${esc(p)}</span>`).join("")}${esc(meta)}</div></li>`;

  async function getJSON(url, opts = {}) {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (r.status === 429) throw new Error("Rate limit reached. Try again shortly.");
    if (!r.ok) throw new Error(`Source returned HTTP ${r.status}`);
    return r.json();
  }

  const sources = {
    async trials(term) {
      const u = API_BASE ? `${API_BASE}/trials?q=${encodeURIComponent(term)}`
        : `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=10&sort=LastUpdatePostDate:desc&fields=NCTId,BriefTitle,OverallStatus,Phase,LeadSponsorName,LastUpdatePostDate`;
      const d = await getJSON(u);
      return (d.studies || []).map((s) => {
        const p = s.protocolSection || {}, id = p.identificationModule?.nctId;
        return item(p.identificationModule?.briefTitle, `https://clinicaltrials.gov/study/${id}`,
          `${id} · ${p.sponsorCollaboratorsModule?.leadSponsor?.name || ""} · updated ${p.statusModule?.lastUpdatePostDateStruct?.date || "n/a"}`,
          [p.statusModule?.overallStatus?.replace(/_/g, " ").toLowerCase(), (p.designModule?.phases || []).join("/")]);
      });
    },
    async papers(term) {
      const u = API_BASE ? `${API_BASE}/papers?q=${encodeURIComponent(term)}`
        : `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(term)}&format=json&pageSize=10&sort=P_PDATE_D%20desc`;
      const d = await getJSON(u);
      return (d.resultList?.result || []).map((r) => {
        const url = r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`;
        return item(r.title, url, `${r.authorString || ""} · ${r.journalTitle || r.bookOrReportDetails?.publisher || ""} · ${r.firstPublicationDate || r.pubYear || ""}`,
          [r.source === "PPR" ? "preprint" : r.source, r.isOpenAccess === "Y" ? "open access" : ""]);
      });
    },
    async grants(term) {
      if (!API_BASE) {
        return [`<li>NIH RePORTER doesn't allow direct browser requests, so live grant search will turn on once our API proxy launches. For now, <a href="https://reporter.nih.gov/" target="_blank" rel="noopener">search RePORTER directly</a> or run <code>bcf --help</code> to find the grants command.</li>`];
      }
      const d = await getJSON(`${API_BASE}/grants?q=${encodeURIComponent(term)}`);
      return (d.results || []).map((g) => item(g.project_title, `https://reporter.nih.gov/project-details/${g.appl_id}`,
        `${g.organization?.org_name || ""} · FY${g.fiscal_year || ""}`, [g.award_amount ? `$${Number(g.award_amount).toLocaleString()}` : "", g.activity_code]));
    },
  };

  async function run() {
    const term = q.value.trim();
    ctrl?.abort();
    if (term.length < 2) { out.innerHTML = ""; status.textContent = ""; return; }
    ctrl = new AbortController();
    const my = ++seq;
    status.textContent = "Searching…";
    try {
      const rows = await sources[tab](term);
      if (my !== seq) return;
      out.innerHTML = rows.join("");
      status.textContent = rows.length ? `${rows.length} most recent results` : "No results. Try a broader term.";
    } catch (e) {
      if (e.name === "AbortError" || my !== seq) return;
      out.innerHTML = "";
      status.textContent = `Couldn't reach the source (${e.message}). Please try again.`;
    }
  }

  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 400); });
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    tab = b.dataset.tab; run();
  }));
  $("#install")?.addEventListener("click", (e) => navigator.clipboard?.writeText(e.target.textContent).then(() => {
    const t = e.target.textContent; e.target.textContent = "Copied!"; setTimeout(() => (e.target.textContent = t), 1200);
  }));
})();
