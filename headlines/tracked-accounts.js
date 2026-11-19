export function accountsFromAllowlist(data) {
  const group = data?.x || {};
  const rows = [...(group.org_accounts || []), ...(group.researcher_handles || [])];
  const seen = new Set();
  const accounts = [];
  for (const row of rows) {
    const handle = String(row?.handle || "").replace(/^@/, "").trim();
    const key = handle.toLowerCase();
    if (!handle || seen.has(key)) continue;
    seen.add(key);
    const displayName = String(row.display_name || handle).replace(/\s+/g, " ").trim() || handle;
    accounts.push({
      handle,
      display_name: displayName,
      href: `https://x.com/${handle}`,
    });
  }
  return accounts;
}

export function accountKey(value) {
  return String(value || "").toLowerCase().replace(/@/g, "").replace(/[\s_]+/g, "");
}

export function matchTrackedAccounts(accounts, query) {
  const key = accountKey(query);
  if (key.length < 2) return [];
  return (accounts || []).filter((account) => {
    return accountKey(account.display_name).includes(key) || accountKey(account.handle).includes(key);
  });
}

export function trackedSearchRows(accounts, query) {
  return matchTrackedAccounts(accounts, query).map((account) => ({
    type: "Tracked X account",
    title: `${account.display_name} @${account.handle}`,
    href: account.href,
  }));
}

export async function loadTrackedAccounts(fetchImpl = fetch) {
  const response = await fetchImpl("/data/ai-discovery-allowlist.json", { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  return accountsFromAllowlist(await response.json());
}

export function applyTrackedAccountFilter(section, accounts, query) {
  if (!section) return [];
  const list = section.querySelector(".tracked-list");
  if (!list) return [];
  const items = [...list.querySelectorAll("li")];
  const matched = new Set(matchTrackedAccounts(accounts, query).map((account) => account.handle.toLowerCase()));
  const filtering = matched.size > 0;
  const visible = [];
  items.forEach((item, index) => {
    const account = accounts?.[index];
    const show = !filtering || Boolean(account && matched.has(String(account.handle).toLowerCase()));
    item.hidden = !show;
    if (show && account) visible.push(account);
  });
  return visible;
}

export function renderTrackedAccounts(section, accounts) {
  if (!section) return;
  const list = section.querySelector(".tracked-list");
  if (!list) return;
  list.replaceChildren();
  if (!accounts?.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const account of accounts) {
    const link = document.createElement("a");
    link.href = account.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(account.display_name, " ");
    const handle = document.createElement("span");
    handle.className = "tracked-handle";
    handle.textContent = `@${account.handle}`;
    link.append(handle);
    const item = document.createElement("li");
    item.append(link);
    list.append(item);
  }
}
