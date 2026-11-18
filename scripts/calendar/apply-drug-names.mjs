import fs from "node:fs";
import path from "node:path";
import { cleanDrugNames, drugSlug, tidyDrugLists } from "./drug-names.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const drugRoot = path.join(repo, "calendar", "drug");
const sections = [
  "Upcoming FDA decision events",
  "Upcoming trial readouts",
  "Readouts, last 180 days",
  "FDA decision events, last 12 months",
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function titleOf(html) {
  const match = html.match(/<h1>([\s\S]*?)<\/h1>/i);
  if (!match) return "";
  const raw = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return raw.replace(/:\s*trial readouts.*$/i, "").trim();
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameVariants(value) {
  const decoded = decode(value);
  return [...new Set([decoded, escapeHtml(decoded), value])];
}

function rewriteNames(html, oldName, newName) {
  let out = html;
  const next = escapeHtml(decode(newName));
  for (const previous of nameVariants(oldName)) {
    if (previous && previous !== next) out = out.split(previous).join(next);
  }
  return out;
}

function rewriteSlug(html, oldSlug, newSlug) {
  if (oldSlug === newSlug) return html;
  return html.split(`/calendar/drug/${oldSlug}/`).join(`/calendar/drug/${newSlug}/`);
}

function dataRows(html, heading) {
  const match = html.match(new RegExp(`<h2>${escapeRe(heading)}</h2><table>[\\s\\S]*?</table>`));
  if (!match) return [];
  return [...match[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)]
    .map((row) => row[0])
    .filter((row) => !row.includes("<th>") && !row.includes("colspan"));
}

function rowKey(row) {
  const nct = row.match(/NCT\d+/);
  if (nct) return `nct:${nct[0]}`;
  const href = row.match(/href="(https?:[^"]+)"/);
  if (href) return `href:${href[1]}`;
  return `row:${row}`;
}

function eventKey(event) {
  const item = event.item || {};
  const blob = `${item.url || ""} ${item.name || ""}`;
  const nct = blob.match(/NCT\d+/);
  if (nct) return `nct:${nct[0]}`;
  return item.url || item.name || "";
}

function mergePages(targetHtml, sourceHtml) {
  let html = targetHtml;
  let added = 0;
  for (const heading of sections) {
    const fresh = dataRows(sourceHtml, heading).filter((row) => {
      const key = rowKey(row);
      return !dataRows(html, heading).some((existing) => rowKey(existing) === key);
    });
    if (!fresh.length) continue;
    added += fresh.length;
    if (!html.includes(`<h2>${heading}</h2>`)) {
      const block = sourceHtml.match(new RegExp(`<h2>${escapeRe(heading)}</h2><table>[\\s\\S]*?</table>`));
      if (!block) continue;
      const inserted = block[0].replace(/<tbody>[\s\S]*<\/tbody>/, `<tbody>${fresh.join("")}</tbody>`);
      html = html.replace("<p><small>Readout =", `${inserted}\n<p><small>Readout =`);
      continue;
    }
    html = html.replace(
      new RegExp(`(<h2>${escapeRe(heading)}</h2><table>[\\s\\S]*?<tbody>)([\\s\\S]*?)(</tbody>)`),
      (_whole, open, body, close) => `${open}${body.replace(/<tr><td colspan=\d+>[\s\S]*?<\/tr>/g, "")}${fresh.join("")}${close}`,
    );
  }
  html = mergeEvents(html, sourceHtml);
  return { html, added };
}

function mergeEvents(targetHtml, sourceHtml) {
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const target = targetHtml.match(pattern);
  const source = sourceHtml.match(pattern);
  if (!target || !source) return targetHtml;
  const targetJson = JSON.parse(target[1]);
  const sourceJson = JSON.parse(source[1]);
  const have = new Set((targetJson.itemListElement || []).map(eventKey));
  for (const event of sourceJson.itemListElement || []) {
    const key = eventKey(event);
    if (!key || have.has(key)) continue;
    targetJson.itemListElement.push(event);
    have.add(key);
  }
  targetJson.itemListElement.forEach((event, index) => {
    event.position = index + 1;
  });
  return targetHtml.replace(pattern, `<script type="application/ld+json">${JSON.stringify(targetJson)}</script>`);
}

function sponsorName(cell) {
  return decode(cell.split(/<b|<a/i)[0]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/[,\s]+$/g, "");
}

function refreshCounts(html) {
  const counts = {
    up: dataRows(html, "Upcoming trial readouts").length,
    past: dataRows(html, "Readouts, last 180 days").length,
    fdaUp: dataRows(html, "Upcoming FDA decision events").length,
    fdaPast: dataRows(html, "FDA decision events, last 12 months").length,
  };
  let next = html.replace(
    /\d+ upcoming industry Phase 2\/3 readout\(s\) in the next 90 days, \d+ upcoming FDA event\(s\), \d+ readout\(s\) in the last 180 days and \d+ FDA event\(s\) in the last 12 months/,
    `${counts.up} upcoming industry Phase 2/3 readout(s) in the next 90 days, ${counts.fdaUp} upcoming FDA event(s), ${counts.past} readout(s) in the last 180 days and ${counts.fdaPast} FDA event(s) in the last 12 months`,
  );
  next = next.replace(
    /: \d+ upcoming readout\(s\), \d+ upcoming FDA event\(s\),/,
    `: ${counts.up} upcoming readout(s), ${counts.fdaUp} upcoming FDA event(s),`,
  );
  const names = [];
  for (const heading of sections) {
    const column = heading.includes("FDA") ? 3 : 2;
    for (const row of dataRows(next, heading)) {
      const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)];
      if (!cells[column]) continue;
      const name = sponsorName(cells[column][1]);
      if (name && !names.some((have) => have.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  }
  next = next.replace(/Sponsors: (.*?)\.( Drug names come)/, (_whole, current, rest) => {
    const have = current.split(",").map((part) => decode(part).trim()).filter(Boolean);
    for (const name of names) {
      if (!have.some((item) => item.toLowerCase() === name.toLowerCase())) have.push(name);
    }
    return `Sponsors: ${have.map((item) => escapeHtml(item)).join(", ")}.${rest}`;
  });
  return next;
}

const pages = new Map();
for (const entry of fs.readdirSync(drugRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(drugRoot, entry.name, "index.html");
  if (!fs.existsSync(file)) continue;
  const html = read(file);
  pages.set(entry.name, { slug: entry.name, title: titleOf(html), html });
}

const finalPages = new Map();
const redirect = new Map();
const removed = [];
const renamed = [];
const split = [];
const merges = [];

for (const page of pages.values()) {
  const names = cleanDrugNames(page.title);
  if (!names.length) {
    removed.push({ slug: page.slug, title: page.title });
    redirect.set(page.slug, "");
    continue;
  }
  const targets = names.map((name) => ({ name, slug: drugSlug(name) }));
  const sameName = targets[0].name.replace(/&amp;/g, "&") === page.title.replace(/&amp;/g, "&");
  if (names.length === 1 && targets[0].slug === page.slug && sameName) {
    finalPages.set(page.slug, page.html);
    continue;
  }
  if (names.length === 1) renamed.push({ slug: page.slug, from: page.title, to: targets[0].name, toSlug: targets[0].slug });
  else split.push({ slug: page.slug, from: page.title, to: targets });
  redirect.set(page.slug, targets[0].slug);
  for (const target of targets) {
    const sourceHtml = rewriteSlug(rewriteNames(page.html, page.title, target.name), page.slug, target.slug);
    if (finalPages.has(target.slug) || (pages.has(target.slug) && target.slug !== page.slug)) {
      merges.push({ html: sourceHtml, toSlug: target.slug });
      continue;
    }
    finalPages.set(target.slug, sourceHtml);
  }
}

for (const [slug, html] of pages) {
  if (!redirect.has(slug) && !finalPages.has(slug)) finalPages.set(slug, html);
}

for (const job of merges) {
  const current = finalPages.get(job.toSlug);
  if (!current) continue;
  const merged = mergePages(current, job.html);
  finalPages.set(job.toSlug, merged.added ? refreshCounts(merged.html) : merged.html);
}

for (const entry of fs.readdirSync(drugRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!finalPages.has(entry.name)) fs.rmSync(path.join(drugRoot, entry.name), { recursive: true, force: true });
}

function labelFor(slug, next) {
  const renamedHit = renamed.find((row) => row.slug === slug && row.toSlug === next);
  if (renamedHit) return escapeHtml(decode(renamedHit.to));
  for (const row of split) {
    if (row.slug !== slug) continue;
    const hit = row.to.find((item) => item.slug === next);
    if (hit) return escapeHtml(decode(hit.name));
  }
  return next;
}

function replaceAnchors(html) {
  return html.replace(/<a href="([^"]*?)([a-z0-9-]+)\/">[^<]*<\/a>/g, (whole, prefix, slug) => {
    if (!redirect.has(slug)) return whole;
    if (prefix !== "" && !prefix.endsWith("drug/")) return whole;
    const next = redirect.get(slug);
    if (!next) return "";
    return `<a href="${prefix}${next}/">${labelFor(slug, next)}</a>`;
  });
}

function dedupeDrugList(html) {
  return html.replace(/Drugs: ([\s\S]*?)<\/p>/g, (whole, body) => {
    const anchors = [...body.matchAll(/<a href="([^"]+)">[^<]*<\/a>/g)];
    if (anchors.length < 2) return whole;
    const seen = new Set();
    if (anchors.every((anchor) => seen.has(anchor[1]) ? false : (seen.add(anchor[1]), true))) return whole;
    const kept = [];
    const used = new Set();
    for (const anchor of anchors) {
      if (used.has(anchor[1])) continue;
      used.add(anchor[1]);
      kept.push(anchor[0]);
    }
    return `Drugs: ${kept.join(", ")}</p>`;
  });
}

function countsFor(html) {
  return {
    up: dataRows(html, "Upcoming trial readouts").length,
    fda: dataRows(html, "Upcoming FDA decision events").length,
  };
}

for (const [slug, html] of finalPages) {
  const dir = path.join(drugRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  let next = tidyDrugLists(replaceAnchors(html));
  next = next.replace(/<li>\s*<\/li>/g, "");
  fs.writeFileSync(path.join(dir, "index.html"), next);
  finalPages.set(slug, next);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(html|xml)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function retargetSitemap(html) {
  for (const [slug, next] of redirect) {
    const from = `https://biocat.ai/calendar/drug/${slug}/`;
    const pattern = new RegExp(`<url><loc>${escapeRe(from)}</loc><lastmod>[^<]*</lastmod></url>`);
    const found = html.match(pattern);
    if (!found) continue;
    html = html.replace(found[0], "");
    if (!next) continue;
    const loc = `https://biocat.ai/calendar/drug/${next}/`;
    if (html.includes(`<loc>${loc}</loc>`)) continue;
    const lastmod = found[0].match(/<lastmod>([^<]*)<\/lastmod>/)[1];
    html = html.replace("</urlset>", `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url></urlset>`);
  }
  const missing = [];
  for (const slug of finalPages.keys()) {
    const loc = `https://biocat.ai/calendar/drug/${slug}/`;
    if (!html.includes(`<loc>${loc}</loc>`)) {
      missing.push(`<url><loc>${loc}</loc><lastmod>2026-11-18</lastmod></url>`);
    }
  }
  if (missing.length) html = html.replace("</urlset>", `${missing.join("")}</urlset>`);
  return html;
}

for (const file of [...walk(path.join(repo, "calendar")), path.join(repo, "sitemap.xml")]) {
  if (file.startsWith(`${drugRoot}${path.sep}`) && path.basename(path.dirname(file)) !== "drug") continue;
  let html = read(file);
  const original = html;
  html = tidyDrugLists(dedupeDrugList(replaceAnchors(html)));
  html = html.replace(/<li>\s*<\/li>/g, "");
  html = html.replace(/<p>Drugs:\s*<\/p>/g, "");
  if (file.endsWith(`${path.sep}sitemap.xml`)) html = retargetSitemap(html);
  if (html !== original) fs.writeFileSync(file, html);
}

const indexFile = path.join(drugRoot, "index.html");
let index = read(indexFile);
index = index.replace(/<li>\s*<small>[\s\S]*?<\/small>\s*<\/li>/g, "");
const touched = new Set();
for (const row of renamed) touched.add(row.toSlug);
for (const row of split) for (const target of row.to) touched.add(target.slug);
for (const slug of finalPages.keys()) {
  if (index.includes(`href="${slug}/"`)) continue;
  const name = escapeHtml(decode(titleOf(finalPages.get(slug))));
  const counts = countsFor(finalPages.get(slug));
  const li = `<li><a href="${slug}/">${name}</a> <small>${counts.up} up / ${counts.fda} FDA</small></li>`;
  const letter = /[a-z]/.test(slug[0]) ? slug[0].toUpperCase() : "#";
  const heading = `<h2 id="${letter}">`;
  const at = index.indexOf(heading);
  if (at < 0) continue;
  const end = index.indexOf("</ul>", at);
  if (end < 0) continue;
  index = index.slice(0, end) + li + index.slice(end);
  touched.add(slug);
}
index = index.replace(/<li><a href="([^"/]+)\/">([^<]*)<\/a>\s*<small>[^<]*<\/small><\/li>/g, (li, slug, name) => {
  if (!touched.has(slug) || !finalPages.has(slug)) return li;
  const counts = countsFor(finalPages.get(slug));
  return `<li><a href="${slug}/">${name}</a> <small>${counts.up} up / ${counts.fda} FDA</small></li>`;
});
const seen = new Set();
index = index.replace(/<li><a href="([^"]+)">[\s\S]*?<\/li>/g, (li, href) => {
  if (seen.has(href)) return "";
  seen.add(href);
  return li;
});
index = index.replace(/>\d+ drugs/, `>${seen.size} drugs`);
fs.writeFileSync(indexFile, index);

const report = { removed, renamed, split, pages: finalPages.size };
fs.writeFileSync("/tmp/drug-name-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ removed: removed.length, renamed: renamed.length, split: split.length, pages: finalPages.size }, null, 2));
