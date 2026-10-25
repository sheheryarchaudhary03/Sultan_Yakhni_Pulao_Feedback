(() => {
  "use strict";

  // Questions, options and branches come from static/questions.json, which the
  // server places in the page. The server checks submissions against the same file.
  const CATALOGUE = JSON.parse(document.getElementById("catalogue").textContent);
  const BRANCHES = CATALOGUE.branches;
  const OPTION_SETS = CATALOGUE.optionSets;
  const QUESTIONS = CATALOGUE.questions;
  const SUBMIT_URL = "/api/feedback";

  const L = (en, ur) => ({ en, ur });

  const UI = {
    eyebrow: L("Customer feedback", "آپ کی رائے"),
    title: L("How was your meal today?", "آج کا کھانا کیسا رہا؟"),
    lede: L("Under a minute. The extra questions at the end are optional.", "ایک منٹ سے کم وقت۔ آخر کے اضافی سوال اختیاری ہیں۔"),
    stepOf: L((a, b) => `Step ${a} of ${b}`, (a, b) => `مرحلہ ${a} از ${b}`),
    next: L("Next", "اگلا"),
    back: L("Back", "پیچھے"),
    sendNow: L("Send now", "ابھی بھیجیں"),
    submit: L("Send feedback", "فیڈبیک بھیجیں"),
    sending: L("Sending…", "بھیجا جا رہا ہے…"),
    required: L("Please answer this question.", "براہ کرم اس سوال کا جواب دیں۔"),
    fixErrors: L("Answer the highlighted questions to continue.", "آگے بڑھنے کے لیے نشان زدہ سوالوں کے جواب دیں۔"),
    branchPlaceholder: L("Choose your branch", "اپنی برانچ منتخب کریں"),
    otherItem: L("What else did you order?", "اور کیا آرڈر کیا؟"),
    name: L("Name", "نام"),
    phone: L("Mobile number", "موبائل نمبر"),
    phoneMissing: L("Enter your mobile number to get offers, like 0300 1234567.", "آفرز کے لیے اپنا موبائل نمبر لکھیں، جیسے 0300 1234567"),
    commentsPh: L("A compliment, a complaint, or anything we missed", "تعریف، شکایت، یا کوئی بھی بات جو ہم نے نہیں پوچھی"),
    ratings: [L("Very bad", "بہت برا"), L("Bad", "برا"), L("Okay", "ٹھیک ہے"), L("Good", "اچھا"), L("Excellent", "بہترین")],
    stars: L(n => n === 1 ? "1 star" : `${n} stars`, n => `${n} ستارے`),
    sendFailed: L("Your feedback didn't send. Check your internet and tap Send again.", "فیڈبیک نہیں بھیجا جا سکا۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔"),
    thanksTitle: L("Shukriya!", "شکریہ!"),
    thanksBody: L("Thank you for your feedback. We hope to serve you again soon.", "آپ کی رائے کا بہت شکریہ۔ امید ہے جلد دوبارہ آپ کی خدمت کا موقع ملے گا۔"),
    reference: L("Reference", "حوالہ نمبر"),
    again: L("Give feedback on another order", "کسی اور آرڈر پر فیڈبیک دیں"),
    follow: L("Follow us on Instagram", "انسٹاگرام پر فالو کریں"),
    orderAgain: L("Order again online", "دوبارہ آن لائن آرڈر کریں"),
    contactLead: L("Questions about your order? Contact us.", "آرڈر کے بارے میں کوئی سوال؟ ہم سے رابطہ کریں۔")
  };

  const SIX = L("Six quick questions.", "صرف چھ آسان سوال۔");
  const STEPS = [
    { label: L("Visit", "برانچ"), title: L("Your order", "آپ کا آرڈر"), sub: L("Pick your branch, then tap how you got your order.", "اپنی برانچ منتخب کریں، پھر بتائیں آرڈر کیسے لیا۔") },
    { service: true },
    { label: L("Optional", "اختیاری"), title: L("A few more, if you have time", "وقت ہو تو چند مزید سوال"), sub: L("All optional. Answer any you like, then tap Send.", "سب سوال اختیاری ہیں۔ جتنے چاہیں جواب دیں، پھر بھیج دیں۔") }
  ];
  const SERVICE_STEP = {
    dine_in: { label: L("Dine-in", "ڈائن اِن"), title: L("Your visit", "ریسٹورنٹ کا تجربہ"), sub: SIX },
    delivery: { label: L("Delivery", "ڈیلیوری"), title: L("Your delivery", "ڈیلیوری کا تجربہ"), sub: SIX },
    takeaway: { label: L("Takeaway", "ٹیک اوے"), title: L("Your pickup", "ٹیک اوے کا تجربہ"), sub: SIX },
    none: { label: L("Review", "رائے"), title: L("Your experience", "آپ کا تجربہ"), sub: SIX }
  };

  const byKey = Object.fromEntries(QUESTIONS.map(q => [q.key, q]));
  const LAST = STEPS.length - 1;

  const $ = id => document.getElementById(id);
  const app = $("app"), form = $("form"), list = $("questions"), formMsg = $("form-msg");
  const submitBtn = $("submit"), sendNowBtn = $("send-now"), backBtn = $("back"), thanks = $("thanks"), intro = $("intro");

  let lang = "en";
  try { if (localStorage.getItem("syp-feedback-lang") === "ur") lang = "ur"; } catch (_) { /* storage unavailable */ }
  const tr = x => x[lang];

  let answers, text, current;
  reset();

  function reset() {
    answers = {};
    text = {};
    current = 0;
    branchFromHash();
  }
  function branchFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (BRANCHES.some(b => b.id === id)) answers.branch = id;
  }

  const ordered = a => (a.items || []).filter(v => v !== "other");

  function optionsOf(q) {
    const spec = q.options;
    if (!spec) return [];
    if (Array.isArray(spec)) return spec;
    if (spec === "@ordered") return OPTION_SETS.menu.filter(m => ordered(answers).includes(m.value));
    return OPTION_SETS[spec.slice(1)];
  }
  // Same rules as catalogue.visible on the server.
  function isVisible(q) {
    const w = q.when || {};
    if (w.service && !w.service.includes(answers.service)) return false;
    if (w.ordered_any && !(answers.items || []).some(v => w.ordered_any.includes(v))) return false;
    if (w.ordered_min && ordered(answers).length < w.ordered_min) return false;
    for (const [key, allowed] of Object.entries(w.answer || {})) {
      if (!allowed.includes(answers[key])) return false;
    }
    return true;
  }
  const titleOf = q => (q.titleByService ? q.titleByService[answers.service] : q.title) || L("", "");
  const isAnswered = q => {
    if (q.kind === "text") return Boolean((text[q.key] || "").trim());
    const v = answers[q.key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  };
  const validPhone = v => /^(03\d{9}|923\d{9})$/.test((v || "").replace(/\D/g, ""));
  const smooth = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const stepInfo = i => STEPS[i].service ? SERVICE_STEP[answers.service || "none"] : STEPS[i];

  const STAR_PATH = "M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.02l-5.64 2.96 1.08-6.29L2.87 9.24l6.31-.92z";
  const ICONS = {
    dine_in: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12.5" cy="12" r="5"/><circle cx="12.5" cy="12" r="2.4"/><path d="M3.5 3.5V8a1.5 1.5 0 0 0 3 0V3.5M5 9.5v11M20.5 3.5c-1.4.9-2 2.7-2 5.5h2v11.5"/></svg>',
    takeaway: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></svg>',
    delivery: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="17" r="2.5"/><path d="M8 17h6.5l2.5-6h3"/><path d="M14.5 17L12 11H9.5"/><path d="M17 11l-1.5-4H13"/><rect x="2.5" y="7" width="6" height="5" rx="1"/></svg>'
  };

  function bodyHTML(q) {
    const k = q.key;
    if (q.kind === "select") {
      return `<div class="select"><select id="branch-input" name="branch" aria-labelledby="${k}-title">` +
        `<option value="">${tr(UI.branchPlaceholder)}</option>` +
        BRANCHES.map(b => `<option value="${b.id}">${b.name}</option>`).join("") + `</select></div>`;
    }
    if (q.kind === "cards") {
      return `<div class="choices" role="radiogroup" aria-labelledby="${k}-title">` +
        optionsOf(q).map(op =>
          `<label class="choice"><input type="radio" name="${k}" value="${op.value}" id="${k}-${op.value}">` +
          `<span>${ICONS[op.value] || ""}${tr(op)}</span></label>`
        ).join("") + `</div>`;
    }
    if (q.kind === "stars") {
      return `<div class="stars" role="radiogroup" aria-labelledby="${k}-title">` +
        [1, 2, 3, 4, 5].map(n =>
          `<label class="star" data-n="${n}"><input type="radio" name="${k}" value="${n}" id="${k}-${n}" aria-label="${tr(UI.stars)(n)}, ${tr(UI.ratings[n - 1])}">` +
          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg></label>`
        ).join("") + `</div><p class="star-caption" id="${k}-caption" aria-hidden="true"></p>`;
    }
    if (q.kind === "text") {
      return `<textarea id="comments" data-text="comments" rows="3" maxlength="1000" aria-labelledby="${k}-title" placeholder="${tr(UI.commentsPh)}"></textarea>`;
    }
    const multi = q.kind === "multi";
    let html = `<div class="pills" role="${multi ? "group" : "radiogroup"}" aria-labelledby="${k}-title">` +
      optionsOf(q).map(op =>
        `<label class="pill"><input type="${multi ? "checkbox" : "radio"}" name="${k}" value="${op.value}" id="${k}-${op.value}">` +
        `<span>${tr(op)}</span></label>`
      ).join("") + `</div>`;
    if (k === "items") {
      html += `<div class="extra single" id="items-extra" hidden><div class="field">` +
        `<label for="other_item">${tr(UI.otherItem)}</label>` +
        `<input id="other_item" data-text="other_item" type="text" maxlength="80"></div></div>`;
    }
    if (k === "offers") {
      html += `<div class="extra" id="offers-extra" hidden>` +
        `<div class="field"><label for="name">${tr(UI.name)}</label><input id="name" data-text="name" type="text" autocomplete="name" maxlength="80"></div>` +
        `<div class="field"><label for="phone">${tr(UI.phone)}</label><input id="phone" data-text="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" dir="ltr" placeholder="03XX XXXXXXX"></div></div>`;
    }
    return html;
  }

  function questionHTML(q) {
    if (q.kind === "group") {
      return `<div class="group-head" id="q-${q.key}" hidden><h3></h3></div>`;
    }
    const hint = q.hint ? `<p class="q-hint">${tr(q.hint)}</p>` : "";
    return `<section class="q" id="q-${q.key}" data-key="${q.key}" hidden>
      <div class="q-head"><span class="q-num" aria-hidden="true"></span><div><h3 class="q-title" id="${q.key}-title">${tr(q.title)}</h3>${hint}</div></div>
      <div class="q-body">${bodyHTML(q)}</div>
      <p class="q-error" id="${q.key}-error" hidden></p>
    </section>`;
  }

  function checkSaved(q) {
    const v = answers[q.key];
    if (!v) return;
    if (q.kind === "select") { $("branch-input").value = v; return; }
    (Array.isArray(v) ? v : [v]).forEach(x => { const el = $(`${q.key}-${x}`); if (el) el.checked = true; });
  }

  function render() {
    app.lang = lang;
    app.dir = lang === "ur" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    document.querySelectorAll("[data-t]").forEach(el => { el.textContent = tr(UI[el.dataset.t]); });

    list.innerHTML = QUESTIONS.map(questionHTML).join("");
    QUESTIONS.forEach(checkSaved);
    list.querySelectorAll("[data-text]").forEach(el => { el.value = text[el.dataset.text] || ""; });
    $("q-favorite").dataset.sig = optionsOf(byKey.favorite).map(x => x.value).join(",");
    formMsg.hidden = true;
    sync();
  }

  // The favourite question only offers the dishes the customer ordered.
  function refreshFavorite() {
    const q = byKey.favorite;
    const opts = optionsOf(q);
    if (answers.favorite && !opts.some(x => x.value === answers.favorite)) delete answers.favorite;
    const sec = $("q-favorite");
    const sig = opts.map(x => x.value).join(",");
    if (sec.dataset.sig === sig) return;
    sec.dataset.sig = sig;
    sec.querySelector(".q-body").innerHTML = bodyHTML(q);
    checkSaved(q);
  }

  function sync() {
    refreshFavorite();
    let shown = 0;
    QUESTIONS.forEach(q => {
      const sec = $("q-" + q.key);
      const visible = q.step === current && isVisible(q);
      sec.hidden = !visible;
      if (!visible) return;
      if (q.kind === "group") {
        sec.firstElementChild.textContent = tr(titleOf(q));
        return;
      }
      shown++;
      sec.querySelector(".q-num").textContent = shown;
      if (q.kind === "stars") {
        const v = answers[q.key] || 0;
        sec.querySelectorAll(".star").forEach(s => s.classList.toggle("on", Number(s.dataset.n) <= v));
        $(q.key + "-caption").textContent = v ? tr(UI.ratings[v - 1]) : "";
      }
    });
    $("items-extra").hidden = !(answers.items || []).includes("other");
    $("offers-extra").hidden = answers.offers !== "yes";

    document.querySelectorAll("#steps li").forEach((li, i) => {
      li.className = i < current ? "done" : i === current ? "current" : "";
      if (i === current) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      li.querySelector(".step-label").textContent = tr(stepInfo(i).label);
    });
    const info = stepInfo(current);
    $("step-kicker").textContent = tr(UI.stepOf)(current + 1, STEPS.length);
    $("step-title").textContent = tr(info.title);
    $("step-sub").textContent = tr(info.sub);

    backBtn.hidden = current === 0;
    submitBtn.hidden = current === 0;
    sendNowBtn.hidden = current !== 1;
    submitBtn.textContent = tr(current === LAST ? UI.submit : UI.next);
  }

  function showError(q, msg) {
    $("q-" + q.key).classList.toggle("invalid", Boolean(msg));
    const err = $(q.key + "-error");
    err.textContent = msg;
    err.hidden = !msg;
  }

  // Checks the current step; shows what's missing and returns false if anything is.
  function stepIsValid() {
    const failed = [];
    QUESTIONS.forEach(q => {
      if (q.step !== current || q.kind === "group" || !isVisible(q)) return;
      let msg = "";
      if (q.required && !isAnswered(q)) msg = tr(UI.required);
      if (q.key === "offers" && answers.offers === "yes" && !validPhone(text.phone)) msg = tr(UI.phoneMissing);
      showError(q, msg);
      if (msg) failed.push(q);
    });
    if (!failed.length) {
      formMsg.hidden = true;
      return true;
    }
    formMsg.textContent = tr(UI.fixErrors);
    formMsg.hidden = false;
    const first = failed[0];
    const sec = $("q-" + first.key);
    sec.scrollIntoView({ behavior: smooth(), block: "center" });
    const target = first.key === "offers" && answers.offers === "yes" ? $("phone") : sec.querySelector("input, select");
    if (target) target.focus({ preventScroll: true });
    return false;
  }

  function goTo(step) {
    current = step;
    formMsg.hidden = true;
    QUESTIONS.forEach(q => { if (q.kind !== "group") showError(q, ""); });
    sync();
    $("panel").scrollIntoView({ behavior: smooth(), block: "start" });
    $("step-title").focus({ preventScroll: true });
  }

  list.addEventListener("change", e => {
    const el = e.target;
    if (el.dataset.text) return;
    const sec = el.closest(".q");
    if (!sec) return;
    const q = byKey[sec.dataset.key];
    if (q.kind === "multi") {
      answers[q.key] = [...sec.querySelectorAll(`input[name="${q.key}"]:checked`)].map(x => x.value);
    } else {
      answers[q.key] = q.kind === "stars" ? Number(el.value) : el.value;
    }
    if (q.required) showError(q, "");
    if (q.key === "offers" && answers.offers !== "yes") showError(q, "");
    sync();
    if (q.key === "branch" && answers.branch && answers.service) moveOn();
  });

  // The first step has no Next button: picking the order type (with a branch chosen)
  // moves straight on. Arrow keys only select; Enter or Space confirms.
  let moveTimer = 0;
  function moveOn() {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (current === 0) goTo(1); }, 300);
  }
  function servicePicked(value) {
    answers.service = value;
    if (answers.branch) moveOn();
    else stepIsValid();
  }
  list.addEventListener("click", e => {
    const el = e.target;
    if (current !== 0 || el.name !== "service" || e.detail === 0) return;
    servicePicked(el.value);
  });
  list.addEventListener("keydown", e => {
    const el = e.target;
    if (current !== 0 || el.name !== "service" || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    servicePicked(el.value);
  });

  list.addEventListener("input", e => {
    const el = e.target;
    if (!el.dataset.text) return;
    text[el.dataset.text] = el.value;
    if (el.dataset.text === "phone" && validPhone(el.value)) showError(byKey.offers, "");
  });

  document.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem("syp-feedback-lang", lang); } catch (_) { /* storage unavailable */ }
    render();
  }));

  window.addEventListener("hashchange", () => {
    branchFromHash();
    checkSaved(byKey.branch);
    sync();
  });

  backBtn.addEventListener("click", () => { if (current > 0) goTo(current - 1); });

  function buildPayload() {
    const given = {};
    QUESTIONS.forEach(q => {
      if (["group", "text"].includes(q.kind) || !isVisible(q) || !isAnswered(q)) return;
      given[q.key] = answers[q.key];
    });
    const offers = answers.offers === "yes";
    return {
      language: lang,
      answers: given,
      comments: (text.comments || "").trim(),
      other_item: (answers.items || []).includes("other") ? (text.other_item || "").trim() : "",
      name: offers ? (text.name || "").trim() : "",
      phone: offers ? (text.phone || "").trim() : "",
      website: $("website").value
    };
  }

  // Resolves to the reference code; rejects with a message to show.
  async function send(payload) {
    let res;
    try {
      res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (_) {
      throw new Error(tr(UI.sendFailed));
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : tr(UI.sendFailed));
    return body.reference;
  }

  async function finish(button) {
    submitBtn.disabled = sendNowBtn.disabled = backBtn.disabled = true;
    button.textContent = tr(UI.sending);
    try {
      const reference = await send(buildPayload());
      $("thanks-code").textContent = reference || "";
      $("thanks-ref").hidden = !reference;
      form.hidden = true;
      intro.hidden = true;
      thanks.hidden = false;
      window.scrollTo(0, 0);
      $("thanks-title").focus();
    } catch (err) {
      formMsg.textContent = err.message;
      formMsg.hidden = false;
    } finally {
      submitBtn.disabled = sendNowBtn.disabled = backBtn.disabled = false;
      sendNowBtn.textContent = tr(UI.sendNow);
      sync();
    }
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!stepIsValid()) return;
    if (current < LAST) goTo(current + 1);
    else finish(submitBtn);
  });

  // Lets customers skip the optional step once the six required questions are answered.
  sendNowBtn.addEventListener("click", () => {
    if (stepIsValid()) finish(sendNowBtn);
  });

  $("again").addEventListener("click", () => {
    reset();
    $("website").value = "";
    thanks.hidden = true;
    intro.hidden = false;
    form.hidden = false;
    render();
    window.scrollTo(0, 0);
  });

  render();
})();
