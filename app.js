// BioCatalystFeed live demo. Trials and papers hit public CORS-enabled APIs directly.
// NIH RePORTER has no CORS, so grants go through the Cloudflare Worker once deployed:
// set API_BASE to the Worker URL (e.g. "https://api.biocatalystfeed.com").
(() => {
  const API_BASE = "";
  const $ = (s) => document.querySelector(s);
  const q = $("#q"), out = $("#results"), status = $("#status");
  let tab = "trials", timer, ctrl, seq = 0;
  // Opt-in Global (Phase 1, off by default): labelled link-outs to non-FDA/EMA registry IDs that ClinicalTrials.gov lists
  // as secondary IDs (nothing fetched from those registries), and paper jurisdiction flags from Europe PMC affiliations.
  const gBox = $("#global"), gOn = $("#global-on");
  const isGlobal = () => !!gBox?.checked;
  const GLOBAL_DISCLAIMER = 'Results labelled "non-FDA/EMA registry" come from registries and studies that may operate under regulatory, ethics and data standards different from, and sometimes lighter than, those of the US FDA or the EU\'s EMA. They are included because you opted in to see everything that is out there. Inclusion is not an endorsement or recommendation and is not medical, legal or investment advice.';
  const ICTRP = (id) => `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(id)}`;
  const REGISTRIES = [["ChiCTR", "China", /ChiCTR[-A-Z]*\d{6,}/, ICTRP], ["CTRI", "India", /CTRI\/\d{4}\/\d{2,3}\/\d{6}/, ICTRP],
    ["jRCT", "Japan", /jRCT[a-z]?\d{7,10}/, ICTRP], ["JPRN", "Japan", /JPRN-[A-Za-z]+-?\d+/, ICTRP], ["CRIS", "South Korea", /KCT\d{7}/, ICTRP],
    ["ANZCTR", "Australia/New Zealand", /ACTRN\d{14}/, ICTRP], ["ReBEC", "Brazil", /RBR-[0-9a-z]{6,8}/, ICTRP], ["PACTR", "Africa", /PACTR\d{15,16}/, ICTRP],
    ["IRCT", "Iran", /IRCT\d{8,}N\d+/, ICTRP], ["TCTR", "Thailand", /TCTR\d{11}/, ICTRP], ["ISRCTN", "United Kingdom/international", /ISRCTN\d{8}/, (id) => `https://www.isrctn.com/${id}`]];
  const regLinks = (ids) => { const out = [], seen = new Set();
    for (const s of ids || []) for (const [reg, c, rx, u] of REGISTRIES) { const m = String(s.id || "").match(rx); if (m && !seen.has(m[0])) { seen.add(m[0]); out.push({ reg, c, id: m[0], url: u(m[0]) }); } }
    return out; };
  const HOME = ["United States", "USA", "U.S.A.", "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Czechia", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden", "Iceland", "Liechtenstein", "Norway"];
  const OTHER = ["China", "Hong Kong", "Macau", "Taiwan", "Japan", "Korea", "India", "Iran", "Brazil", "United Kingdom", "UK", "England", "Scotland", "Wales", "Switzerland", "Canada", "Australia", "New Zealand", "Russia", "Turkey", "Türkiye", "Israel", "Egypt", "Saudi Arabia", "Pakistan", "Singapore", "Mexico", "South Africa", "Nigeria", "Thailand", "Vietnam", "Viet Nam", "Malaysia", "Indonesia", "Argentina", "Chile", "Colombia", "Peru", "Bangladesh", "Philippines", "Ukraine", "Serbia", "Qatar", "United Arab Emirates", "Jordan", "Lebanon", "Ethiopia", "Kenya", "Ghana", "Uganda", "Tanzania", "Morocco", "Tunisia", "Nepal", "Sri Lanka", "Kazakhstan", "Belarus"];
  const CANON = { USA: "United States", "U.S.A.": "United States", Czechia: "Czech Republic", Korea: "South Korea", UK: "United Kingdom", England: "United Kingdom", Scotland: "United Kingdom", Wales: "United Kingdom", "Türkiye": "Turkey", "Viet Nam": "Vietnam" };
  const HOME_SET = new Set(HOME.map((c) => CANON[c] || c));
  const CRX = new RegExp("(?<![A-Za-z])(?<!New )(?<!New South )(" + [...HOME, ...OTHER].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z])", "g");
  const paperFlag = (r) => { const affs = [];
    for (const au of r.authorList?.author || []) { for (const x of au.authorAffiliationDetailsList?.authorAffiliation || []) if (x.affiliation) affs.push(x.affiliation); if (au.affiliation) affs.push(au.affiliation); }
    if (!affs.length && r.affiliation) affs.push(r.affiliation);
    const found = []; for (const a of affs) for (const m of String(a).matchAll(CRX)) { const c = CANON[m[1]] || m[1]; if (!found.includes(c)) found.push(c); }
    const other = found.filter((c) => !HOME_SET.has(c));
    return !found.length ? { flag: "unknown", other } : { flag: other.length ? "non-FDA/EMA oversight" : null, other }; };
  const addTop = (top, html) => (top ? html.replace("<li>", "<li>" + top) : html);
  let globalHit = false;
  const gtag = (t) => `<span class="gtag">${esc(t)}</span>`;
  const cache = new Map(); // per-page-load cache: re-typing / tab switching never re-hits upstream APIs
  let cooldownUntil = 0;   // after a 429, pause live queries instead of hammering the source

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const item = (title, url, meta, pills = []) =>
    `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a><div class="meta">${pills.filter(Boolean).map((p) => `<span class="pill">${esc(p)}</span>`).join("")}${esc(meta)}</div></li>`;

  async function getJSON(url, opts = {}) {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (r.status === 429) {
      const ra = parseInt(r.headers.get("Retry-After") || "30", 10);
      cooldownUntil = Date.now() + Math.min(Number.isFinite(ra) ? ra : 30, 3600) * 1000;
      throw new Error("the source is busy right now (rate limited). Try again in a minute");
    }
    if (!r.ok) throw new Error(`Source returned HTTP ${r.status}`);
    return r.json();
  }

  const sources = {
    async trials(term, g) {
      const u = API_BASE ? `${API_BASE}/trials?q=${encodeURIComponent(term)}`
        : `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=10&sort=LastUpdatePostDate:desc&fields=NCTId,BriefTitle,OverallStatus,Phase,LeadSponsorName,LastUpdatePostDate${g ? ",SecondaryIdInfo" : ""}`;
      const d = await getJSON(u);
      return (d.studies || []).map((s) => {
        const p = s.protocolSection || {}, id = p.identificationModule?.nctId;
        const links = g ? regLinks(p.identificationModule?.secondaryIdInfos) : [];
        const extra = links.length ? `<div class="glinks">${links.map((l) => `${gtag(`non-FDA/EMA registry · ${l.reg} · ${l.c}`)}<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.id)}</a> (also registered as ${esc(id)}; link only)`).join("<br>")}</div>` : "";
        if (links.length) globalHit = true;
        return addTop(extra, item(p.identificationModule?.briefTitle, `https://clinicaltrials.gov/study/${id}`,
          `${id} · ${p.sponsorCollaboratorsModule?.leadSponsor?.name || ""} · updated ${p.statusModule?.lastUpdatePostDateStruct?.date || "n/a"}`,
          [p.statusModule?.overallStatus?.replace(/_/g, " ").toLowerCase(), (p.designModule?.phases || []).join("/")]));
      });
    },
    async papers(term, g) {
      const u = API_BASE ? `${API_BASE}/papers?q=${encodeURIComponent(term)}`
        : `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(term)}&format=json&pageSize=10&sort=P_PDATE_D%20desc${g ? "&resultType=core" : ""}`;
      const d = await getJSON(u);
      return (d.resultList?.result || []).map((r) => {
        const url = r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`;
        let pre = "";
        if (g) { const f = paperFlag(r);
          if (f.flag === "non-FDA/EMA oversight") { globalHit = true; pre = `<div class="glinks">${gtag(`non-FDA/EMA oversight · ${f.other.join(", ")}`)}</div>`; }
          else if (f.flag === "unknown") pre = `<div class="glinks">${gtag("jurisdiction unknown")}</div>`; }
        return addTop(pre, item(r.title, url, `${r.authorString || ""} · ${r.journalTitle || r.bookOrReportDetails?.publisher || ""} · ${r.firstPublicationDate || r.pubYear || ""}`,
          [r.source === "PPR" ? "preprint" : r.source, r.isOpenAccess === "Y" ? "open access" : ""]));
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

  const discFor = (rows) => (rows.globalHit ? `<li class="gdisc" style="border:0;background:none;padding:0">${esc(GLOBAL_DISCLAIMER)}</li>` : "");

  async function run() {
    const term = q.value.trim();
    ctrl?.abort();
    if (term.length < 2) { out.innerHTML = ""; status.textContent = ""; return; }
    ctrl = new AbortController();
    const my = ++seq;
    const g = isGlobal();
    const key = `${tab}:${g ? "g:" : ""}${term.toLowerCase()}`;
    if (cache.has(key)) { const rows = cache.get(key); out.innerHTML = rows.join("") + discFor(rows); status.textContent = rows.length ? `${rows.length} most recent results` : "No results. Try a broader term."; return; }
    if (Date.now() < cooldownUntil) { status.textContent = "Live search is paused briefly because the data source is rate-limiting. Please try again in a minute."; return; }
    status.textContent = "Searching…";
    try {
      globalHit = false;
      const rows = await sources[tab](term, g && tab !== "grants");
      if (globalHit) rows.globalHit = true;
      if (cache.size > 100) cache.clear();
      cache.set(key, rows);
      if (my !== seq) return;
      out.innerHTML = rows.join("") + discFor(rows);
      status.textContent = rows.length ? `${rows.length} most recent results` : "No results. Try a broader term.";
    } catch (e) {
      if (e.name === "AbortError" || my !== seq) return;
      out.innerHTML = "";
      status.textContent = `Couldn't reach the source (${e.message}). Please try again.`;
    }
  }

  // Global toggle (off by default) + ⓘ detail: hover/click/focus popover on desktop, tap-to-expand inline on touch; Esc closes.
  const info = $("#ginfo"), detail = $("#global-detail"), gbox = $("#global-box");
  let pinned = false;
  const setOpen = (open) => { if (!detail) return; detail.hidden = !open; document.querySelectorAll('[aria-controls="global-detail"]').forEach((x) => x.setAttribute("aria-expanded", String(open))); };
  const toggle = () => { pinned = !pinned; setOpen(pinned); };
  info?.addEventListener("click", toggle);
  document.querySelectorAll('.global-on [aria-controls="global-detail"]').forEach((x) => x.addEventListener("click", toggle));
  info?.addEventListener("keyup", (e) => { if (e.key === "Tab") setOpen(true); }); // keyboard focus opens
  info?.addEventListener("blur", () => setTimeout(() => { if (!pinned && !detail.contains(document.activeElement)) setOpen(false); }, 150));
  if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
    info?.addEventListener("mouseenter", () => setOpen(true));
    gbox?.addEventListener("mouseleave", () => { if (!pinned) setOpen(false); });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && detail && !detail.hidden) { pinned = false; setOpen(false); } });
  document.addEventListener("click", (e) => { if (pinned && !gbox.contains(e.target) && !e.target.closest?.(".global-on")) { pinned = false; setOpen(false); } });
  gBox?.addEventListener("change", () => { if (gOn) gOn.hidden = !gBox.checked; run(); });

  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 600); });
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    tab = b.dataset.tab; run();
  }));
  $("#install")?.addEventListener("click", (e) => navigator.clipboard?.writeText(e.target.textContent).then(() => {
    const t = e.target.textContent; e.target.textContent = "Copied!"; setTimeout(() => (e.target.textContent = t), 1200);
  }));
})();
