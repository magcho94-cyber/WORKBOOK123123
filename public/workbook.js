"use strict";
let workbookJob = "", workbookDraft = null, workbookPhase = "", workbookImages = new Set();
let workbookStudentPages = 0, workbookTeacherPages = 0;
let workbookInputMode = "textbook", workbookDraftVersion = 0;
const wb = id => document.getElementById(id);
const wbEsc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wbChunks = (items, count) => Array.from({ length: Math.ceil(items.length / count) }, (_, i) => items.slice(i * count, (i + 1) * count));
const wbLetter = i => i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
const wbLine = (n = 1) => '<div class="wbBlankLine"></div>'.repeat(n);

function wbRanges(count) {
  if (!Number.isInteger(count) || count < 1) throw Error("문장이 필요합니다.");
  const sizes = [];
  for (let left = count; left > 5; left -= 3) sizes.push(3);
  sizes.push(count - sizes.length * 3);
  let start = 0;
  return sizes.map(size => { const result = [start, start + size]; start += size; return result; });
}

function wbShuffle(length, seed) {
  const a = Array.from({ length }, (_, i) => i);
  let x = seed >>> 0 || 1;
  for (let i = length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (length > 1 && a.every((v, i) => v === i)) a.push(a.shift());
  return a;
}

function wbOrderBlocks(pars) {
  if (pars.length > 1) return pars.map((p, i) => ({ index: i, sentences: p.sentences.map(s => s.en) }));
  const rows = pars[0].sentences;
  if (rows.length < 2) return [{ index: 0, sentences: rows.map(s => s.en) }];
  const count = Math.min(3, rows.length);
  return Array.from({ length: count }, (_, i) => ({ index: i,
    sentences: rows.slice(Math.floor(i * rows.length / count), Math.floor((i + 1) * rows.length / count)).map(s => s.en) }));
}

function wbOrderCost(sentences) {
  const text = sentences.join(" ");
  return 9 + 4.8 * Math.ceil(text.length / 95);
}

function wbPackOrder(items, budget = 190) {
  const groups = [], current = [];
  let used = 0;
  for (const item of items) {
    const cost = wbOrderCost(item.sentences);
    if (current.length && used + cost > budget) { groups.push(current.splice(0)); used = 0; }
    current.push(item); used += cost;
  }
  if (current.length) groups.push(current);
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].length !== 1 || groups.length === 1) continue;
    const only = groups[i][0];
    if (only.sentences.length > 1) {
      const cut = Math.ceil(only.sentences.length / 2);
      groups[i] = [{ sentences: only.sentences.slice(0, cut) }, { sentences: only.sentences.slice(cut) }];
    } else if (i && groups[i - 1].length > 2) {
      groups[i].unshift(groups[i - 1].pop());
    } else if (i && groups[i - 1].reduce((n, block) => n + wbOrderCost(block.sentences), wbOrderCost(only.sentences)) <= budget) {
      groups[i - 1].push(only); groups.splice(i--, 1);
    }
  }
  return groups;
}

function wbStep4Questions(pars) {
  const units = [];
  for (const block of wbOrderBlocks(pars)) {
    let current = [];
    for (const sentence of block.sentences) {
      if (current.length && wbOrderCost([...current, sentence]) > 92) {
        units.push({ sentences: current }); current = [];
      }
      current.push(sentence);
    }
    if (current.length) units.push({ sentences: current });
  }
  return wbPackOrder(units).map((blocks, i) => ({ blocks, order: wbShuffle(blocks.length, 74051 + i) }));
}

function wbStep5Questions(pars) {
  return pars.flatMap((par, p) => wbPackOrder(par.sentences.map((row, index) => ({ sentences: [row.en], index })))
    .map((blocks, i) => ({ paragraph: p, index: i, blocks,
      order: wbShuffle(blocks.length, 91001 + p * 100 + i) })));
}

function wbOrderAnswer(order) {
  return Array.from({ length: order.length }, (_, original) => wbLetter(order.indexOf(original))).join(" → ");
}

function wbReplaceOnce(text, target, replacement) {
  if (!target) return text;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const found of text.matchAll(new RegExp(escaped, "giu"))) {
    const at = found.index, original = found[0];
    const before = text.slice(0, at), after = text.slice(at + original.length);
    if (!/\p{L}$/u.test(before) && !/^\p{L}/u.test(after)) {
      return before + (typeof replacement === "function" ? replacement(original) : replacement) + after;
    }
  }
  return text;
}
function wbMask(row) {
  let en = row.en;
  for (const word of row.blanks) en = wbReplaceOnce(en, word, "________");
  return en;
}
function wbGrammar(row) { return wbReplaceOnce(row.en, row.grammar_correct, original => `(${original} / ${row.grammar_wrong})`); }

function renumberWorkbookParagraphs() {
  const cards = [...document.querySelectorAll(".wbParagraphCard")];
  cards.forEach((card, i) => {
    card.querySelector(".wbParagraphLabel").textContent = `${i + 1}문단`;
    card.querySelector(".wbParagraphRemove").classList.toggle("hidden", cards.length === 1);
  });
}

function addWorkbookParagraph() {
  const card = document.createElement("div");
  card.className = "card wbParagraphCard";
  card.innerHTML = `<div class="wbParagraphHeader"><h2 class="wbParagraphLabel"></h2><button type="button" class="secondary wbParagraphRemove" onclick="removeWorkbookParagraph(this)">문단 삭제</button></div>
    <label class="wbParagraphHeading">소제목 <small>선택</small><input class="wbHeading" placeholder="예: Introduction"></label>
    <div class="wbParagraphColumns"><div><label>영어 본문<textarea class="wbInput wbEnglish" placeholder="이 문단의 영어 문장을 넣으세요. 문장마다 줄을 바꿀 필요는 없습니다."></textarea></label><p class="hint">파일을 불러오면 이 칸에 들어옵니다. 여러 문단은 각각의 칸으로 나누어 주세요.</p><label>영어 파일 불러오기<input type="file" accept=".pdf,.docx,.txt,.md" onchange="extractWorkbookFile(this,'english')"></label></div>
    <div><label>우리말 해석 <small>선택</small><textarea class="wbInput wbKorean" placeholder="이 문단의 해석을 문장 순서대로 넣으세요. 비우면 AI가 작성합니다."></textarea></label><p class="hint">이 문단의 영어 문장 수와 해석 문장 수가 같아야 합니다.</p><label>해석 파일 불러오기<input type="file" accept=".pdf,.docx,.txt,.md" onchange="extractWorkbookFile(this,'korean')"></label></div></div>`;
  wb("wbParagraphs").append(card);
  renumberWorkbookParagraphs();
  return card;
}

function removeWorkbookParagraph(button) {
  if (document.querySelectorAll(".wbParagraphCard").length <= 1) return;
  button.closest(".wbParagraphCard").remove();
  renumberWorkbookParagraphs();
}

function wbCollectParagraphs() {
  const entries = [...document.querySelectorAll(".wbParagraphCard")].map((card, i) => {
    const entry = {
      heading: card.querySelector(".wbHeading").value.trim(),
      english: card.querySelector(".wbEnglish").value.trim(),
      korean: card.querySelector(".wbKorean").value.trim(),
    };
    if (!entry.english && (entry.korean || entry.heading)) throw Error(`${i + 1}문단에 영어 본문이 없습니다.`);
    return entry;
  }).filter(entry => entry.english);
  if (!entries.length) throw Error("영어 본문을 입력해 주세요.");
  return entries;
}

function setWorkbookMode(mode) {
  if (!["textbook", "mock"].includes(mode)) return;
  workbookInputMode = mode;
  wb("wbTextbookInputs").classList.toggle("hidden", mode !== "textbook");
  wb("wbMockInputs").classList.toggle("hidden", mode !== "mock");
  for (const [name, button] of [["textbook", wb("wbModeTextbook")], ["mock", wb("wbModeMock")]]) {
    button.classList.toggle("secondary", mode !== name);
    button.setAttribute("aria-pressed", String(mode === name));
  }
}

function addWorkbookMockSlots() {
  for (let number = 18; number <= 45; number++) {
    const card = document.createElement("details");
    card.className = "card wbMockCard";
    card.dataset.number = String(number);
    if (number === 18) card.open = true;
    card.innerHTML = `<summary><b>${number}번</b><span class="wbMockStatus">본문 없음</span></summary>
      <div class="wbParagraphColumns"><div><label>영어 본문<textarea class="wbInput wbEnglish" oninput="updateWorkbookMockCount()" placeholder="${number}번 영어 지문 전체를 입력하세요. 빈칸이면 생성되지 않습니다."></textarea></label><label>영어 파일 불러오기<input type="file" accept=".pdf,.docx,.txt,.md" onchange="extractWorkbookFile(this,'english')"></label></div>
      <div><label>우리말 해석 <small>선택</small><textarea class="wbInput wbKorean" oninput="updateWorkbookMockCount()" placeholder="문장 순서대로 입력하거나 비워 두세요."></textarea></label><label>해석 파일 불러오기<input type="file" accept=".pdf,.docx,.txt,.md" onchange="extractWorkbookFile(this,'korean')"></label></div></div>`;
    wb("wbMockSlots").append(card);
  }
}

function updateWorkbookMockCount() {
  let count = 0;
  for (const card of document.querySelectorAll(".wbMockCard")) {
    const filled = !!card.querySelector(".wbEnglish").value.trim();
    if (filled) count++;
    card.querySelector(".wbMockStatus").textContent = filled ? "입력됨 · 생성 대상" : "본문 없음";
    card.classList.toggle("wbMockFilled", filled);
  }
  wb("wbMockCount").textContent = `${count}개 번호 입력됨`;
}

function wbCollectMockPassages() {
  const entries = [...document.querySelectorAll(".wbMockCard")].map(card => ({
    number: Number(card.dataset.number),
    english: card.querySelector(".wbEnglish").value.trim(),
    korean: card.querySelector(".wbKorean").value.trim(),
  }));
  const missing = entries.find(x => !x.english && x.korean);
  if (missing) throw Error(`${missing.number}번에 영어 본문이 없습니다.`);
  const filled = entries.filter(x => x.english);
  if (!filled.length) throw Error("모의고사 18~45번 중 영어 본문을 입력해 주세요.");
  return filled;
}

function wbPage(content, section, title, kind = "wbStudent", pageClass = "", questionLabel = "") {
  const number = kind === "wbTeacher" ? ++workbookTeacherPages : ++workbookStudentPages;
  const reading = section === "READING" || section.startsWith("READING · ");
  const footer = questionLabel || (reading ? (section.match(/^READING · Paragraph \d+/)?.[0] || "READING") : "전체 문장 워크북");
  const shownSection = questionLabel ? `${questionLabel} · ${section}` : section;
  return `<section class="wbPage ${kind}${reading ? " wbReadingPage" : ""}${pageClass ? ` ${pageClass}` : ""}"><div class="wbPageHead"><img src="/jongrom-logo.png" alt=""><span>종로M ENGLISH</span><small>${wbEsc(workbookDraft.title)}</small></div><div class="wbSection">${wbEsc(shownSection)}</div><div class="wbSub">${wbEsc(title)}</div>${content}<div class="wbFooter"><span>${wbEsc(footer)}</span><span>${number}</span></div></section>`;
}

function wbStudent(draft, questionLabel = "") {
  if (draft.mode === "mock") return draft.paragraphs.map(par =>
    wbStudent({ title: draft.title, paragraphs: [par] }, `${par.number}번`)).join("");
  const studentPage = (content, section, title, kind = "wbStudent", pageClass = "") =>
    wbPage(content, section, title, kind, pageClass, questionLabel);
  let html = "", global = 0;
  const pars = draft.paragraphs;
  const multi = pars.length > 1;
  pars.forEach((par, p) => {
    const rows = par.sentences, heading = par.heading || "";
    const ranges = wbRanges(rows.length);
    ranges.forEach(([start, end], group) => {
      const key = `p${(par.sourceIndex ?? p) + 1}g${group + 1}`;
      const ending = end === rows.length;
      const count = end - start, panels = Math.min(3, count);
      const density = count === 5 ? "wbReadingFive" : count === 4 ? "wbReadingFour" : count === 3 ? "wbReadingThree" : "wbReadingShort";
      let content = `<div class="wbReadingContent${ending ? " wbReadingFinal" : ""} ${density}"><div class="wbImageBox" style="--wb-panels:${panels}"><span data-wb-placeholder="${key}">${panels}컷 삽화 생성 중</span><img class="wbIllustration hidden" data-wb-image="${key}" alt="${multi ? `Paragraph ${p + 1} ` : ""}문장 ${start + 1}–${end} 가로 ${panels}컷 만화"><div class="wbPanelLines" aria-hidden="true">${"<i></i>".repeat(panels)}</div></div><p class="wbImageCaption">${wbEsc(par.reading_captions?.[group] || "")}</p>`;
      content += rows.slice(start, end).map((row, j) => {
        const number = global + start + j + 1;
        const bridge = row.connection && (start + j > 0 || p > 0)
          ? `<div class="wbReadingBridge"><b>${start + j ? `문장 ${number - 1} → ${number}` : `이전 문단 → 문장 ${number}`}</b><span>${wbEsc(row.connection)}</span></div>` : "";
        return `${bridge}<div class="wbReadingRow"><div class="wbReadingNum">${multi ? `${p + 1}-` : ""}${String(start + j + 1).padStart(2, "0")}</div><p class="wbEn">${wbEsc(row.en)}</p><p class="wbKo">${wbEsc(row.ko)}</p></div>`;
      }).join("");
      if (ending) content += `<div class="wbReadingTopics"><div class="wbTopicField"><span>주제 (Topic)</span></div><div class="wbTopicField"><span>제목 (Title)</span></div></div>`;
      content += "</div>";
      const section = multi ? `READING · Paragraph ${p + 1} (${group + 1}/${ranges.length})` : ranges.length > 1 ? `READING · ${group + 1}/${ranges.length}` : "READING";
      const title = `${heading || (multi ? `Paragraph ${p + 1}` : "")}${heading || multi ? " | " : ""}그림은 아래 문장의 내용을 이해하기 위한 장면입니다.`;
      html += studentPage(content, section, title, "wbStudent");
    });
    global += rows.length;
  });
  global = 0;
  pars.forEach((par, p) => {
    const rows = par.sentences;
    wbChunks(rows.map((row, i) => ({ row, i })), 3).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbItem"><p class="wbEn"><span class="wbNumber">${global + i + 1}.</span>${wbEsc(row.en)}</p><p class="wbPrompt">우리말 해석</p>${wbLine(2)}${(i > 0 || p > 0) ? `<p class="wbPrompt">${i ? `문장 ${global + i} → ${global + i + 1}` : `이전 문단 → 문장 ${global + 1}`} 논리 관계</p>${wbLine(1)}` : ""}</div>`).join("");
      html += studentPage(content, "STEP 1 · 해석 / 문장 사이의 논리 관계 파악", `${multi ? `Paragraph ${p + 1} · ` : ""}문장 ${j * 3 + 1}–${j * 3 + group.length}`);
    });
    const qHtml = par.questions.map((q, i) => `<div class="wbTask"><p class="wbQuestion">${i + 1}. ${wbEsc(q.question)}</p>${wbLine(2)}</div>`).join("");
    const oxHtml = par.ox.map((q, i) => `<div class="wbTask"><p class="wbQuestion">${i + 1}. ( O / X ) ${wbEsc(q.statement)}</p></div>`).join("");
    html += studentPage(`<h3>내용확인</h3>${qHtml}<h3>내용확인 O/X</h3>${oxHtml}`, "STEP 1 · 내용확인", multi ? `Paragraph ${p + 1}` : "본문 내용");
    global += rows.length;
  });
  global = 0;
  pars.forEach((par, p) => {
    wbChunks(par.sentences.map((row, i) => ({ row, i })), 5).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbItem"><p class="wbEn"><span class="wbNumber">${global + i + 1}.</span>${wbEsc(wbMask(row))}</p><p class="wbSmall">원문대로 완성하기 · 짧은 문장은 빈칸 수 예외</p>${wbLine(1)}</div>`).join("");
      html += studentPage(content, "STEP 2 · 핵심표현 빈칸", `${multi ? `Paragraph ${p + 1} · ` : ""}${j + 1}쪽`);
    });
    global += par.sentences.length;
  });
  global = 0;
  pars.forEach((par, p) => {
    wbChunks(par.sentences.map((row, i) => ({ row, i })), 3).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbItem"><p class="wbEn"><span class="wbNumber">${global + i + 1}.</span>${wbEsc(wbGrammar(row))}</p><p class="wbPrompt">선택한 어법의 근거</p>${wbLine(2)}</div>`).join("");
      html += studentPage(content, "STEP 3 · 어법 선택", `${multi ? `Paragraph ${p + 1} · ` : ""}${j + 1}쪽`);
    });
    global += par.sentences.length;
  });
  wbStep4Questions(pars).forEach(({ blocks, order }, question) => {
    const content = order.map((original, i) => `<div class="wbOrderBlock"><b>(${wbLetter(i)})</b> ${blocks[original].sentences.map(wbEsc).join(" ")}</div>`).join("") +
      `<div class="wbAnswerBox">올바른 문단 순서: ${wbLine(1)}</div>`;
    html += studentPage(content, "STEP 4 · 문단 나열", `문제 ${question + 1} · 제시문 전체를 이 페이지에서 배열`, "wbStudent", "wbOrderPage");
  });
  wbStep5Questions(pars).forEach(({ paragraph, index, blocks, order }) => {
    const content = order.map((original, i) => `<div class="wbOrderBlock"><b>(${wbLetter(i)})</b> ${wbEsc(blocks[original].sentences[0])}</div>`).join("") +
      `<div class="wbAnswerBox">올바른 문장 순서: ${wbLine(1)}</div>`;
    html += studentPage(content, "STEP 5 · 문장 나열", `${multi ? `Paragraph ${paragraph + 1} · ` : ""}문제 ${index + 1} · 제시문 전체를 이 페이지에서 배열`, "wbStudent", "wbOrderPage");
  });
  return html;
}

function wbTeacher(draft, questionLabel = "") {
  if (draft.mode === "mock") return draft.paragraphs.map(par =>
    wbTeacher({ title: draft.title, paragraphs: [par] }, `${par.number}번`)).join("");
  const teacherPage = (content, section, title) => wbPage(content, section, title, "wbTeacher", "", questionLabel);
  let html = "", global = 0;
  const pars = draft.paragraphs, multi = pars.length > 1;
  pars.forEach((par, p) => {
    wbChunks(par.sentences.map((row, i) => ({ row, i })), 7).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbKey"><b>${global + i + 1}. ${wbEsc(row.en)}</b><br>해석: ${wbEsc(row.ko)}${row.connection && (i > 0 || p > 0) ? `<br>연결: ${wbEsc(row.connection)}` : ""}</div>`).join("");
      html += teacherPage(content, "교사용 · STEP 1", `${multi ? `Paragraph ${p + 1} · ` : ""}해석 / 논리 관계 · 문장 ${j * 7 + 1}–${j * 7 + group.length}`);
    });
    const content = `<div class="wbKey"><b>주제</b> ${wbEsc(par.topic)}<br><b>제목</b> ${wbEsc(par.paragraph_title)}</div>` +
      par.questions.map((q, i) => `<div class="wbKey"><b>내용확인 ${i + 1}.</b> ${wbEsc(q.question)}<br>정답: ${wbEsc(q.answer)}</div>`).join("") +
      par.ox.map((q, i) => `<div class="wbKey"><b>내용확인 O/X ${i + 1}. ${q.answer}</b> ${wbEsc(q.statement)}<br>근거: ${wbEsc(q.reason)}</div>`).join("");
    html += teacherPage(content, "교사용 · STEP 1", multi ? `Paragraph ${p + 1} · 내용확인` : "내용확인");
    global += par.sentences.length;
  });
  global = 0;
  pars.forEach((par, p) => {
    wbChunks(par.sentences.map((row, i) => ({ row, i })), 18).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbKey"><b>${global + i + 1}.</b> ${wbEsc(row.blanks.join(" / "))}</div>`).join("");
      html += teacherPage(content, "교사용 · STEP 2", `${multi ? `Paragraph ${p + 1} · ` : ""}핵심표현 빈칸 · ${j + 1}쪽`);
    });
    global += par.sentences.length;
  });
  global = 0;
  pars.forEach((par, p) => {
    wbChunks(par.sentences.map((row, i) => ({ row, i })), 10).forEach((group, j) => {
      const content = group.map(({ row, i }) => `<div class="wbKey"><b>${global + i + 1}. ${wbEsc(row.grammar_correct)}</b><br>${wbEsc(row.grammar_reason)}</div>`).join("");
      html += teacherPage(content, "교사용 · STEP 3", `${multi ? `Paragraph ${p + 1} · ` : ""}어법 선택 · ${j + 1}쪽`);
    });
    global += par.sentences.length;
  });
  const step4 = wbStep4Questions(pars);
  wbChunks(step4.map((q, i) => ({ q, i })), 14).forEach(group => {
    const content = group.map(({ q, i }) => `<div class="wbKey"><b>문제 ${i + 1}.</b> ${wbEsc(wbOrderAnswer(q.order))}</div>`).join("");
    html += teacherPage(content, "교사용 · STEP 4", "문단 나열 정답");
  });
  const step5 = wbStep5Questions(pars);
  wbChunks(step5.map(q => ({ q })), 14).forEach(group => {
    const content = group.map(({ q }) => `<div class="wbKey"><b>${multi ? `Paragraph ${q.paragraph + 1} · ` : ""}문제 ${q.index + 1}.</b> ${wbEsc(wbOrderAnswer(q.order))}</div>`).join("");
    html += teacherPage(content, "교사용 · STEP 5", "문장 나열 정답");
  });
  return html;
}

function showWorkbook(draft) {
  workbookDraft = draft;
  workbookStudentPages = workbookTeacherPages = 0;
  workbookImages = new Set();
  wb("workbook").classList.remove("active");
  wb("output").classList.remove("hidden");
  wb("paper").innerHTML = wbStudent(draft) + wbTeacher(draft);
  wb("outputMeta").textContent = "본문 분석 완료 · 삽화 생성 중";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateWorkbookImages(keys) {
  keys.forEach(key => {
    if (workbookImages.has(key)) return;
    workbookImages.add(key);
    document.querySelectorAll(`[data-wb-image="${key}"]`).forEach(img => {
      img.src = `/api/workbook/jobs/${encodeURIComponent(workbookJob)}/images/${key}`;
      img.classList.remove("hidden");
    });
    document.querySelectorAll(`[data-wb-placeholder="${key}"]`).forEach(x => x.remove());
  });
}

async function workbookPoll() {
  if (!workbookJob) return;
  try {
    const r = await fetch(`/api/workbook/jobs/${encodeURIComponent(workbookJob)}`);
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    workbookPhase = data.phase;
    if (data.draft && data.draftVersion !== workbookDraftVersion) {
      workbookDraftVersion = data.draftVersion;
      showWorkbook(data.draft);
    }
    if (workbookDraft) updateWorkbookImages(data.imageKeys || []);
    const working = data.phase === "text" || data.phase === "images";
    wb("wbProgressTitle").textContent = data.phase === "text" ? "지문 분석 중" : data.phase === "images" ? "READING 삽화 생성 중" : data.phase === "partial" ? "일부 항목 재시도 필요" : "워크북 완성";
    wb("wbProgressText").textContent = data.phase === "text" ? `${data.textDone}/${data.textTotal}개 지문 분석` : `${data.imagesDone}/${data.imagesTotal}장 완성`;
    wb("wbProgressFill").style.width = `${data.phase === "text" ? Math.round(data.textDone / data.textTotal * 100) : data.imagesTotal ? Math.round(data.imagesDone / data.imagesTotal * 100) : 0}%`;
    const failures = [...(data.textErrors || []).map(x => `${x.label}: ${x.message}`), ...(data.imageErrors || [])];
    if (workbookDraft) {
      wb("outputMeta").textContent = working ? `본문 완성 · 삽화 ${data.imagesDone}/${data.imagesTotal}장 생성 중` :
        data.phase === "complete" ? `완료 · 모든 문장 · 삽화 ${data.imagesDone}장` :
          `완성된 지문은 보존됨 · 실패 ${failures.length}개 (다시 시도 가능)`;
      wb("workbookPrint").querySelectorAll("button").forEach(b => { if (b.textContent.includes("PDF")) b.disabled = working; });
      wb("wbRetryOutput").classList.toggle("hidden", data.phase !== "partial");
    }
    if (data.phase === "failed") throw Error(data.error);
    if (working) setTimeout(workbookPoll, 1800);
    else {
      wb("wbStart").disabled = false;
      if (data.phase === "partial") {
        wb("wbProgressText").textContent = `실패 ${failures.length}개: ${failures.join("; ").slice(0, 800)}`;
        wb("wbRetry").classList.remove("hidden");
      } else {
        wb("wbRetry").classList.add("hidden");
        wb("wbProgressText").textContent = "워크북이 완성되었습니다. 학생용과 교사용을 각각 인쇄해 PDF로 저장하세요.";
      }
    }
  } catch (e) {
    wb("wbProgressTitle").textContent = "생성 오류";
    wb("wbProgressText").textContent = e.message;
    wb("wbStart").disabled = false;
    if (!workbookDraft && workbookPhase !== "failed") setTimeout(workbookPoll, 3500);
  }
}

async function startWorkbook() {
  let input;
  try { input = workbookInputMode === "mock" ? { passages: wbCollectMockPassages() } : { paragraphs: wbCollectParagraphs() }; }
  catch (e) { return alert(e.message); }
  wb("wbStart").disabled = true;
  wb("wbProgressCard").classList.remove("hidden");
  wb("wbRetry").classList.add("hidden");
  wb("wbProgressTitle").textContent = "생성 시작 중";
  wb("wbProgressText").textContent = "본문을 문장별로 나누고 있습니다.";
  workbookDraft = null; workbookImages = new Set(); workbookDraftVersion = 0;
  try {
    const r = await fetch("/api/workbook/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      title: wb("wbTitle").value, mode: workbookInputMode, ...input,
    }) });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    workbookJob = data.id;
    workbookPoll();
  } catch (e) {
    wb("wbStart").disabled = false;
    wb("wbProgressTitle").textContent = "입력을 확인하세요";
    wb("wbProgressText").textContent = e.message;
  }
}

async function retryWorkbookImages() {
  wb("wbRetry").classList.add("hidden");
  wb("wbRetryOutput").classList.add("hidden");
  const r = await fetch(`/api/workbook/jobs/${encodeURIComponent(workbookJob)}/retry`, { method: "POST" });
  const data = await r.json();
  if (!r.ok) return alert(data.error);
  workbookPoll();
}

async function printWorkbook(kind) {
  if (!workbookDraft) return;
  if (workbookPhase === "text" || workbookPhase === "images") return alert("삽화 생성이 끝난 뒤 저장해 주세요.");
  await Promise.all([...document.querySelectorAll(".wbIllustration:not(.hidden)")].map(img => img.decode().catch(() => {})));
  window.addEventListener("afterprint", () => document.body.classList.remove(`workbook-print-${kind}`), { once: true });
  document.body.classList.add(`workbook-print-${kind}`);
  window.print();
  setTimeout(() => document.body.classList.remove(`workbook-print-${kind}`), 5000);
}

function downloadWorkbookDraft() {
  if (!workbookDraft) return;
  const blob = new Blob([JSON.stringify(workbookDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "워크북_검토용_초안.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function closeWorkbookOutput() {
  wb("output").classList.add("hidden");
  wb("workbook").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function extractWorkbookFile(input, target) {
  const file = input.files?.[0];
  if (!file) return;
  const field = input.closest(".wbParagraphCard, .wbMockCard")?.querySelector(target === "korean" ? ".wbKorean" : ".wbEnglish");
  if (!field) return;
  const before = field.value;
  field.value = "파일에서 텍스트를 읽는 중...";
  try {
    const data = new FormData(); data.append("file", file);
    const response = await fetch("/api/extract/file", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    field.value = result.text;
    if (input.closest(".wbMockCard")) updateWorkbookMockCount();
  } catch (error) {
    field.value = before;
    alert(error.message);
  } finally { input.value = ""; }
}

if (typeof document !== "undefined") {
  addWorkbookParagraph();
  addWorkbookParagraph();
  addWorkbookMockSlots();
  fetch("/api/status").then(response => response.json()).then(status => {
    wb("ai").textContent = status.ai ? "AI 연결됨" : "API 키 설정 필요";
    wb("ai").className = `pill ${status.ai ? "ok" : "off"}`;
  }).catch(() => { wb("ai").textContent = "서버 연결 확인 필요"; });
}
