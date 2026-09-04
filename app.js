// Adjust these paths when the repository layout changes.
const APP_PATHS = {
  questions: "./SJTU_Public_Nutritionist/data/questions.json",
  manifest: "./SJTU_Public_Nutritionist/data/manifest.json",
};
const DEFAULT_CONFIG = {
  accessKeyHash: "4836f7ae932396e81d9a543fe646e28c21064535a243f06f914ecdc3ff74edb5",
  rememberAccess: true,
};
const app = document.querySelector("#app");
const config = { ...DEFAULT_CONFIG, ...(window.APP_CONFIG || {}) };
const DB_NAME = "nutritionist-question-bank";
const DB_VERSION = 1;
const MAX_ATTEMPTS = 10000;
const state = { authorized: false, questions: [], manifest: null, route: "gate", session: null, wrong: new Map(), bookmarks: new Set(), attempts: 0, attemptedQuestionIds: new Set(), storage: true };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const resourceUrl = (relativePath) => new URL(relativePath, document.baseURI).href;
const hash = () => location.hash.replace(/^#/, "") || "/";
const go = (path) => { location.hash = path; };
const text = (value) => esc(value).replace(/\n/g, "<br>");

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ["attempts", "wrongQuestions", "bookmarks", "notes", "practiceProgress", "meta"].forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
let dbPromise;
const db = () => (dbPromise ||= openDb().catch(() => { state.storage = false; throw new Error("本地存储不可用"); }));
async function getAll(store) { const d = await db(); return new Promise((resolve, reject) => { const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function put(store, value) { const d = await db(); return new Promise((resolve, reject) => { const r = d.transaction(store, "readwrite").objectStore(store).put(value); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }
async function remove(store, id) { const d = await db(); d.transaction(store, "readwrite").objectStore(store).delete(id); }
async function clearStore(store) { const d = await db(); d.transaction(store, "readwrite").objectStore(store).clear(); }

async function loadLocal() {
  try {
    const [wrong, bookmarks, attempts, progress] = await Promise.all([getAll("wrongQuestions"), getAll("bookmarks"), getAll("attempts"), getAll("practiceProgress")]);
    state.wrong = new Map(wrong.map((item) => [item.id, item]));
    state.bookmarks = new Set(bookmarks.map((item) => item.id));
    state.attempts = attempts.length;
    state.attemptedQuestionIds = new Set(attempts.map((item) => item.questionId));
    state.progress = progress[0] || null;
  } catch { state.storage = false; state.progress = null; }
}
async function sha256(value) { const data = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", data); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function isAuthorized() { return localStorage.getItem("nutritionist-authorized") === config.accessKeyHash; }
async function authorize(key, remember) { const digest = await sha256(key); if (!config.accessKeyHash || config.accessKeyHash.startsWith("REPLACE_")) return { ok: false, setup: true }; if (digest !== config.accessKeyHash.toLowerCase()) return { ok: false }; state.authorized = true; if (remember) localStorage.setItem("nutritionist-authorized", config.accessKeyHash); else localStorage.removeItem("nutritionist-authorized"); return { ok: true }; }

async function loadQuestions() {
  const response = await fetch(resourceUrl(APP_PATHS.questions));
  if (!response.ok) throw new Error("题库文件加载失败");
  state.questions = await response.json();
  try { const r = await fetch(resourceUrl(APP_PATHS.manifest)); state.manifest = r.ok ? await r.json() : null; } catch { state.manifest = null; }
}
function question(id) { return state.questions.find((item) => item.id === id); }
function pct(value, total) { return total ? `${Math.round(value / total * 100)}%` : "0%"; }
function layout(content, actions = "") { app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">营</span><span>公共营养师题库</span></div><div class="top-actions">${actions}</div></header><main class="page">${content}</main><footer class="footer"><span>© 2026 上海交通大学医学院 · 内部学习资料</span><span>答题记录仅保存在当前浏览器</span></footer></div>`; }

function renderGate(message = "") {
  app.innerHTML = `<div class="shell"><main class="page"><div class="hero"><section><p class="eyebrow">NUTRITION STUDY / LOCAL EDITION</p><h1>公共营养师题库</h1><p class="lede">【二级】测试版</p></section><section class="panel"><form class="key-form" id="key-form"><div><label for="access-key">学习密钥</label><input id="access-key" type="password" autocomplete="off" placeholder="请输入统一访问密钥" /></div><label><input id="remember" type="checkbox" checked /> 在本设备记住访问状态</label><button class="btn" type="submit">进入题库</button><div class="error">${esc(message)}</div></form><div class="notice">提示：清除浏览器数据、更换浏览器或使用隐私模式，可能导致本地错题记录消失。</div></section></div></main><footer class="footer"><span>© 2026 上海交通大学医学院 · 内部学习资料</span><span>仅供学习使用</span></footer></div>`;
  document.querySelector("#key-form").onsubmit = async (event) => { event.preventDefault(); const button = event.target.querySelector("button"); button.disabled = true; const result = await authorize(document.querySelector("#access-key").value, document.querySelector("#remember").checked); if (result.ok) { try { await loadQuestions(); await loadLocal(); if (hash() === "/home") renderHome(); else go("/home"); } catch (error) { state.authorized = false; renderGate(error.message || "题库加载失败，请稍后重试。"); } } else { renderGate(result.setup ? "请先在 config.js 中配置访问密钥。" : "密钥不正确，请重新输入。"); } };
}

function renderHome() {
  const wrongCount = [...state.wrong.values()].filter((item) => !item.mastered).length;
  const completed = state.attemptedQuestionIds.size;
  const completion = state.questions.length ? Math.round(completed / state.questions.length * 100) : 0;
  const resume = state.progress ? `<button class="btn" id="resume">继续上次练习</button>` : "";
  const cards = [{ key: "all", name: "全部题库", count: state.questions.length }, ...["A", "B", "C", "D"].map((key) => ({ key, name: `${key} 题库`, count: state.questions.filter((q) => q.bank === key).length })), { key: "bookmarks", name: "收藏题库", count: state.bookmarks.size }].map((item) => `<button class="bank-card ${item.key === "bookmarks" ? "favorite-card" : ""}" data-bank="${item.key}"><h3>${item.name}</h3><p>${item.count} 道${item.key === "bookmarks" ? "已收藏题目" : "可练习题"}</p></button>`).join("");
  layout(`<section class="dashboard"><div class="dashboard-copy"><p class="eyebrow">YOUR LOCAL DASHBOARD</p><h1 class="dashboard-title">开始今天的练习</h1><p class="lede">普通练习随机出题，并自动避开当前错题本中的题目。错题可进入错题本集中巩固。</p><div class="stats"><div class="stat"><strong>${state.attempts}</strong>累计作答</div><div class="stat"><strong>${wrongCount}</strong>待复习错题</div><div class="stat"><strong>${state.bookmarks.size}</strong>收藏题目</div></div></div><aside class="progress-panel"><div class="progress-ring" style="--progress:${completion * 3.6}deg"><span>${completion}%</span></div><div><p class="eyebrow">TOTAL PROGRESS</p><h2>已刷 ${completed} / ${state.questions.length}</h2><p>按本机已作答的不同题目统计</p></div></aside></section><section class="quick-row"><div><strong>${state.storage ? "本地记忆已开启" : "临时模式"}</strong><span>${state.storage ? "错题、完成度和练习进度保存在本设备" : "当前浏览器无法保存学习记录"}</span></div><div class="quick-actions">${resume}<button class="btn secondary" id="wrong-link">错题本</button><button class="btn ghost" id="settings-link">本地设置</button></div></section><section><div class="section-head"><div><p class="eyebrow">RANDOM PRACTICE</p><h2>选择题库</h2><p class="section-note">点击后随机开始，当前错题不会混入普通练习。</p></div></div><div class="bank-grid">${cards}</div></section>`, `<button class="btn ghost" id="exit">退出</button>`);
  document.querySelectorAll("[data-bank]").forEach((button) => button.onclick = () => startPractice(button.dataset.bank));
  if (state.progress) document.querySelector("#resume").onclick = () => { const activeWrongIds = new Set([...state.wrong.values()].filter((item) => !item.mastered).map((item) => item.id)); const ids = state.progress.questionIds; const source = ids.map(question).filter(Boolean); const blockedGroups = new Set(source.filter((item) => item.groupId && activeWrongIds.has(item.id)).map((item) => item.groupId)); const pool = source.filter((item) => !activeWrongIds.has(item.id) && (!item.groupId || !blockedGroups.has(item.groupId))); if (pool.length) { state.session = { id: state.progress.id, bank: state.progress.bank, mode: state.progress.mode, questions: pool, index: Math.min(state.progress.currentIndex, pool.length - 1), selected: [], submitted: false, results: [], startedAt: Date.now() }; go("/practice"); } else { clearStore("practiceProgress"); state.progress = null; renderHome(); } };
  document.querySelector("#wrong-link").onclick = () => go("/wrong-questions"); document.querySelector("#settings-link").onclick = () => go("/settings"); document.querySelector("#exit").onclick = () => { state.authorized = false; localStorage.removeItem("nutritionist-authorized"); go("/"); };
}

function orderPracticeQuestions(source, mode) {
  const groups = new Map();
  source.forEach((item, index) => {
    const groupId = item.groupId || `single-${item.id}`;
    const group = groups.get(groupId) || { order: index, questions: [] };
    group.questions.push(item);
    groups.set(groupId, group);
  });
  const orderedGroups = [...groups.values()].map((group) => ({ ...group, questions: group.questions.sort((a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0)) }));
  if (mode === "random") orderedGroups.sort(() => Math.random() - 0.5);
  return orderedGroups.flatMap((group) => group.questions);
}

function startPractice(bank, mode = "random", ids = null) {
  const activeWrongIds = new Set([...state.wrong.values()].filter((item) => !item.mastered).map((item) => item.id));
  const requested = ids ? ids.map(question).filter(Boolean) : state.questions.filter((q) => bank === "all" || bank === "bookmarks" || q.bank === bank);
  const pool = ids
    ? requested
    : bank === "bookmarks"
      ? requested.filter((q) => state.bookmarks.has(q.id))
    : requested.filter((q) => !activeWrongIds.has(q.id) && (!q.groupId || ![...activeWrongIds].some((id) => question(id)?.groupId === q.groupId)));
  const ordered = orderPracticeQuestions(pool, mode);
  if (!ordered.length) { alert("该题库暂无可用的新题，请先处理错题本或选择其他题库。"); return; }
  state.session = { id: crypto.randomUUID(), bank, mode, questions: ordered, index: 0, selected: [], submitted: false, results: [], startedAt: Date.now() };
  saveProgress();
  go("/practice");
}
async function saveProgress() { if (!state.storage || !state.session) return; await put("practiceProgress", { id: "current", questionIds: state.session.questions.map((q) => q.id), currentIndex: state.session.index, bank: state.session.bank, mode: state.session.mode, updatedAt: Date.now(), questionBankVersion: state.manifest?.version || "unknown" }).catch(() => { state.storage = false; }); }
function renderPractice() {
  const session = state.session; const q = session.questions[session.index]; const selected = new Set(session.selected); const submitted = session.submitted; const correct = submitted && q.answers.length === selected.size && q.answers.every((answer) => selected.has(answer));
  const optionHtml = Object.entries(q.options).map(([key, content]) => { const isCorrect = submitted && q.answers.includes(key); const isWrong = submitted && selected.has(key) && !isCorrect; return `<button class="option ${selected.has(key) ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}" data-option="${key}" ${submitted ? "disabled" : ""}><span class="option-key">${key}</span><span>${text(content)}</span></button>`; }).join("");
  const feedback = submitted ? `<div class="feedback ${correct ? "ok" : "bad"}"><strong>${correct ? "回答正确" : "回答错误"}</strong><div>正确答案：${q.answers.join("、")}</div>${q.explanation ? `<p>${text(q.explanation)}</p>` : ""}</div>` : "";
  layout(`<div class="practice-head"><button class="btn ghost" id="back-home">退出练习</button><span class="progress">${session.index + 1} / ${session.questions.length}</span></div><article class="panel"><div class="question-meta"><span class="badge">${q.type === "multiple" ? "多选题" : "单选题"}</span><span class="progress">${q.bank} 题库 · 原题 ${q.sourceQuestionNo}</span></div>${q.sharedStem ? `<div class="shared-stem">${text(q.sharedStem)}</div>` : ""}<h2 class="question-stem">${text(q.stem)}</h2><div class="options">${optionHtml}</div>${feedback}<div class="practice-actions"><button class="btn ghost" id="bookmark">${state.bookmarks.has(q.id) ? "已收藏" : "收藏本题"}</button>${submitted ? `<button class="btn" id="next">${session.index === session.questions.length - 1 ? "查看结果" : "下一题"}</button>` : `<button class="btn" id="submit">提交答案</button>`}</div></article>`, "");
  document.querySelector("#back-home").onclick = () => { saveProgress(); go("/home"); }; document.querySelector("#bookmark").onclick = async () => { if (state.bookmarks.has(q.id)) { state.bookmarks.delete(q.id); await remove("bookmarks", q.id); } else { state.bookmarks.add(q.id); await put("bookmarks", { id: q.id, createdAt: Date.now() }); } renderPractice(); };
  document.querySelectorAll("[data-option]").forEach((button) => button.onclick = () => { const key = button.dataset.option; if (q.type === "single") session.selected = [key]; else session.selected = selected.has(key) ? session.selected.filter((item) => item !== key) : [...session.selected, key]; renderPractice(); });
  if (submitted) document.querySelector("#next").onclick = () => { if (session.index === session.questions.length - 1) { state.lastResults = session.results; remove("practiceProgress", "current"); go("/result"); } else { session.index++; session.selected = []; session.submitted = false; saveProgress(); renderPractice(); } };
  else document.querySelector("#submit").onclick = async () => { if (!session.selected.length) return; const isCorrect = q.answers.length === session.selected.length && q.answers.every((answer) => session.selected.includes(answer)); session.submitted = true; session.results.push({ questionId: q.id, correct: isCorrect }); const attempt = { id: crypto.randomUUID(), questionId: q.id, selectedAnswers: session.selected, correct: isCorrect, answeredAt: Date.now(), questionBankVersion: state.manifest?.version || "unknown" }; state.attempts += 1; state.attemptedQuestionIds.add(q.id); if (state.storage) { await put("attempts", attempt).catch(() => { state.storage = false; }); if (!isCorrect) { const previous = state.wrong.get(q.id) || { id: q.id, wrongCount: 0, correctCountAfterWrong: 0, mastered: false }; const record = { ...previous, wrongCount: previous.wrongCount + 1, lastWrongAt: Date.now(), mastered: false }; state.wrong.set(q.id, record); await put("wrongQuestions", record).catch(() => { state.storage = false; }); } else if (state.wrong.has(q.id)) { const record = { ...state.wrong.get(q.id), correctCountAfterWrong: (state.wrong.get(q.id).correctCountAfterWrong || 0) + 1, mastered: session.mode === "wrong-only" }; state.wrong.set(q.id, record); await put("wrongQuestions", record).catch(() => { state.storage = false; }); } } renderPractice(); };
}

function renderResult() { const results = state.lastResults || []; const good = results.filter((r) => r.correct).length; layout(`<section class="hero"><div><p class="eyebrow">SESSION COMPLETE</p><h1>这一轮，完成得很好。</h1><p class="lede">结果已经更新到本机错题本。你可以继续挑战，也可以先处理刚刚答错的题。</p></div><div class="panel"><p class="eyebrow">SCORE</p><h2>${good} / ${results.length}</h2><p class="lede" style="font-size:16px">本轮正确率 ${pct(good, results.length)}</p><button class="btn" id="wrong">去错题本</button><button class="btn secondary" id="home">返回首页</button></div></section>`); document.querySelector("#wrong").onclick = () => go("/wrong-questions"); document.querySelector("#home").onclick = () => go("/home"); }

function renderWrong() { const records = [...state.wrong.values()].filter((item) => !item.mastered); const ids = records.map((item) => item.id); const items = records.map((record) => { const q = question(record.id); return q ? `<div class="wrong-item"><div class="wrong-copy"><span class="badge">${q.bank} · ${q.type === "multiple" ? "多选" : "单选"}</span><strong>${text(q.stem.slice(0, 120))}${q.stem.length > 120 ? "..." : ""}</strong><p>累计错误 ${record.wrongCount} 次${record.correctCountAfterWrong ? ` · 重做正确 ${record.correctCountAfterWrong} 次` : ""}</p></div><div class="item-actions"><button class="btn ghost" data-master="${q.id}">标记掌握</button><button class="btn secondary" data-review="${q.id}">单题重做</button></div></div>` : ""; }).join(""); layout(`<div class="section-head wrong-head"><div><p class="eyebrow">REVIEW LIST</p><h1 class="page-title">错题本</h1><p class="lede">${records.length ? `共 ${records.length} 道待巩固题目。集中练习时答对的题会自动标记为已掌握。` : "当前没有待复习错题。"}</p></div><div class="head-actions">${records.length ? `<button class="btn" id="review-all">练习全部错题</button>` : ""}<button class="btn ghost" id="home">返回首页</button></div></div><div class="wrong-list">${items || `<div class="empty">答错的题目会自动出现在这里。</div>`}</div>`, ""); document.querySelector("#home").onclick = () => go("/home"); if (records.length) document.querySelector("#review-all").onclick = () => startPractice("all", "wrong-only", ids); document.querySelectorAll("[data-review]").forEach((button) => button.onclick = () => startPractice("all", "wrong-only", [button.dataset.review])); document.querySelectorAll("[data-master]").forEach((button) => button.onclick = async () => { const record = { ...state.wrong.get(button.dataset.master), mastered: true }; state.wrong.set(record.id, record); await put("wrongQuestions", record).catch(() => { state.storage = false; }); renderWrong(); }); }

async function renderSettings() { const [attempts, wrong, bookmarks] = state.storage ? await Promise.all([getAll("attempts"), getAll("wrongQuestions"), getAll("bookmarks")]) : [[], [], []]; layout(`<div class="section-head"><div><p class="eyebrow">LOCAL DATA</p><h1 style="font-size:clamp(38px,5vw,62px)">本地设置</h1><p class="lede">数据只保存在当前浏览器，不会上传，也不会跨设备同步。</p></div><button class="btn ghost" id="home">返回首页</button></div><div class="panel"><div class="stats"><div class="stat"><strong>${attempts.length}</strong>答题记录</div><div class="stat"><strong>${wrong.length}</strong>错题</div><div class="stat"><strong>${bookmarks.length}</strong>收藏</div></div><hr style="border:0;border-top:1px solid var(--line);margin:30px 0"><p class="notice">存储状态：${state.storage ? "IndexedDB 可用，支持恢复进度" : "不可用，将以临时模式运行"}</p><button class="btn secondary" id="clear-attempts">清除答题历史</button> <button class="btn secondary" id="clear-wrong">清除错题本</button> <button class="btn" id="clear-all">清除全部本地数据</button></div>`); document.querySelector("#home").onclick = () => go("/home"); document.querySelector("#clear-attempts").onclick = async () => { if (confirm("确定清除全部答题历史吗？")) { await clearStore("attempts"); await loadLocal(); renderSettings(); } }; document.querySelector("#clear-wrong").onclick = async () => { if (confirm("确定清除错题本吗？")) { await clearStore("wrongQuestions"); await loadLocal(); renderSettings(); } }; document.querySelector("#clear-all").onclick = async () => { if (confirm("确定清除全部本地数据并退出吗？")) { for (const name of ["attempts", "wrongQuestions", "bookmarks", "notes", "practiceProgress", "meta"]) await clearStore(name); localStorage.removeItem("nutritionist-authorized"); location.hash = "/"; location.reload(); } }; }

async function render() { const route = hash(); state.route = route; if (!state.authorized) return renderGate(); if (route === "/") return go("/home"); if (route === "/home") return renderHome(); if (route === "/practice" && state.session) return renderPractice(); if (route === "/result") return renderResult(); if (route === "/wrong-questions") return renderWrong(); if (route === "/settings") return renderSettings(); go("/home"); }
window.addEventListener("hashchange", render);
(async () => { if (await isAuthorized()) { try { state.authorized = true; await loadQuestions(); await loadLocal(); if (hash() === "/") return go("/home"); } catch { state.authorized = false; } } await render(); })();
