/* =========================================================================
   N2 語彙 道場 — App logic
   ========================================================================= */
(function () {
  "use strict";

  const VOCAB = (typeof N2_VOCAB !== "undefined" ? N2_VOCAB : null) || [];
  const CATS = (typeof VOCAB_CATEGORIES !== "undefined" ? VOCAB_CATEGORIES : null) || {};
  const TIERS = (typeof VOCAB_TIERS !== "undefined" ? VOCAB_TIERS : null) || {};
  const DAY = 86400000;
  const STORE_KEY = "monvocab.v1";

  /* ----------------------------- Helpers -------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function todayStr(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function yesterdayStr() {
    const d = new Date(); d.setDate(d.getDate() - 1); return todayStr(d);
  }

  /* ----------------------------- Storage -------------------------------- */
  const DEFAULT_STATE = {
    srs: {},
    stats: { totalReviews: 0, totalCorrect: 0, totalWrong: 0, sessions: 0, streak: 0, lastStudyDay: null, challengeBest: 0, history: {} },
    settings: { theme: "dark", dailyGoal: 20, sound: false },
  };
  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const p = JSON.parse(raw);
      return { srs: p.srs || {}, stats: Object.assign({}, DEFAULT_STATE.stats, p.stats || {}), settings: Object.assign({}, DEFAULT_STATE.settings, p.settings || {}) };
    } catch (e) { return clone(DEFAULT_STATE); }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }, 120);
  }

  /* ----------------------------- SRS ------------------------------------ */
  function ensureSrs(id) {
    if (!state.srs[id]) state.srs[id] = { reps: 0, ease: 2.5, interval: 0, due: 0, seen: 0, correct: 0, wrong: 0, lapses: 0, lastQ: -1 };
    return state.srs[id];
  }
  function gradeSrs(s, q) {
    if (q >= 3) {
      if (s.reps === 0) s.interval = 1;
      else if (s.reps === 1) s.interval = 3;
      else s.interval = Math.round(s.interval * s.ease);
      s.reps += 1;
      s.ease = clamp(s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3, 2.7);
    } else {
      s.reps = 0; s.lapses += 1; s.interval = 1;
      s.ease = clamp(s.ease - 0.2, 1.3, 2.7);
    }
    s.due = Date.now() + s.interval * DAY;
  }
  function record(id, correct, quality, useSrs) {
    const s = ensureSrs(id);
    s.seen += 1;
    if (correct) s.correct += 1; else s.wrong += 1;
    if (useSrs) gradeSrs(s, quality);
    const st = state.stats;
    st.totalReviews += 1;
    if (correct) st.totalCorrect += 1; else st.totalWrong += 1;
    const t = todayStr();
    const h = st.history[t] || (st.history[t] = { reviews: 0, correct: 0 });
    h.reviews += 1; if (correct) h.correct += 1;
    bumpStreak(); save();
  }
  function bumpStreak() {
    const st = state.stats, t = todayStr();
    if (st.lastStudyDay === t) return;
    st.streak = st.lastStudyDay === yesterdayStr() ? st.streak + 1 : 1;
    st.lastStudyDay = t;
  }
  function displayStreak() {
    const st = state.stats, t = todayStr();
    if (st.lastStudyDay === t || st.lastStudyDay === yesterdayStr()) return st.streak;
    return 0;
  }
  function masteryOf(id) {
    const s = state.srs[id];
    if (!s || s.seen === 0) return "new";
    if (s.reps >= 5 && s.interval >= 21) return "mastered";
    if (s.reps >= 3) return "young";
    return "learning";
  }
  const MASTERY_LABEL = { new: "New", learning: "In progress", young: "Consolidated", mastered: "Mastered" };
  function accuracyOf(id) { const s = state.srs[id]; return (!s || s.seen === 0) ? null : s.correct / s.seen; }
  function isDue(v) { const s = state.srs[v.id]; return s && s.seen > 0 && s.due <= Date.now(); }
  function isNew(v) { const s = state.srs[v.id]; return !s || s.seen === 0; }

  /* ----------------------------- Question picker ----------------------- */
  function pickQuestion(vid) {
    const v = byId(vid), s = ensureSrs(vid), n = v.qs.length;
    return { vid, qi: n ? (s.lastQ + 1) % n : 0 };
  }
  const _byId = {};
  VOCAB.forEach((v) => (_byId[v.id] = v));
  function byId(id) { return _byId[id]; }

  /* ----------------------------- Audio ---------------------------------- */
  let actx = null;
  function beep(ok) {
    if (!state.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.connect(g); g.connect(actx.destination);
      o.type = "sine"; o.frequency.value = ok ? 660 : 220;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18);
      o.start(); o.stop(actx.currentTime + 0.2);
    } catch (e) {}
  }

  /* ----------------------------- Toast ---------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ----------------------------- Theme ---------------------------------- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    const ic = $("#themeIc");
    if (ic) ic.innerHTML = state.settings.theme === "dark"
      ? '<path d="M21 12.8A8.5 8.5 0 0 1 11.2 3 7 7 0 1 0 21 12.8Z"/>'
      : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"/>';
  }
  function toggleTheme() { state.settings.theme = state.settings.theme === "dark" ? "light" : "dark"; applyTheme(); save(); }

  /* =====================================================================
     ROUTER
     ===================================================================== */
  const VIEWS = ["dashboard", "practice", "flash", "challenge", "reference"];
  let current = "dashboard";
  function go(view) {
    if (current === "challenge") stopChallenge();
    current = view;
    VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== view));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    $$("#bottomnav button").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
    render(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function render(v) {
    if (v === "dashboard") renderDashboard();
    else if (v === "practice") renderPracticeSetup();
    else if (v === "flash") renderFlash();
    else if (v === "challenge") renderChallengeIntro();
    else if (v === "reference") renderReference();
  }

  /* ----------------------------- Shared components --------------------- */
  function catBadge(c) {
    const cat = CATS[c] || { label: c, color: "#888" };
    return `<span class="badge cat" style="background:${cat.color}">${esc(cat.label)}</span>`;
  }
  function catIcon(c) {
    const cat = CATS[c] || { icon: "?", color: "#888" };
    return `<span class="cat-ic" style="background:${cat.color}">${esc(cat.icon)}</span>`;
  }
  function tierBadge(lv) { return `<span class="badge tier">${esc(TIERS[lv] || "—")}</span>`; }
  function masteryDot(id) {
    const m = masteryOf(id);
    return `<span class="dot m-${m}" title="${MASTERY_LABEL[m]}"></span>`;
  }
  function ringSVG(pct, big, small) {
    const r = 58, c = 2 * Math.PI * r, off = c * (1 - clamp(pct, 0, 1));
    return `<div class="ring"><svg viewBox="0 0 132 132">
      <defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
      </linearGradient></defs>
      <circle class="track" cx="66" cy="66" r="${r}" fill="none" stroke-width="12"/>
      <circle class="fill" cx="66" cy="66" r="${r}" fill="none" stroke-width="12"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg><div class="label"><b>${big}</b><span>${esc(small)}</span></div></div>`;
  }

  /* =====================================================================
     DASHBOARD
     ===================================================================== */
  function renderDashboard() {
    const total = VOCAB.length;
    let counts = { new: 0, learning: 0, young: 0, mastered: 0 };
    VOCAB.forEach((v) => counts[masteryOf(v.id)]++);
    const dueCount = VOCAB.filter(isDue).length;
    const newCount = counts.new;
    const seen = total - newCount;
    const acc = state.stats.totalReviews ? Math.round((state.stats.totalCorrect / state.stats.totalReviews) * 100) : 0;
    const todayRev = (state.stats.history[todayStr()] || {}).reviews || 0;
    const goal = state.settings.dailyGoal;
    const goalPct = goal ? clamp(todayRev / goal, 0, 1) : 0;
    const hour = new Date().getHours();
    const greet = hour < 5 ? "Bonne nuit" : hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
    const barColors = { new: "var(--text-faint)", learning: "var(--accent-2)", young: "var(--blue)", mastered: "var(--green)" };
    const masteryBar = ["new", "learning", "young", "mastered"]
      .map((k) => counts[k] ? `<span style="width:${(counts[k] / total) * 100}%;background:${barColors[k]}"></span>` : "").join("");
    const catRows = Object.keys(CATS).map((c) => {
      const items = VOCAB.filter((v) => v.c === c);
      const mast = items.filter((v) => masteryOf(v.id) === "mastered").length;
      const pct = items.length ? (mast / items.length) * 100 : 0;
      return `<div class="cat-row" data-cat="${c}">
        <div class="name">${catIcon(c)}${esc(CATS[c].label)}</div>
        <div class="track2"><span style="width:${pct}%;background:${CATS[c].color}"></span></div>
        <div class="frac">${mast}/${items.length}</div>
      </div>`;
    }).join("");
    const weak = VOCAB.map((v) => ({ v, a: accuracyOf(v.id), s: state.srs[v.id] }))
      .filter((x) => x.s && x.s.seen >= 2 && x.a !== null && x.a < 0.85)
      .sort((a, b) => a.a - b.a).slice(0, 6);
    const weakHTML = weak.length
      ? `<div class="weak-list">${weak.map((x) => `<div class="weak-item" data-vid="${x.v.id}">
          <span class="g jp">${esc(x.v.w)}</span><span class="pct">${Math.round(x.a * 100)}%</span>
        </div>`).join("")}</div>`
      : `<p class="faint" style="font-size:14px">No weak points yet — keep practicing!</p>`;

    $("#view-dashboard").innerHTML = `
      <div class="card pad hero">
        <div>
          <h1>${greet} ! Prêt à réviser ton <span class="jp">vocabulaire</span> ?</h1>
          <p>${dueCount > 0
            ? `<b>${dueCount}</b> mot${dueCount > 1 ? "s" : ""} à réviser${newCount ? ` · <b>${newCount}</b> à découvrir` : ""}.`
            : newCount > 0 ? `<b>${newCount}</b> mot${newCount > 1 ? "s" : ""} en attente.`
            : `Tout est à jour. Keep reviewing or try a speed challenge.`}</p>
          <div class="hero-cta">
            <button class="btn primary big" id="startSmart">Réviser</button>
            <button class="btn big ghost" data-go="challenge">Défi chrono</button>
          </div>
        </div>
        ${ringSVG(goalPct, todayRev, `/ ${goal} today`)}
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="v">${seen}<small> / ${total}</small></div><div class="k">Mots vus</div></div>
        <div class="stat"><div class="v">${counts.mastered}</div><div class="k">Mots acquis</div></div>
        <div class="stat"><div class="v">${acc}<small>%</small></div><div class="k">Accuracy</div></div>
        <div class="stat"><div class="v">${state.stats.totalReviews}</div><div class="k">Révisions</div></div>
      </div>
      <div class="card pad" style="margin-top:18px">
        <div class="section-title">Mastery progress</div>
        <div class="bar-mastery">${masteryBar}</div>
        <div class="legend">
          <div><span class="dot m-mastered"></span><b>${counts.mastered}</b> Mastered</div>
          <div><span class="dot m-young"></span><b>${counts.young}</b> Consolidated</div>
          <div><span class="dot m-learning"></span><b>${counts.learning}</b> In progress</div>
          <div><span class="dot m-new"></span><b>${counts.new}</b> New</div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:18px">
        <div class="card pad"><div class="section-title">By category</div><div class="cat-rows">${catRows}</div></div>
        <div class="card pad"><div class="section-title">Weak points</div>${weakHTML}</div>
      </div>`;

    $("#startSmart").onclick = () => startSmartSession();
    $$("#view-dashboard [data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
    $$("#view-dashboard .cat-row").forEach((r) => (r.onclick = () => { refState.cat = r.dataset.cat; refState.q = ""; go("reference"); }));
    $$("#view-dashboard .weak-item").forEach((w) => (w.onclick = () => { const vid = w.dataset.vid; startSession([pickQuestion(vid)].concat(buildQueue("all", byId(vid).c, 10))); }));
  }

  /* =====================================================================
     QUEUE BUILDER
     ===================================================================== */
  function poolFor(scope, cat) {
    let pool = VOCAB.slice();
    if (cat && cat !== "all") pool = pool.filter((v) => v.c === cat);
    if (scope === "due") {
      const base = cat && cat !== "all" ? VOCAB.filter((v) => v.c === cat) : VOCAB.slice();
      pool = base.filter((v) => isDue(v) || isNew(v));
    } else if (scope === "new") {
      pool = pool.filter(isNew);
    } else if (scope === "weak") {
      pool = pool.filter((v) => { const a = accuracyOf(v.id); return a !== null && a < 0.85; })
        .sort((a, b) => accuracyOf(a.id) - accuracyOf(b.id));
    }
    return pool;
  }
  function buildQueue(scope, cat, length) {
    let pool = poolFor(scope, cat);
    if (scope !== "weak") pool = shuffle(pool);
    if (length && length > 0) pool = pool.slice(0, length);
    return pool.map((v) => pickQuestion(v.id));
  }

  /* =====================================================================
     PRACTICE SETUP
     ===================================================================== */
  const practiceCfg = { scope: "due", cat: "all", length: 20 };
  function renderPracticeSetup() {
    const scopes = [["due", "Due"], ["all", "All"], ["weak", "Weak points"], ["new", "New"]];
    const lengths = [[10, "10"], [20, "20"], [30, "30"], [0, "All"]];
    const catChips = [["all", "All"]].concat(Object.keys(CATS).map((c) => [c, CATS[c].label]));
    $("#view-practice").innerHTML = `
      <div class="setup card pad">
        <h2>Study session</h2>
        <p class="muted">Choose what to work on. Correct answers space out reviews; mistakes come back sooner.</p>
        <div class="opt-group"><label>Selection</label>
          <div class="seg" id="segScope">${scopes.map(([v, l]) => `<button data-v="${v}" class="${practiceCfg.scope === v ? "sel" : ""}">${l}</button>`).join("")}</div>
        </div>
        <div class="opt-group"><label>Category</label>
          <div class="seg" id="segCat">${catChips.map(([v, l]) => `<button data-v="${v}" class="${practiceCfg.cat === v ? "sel" : ""}">${esc(l)}</button>`).join("")}</div>
        </div>
        <div class="opt-group"><label>Session length</label>
          <div class="seg" id="segLen">${lengths.map(([v, l]) => `<button data-v="${v}" class="${practiceCfg.length === v ? "sel" : ""}">${l}</button>`).join("")}</div>
        </div>
        <div class="opt-group" style="display:flex;align-items:center;gap:12px;justify-content:space-between">
          <span class="faint" id="poolInfo"></span>
          <button class="btn primary big" id="startPractice">Start</button>
        </div>
      </div>`;
    const bind = (sel, key, numeric) => {
      $$(sel + " button").forEach((b) => (b.onclick = () => {
        practiceCfg[key] = numeric ? Number(b.dataset.v) : b.dataset.v;
        $$(sel + " button").forEach((x) => x.classList.toggle("sel", x === b));
        updatePoolInfo();
      }));
    };
    bind("#segScope", "scope", false);
    bind("#segCat", "cat", false);
    bind("#segLen", "length", true);
    $("#startPractice").onclick = () => {
      const q = buildQueue(practiceCfg.scope, practiceCfg.cat, practiceCfg.length);
      if (!q.length) { toast("No words match this selection."); return; }
      startSession(q);
    };
    updatePoolInfo();
    function updatePoolInfo() {
      const n = poolFor(practiceCfg.scope, practiceCfg.cat).length;
      $("#poolInfo").textContent = n ? `${n} word${n > 1 ? "s" : ""} available` : "No words available";
    }
  }
  function startSmartSession() {
    const q = buildQueue("due", "all", state.settings.dailyGoal || 20);
    if (!q.length) { toast("Rien à réviser — lance une session libre."); go("practice"); return; }
    go("practice"); startSession(q);
  }

  /* =====================================================================
     QUIZ RUNNER
     ===================================================================== */
  let quiz = null;
  function startSession(queue) {
    quiz = { queue, idx: 0, correct: 0, wrong: 0, answered: false, requeued: {}, startedAt: Date.now() };
    state.stats.sessions += 1; save();
    go("practice"); renderQuestion();
  }

  function renderQuestion() {
    const item = quiz.queue[quiz.idx];
    const v = byId(item.vid);
    const q = v.qs[item.qi];
    quiz.answered = false;
    const total = quiz.queue.length;
    const indices = shuffle([0, 1, 2, 3]);
    quiz.shuffledOpts = indices.map((i) => q.o[i]);
    quiz.shuffledAnswer = indices.indexOf(q.a);
    const optsHTML = quiz.shuffledOpts.map((opt, i) => `
      <button class="option" data-i="${i}">
        <span class="key">${i + 1}</span>
        <span class="txt">${esc(opt)}</span>
        <svg class="mark ic" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </button>`).join("");

    let stemHTML;
    if (q.t === "fitb") {
      stemHTML = `<div class="qtype">Fill in the blank</div>
        <div class="qstem jp">${renderStem(q.s)}</div>`;
    } else {
      stemHTML = `<div class="qtype">Que signifie ce mot ?</div>
        <div class="qword">
          <div class="jp qbig-word">${esc(v.w)}</div>
          <div class="jp qword-reading">${esc(v.r)}</div>
        </div>`;
    }

    $("#view-practice").innerHTML = `
      <div class="quiz-top">
        <button class="icon-btn" id="quitQuiz" title="Quit">
          <svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <div class="qprogress"><span style="width:${(quiz.idx / total) * 100}%"></span></div>
        <div class="quiz-count">${quiz.idx + 1}/${total}</div>
        <div class="quiz-score"><span class="ok">${quiz.correct}</span><span class="no">${quiz.wrong}</span></div>
      </div>
      <div class="qcard card pad">
        <div class="qhead">${catBadge(v.c)}</div>
        ${stemHTML}
        <div class="options" id="options">${optsHTML}</div>
        <div id="fbZone"></div>
        <div class="quiz-foot" id="foot"></div>
      </div>`;

    $("#quitQuiz").onclick = confirmQuit;
    $$("#options .option").forEach((b) => (b.onclick = () => answer(Number(b.dataset.i))));
  }

  function renderStem(text) {
    return esc(text).replace(/＿{2,}/g, '<span class="blank">?</span>');
  }

  function answer(i) {
    if (quiz.answered) return;
    quiz.answered = true;
    const item = quiz.queue[quiz.idx];
    const v = byId(item.vid);
    const q = v.qs[item.qi];
    const correct = i === quiz.shuffledAnswer;
    const srs = ensureSrs(v.id);
    srs.lastQ = item.qi;

    $$("#options .option").forEach((b, idx) => {
      b.disabled = true;
      if (idx === quiz.shuffledAnswer) b.classList.add("correct");
      else if (idx === i) b.classList.add("wrong");
      else b.classList.add("dim");
    });
    if (correct) {
      quiz.correct++;
    } else {
      quiz.wrong++;
      const opt = $$("#options .option")[i];
      if (opt) { opt.classList.add("shake"); setTimeout(() => opt.classList.remove("shake"), 420); }
      if (!quiz.requeued[v.id + ":" + item.qi]) {
        quiz.requeued[v.id + ":" + item.qi] = true;
        quiz.queue.push({ vid: v.id, qi: item.qi });
      }
    }
    beep(correct);
    record(v.id, correct, correct ? 4 : 1, true);

    const enLine = (q.t === "fitb" && q.en) ? `<div class="qfr">${esc(q.en)}</div>` : "";
    const exLine = (q.t === "meaning" && v.ex && v.ex[0])
      ? `<div class="qfr jp" style="font-size:15px;margin-top:10px">${esc(v.ex[0].jp)}</div><div class="qfr" style="font-size:13px;margin-top:2px;color:var(--text-faint)">${esc(v.ex[0].en)}</div>`
      : "";

    $("#fbZone").innerHTML = `
      <div class="feedback ${correct ? "ok" : "no"}">
        <div class="fb-head">
          ${correct
            ? '<svg viewBox="0 0 24 24" class="ic"><path d="M5 13l4 4L19 7"/></svg>Correct !'
            : '<svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg>Pas tout à fait'}
        </div>
        <div class="fb-body">
          <div class="expl">${esc(q.e)}</div>
          ${enLine}${exLine}
          <div class="mini-g">
            <span class="gp jp">${esc(v.w)}</span>
            <span class="jp" style="font-size:13px;color:var(--text-dim)">${esc(v.r)}</span>
            <span class="gm">${esc(v.m)}</span>
          </div>
        </div>
      </div>`;

    const last = quiz.idx >= quiz.queue.length - 1;
    $("#foot").innerHTML = `
      <span class="kbd-hint">Press <span class="kbd">Enter</span></span>
      <button class="btn primary" id="nextBtn">${last ? "Résultat" : "Next"}</button>`;
    $("#nextBtn").onclick = next;
    $("#fbZone").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function next() {
    quiz.idx++;
    if (quiz.idx >= quiz.queue.length) return summary();
    renderQuestion();
  }

  function summary() {
    const totalAns = quiz.correct + quiz.wrong;
    const pct = totalAns ? Math.round((quiz.correct / totalAns) * 100) : 0;
    const mins = Math.max(1, Math.round((Date.now() - quiz.startedAt) / 60000));
    const distinct = new Set(quiz.queue.map((x) => x.vid)).size;
    const msg = pct >= 90 ? "Outstanding!" : pct >= 70 ? "Good work, keep it up." : pct >= 50 ? "Making progress — keep going." : "Every mistake is a lesson. Try again?";
    $("#view-practice").innerHTML = `
      <div class="summary card pad">
        <div class="section-title">Session complete</div>
        <div class="big-pct">${pct}%</div>
        <p class="muted" style="margin-top:6px">${msg}</p>
        <div class="sline">
          <div><div class="v" style="color:var(--green)">${quiz.correct}</div><div class="k">Correct</div></div>
          <div><div class="v" style="color:var(--red)">${quiz.wrong}</div><div class="k">Errors</div></div>
          <div><div class="v">${distinct}</div><div class="k">Words seen</div></div>
          <div><div class="v">${mins}<small style="font-size:13px"> min</small></div><div class="k">Duration</div></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" id="againBtn">New session</button>
          <button class="btn ghost" data-go="dashboard">Dashboard</button>
        </div>
      </div>`;
    $("#againBtn").onclick = renderPracticeSetup;
    $$("#view-practice [data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
    quiz = null;
  }

  function confirmQuit() {
    if (!quiz || quiz.idx === 0) { renderPracticeSetup(); return; }
    openModal("Quit session?", `<p class="muted">Your progress on answered questions has been saved.</p>`, [
      { label: "Continue", kind: "ghost", act: closeModal },
      { label: "Quit", kind: "primary", act: () => { closeModal(); quiz = null; renderPracticeSetup(); } },
    ]);
  }

  /* =====================================================================
     FLASHCARDS
     ===================================================================== */
  const flashState = { cat: "all", queue: [], idx: 0, flipped: false, _cat: null };
  function renderFlash() {
    const catChips = [["all", "All"]].concat(Object.keys(CATS).map((c) => [c, CATS[c].label]));
    $("#view-flash").innerHTML = `
      <div class="flash-wrap">
        <div class="ref-controls" style="margin-bottom:14px">
          <div class="filters" id="flashCats">${catChips.map(([v, l]) => `<button class="fchip ${flashState.cat === v ? "on" : ""}" data-v="${v}">${esc(l)}</button>`).join("")}</div>
        </div>
        <div id="flashArea"></div>
      </div>`;
    $$("#flashCats .fchip").forEach((b) => (b.onclick = () => { flashState.cat = b.dataset.v; buildFlashQueue(); renderFlash(); }));
    if (!flashState.queue.length || flashState._cat !== flashState.cat) buildFlashQueue();
    renderFlashCard();
  }
  function buildFlashQueue() {
    let pool = VOCAB.slice();
    if (flashState.cat !== "all") pool = pool.filter((v) => v.c === flashState.cat);
    pool.sort((a, b) => sortKey(a) - sortKey(b));
    flashState.queue = pool.map((v) => v.id);
    flashState.idx = 0; flashState.flipped = false; flashState._cat = flashState.cat;
    function sortKey(v) {
      if (isDue(v)) return 0; if (isNew(v)) return 1;
      return 2 + (state.srs[v.id] ? state.srs[v.id].due / 1e13 : 9);
    }
  }
  function renderFlashCard() {
    const area = $("#flashArea"); if (!area) return;
    if (!flashState.queue.length) { area.innerHTML = `<div class="card pad" style="text-align:center"><p class="muted">No cards in this category.</p></div>`; return; }
    if (flashState.idx >= flashState.queue.length) {
      area.innerHTML = `<div class="summary card pad">
        <div class="section-title">Deck complete</div>
        <div class="big-pct">✓</div>
        <p class="muted">You've gone through all the cards in this selection.</p>
        <button class="btn primary" id="restartFlash">Restart</button></div>`;
      $("#restartFlash").onclick = () => { buildFlashQueue(); renderFlashCard(); };
      return;
    }
    const v = byId(flashState.queue[flashState.idx]);
    const exHTML = (v.ex || []).map((e) => `<div class="ex"><div class="j jp">${esc(e.jp)}</div><div class="f">${esc(e.en)}</div></div>`).join("");
    area.innerHTML = `
      <div class="quiz-top">
        <div class="qprogress"><span style="width:${(flashState.idx / flashState.queue.length) * 100}%"></span></div>
        <div class="quiz-count">${flashState.idx + 1}/${flashState.queue.length}</div>
      </div>
      <div class="flashcard ${flashState.flipped ? "flipped" : ""}" id="fcard">
        <div class="flash-inner">
          <div class="flash-face front">
            ${catBadge(v.c)}
            <div class="gp jp" style="margin-top:14px">${esc(v.w)}</div>
            <div class="form jp">${esc(v.r)}</div>
            <div class="flip-hint">Tap or press <span class="kbd">Space</span> to flip</div>
          </div>
          <div class="flash-face back">
            <div class="gm">${esc(v.m)}</div>
            ${tierBadge(v.lv)}
            <div class="flash-ex" style="margin-top:16px">${exHTML}</div>
          </div>
        </div>
      </div>
      <div class="flash-rate" id="flashRate">
        <button class="again" data-q="1">Again<small>&lt; 1d</small></button>
        <button class="hard" data-q="3">Hard<small>1d</small></button>
        <button class="good" data-q="4">Good<small>few days</small></button>
        <button class="easy" data-q="5">Easy<small>longer</small></button>
      </div>`;
    $("#fcard").onclick = () => { flashState.flipped = !flashState.flipped; $("#fcard").classList.toggle("flipped", flashState.flipped); };
    $$("#flashRate button").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); rateFlash(Number(b.dataset.q)); }));
  }
  function rateFlash(q) {
    const v = byId(flashState.queue[flashState.idx]);
    record(v.id, q >= 3, q, true);
    flashState.idx++; flashState.flipped = false; renderFlashCard();
  }

  /* =====================================================================
     SPEED CHALLENGE
     ===================================================================== */
  let challenge = null;
  function renderChallengeIntro() {
    stopChallenge();
    $("#view-challenge").innerHTML = `
      <div class="challenge-intro card pad">
        <h2>Défi chrono</h2>
        <p class="muted">Fill in the blank as fast as you can. Correct answers build your combo; a mistake costs 2 seconds.</p>
        <div class="opt-group"><label>Duration</label>
          <div class="seg" id="segDur">
            <button data-v="60" class="sel">60 s</button>
            <button data-v="90">90 s</button>
            <button data-v="120">120 s</button>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:12px">
          <span class="faint">Best: <b style="color:var(--gold)">${state.stats.challengeBest}</b></span>
          <button class="btn primary big" id="startChallenge">Start</button>
        </div>
      </div>`;
    let dur = 60;
    $$("#segDur button").forEach((b) => (b.onclick = () => { dur = Number(b.dataset.v); $$("#segDur button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    $("#startChallenge").onclick = () => startChallenge(dur);
  }
  function challengePool() {
    const pool = [];
    VOCAB.forEach((v) => v.qs.forEach((q, qi) => { if (q.t === "fitb" || q.t === "meaning") pool.push({ vid: v.id, qi }); }));
    return shuffle(pool);
  }
  function startChallenge(duration) {
    challenge = { dur: duration, left: duration, score: 0, combo: 0, correct: 0, total: 0, pool: challengePool(), pi: 0, answered: false, timer: null };
    challenge.timer = setInterval(tickChallenge, 1000);
    renderChallengeQ();
  }
  function tickChallenge() {
    if (!challenge) return;
    challenge.left -= 1;
    const bar = $("#cTimer"), t = $("#cTime");
    if (bar) { bar.style.width = (challenge.left / challenge.dur) * 100 + "%"; $("#cTimerWrap").classList.toggle("low", challenge.left <= 10); }
    if (t) t.textContent = challenge.left;
    if (challenge.left <= 0) endChallenge();
  }
  function stopChallenge() { if (challenge && challenge.timer) clearInterval(challenge.timer); challenge = null; }
  function renderChallengeQ() {
    if (!challenge) return;
    if (challenge.pi >= challenge.pool.length) { challenge.pool = challengePool(); challenge.pi = 0; }
    const item = challenge.pool[challenge.pi];
    const v = byId(item.vid), q = v.qs[item.qi];
    challenge.answered = false;
    const cIdx = shuffle([0, 1, 2, 3]);
    challenge.shuffledOpts = cIdx.map((i) => q.o[i]);
    challenge.shuffledAnswer = cIdx.indexOf(q.a);
    const optsHTML = challenge.shuffledOpts.map((opt, i) =>
      `<button class="option" data-i="${i}"><span class="key">${i + 1}</span><span class="txt">${esc(opt)}</span><svg class="mark ic" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>`
    ).join("");
    $("#view-challenge").innerHTML = `
      <div id="cTimerWrap" class="timer-bar ${challenge.left <= 10 ? "low" : ""}"><span id="cTimer" style="width:${(challenge.left / challenge.dur) * 100}%"></span></div>
      <div class="challenge-hud">
        <div class="time"><span id="cTime">${challenge.left}</span><span style="font-size:14px;color:var(--text-faint)">s</span></div>
        <div class="combo ${challenge.combo >= 2 ? "show" : ""}" id="cCombo">×${challenge.combo} combo</div>
        <div class="sc"><div class="v" id="cScore">${challenge.score}</div><div class="k">SCORE</div></div>
      </div>
      <div class="qcard card pad">
        <div class="qhead">${catBadge(v.c)}</div>
        <div class="qstem jp">${renderStem(q.s)}</div>
        <div class="options" id="cOptions">${optsHTML}</div>
      </div>`;
    $$("#cOptions .option").forEach((b) => (b.onclick = () => answerChallenge(Number(b.dataset.i))));
  }
  function answerChallenge(i) {
    if (!challenge || challenge.answered) return;
    challenge.answered = true;
    const item = challenge.pool[challenge.pi];
    const v = byId(item.vid), q = v.qs[item.qi];
    const correct = i === challenge.shuffledAnswer;
    challenge.total++;
    $$("#cOptions .option").forEach((b, idx) => { b.disabled = true; if (idx === challenge.shuffledAnswer) b.classList.add("correct"); else if (idx === i) b.classList.add("wrong"); });
    if (correct) {
      challenge.correct++; challenge.combo++;
      challenge.score += Math.round(10 * (1 + Math.min(challenge.combo - 1, 5) * 0.2));
      beep(true);
    } else {
      challenge.combo = 0; challenge.left = Math.max(0, challenge.left - 2); beep(false);
    }
    record(v.id, correct, correct ? 4 : 2, true);
    const sc = $("#cScore"); if (sc) { sc.textContent = challenge.score; sc.classList.add("flash-pop"); setTimeout(() => sc.classList.remove("flash-pop"), 300); }
    const cc = $("#cCombo"); if (cc) { cc.classList.toggle("show", challenge.combo >= 2); cc.textContent = "×" + challenge.combo + " combo"; }
    challenge.pi++;
    setTimeout(() => { if (challenge && challenge.left > 0) renderChallengeQ(); }, 420);
  }
  function endChallenge() {
    if (!challenge) return;
    clearInterval(challenge.timer);
    const c = challenge; challenge = null;
    const acc = c.total ? Math.round((c.correct / c.total) * 100) : 0;
    const best = c.score > state.stats.challengeBest;
    if (best) { state.stats.challengeBest = c.score; save(); }
    $("#view-challenge").innerHTML = `
      <div class="summary card pad">
        <div class="section-title">Time's up</div>
        <div class="big-pct">${c.score}</div>
        <p class="muted">${best ? "New personal best!" : "Best: " + state.stats.challengeBest}</p>
        <div class="sline">
          <div><div class="v" style="color:var(--green)">${c.correct}</div><div class="k">Correct</div></div>
          <div><div class="v">${c.total}</div><div class="k">Answers</div></div>
          <div><div class="v">${acc}<small style="font-size:13px">%</small></div><div class="k">Accuracy</div></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" id="cReplay">Play again</button>
          <button class="btn ghost" data-go="dashboard">Dashboard</button>
        </div>
      </div>`;
    $("#cReplay").onclick = renderChallengeIntro;
    $$("#view-challenge [data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  }

  /* =====================================================================
     DICTIONARY / REFERENCE
     ===================================================================== */
  const refState = { q: "", cat: "all", sort: "freq" };
  function renderReference() {
    const catChips = [["all", "All"]].concat(Object.keys(CATS).map((c) => [c, CATS[c].label]));
    $("#view-reference").innerHTML = `
      <div class="ref-controls">
        <div class="search">
          <svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="refSearch" type="search" placeholder="Search by kanji, reading, or meaning…" value="${esc(refState.q)}" autocomplete="off" />
        </div>
        <select class="mini sort-sel" id="refSort">
          <option value="freq" ${refState.sort === "freq" ? "selected" : ""}>By frequency</option>
          <option value="az" ${refState.sort === "az" ? "selected" : ""}>Alphabetical</option>
          <option value="mastery" ${refState.sort === "mastery" ? "selected" : ""}>By mastery</option>
        </select>
      </div>
      <div class="filters" id="refCats" style="margin-bottom:16px">${catChips.map(([v, l]) => `<button class="fchip ${refState.cat === v ? "on" : ""}" data-v="${v}">${esc(l)}</button>`).join("")}</div>
      <div class="ref-count" id="refCount"></div>
      <div class="ref-list" id="refList"></div>`;
    $("#refSearch").oninput = (e) => { refState.q = e.target.value; renderRefList(); };
    $("#refSort").onchange = (e) => { refState.sort = e.target.value; renderRefList(); };
    $$("#refCats .fchip").forEach((b) => (b.onclick = () => { refState.cat = b.dataset.v; renderReference(); }));
    renderRefList();
  }
  function renderRefList() {
    let list = VOCAB.slice();
    if (refState.cat !== "all") list = list.filter((v) => v.c === refState.cat);
    const q = refState.q.trim().toLowerCase();
    if (q) list = list.filter((v) => (v.w + " " + v.r + " " + v.m).toLowerCase().includes(q));
    if (refState.sort === "az") list.sort((a, b) => a.w.localeCompare(b.w, "ja"));
    else if (refState.sort === "mastery") { const ord = { new: 0, learning: 1, young: 2, mastered: 3 }; list.sort((a, b) => ord[masteryOf(a.id)] - ord[masteryOf(b.id)]); }
    else list.sort((a, b) => a.lv - b.lv || a.id.localeCompare(b.id));
    $("#refCount").textContent = `${list.length} word${list.length !== 1 ? "s" : ""}`;
    $("#refList").innerHTML = list.map(refEntry).join("") || `<div class="card pad"><p class="muted">No results for "${esc(refState.q)}".</p></div>`;
    $$("#refList .drill-btn").forEach((btn) => (btn.onclick = () => startSession([pickQuestion(btn.dataset.id)].concat(buildQueue("all", byId(btn.dataset.id).c, 8)))));
  }
  function refEntry(v) {
    const exHTML = (v.ex || []).map((e) => `<div class="ex"><div class="j jp">${esc(e.jp)}</div><div class="f">${esc(e.en)}</div></div>`).join("");
    const s = state.srs[v.id];
    const accTxt = s && s.seen ? ` · ${Math.round((s.correct / s.seen) * 100)}% on ${s.seen}` : "";
    return `<details class="gentry" id="ref-${v.id}">
      <summary>
        ${masteryDot(v.id)}
        <div class="ghead-main">
          <div class="g-form jp">${esc(v.w)}</div>
          <div class="g-mean">${esc(v.r)} · ${esc(v.m)}</div>
        </div>
        <div class="g-side">
          <span class="g-badges">${catBadge(v.c)}${tierBadge(v.lv)}</span>
          <span class="g-mini">${catIcon(v.c)}</span>
          <svg viewBox="0 0 24 24" class="ic chev"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </summary>
      <div class="gbody">
        <div class="row"><div class="lab">Reading</div><div class="formation jp">${esc(v.r)}</div></div>
        <div class="row"><div class="lab">Meaning</div><div class="note">${esc(v.m)}</div></div>
        <div class="row"><div class="lab">Example</div>${exHTML}</div>
        <div class="row" style="border:0"><div class="lab">Status${accTxt}</div>
          <div class="actions"><button class="btn drill-btn" data-id="${v.id}">Practice this word</button></div>
        </div>
      </div>
    </details>`;
  }

  /* =====================================================================
     MODAL / SETTINGS
     ===================================================================== */
  function openModal(title, body, actions) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-overlay" id="ov"><div class="modal">
      <div class="modal-head"><h3>${title}</h3>
        <button class="icon-btn" id="mClose"><svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions ? `<div class="modal-foot" id="mFoot"></div>` : ""}
    </div></div>`;
    $("#mClose").onclick = closeModal;
    $("#ov").onclick = (e) => { if (e.target.id === "ov") closeModal(); };
    if (actions) {
      const foot = $("#mFoot");
      actions.forEach((a) => { const b = document.createElement("button"); b.className = "btn " + (a.kind || "ghost"); b.innerHTML = a.label; b.onclick = a.act; foot.appendChild(b); });
    }
  }
  function closeModal() { $("#modalRoot").innerHTML = ""; }

  function openSettings() {
    const s = state.settings;
    const goals = [10, 20, 30, 50];
    openModal("Settings", `
      <div class="field">
        <div><label>Dark mode</label><div class="sub">Easier on the eyes during long sessions</div></div>
        <label class="switch"><input type="checkbox" id="setTheme" ${s.theme === "dark" ? "checked" : ""}><span class="sl"></span></label>
      </div>
      <div class="field">
        <div><label>Sound</label><div class="sub">Subtle beep on each answer</div></div>
        <label class="switch"><input type="checkbox" id="setSound" ${s.sound ? "checked" : ""}><span class="sl"></span></label>
      </div>
      <div class="field">
        <div><label>Daily goal</label><div class="sub">Target reviews per day</div></div>
        <div class="seg" id="setGoal" style="flex:0 0 auto">${goals.map((g) => `<button data-v="${g}" class="${s.dailyGoal === g ? "sel" : ""}">${g}</button>`).join("")}</div>
      </div>
      <div class="field" style="border-top:1px solid var(--border);padding-top:16px">
        <div><label>Backup</label><div class="sub">Export / import your progress</div></div>
        <div style="display:flex;gap:8px"><button class="btn" id="setExport">Export</button><button class="btn" id="setImport">Import</button></div>
      </div>`, [
      { label: "Reset progress", kind: "ghost", act: confirmReset },
      { label: "Close", kind: "primary", act: closeModal },
    ]);
    $("#setTheme").onchange = (e) => { state.settings.theme = e.target.checked ? "dark" : "light"; applyTheme(); save(); };
    $("#setSound").onchange = (e) => { state.settings.sound = e.target.checked; save(); };
    $$("#setGoal button").forEach((b) => (b.onclick = () => { state.settings.dailyGoal = Number(b.dataset.v); $$("#setGoal button").forEach((x) => x.classList.toggle("sel", x === b)); save(); }));
    $("#setExport").onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "n2-vocab-backup-" + todayStr() + ".json"; a.click(); URL.revokeObjectURL(a.href);
      toast("Backup exported.");
    };
    $("#setImport").onclick = () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const data = JSON.parse(fr.result);
            if (!data || !data.stats) throw new Error();
            state = { srs: data.srs || {}, stats: Object.assign({}, DEFAULT_STATE.stats, data.stats), settings: Object.assign({}, DEFAULT_STATE.settings, data.settings) };
            save(); applyTheme(); closeModal(); toast("Backup imported."); go("dashboard");
          } catch (e) { toast("Invalid file."); }
        };
        fr.readAsText(f);
      };
      inp.click();
    };
  }
  function confirmReset() {
    openModal("Reset?", `<p class="muted">All progress will be permanently erased.</p>`, [
      { label: "Cancel", kind: "ghost", act: openSettings },
      { label: "Erase all", kind: "primary", act: () => { state = clone(DEFAULT_STATE); save(); applyTheme(); closeModal(); toast("Progress reset."); go("dashboard"); } },
    ]);
  }

  /* =====================================================================
     KEYBOARD
     ===================================================================== */
  document.addEventListener("keydown", (e) => {
    if ($("#modalRoot").firstChild) { if (e.key === "Escape") closeModal(); return; }
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (current === "practice" && quiz) {
      if (!quiz.answered && ["1", "2", "3", "4"].includes(e.key)) {
        const btn = $$("#options .option")[Number(e.key) - 1]; if (btn) { e.preventDefault(); btn.click(); }
      } else if (quiz.answered && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault(); const nb = $("#nextBtn"); if (nb) nb.click();
      }
    } else if (current === "flash" && flashState.queue.length) {
      if (e.key === " ") { e.preventDefault(); const c = $("#fcard"); if (c) c.click(); }
      else if (flashState.flipped && ["1", "2", "3", "4"].includes(e.key)) { const b = $$("#flashRate button")[Number(e.key) - 1]; if (b) { e.preventDefault(); b.click(); } }
    } else if (current === "challenge" && challenge && !challenge.answered) {
      if (["1", "2", "3", "4"].includes(e.key)) { const b = $$("#cOptions .option")[Number(e.key) - 1]; if (b) { e.preventDefault(); b.click(); } }
    }
  });

  /* =====================================================================
     INIT
     ===================================================================== */
  function buildBottomNav() {
    const items = [
      ["dashboard", "Accueil", '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>'],
      ["practice", "Réviser", '<path d="M4 6h16M4 12h16M4 18h10"/>'],
      ["flash", "Cartes", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'],
      ["challenge", "Défi", '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'],
      ["reference", "Dico", '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8"/>'],
    ];
    $("#bottomnav").innerHTML = items.map(([v, l, p]) => `<button data-view="${v}"><svg viewBox="0 0 24 24" class="ic">${p}</svg>${l}</button>`).join("");
    $$("#bottomnav button").forEach((b) => (b.onclick = () => go(b.dataset.view)));
  }

  function init() {
    applyTheme(); buildBottomNav();
    $$(".tab").forEach((t) => (t.onclick = () => go(t.dataset.view)));
    $("#brand").onclick = () => go("dashboard");
    $("#brand").onkeydown = (e) => { if (e.key === "Enter") go("dashboard"); };
    $("#themeBtn").onclick = toggleTheme;
    $("#settingsBtn").onclick = openSettings;
    $("#streakChip").onclick = () => toast(displayStreak() > 0 ? `${displayStreak()}-day streak — keep it up!` : "Answer a question today to start your streak.");
    refreshStreakChip();
    go("dashboard");
  }
  function refreshStreakChip() {
    const d = displayStreak();
    $("#streakNum").textContent = d;
    $("#streakChip").classList.toggle("cold", d === 0);
  }
  const _save = save;
  save = function () { _save(); refreshStreakChip(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
