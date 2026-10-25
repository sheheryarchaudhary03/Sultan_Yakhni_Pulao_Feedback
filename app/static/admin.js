(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STATUS_LABELS = { new: "New", reviewed: "Reviewed", actioned: "Actioned", archived: "Archived" };
  const RETURN_LABELS = { yes: "Yes", maybe: "Maybe", no: "No" };

  let meta = null;
  let view = "overview";
  const filters = { range: "30", date_from: "", date_to: "", branch: "", service: "" };
  const list = { q: "", status: "", attention: false, offers: false, sort: "newest", page: 1, pageSize: 25, total: 0 };
  let openId = null;
  let lastFocus = null;

  // ------------------------------------------------------------ helpers
  // Builds an element; strings become text nodes, so stored text can never become markup.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  class ApiError extends Error {}

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      ...options,
    });
    if (res.status === 401 && !path.endsWith("/login")) {
      showLogin();
      throw new ApiError("Please sign in.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(typeof body.detail === "string" ? body.detail : "Something went wrong. Try again.");
    return body;
  }

  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function filterParams(extra = {}) {
    const p = new URLSearchParams();
    let from = "", to = "";
    if (filters.range === "custom") {
      from = filters.date_from;
      to = filters.date_to;
    } else if (filters.range !== "all") {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - (filters.range === "today" ? 0 : Number(filters.range) - 1));
      from = isoDate(start);
      to = isoDate(today);
    }
    const all = { date_from: from, date_to: to, branch: filters.branch, service: filters.service, ...extra };
    for (const [k, v] of Object.entries(all)) if (v !== "" && v !== false && v !== null && v !== undefined) p.set(k, v);
    return p;
  }

  function listParams() {
    return filterParams({ q: list.q, status: list.status, attention: list.attention || "", offers: list.offers || "" });
  }

  const fmtWhen = iso => new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: meta ? meta.timezone : undefined,
  });
  const fmtLong = iso => new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: meta ? meta.timezone : undefined,
  });

  function stars(n) {
    return h("span", { class: "stars", "aria-label": `${n} out of 5 stars` },
      "★".repeat(n), h("span", { class: "off" }, "★".repeat(5 - n)));
  }
  const statusChip = s => h("span", { class: `chip ${s}` }, STATUS_LABELS[s] || s);

  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  async function busy(fn) {
    const main = $("main");
    main.classList.add("loading");
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ApiError && e.message === "Please sign in.")) toast(e.message);
    } finally {
      main.classList.remove("loading");
    }
  }

  // ------------------------------------------------------------ sign-in
  function showLogin() {
    closeDrawer();
    $("app-view").hidden = true;
    $("login-view").hidden = false;
    $("login-user").focus();
  }

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("login-error");
    err.hidden = true;
    const username = $("login-user").value.trim();
    const password = $("login-pass").value;
    if (!username || !password) {
      err.textContent = "Enter your username and password.";
      err.hidden = false;
      return;
    }
    $("login-btn").disabled = true;
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      $("login-pass").value = "";
      await start();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      $("login-btn").disabled = false;
    }
  });

  $("logout").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  async function start() {
    const me = await api("/api/admin/me");
    if (!meta) {
      meta = await api("/api/admin/meta");
      setUpFilters();
    }
    $("who").textContent = `Signed in as ${me.username}`;
    $("pw-banner").hidden = !me.default_password;
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    await refresh();
  }

  // ------------------------------------------------------------ filters
  function setUpFilters() {
    for (const b of meta.branches) $("f-branch").append(h("option", { value: b.id }, b.name));
    for (const s of meta.services) $("f-service").append(h("option", { value: s.value }, s.label));
    const groups = { 0: "Visit", 1: "Required questions", 2: "Optional questions" };
    for (const step of [1, 2]) {
      const g = h("optgroup", { label: groups[step] });
      for (const q of meta.questions.filter(x => x.step === step)) {
        const scope = q.services ? ` (${q.services.map(v => meta.services.find(s => s.value === v).label).join(", ")})` : "";
        g.append(h("option", { value: q.key }, q.title + scope));
      }
      $("q-pick").append(g);
    }
    $("q-pick").value = "improve_most";
    paintRange();
  }

  function paintRange() {
    document.querySelectorAll("#range button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.range === filters.range)));
    $("custom-range").hidden = filters.range !== "custom";
  }

  $("range").addEventListener("click", e => {
    const b = e.target.closest("button[data-range]");
    if (!b) return;
    filters.range = b.dataset.range;
    if (filters.range === "custom" && !filters.date_from) {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 29);
      $("date-from").value = filters.date_from = isoDate(start);
      $("date-to").value = filters.date_to = isoDate(today);
    }
    paintRange();
    list.page = 1;
    refresh();
  });
  for (const id of ["date-from", "date-to"]) {
    $(id).addEventListener("change", () => {
      filters.date_from = $("date-from").value;
      filters.date_to = $("date-to").value;
      list.page = 1;
      refresh();
    });
  }
  $("f-branch").addEventListener("change", e => { filters.branch = e.target.value; list.page = 1; refresh(); });
  $("f-service").addEventListener("change", e => { filters.service = e.target.value; list.page = 1; refresh(); });

  function refresh() {
    $("export").href = "/api/admin/export.xlsx?" + listParams().toString();
    return view === "overview" ? loadOverview() : loadResponses();
  }

  // ------------------------------------------------------------ tabs
  function setView(next) {
    view = next;
    for (const b of document.querySelectorAll(".tabs [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.view === view));
    $("view-overview").hidden = view !== "overview";
    $("view-responses").hidden = view !== "responses";
    refresh();
  }
  document.querySelector(".tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });

  // ------------------------------------------------------------ overview
  function bars(el, items, total, emptyText) {
    el.replaceChildren();
    if (!total) {
      el.append(h("p", { class: "empty" }, emptyText || "No answers yet for these filters."));
      return;
    }
    const max = Math.max(...items.map(i => i.n), 1);
    for (const i of items) {
      const pct = Math.round((100 * i.n) / total);
      const fill = h("span", { class: "bar-fill" });
      fill.style.setProperty("--p", i.n / max);
      const row = h("div", { class: "bar-row", tabindex: "0", "aria-label": `${i.label}: ${i.n} (${pct}%)` },
        h("span", { class: "bar-label" }, i.label),
        h("span", { class: "bar-track" }, fill, h("span", { class: "bar-value" }, h("b", null, String(i.n)), ` · ${pct}%`)));
      row.dataset.tipTitle = i.label;
      row.dataset.tipValue = `${i.n} of ${total} answers · ${pct}%`;
      el.append(row);
    }
  }

  function starBars(el, items) {
    el.replaceChildren();
    const rated = items.filter(i => i.n > 0);
    if (!rated.length) {
      el.append(h("p", { class: "empty" }, "No star ratings yet for these filters."));
      return;
    }
    for (const i of rated) {
      const fill = h("span", { class: "bar-fill" });
      fill.style.setProperty("--p", i.avg / 5);
      const row = h("div", { class: "bar-row", tabindex: "0", "aria-label": `${i.title}: ${i.avg.toFixed(1)} out of 5 from ${i.n} answers` },
        h("span", { class: "bar-label" }, i.title),
        h("span", { class: "bar-track" }, fill, h("span", { class: "bar-value" }, h("b", null, i.avg.toFixed(1)), ` /5 · ${i.n}`)));
      row.dataset.tipTitle = i.title;
      row.dataset.tipValue = `${i.avg.toFixed(2)} out of 5 · ${i.n} answers`;
      el.append(row);
    }
  }

  async function loadOverview() {
    await busy(async () => {
      const params = filterParams();
      const [s, q] = await Promise.all([
        api("/api/admin/stats?" + params),
        api(`/api/admin/breakdown/${encodeURIComponent($("q-pick").value)}?` + params),
      ]);
      renderStats(s);
      renderQuestion(q);
    });
  }

  function renderStats(s) {
    $("t-total").textContent = s.total.toLocaleString("en");
    $("t-total-sub").textContent = s.total ? `${s.unreviewed.toLocaleString("en")} not reviewed yet` : "No responses in this period";
    $("t-food").replaceChildren(s.avg_food !== null ? s.avg_food.toFixed(1) : "–", h("small", null, s.avg_food !== null ? " / 5" : ""));
    $("t-food-sub").textContent = s.total ? `From ${s.total.toLocaleString("en")} responses` : "";
    $("t-return").textContent = s.return_pct !== null ? `${s.return_pct}%` : "–";
    $("t-return-sub").textContent = s.return_n ? `Of ${s.return_n.toLocaleString("en")} who answered` : "";
    $("t-attn").textContent = s.attention_open.toLocaleString("en");
    $("t-attn-sub").textContent = `Not reviewed yet · ${s.attention.toLocaleString("en")} in this period`;
    $("t-attn-tile").classList.toggle("alert", s.attention_open > 0);
    $("t-attn-go").hidden = s.attention_open === 0;
    $("open-count").textContent = s.attention_open;
    $("open-count").hidden = s.attention_open === 0;

    bars($("c-food"), s.food_dist.map(d => ({ label: `${d.value} ${d.value === 1 ? "star" : "stars"}`, n: d.n })), s.total,
      "No responses yet for these filters.");
    bars($("c-service"), s.by_service.map(d => ({ label: d.label, n: d.n })), s.total, "No responses yet for these filters.");
    starBars($("c-stars"), s.star_questions);

    const body = $("c-branches");
    body.replaceChildren();
    for (const b of s.by_branch) {
      const meter = h("span", { class: "meter", "aria-hidden": "true" }, h("i"));
      meter.firstChild.style.width = `${b.avg_food ? (b.avg_food / 5) * 100 : 0}%`;
      body.append(h("tr", null,
        h("td", null, h("button", { type: "button", class: "cell-link", onclick: () => pickBranch(b.branch) }, b.name)),
        h("td", { class: "n" }, b.total.toLocaleString("en")),
        h("td", { class: "num" }, b.avg_food !== null ? [meter, b.avg_food.toFixed(1)] : "–"),
        h("td", { class: "n" }, b.return_pct !== null ? `${b.return_pct}%` : "–"),
        h("td", { class: "n" }, b.attention ? h("span", { class: "chip crit" }, b.attention) : "0"),
      ));
    }
  }

  function renderQuestion(q) {
    const scope = q.respondents ? `${q.respondents.toLocaleString("en")} customers answered` : "No answers yet for these filters";
    $("c-q-hint").textContent = q.kind === "multi" ? `${scope}. Customers could pick more than one.` : scope;
    bars($("c-question"), q.items.map(i => ({ label: i.label, n: i.n })), q.respondents);
  }

  $("q-pick").addEventListener("change", () => busy(async () => {
    renderQuestion(await api(`/api/admin/breakdown/${encodeURIComponent($("q-pick").value)}?` + filterParams()));
  }));

  function pickBranch(id) {
    filters.branch = id;
    $("f-branch").value = id;
    list.page = 1;
    refresh();
    window.scrollTo({ top: 0 });
  }

  $("t-attn-go").addEventListener("click", () => {
    list.attention = true;
    list.status = "new";
    list.page = 1;
    $("r-attn").checked = true;
    $("r-status").value = "new";
    setView("responses");
  });

  // ------------------------------------------------------------ responses
  async function loadResponses() {
    await busy(async () => {
      const p = listParams();
      p.set("page", list.page);
      p.set("page_size", list.pageSize);
      p.set("sort", list.sort);
      const data = await api("/api/admin/responses?" + p);
      list.total = data.total;
      renderRows(data.items);
    });
  }

  function renderRows(items) {
    const body = $("r-body");
    body.replaceChildren();
    for (const r of items) {
      const tr = h("tr", { tabindex: "0", "data-id": r.id, "aria-label": `Open response ${r.reference_code}` },
        h("td", { class: "num" }, fmtWhen(r.submitted_at)),
        h("td", null, r.branch_name),
        h("td", null, r.service_name),
        h("td", null, stars(r.food_rating)),
        h("td", null, RETURN_LABELS[r.would_return] || "–"),
        h("td", null, r.needs_attention
          ? h("span", { class: "chip crit", title: r.issues.join("\n") }, `${r.issues.length} ${r.issues.length === 1 ? "issue" : "issues"}`)
          : "–"),
        h("td", null, statusChip(r.status)),
        h("td", null, r.customer_name || r.customer_phone || "–"),
        h("td", null, h("div", { class: "snippet" }, r.comments || "–")),
      );
      body.append(tr);
    }
    $("r-empty").hidden = items.length > 0;
    const first = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
    const last = Math.min(list.page * list.pageSize, list.total);
    $("r-range").textContent = list.total ? `${first}–${last} of ${list.total.toLocaleString("en")}` : "";
    $("r-prev").disabled = list.page <= 1;
    $("r-next").disabled = last >= list.total;
  }

  $("r-body").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openDrawer(tr.dataset.id, tr);
  });
  $("r-body").addEventListener("keydown", e => {
    const tr = e.target.closest("tr[data-id]");
    if (tr && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openDrawer(tr.dataset.id, tr);
    }
  });

  let searchTimer = 0;
  $("r-q").addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { list.q = e.target.value.trim(); list.page = 1; refresh(); }, 300);
  });
  $("r-status").addEventListener("change", e => { list.status = e.target.value; list.page = 1; refresh(); });
  $("r-attn").addEventListener("change", e => { list.attention = e.target.checked; list.page = 1; refresh(); });
  $("r-offers").addEventListener("change", e => { list.offers = e.target.checked; list.page = 1; refresh(); });
  $("r-sort").addEventListener("change", e => { list.sort = e.target.value; list.page = 1; refresh(); });
  $("r-prev").addEventListener("click", () => { list.page -= 1; refresh(); });
  $("r-next").addEventListener("click", () => { list.page += 1; refresh(); });

  // ------------------------------------------------------------ detail drawer
  async function openDrawer(id, from) {
    lastFocus = from || document.activeElement;
    try {
      const r = await api(`/api/admin/responses/${id}`);
      openId = id;
      renderDrawer(r);
      $("scrim").hidden = false;
      $("drawer").hidden = false;
      $("d-close").focus();
    } catch (e) {
      toast(e.message);
    }
  }

  function closeDrawer() {
    if ($("drawer").hidden) return;
    $("drawer").hidden = true;
    $("scrim").hidden = true;
    openId = null;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  $("d-close").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("pw-modal").hidden) closeModal();
    else closeDrawer();
  });

  function digits(phone) {
    const d = (phone || "").replace(/\D/g, "");
    return d.startsWith("0") ? "92" + d.slice(1) : d;
  }

  function renderDrawer(r) {
    $("d-ref").textContent = r.reference_code;
    $("d-when").textContent = fmtLong(r.submitted_at);
    const body = $("d-body");
    body.replaceChildren();

    body.append(h("div", { class: "chips" },
      h("span", { class: "chip plain" }, r.branch_name),
      h("span", { class: "chip plain" }, r.service_name),
      h("span", { class: "chip plain" }, `Filled in ${{ ur: "Urdu", roman: "Roman Urdu" }[r.language] || "English"}`),
      h("span", { class: "chip plain" }, "Food ", stars(r.food_rating)),
    ));

    if (r.issues.length) {
      body.append(h("div", null,
        h("p", { class: "issues-title" }, "Needs attention"),
        h("ul", { class: "issues" }, r.issues.map(i => h("li", null, i)))));
    }

    const seg = h("div", { class: "status-seg", role: "group", "aria-label": "Status" });
    for (const s of meta.statuses) {
      seg.append(h("button", { type: "button", "aria-pressed": String(r.status === s), onclick: () => save({ status: s }, `Marked as ${STATUS_LABELS[s].toLowerCase()}`) }, STATUS_LABELS[s]));
    }
    const note = h("textarea", { id: "d-note", maxlength: "2000", placeholder: "What was done, e.g. called the customer and sent a free meal voucher" });
    note.value = r.admin_note || "";
    body.append(h("div", null, h("p", { class: "block-title" }, "Status"), seg));
    body.append(h("div", null,
      h("p", { class: "block-title" }, h("label", { for: "d-note" }, "Team note")), note,
      h("div", { class: "note-row" }, h("button", { type: "button", class: "btn secondary", onclick: () => save({ admin_note: note.value.trim() }, "Note saved") }, "Save note"))));

    if (r.customer_name || r.customer_phone) {
      const rows = [];
      if (r.customer_name) rows.push(h("dt", null, "Name"), h("dd", null, r.customer_name));
      if (r.customer_phone) rows.push(h("dt", null, "Mobile"), h("dd", { dir: "ltr" }, r.customer_phone));
      rows.push(h("dt", null, "Wants offers"), h("dd", null, r.wants_offers ? "Yes" : "No"));
      const links = r.customer_phone ? h("div", { class: "contact-links" },
        h("a", { class: "btn secondary", href: `tel:+${digits(r.customer_phone)}` }, "Call"),
        h("a", { class: "btn secondary", href: `https://wa.me/${digits(r.customer_phone)}`, target: "_blank", rel: "noopener" }, "WhatsApp")) : null;
      body.append(h("div", null, h("p", { class: "block-title" }, "Customer"), h("dl", { class: "kv" }, rows), links));
    }

    if (r.comments) body.append(h("div", null, h("p", { class: "block-title" }, "Comment"), h("p", { class: "quote", dir: "auto" }, r.comments)));
    if (r.other_item) body.append(h("div", null, h("p", { class: "block-title" }, "Other item ordered"), h("p", { class: "quote", dir: "auto" }, r.other_item)));

    for (const s of r.sections) {
      body.append(h("div", null, h("p", { class: "block-title" }, s.title),
        h("dl", { class: "kv" }, s.rows.map(row => [h("dt", null, row.title), h("dd", null, row.value)]))));
    }
  }

  async function save(change, message) {
    if (!openId) return;
    try {
      const r = await api(`/api/admin/responses/${openId}`, { method: "PATCH", body: JSON.stringify(change) });
      renderDrawer(r);
      toast(message);
      const restore = document.activeElement;
      await (view === "overview" ? loadOverview() : loadResponses());
      if (restore && document.body.contains(restore)) restore.focus();
    } catch (e) {
      toast(e.message);
    }
  }

  // ------------------------------------------------------------ password
  function openModal() {
    $("pw-form").reset();
    $("pw-error").hidden = true;
    $("pw-modal").hidden = false;
    $("pw-current").focus();
  }
  function closeModal() {
    $("pw-modal").hidden = true;
  }
  $("open-password").addEventListener("click", openModal);
  $("banner-password").addEventListener("click", openModal);
  $("pw-cancel").addEventListener("click", closeModal);
  $("pw-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("pw-error");
    const current = $("pw-current").value, next = $("pw-new").value;
    let msg = "";
    if (!current || !next) msg = "Fill in all three fields.";
    else if (next.length < 8) msg = "Use at least 8 characters.";
    else if (next !== $("pw-repeat").value) msg = "The new passwords don't match.";
    if (msg) {
      err.textContent = msg;
      err.hidden = false;
      return;
    }
    $("pw-save").disabled = true;
    try {
      await api("/api/admin/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      closeModal();
      $("pw-banner").hidden = true;
      toast("Password changed. Other devices were signed out.");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      $("pw-save").disabled = false;
    }
  });

  // ------------------------------------------------------------ chart tooltip
  const tip = $("tip");
  function showTip(row, x, y) {
    tip.replaceChildren(h("b", null, row.dataset.tipValue), row.dataset.tipTitle);
    tip.hidden = false;
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(8, x + 12), window.innerWidth - w - 8)}px`;
    tip.style.top = `${Math.max(8, y - ht - 12)}px`;
  }
  document.addEventListener("pointermove", e => {
    const row = e.target.closest && e.target.closest(".bar-row");
    if (row) showTip(row, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  document.addEventListener("focusin", e => {
    const row = e.target.closest && e.target.closest(".bar-row");
    if (!row) { tip.hidden = true; return; }
    const r = row.getBoundingClientRect();
    showTip(row, r.left + r.width / 2, r.top);
  });
  document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  // ------------------------------------------------------------ boot
  start().catch(e => { if (!(e instanceof ApiError)) showLogin(); });
})();
