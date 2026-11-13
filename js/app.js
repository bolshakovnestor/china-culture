(function(){
"use strict";
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const app = $("#app");
const T = window.TOPICS, P = window.PROVINCES, R = window.REGIONS, TY = window.TYPES, MP = window.MAP_PATHS;
const byId = Object.fromEntries(P.map(p=>[p.id,p]));
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- storage (safe) ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem("hx_"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("hx_"+k, JSON.stringify(v)); }catch(e){} }
};
let visited = store.get("visited", []);
let stars = store.get("stars", []);
let best = store.get("best", {});

/* ---------- terms {汉字|pinyin|переклад} ---------- */
const TERM = /\{([^|{}]+)\|([^|{}]+)\|([^{}]+)\}/g;
function fmt(s){
  return esc(s).replace(TERM, (m, hz, py, tr) =>
    `<span class="term" tabindex="0" data-say="${hz}" title="Натисни, щоб почути"><span class="t-hz">${hz}</span><span class="t-py">${py}</span> <span class="t-tr">(${tr})</span></span>`);
}
function plain(s){ return String(s).replace(TERM, (m,hz)=>hz); }

/* ---------- speech ---------- */
let zhVoice = null;
function pickVoice(){
  if(!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find(v=>/zh[-_]CN/i.test(v.lang)) || vs.find(v=>/^zh/i.test(v.lang)) || null;
}
if("speechSynthesis" in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, el){
  if(!("speechSynthesis" in window)){ toast("Браузер не підтримує озвучення"); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; u.rate = .8; if(zhVoice) u.voice = zhVoice;
  if(el){ el.classList.add("speaking"); u.onend = u.onerror = ()=>el.classList.remove("speaking"); }
  speechSynthesis.speak(u);
  if(!zhVoice && speechSynthesis.getVoices().length) toast("Китайський голос не знайдено — встанови його в налаштуваннях мовлення системи");
}
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-say]");
  if(t){ e.preventDefault(); say(t.dataset.say, t); }
});
document.addEventListener("keydown", e=>{
  if(e.key==="Enter" && e.target.matches && e.target.matches(".term")) say(e.target.dataset.say, e.target);
});

let toastT;
function toast(msg){
  let el = $("#toast");
  if(!el){ el = document.createElement("div"); el.id="toast";
    el.style.cssText="position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1c1a19;color:#fff;padding:10px 16px;border-radius:10px;z-index:99;font-size:14px;max-width:90vw;text-align:center;transition:opacity .3s";
    document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(()=>el.style.opacity=0, 3200);
}

/* ---------- wiki images ---------- */
const imgCache = store.get("img3", {});
const WIKI = window.WIKI || {};
async function wikiImg(article, lang){
  const key = lang+":"+article;
  if(imgCache[key] !== undefined) return imgCache[key];
  try{
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/`+encodeURIComponent(article));
    if(!r.ok) throw 0;
    const j = await r.json();
    let res = null;
    if(j.thumbnail && j.thumbnail.source){
      const ow = (j.originalimage && j.originalimage.width) || 0;
      const thumb = j.thumbnail.source;
      let src = thumb;
      // Wikimedia віддає лише стандартні розміри мініатюр (…, 330, 500, 960, 1280 …)
      if(/\/\d+px-/.test(thumb) && ow > 960) src = thumb.replace(/\/\d+px-/, "/960px-");
      else if(j.originalimage && ow <= 960) src = j.originalimage.source;
      const page = (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article)}`;
      res = {src, thumb, page};
    }
    imgCache[key] = res; store.set("img3", imgCache);
    return res;
  }catch(e){ return null; }
}
function loadPhotos(root){
  $$("[data-wiki],[data-zh]", root).forEach(async el=>{
    if(el.dataset.done) return; el.dataset.done = 1;
    let res = null;
    if(el.dataset.wiki) res = await wikiImg(el.dataset.wiki, "en");
    if(!res && el.dataset.zh) res = await wikiImg(el.dataset.zh, "zh");
    if(!res){ el.classList.add("noimg"); return; }
    const im = new Image();
    im.onload = ()=>{ el.style.backgroundImage = `url("${res.src}")`; el.classList.add("ok");
      el.dataset.full = res.src; el.dataset.page = res.page;
      const c = el.parentElement && el.parentElement.querySelector(":scope > .credit");
      if(c) c.innerHTML = `Фото: <a href="${res.page}" target="_blank" rel="noopener">Wikipedia / Wikimedia Commons</a>`; };
    im.onerror = ()=>{ if(res.thumb && im.src !== res.thumb){ res.src = res.thumb; im.src = res.thumb; } else el.classList.add("noimg"); };
    im.src = res.src;
  });
}
// перший термін у тексті → фото, якщо є у словнику WIKI
function firstImgKey(text){ const m = /\{([^|{}]+)\|/.exec(text); return m && WIKI[m[1]] ? m[1] : null; }
function tile(term){
  const m = /\{([^|{}]+)\|([^|{}]+)\|([^{}]+)\}/.exec(term); if(!m) return `<li>${fmt(term)}</li>`;
  const hz = m[1], en = WIKI[hz] || "";
  return `<figure class="tile"><div class="im" ${en?`data-wiki="${esc(en)}"`:""} data-zh="${hz}" data-cap="${esc(m[3])}"><span class="ph-hz">${hz}</span></div>
    <figcaption>${fmt(term)}</figcaption></figure>`;
}
/* lightbox */
document.addEventListener("click", e=>{
  const el = e.target.closest(".im.ok"); if(!el || e.target.closest(".term") || el.closest("a")) return;
  const lb = document.createElement("div"); lb.className = "lb";
  lb.innerHTML = `<figure><img src="${el.dataset.full}" alt=""><figcaption>${esc(el.dataset.cap||"")} · <a href="${el.dataset.page}" target="_blank" rel="noopener">джерело фото</a></figcaption></figure><button aria-label="Закрити">×</button>`;
  lb.onclick = ev=>{ if(!ev.target.closest("a")) lb.remove(); };
  document.body.appendChild(lb);
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape") $$(".lb").forEach(x=>x.remove()); });

/* ---------- vocab pool ---------- */
const VOCAB = [];
T.forEach(t => t.vocab.forEach(v => VOCAB.push({zh:v[0], py:v[1], uk:v[2], topic:t.id})));
P.forEach(p => VOCAB.push({zh:p.zh, py:p.py, uk:p.uk, topic:"map"}));
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/ü/g,"u").replace(/[\s'’-]/g,"").toLowerCase();

/* ---------- router ---------- */
function route(){
  const h = location.hash.replace(/^#\/?/, "");
  const [r, a] = h.split("/");
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.r === (r||"home") || (r==="topic" && x.dataset.r==="topics")));
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  window.scrollTo(0,0);
  if(!r) home();
  else if(r==="topics") topics();
  else if(r==="topic") topic(a);
  else if(r==="map") mapPage(a);
  else if(r==="dict") dict();
  else if(r==="quiz") quizPage(a);
  else home();
  app.classList.remove("fade"); void app.offsetWidth; app.classList.add("fade");
}
window.addEventListener("hashchange", route);

/* ---------- pieces ---------- */
const MOUNTAINS = `<svg class="mount" viewBox="0 0 1440 260" preserveAspectRatio="none" aria-hidden="true">
<defs><linearGradient id="m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d6a66"/><stop offset="1" stop-color="#d8cdb8"/></linearGradient>
<linearGradient id="m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3835"/><stop offset="1" stop-color="#8a8278"/></linearGradient>
<linearGradient id="m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1a19"/><stop offset="1" stop-color="#4b4540"/></linearGradient></defs>
<path fill="url(#m1)" opacity=".45" d="M0 170 L90 120 L160 150 L250 70 L330 130 L420 90 L520 150 L600 60 L700 140 L790 100 L880 150 L980 50 L1080 130 L1170 95 L1260 140 L1350 80 L1440 120 V260 H0Z"/>
<path fill="url(#m2)" opacity=".6" d="M0 200 L120 150 L210 190 L330 120 L440 185 L560 140 L650 195 L770 130 L900 200 L1010 150 L1120 195 L1240 140 L1360 190 L1440 160 V260 H0Z"/>
<path fill="url(#m3)" d="M0 235 C120 205 200 245 330 215 S560 240 690 220 S940 250 1070 222 S1300 245 1440 225 V260 H0Z"/>
<g fill="none" stroke="#b8232f" stroke-width="1.6" opacity=".55"><path d="M1060 70 q14 -10 28 0 q14 10 28 0"/><path d="M1100 92 q12 -8 24 0 q12 8 24 0"/></g>
</svg>`;

function tcard(t){
  const done = visited.includes(t.id);
  return `<a class="tcard" href="#/topic/${t.id}" style="--c:${t.color}">
    <span class="big">${t.icon}</span><div class="ic">${t.icon}</div>
    <h4>${esc(t.uk)}</h4><div class="zh">${t.zh} · <i>${t.py}</i></div>
    <p>${esc(plain(t.lead)).slice(0,110)}…</p>${done?'<span class="done">✓ переглянуто</span>':""}</a>`;
}

function wordOfDay(){
  const d = new Date(); const i = (d.getFullYear()*372 + d.getMonth()*31 + d.getDate()) % VOCAB.length;
  return VOCAB[i];
}

/* ---------- HOME ---------- */
function home(){
  const w = wordOfDay();
  const prog = Math.round(visited.filter(v=>T.some(t=>t.id===v)).length / T.length * 100);
  app.innerHTML = `
  <section class="hero">
    <div class="sun"></div>${MOUNTAINS}
    <div class="wrap">
      <div>
        <h1>中华<span>文化</span></h1>
        <div class="py">Zhōnghuá wénhuà — китайська культура</div>
        <h2>Інтерактивний довідник для студентів-китаїстів</h2>
        <p>Мова, історія, філософія, свята, кухня, чай, мистецтво та всі провінції на мапі. Кожне китайське слово — з ієрогліфами, піньїнем, перекладом і озвученням.</p>
        <div class="btns"><a class="btn red" href="#/topics">Почати вивчення →</a><a class="btn" href="#/map">Мапа Китаю</a><a class="btn" href="#/quiz">Перевірити себе</a></div>
      </div>
      <div class="stamp">
        <div class="muted" style="font-size:12px;letter-spacing:2px">СЛОВО ДНЯ · 今日词语</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:8px">
          <div class="hz" style="font:400 60px/1 var(--brush);color:var(--red)">${w.zh}</div>
          <div><div style="font:italic 20px var(--serif);color:var(--jade)">${w.py}</div><div style="font-size:17px">${esc(w.uk)}</div></div>
        </div>
        <button class="btn sm" style="margin-top:12px" data-say="${w.zh}">🔊 Послухати</button>
        <div class="prog" style="margin-top:16px">Прогрес <div class="bar"><i style="width:${prog}%"></i></div> ${prog}%</div>
      </div>
    </div>
  </section>
  <div class="wrap">
    <div class="stats">
      <div class="stat"><b>${T.length}</b><span>тем про культуру</span></div>
      <div class="stat"><b>34</b><span>провінційні одиниці на мапі</span></div>
      <div class="stat"><b>${VOCAB.length}</b><span>слів і назв у словнику</span></div>
      <div class="stat"><b>${T.reduce((a,t)=>a+t.quiz.length,0)}</b><span>питань у тестах</span></div>
    </div>
    <section class="blk">
      <div class="ttl"><h3>Теми</h3><span class="hz">主题</span><span class="py">zhǔtí</span></div>
      <div class="grid">${T.map(tcard).join("")}</div>
    </section>
    <section class="blk" style="padding-top:0">
      <div class="ttl"><h3>Пам'ятки Китаю</h3><span class="hz">名胜古迹</span><span class="py">míngshèng gǔjì</span></div>
      <div class="gal">${window.GALLERY.map(g=>`<a href="#/map/${g[3]}" class="gi"><div class="im" data-wiki="${esc(WIKI[g[0]]||"")}" data-zh="${g[0]}" data-cap="${esc(g[2])}"><span class="ph-hz">${g[0]}</span></div>
        <div class="gc"><b class="hz">${g[0]}</b> <i>${g[1]}</i><br>${esc(g[2])}</div></a>`).join("")}</div>
    </section>
    <section class="blk" style="padding-top:0">
      <div class="widget" style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center">
        <div><h3>Порада: натискай на будь-яке китайське слово</h3>
        <div class="sub" style="margin:0">Наприклад, ${fmt("{你好|nǐ hǎo|привіт}")} або ${fmt("{谢谢|xièxie|дякую}")} — браузер вимовить його китайською. Найкраще працює в Chrome, Edge і Safari.</div></div>
        <a class="btn red" href="#/dict">Словник →</a>
      </div>
    </section>
  </div>`;
  loadPhotos(app);
}

/* ---------- TOPICS LIST ---------- */
function topics(){
  app.innerHTML = `<div class="wrap"><section class="blk">
    <div class="ttl"><h3>Усі теми</h3><span class="hz">主题</span><span class="py">zhǔtí</span></div>
    <p class="muted" style="margin-top:-10px">Рекомендований порядок: почни з «Китай сьогодні» та «Мова», далі — за інтересом.</p>
    <div class="grid">${T.map(tcard).join("")}</div></section></div>`;
}

/* ---------- TOPIC ---------- */
function topic(id){
  const i = T.findIndex(t=>t.id===id); const t = T[i];
  if(!t){ home(); return; }
  if(!visited.includes(id)){ visited.push(id); store.set("visited", visited); }
  const prev = T[(i-1+T.length)%T.length], next = T[(i+1)%T.length];
  app.innerHTML = `
  <div class="tbanner" style="--c:${t.color}"><div class="ph" data-wiki="${t.wiki}"></div>
    <div class="wrap"><div class="crumbs"><a href="#/topics">← Усі теми</a></div>
      <div class="bigzh">${t.zh}</div><div class="pys">${t.py}</div><h1>${esc(t.uk)}</h1></div>
    <div class="credit"></div></div>
  <div class="wrap" style="--c:${t.color}">
    <p class="lead">${fmt(t.lead)}</p>
    ${t.sections.map(s=>`<div class="sec"><h3>${esc(s.title)}</h3><div class="cards">
      ${s.cards.map(c=>{ const k = firstImgKey(c.t); return `<div class="card${k?" has-img":""}">${k?`<div class="cimg im" data-wiki="${esc(WIKI[k])}" data-cap="${esc(c.h)}"></div>`:""}<h4>${esc(c.h)}</h4><p>${fmt(c.t)}</p></div>`;}).join("")}</div></div>`).join("")}
    <div id="widget"></div>
    <div class="sec"><h3>Корисна лексика · 词汇 <span class="muted" style="font:italic 15px var(--serif)">cíhuì</span></h3>
      <div class="vtools"><button class="chip on" data-vm="list">Список</button><button class="chip" data-vm="cards">Картки</button>
      <button class="chip" id="sayall">🔊 Прослухати все</button></div>
      <div id="vocab"></div></div>
    <div class="sec"><h3>Перевір себе · 测验 <span class="muted" style="font:italic 15px var(--serif)">cèyàn</span></h3><div id="quiz"></div></div>
    <div class="sources"><h4>Джерела</h4><ol>${t.sources.map(s=>`<li><a href="${s[1]}" target="_blank" rel="noopener">${esc(s[0])}</a></li>`).join("")}</ol></div>
    <div class="pn"><a class="btn" href="#/topic/${prev.id}">← ${esc(prev.uk)}</a><a class="btn red" href="#/topic/${next.id}">${esc(next.uk)} →</a></div>
  </div>`;
  loadPhotos(app);
  const words = t.vocab.map(v=>({zh:v[0],py:v[1],uk:v[2]}));
  const vbox = $("#vocab");
  const showList = ()=> vbox.innerHTML = vocabTable(words);
  showList();
  $$("[data-vm]").forEach(b=>b.onclick=()=>{ $$("[data-vm]").forEach(x=>x.classList.toggle("on",x===b));
    b.dataset.vm==="list" ? showList() : flashcards(vbox, words); });
  $("#sayall").onclick = ()=> say(words.map(w=>w.zh).join("，"));
  runQuiz($("#quiz"), t.quiz.map(q=>({...q})), "t_"+t.id);
  if(t.widget) WIDGETS[t.widget]($("#widget"), t);
}

function vocabTable(words){
  return `<table class="vtable">${words.map(w=>{
    const on = stars.includes(w.zh);
    return `<tr><td class="vz">${w.zh}</td><td class="vp">${w.py}</td><td>${esc(w.uk)}</td>
    <td class="vs"><button class="say" data-say="${w.zh}" aria-label="Озвучити">🔊</button><button class="star ${on?"on":""}" data-star="${w.zh}" title="Позначити вивченим">${on?"★":"☆"}</button></td></tr>`;}).join("")}</table>`;
}
document.addEventListener("click", e=>{
  const s = e.target.closest("[data-star]"); if(!s) return;
  const z = s.dataset.star; const i = stars.indexOf(z);
  if(i>=0) stars.splice(i,1); else stars.push(z);
  store.set("stars", stars); s.classList.toggle("on", i<0); s.textContent = i<0 ? "★" : "☆";
});

function flashcards(box, words){
  let i = 0; let list = [...words];
  const draw = ()=>{
    const w = list[i];
    box.innerHTML = `<div class="flash"><div class="fc" id="fc"><div class="f"><b>${w.zh}</b><small class="muted">натисни, щоб перевернути</small></div>
      <div class="b"><div class="p">${w.py}</div><div class="u">${esc(w.uk)}</div></div></div>
      <div class="fnav"><button class="btn sm" id="fp">←</button><span>${i+1} / ${list.length}</span><button class="btn sm" data-say="${w.zh}">🔊</button>
      <button class="btn sm" id="fs">🔀</button><button class="btn sm red" id="fn">→</button></div></div>`;
    $("#fc").onclick = ()=> $("#fc").classList.toggle("flip");
    $("#fp").onclick = ()=>{ i=(i-1+list.length)%list.length; draw(); };
    $("#fn").onclick = ()=>{ i=(i+1)%list.length; draw(); };
    $("#fs").onclick = ()=>{ list.sort(()=>Math.random()-.5); i=0; draw(); };
  };
  draw();
}

/* ---------- QUIZ engine ---------- */
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function runQuiz(box, qs, key){
  qs = qs.map(q=>{ const order = shuffle(q.a.map((x,i)=>i)); return {...q, a:order.map(i=>q.a[i]), c:order.indexOf(q.c)}; });
  let n = 0, score = 0;
  const draw = ()=>{
    if(n>=qs.length){
      const pct = Math.round(score/qs.length*100);
      if(!best[key] || pct>best[key]){ best[key]=pct; store.set("best",best); }
      box.innerHTML = `<div class="quiz result"><div class="score">${score}/${qs.length}</div>
        <p>${pct===100?"Чудово! 太棒了！ <i>tài bàng le!</i>":pct>=60?"Добре! 不错！ <i>búcuò!</i>":"Варто повторити. 加油！ <i>jiāyóu!</i>"}</p>
        <p class="muted">Найкращий результат: ${best[key]}%</p><button class="btn red" id="again">Пройти ще раз</button></div>`;
      $("#again", box).onclick = ()=> runQuiz(box, shuffle(qs).map(q=>({...q})), key);
      return;
    }
    const q = qs[n];
    box.innerHTML = `<div class="quiz"><div class="qn">Питання ${n+1} з ${qs.length}</div>
      <div class="bar"><i style="width:${n/qs.length*100}%"></i></div>
      <div class="qq">${fmt(q.q)}</div>
      <div class="opts">${q.a.map((a,i)=>`<button class="opt" data-i="${i}">${a.includes("{")?fmt(a):esc(a).replace(/([\u4e00-\u9fff，？]+)/g,'<span class="hz">$1</span>')}</button>`).join("")}</div>
      <div id="ex"></div></div>`;
    $$(".opt", box).forEach(b=>b.onclick=()=>{
      const k = +b.dataset.i; const ok = k===q.c; if(ok) score++;
      $$(".opt", box).forEach((x,j)=>{ x.disabled=true; if(j===q.c) x.classList.add("ok"); });
      if(!ok) b.classList.add("bad");
      $("#ex", box).innerHTML = `<div class="expl">${ok?"✅ Правильно!":"❌ Неправильно."} ${fmt(q.e||"")}</div>
        <div style="margin-top:12px;text-align:right"><button class="btn red sm" id="nx">${n+1<qs.length?"Далі →":"Результат"}</button></div>`;
      $("#nx", box).onclick = ()=>{ n++; draw(); };
    });
  };
  draw();
}

/* ---------- WIDGETS ---------- */
const WIDGETS = {
  tones(el){
    const tones=[["妈","mā","1-й · рівний","M4 8 H40"],["麻","má","2-й · висхідний","M4 26 L40 6"],["马","mǎ","3-й · низхідно-висхідний","M4 12 L20 26 L40 8"],["骂","mà","4-й · низхідний","M4 4 L40 26"],["吗","ma","нейтральний","M18 18 h6"]];
    const tr=["мама","коноплі","кінь","лаяти","питальна частка"];
    el.innerHTML = `<div class="widget"><h3>Почуй тони · 声调 <i style="font-weight:400;color:var(--gold)">shēngdiào</i></h3>
    <div class="sub">Один склад «ma» — п'ять різних значень. Натисни на картку.</div>
    <div class="tones">${tones.map((t,i)=>`<button class="tone" data-say="${t[0]}"><svg viewBox="0 0 44 30"><path d="${t[3]}" fill="none" stroke="#c49a45" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><b>${t[0]}</b><i>${t[1]}</i><small>${t[2]}</small><small style="color:#fff">${tr[i]}</small></button>`).join("")}</div>
    <div class="sub" style="margin:22px 0 10px">Еволюція піктограм: від зображення до знака</div>
    <div class="tones">${[["人","rén","людина"],["山","shān","гора"],["水","shuǐ","вода"],["木","mù","дерево"],["日","rì","сонце"],["月","yuè","місяць"],["口","kǒu","рот"],["火","huǒ","вогонь"],["马","mǎ","кінь"],["鱼","yú","риба"]].map(c=>`<button class="tone" data-say="${c[0]}"><b>${c[0]}</b><i>${c[1]}</i><small style="color:#fff">${c[2]}</small></button>`).join("")}</div></div>`;
  },
  timeline(el, t){
    const tl = t.timeline;
    el.innerHTML = `<div class="widget"><h3>Стрічка династій · 朝代表</h3><div class="sub">Гортай і натискай на династію. Мнемоніка: Ся–Шан–Чжоу–Цінь–Хань… Тан–Сун–Юань–Мін–Цін.</div>
    <div class="tl">${tl.map((d,i)=>`<div class="d" data-i="${i}"><b>${d[0]}</b><i>${d[1]}</i><small>${esc(d[2])}</small><small>${esc(d[3])}</small></div>`).join("")}</div>
    <div class="tlinfo" id="tli"></div></div>`;
    const show = i=>{ const d=tl[i]; $$(".tl .d",el).forEach((x,j)=>x.classList.toggle("on",i===j));
      $("#tli",el).innerHTML = `<b style="font-family:var(--serif);font-size:18px">${esc(d[2])}</b> <span class="term" data-say="${d[0]}"><span class="t-hz">${d[0]}</span><span class="t-py">${d[1]}</span></span> · ${esc(d[3])}<br>${fmt(d[4])}`; };
    $$(".tl .d",el).forEach(x=>x.onclick=()=>show(+x.dataset.i)); show(9);
  },
  zodiac(el){
    const Z = window.ZODIAC, E = window.ELEMENTS;
    el.innerHTML = `<div class="widget"><h3>Хто ти за китайським зодіаком? · 你属什么？</h3>
    <div class="sub">Введи рік народження. Увага: китайський рік починається зі Свята Весни (21 січня – 20 лютого), тож якщо ти народився в січні чи на початку лютого — перевір і попередній рік.</div>
    <div class="zform"><input id="zy" type="number" min="1900" max="2100" value="${new Date().getFullYear()-20}"><button class="btn red" id="zgo">Дізнатися</button></div>
    <div class="zres" id="zr"></div>
    <div class="zwheel">${Z.map((z,i)=>`<div data-z="${i}"><span>${z[0]}</span>${z[1]} · ${z[2]}</div>`).join("")}</div></div>`;
    const go = ()=>{
      const y = parseInt($("#zy",el).value,10); if(!(y>=1900 && y<=2100)) return;
      const zi = ((y-4)%12+12)%12, ei = Math.floor(((y%10)+10)%10/2);
      const z = Z[zi], e = E[ei];
      $("#zr",el).innerHTML = `<div class="ani">${z[3]}</div><b>${z[0]}</b><div><div style="font-size:22px;font-family:var(--serif)">${y} — рік ${esc(z[4])}</div>
        <div>Стихія: <span class="term" data-say="${e[0]}"><span class="t-hz" style="color:#ffb3a8">${e[0]}</span><span class="t-py" style="color:#9fd3c3">${e[1]}</span></span> ${esc(e[2])}</div>
        <div style="margin-top:6px">Скажи китайською: <span class="term" data-say="我属${z[0]}"><span class="t-hz" style="color:#ffb3a8">我属${z[0]}</span><span class="t-py" style="color:#9fd3c3">wǒ shǔ ${z[1]}</span></span></div></div>`;
      $$(".zwheel div",el).forEach(d=>d.classList.toggle("on", +d.dataset.z===zi));
    };
    $("#zgo",el).onclick = go; $("#zy",el).onkeydown = e=>{ if(e.key==="Enter") go(); };
    $$(".zwheel div",el).forEach(d=>d.onclick=()=>say(Z[+d.dataset.z][0]));
    go();
  },
  poem(el){
    const p = window.POEM;
    el.innerHTML = `<div class="widget"><h3>${p.title[0]} · ${p.title[1]} — «${p.title[2]}»</h3>
    <div class="sub">${p.author[0]} ${p.author[1]} (${p.author[2]}), VIII ст. Класичний вертикальний запис: читаємо згори вниз, справа наліво. Натисни на рядок.</div>
    <div class="poem"><div class="ttlp">${p.title[0]}　${p.author[0]}</div>${p.lines.map(l=>`<div class="ln" data-say="${l[0]}">${l[0]}</div>`).join("")}</div>
    <div class="ptrans">${p.lines.map(l=>`<div><i>${l[1]}</i><span>${esc(l[2])}</span></div>`).join("")}</div>
    <div style="margin-top:12px;position:relative;z-index:1"><button class="btn sm red" data-say="${p.lines.map(l=>l[0]).join("，")}">🔊 Прочитати весь вірш</button>
    <span class="muted" style="font-size:12px;margin-left:8px">Підрядний переклад — для навчання.</span></div></div>`;
  },
  teas(el){
    const TE = window.TEAS;
    el.innerHTML = `<div class="widget"><h3>Шість кольорів чаю · 六大茶类</h3><div class="sub">Від неокисненого до постферментованого. Натисни на категорію.</div>
    <div class="grad"></div><div class="teas">${TE.map((t,i)=>`<div class="tea" data-i="${i}" style="background:${t[4]}"><b>${t[0]}</b><small>${t[1]}<br>${esc(t[2])}</small></div>`).join("")}</div>
    <div class="tlinfo" id="tei"></div></div>`;
    const show=i=>{ const t=TE[i]; $$(".tea",el).forEach((x,j)=>x.classList.toggle("on",i===j));
      $("#tei",el).innerHTML=`<span class="term" data-say="${t[0]}"><span class="t-hz">${t[0]}</span><span class="t-py">${t[1]}</span></span> — <b>${esc(t[2])}</b>. Окиснення: ${esc(t[3])}. ${esc(t[5])}`; };
    $$(".tea",el).forEach(x=>x.onclick=()=>show(+x.dataset.i)); show(0);
  },
  cuisines(el){
    const C = window.CUISINES;
    el.innerHTML = `<div class="widget"><h3>Вісім великих кухонь на мапі · 八大菜系</h3><div class="sub">Натисни на кухню — побачиш її провінцію.</div>
    <div class="cuis"><svg viewBox="0 0 ${MP.w} ${MP.h}">${Object.entries(MP.p).map(([id,p])=>`<path d="${p.d}" data-id="${id}" class="${C.some(c=>c[3]===id)?"hl":""}"/>`).join("")}</svg>
    <div><div class="clist">${C.map((c,i)=>`<button data-i="${i}"><b>${c[0]}</b>${esc(c[2])}</button>`).join("")}</div><div class="tlinfo" id="cui"></div></div></div></div>`;
    const show=i=>{ const c=C[i]; $$(".clist button",el).forEach((x,j)=>x.classList.toggle("on",i===j));
      $$(".cuis path",el).forEach(p=>p.classList.toggle("on",p.dataset.id===c[3]));
      const pr = byId[c[3]];
      $("#cui",el).innerHTML=`<span class="term" data-say="${c[0]}"><span class="t-hz">${c[0]}</span><span class="t-py">${c[1]}</span></span> — ${esc(c[2])} кухня (${esc(pr.uk)}). ${esc(c[4])}`; };
    $$(".clist button",el).forEach(x=>x.onclick=()=>show(+x.dataset.i));
    $$(".cuis path.hl",el).forEach(p=>p.onclick=()=>show(C.findIndex(c=>c[3]===p.dataset.id)));
    show(1);
  }
};

/* ---------- MAP ---------- */
let mapMode = "region";
function popColor(v){
  const stops=[[0,[246,226,196]],[10,[232,170,120]],[40,[205,95,70]],[80,[160,30,40]],[130,[95,15,25]]];
  for(let i=1;i<stops.length;i++){ if(v<=stops[i][0]){ const [a,ca]=stops[i-1],[b,cb]=stops[i]; const k=(v-a)/(b-a);
    return `rgb(${ca.map((c,j)=>Math.round(c+(cb[j]-c)*k)).join(",")})`; } }
  return "rgb(95,15,25)";
}
const typeColor = {province:"#2e6b5e",autonomous:"#c49a45",municipality:"#b8232f",sar:"#1f3a5f",taiwan:"#9b9184"};
function fillFor(p){
  if(mapMode==="region") return R[p.region].color;
  if(mapMode==="pop") return popColor(p.pop);
  if(mapMode==="type") return typeColor[p.type];
  return "#cbbfa8";
}
function mapPage(sel){
  const labels = P.map(p=>{ const m=MP.p[p.id]; if(!m) return "";
    const small = ["110000","120000","310000","810000","820000"].includes(p.id);
    return small ? "" : `<text x="${m.cx}" y="${m.cy}" text-anchor="middle" dominant-baseline="middle">${p.zh}</text>`; }).join("");
  app.innerHTML = `<div class="wrap"><section class="blk">
    <div class="ttl"><h3>Мапа Китаю</h3><span class="hz">中国地图</span><span class="py">Zhōngguó dìtú</span></div>
    <p class="muted" style="margin-top:-12px">34 одиниці провінційного рівня за адміністративним поділом КНР. Натисни на регіон, щоб побачити столицю, населення, пам'ятки й місцеві страви.</p>
    <div class="maplay"><div>
      <div class="mtools">
        <button class="chip" data-m="region">Географічні регіони</button><button class="chip" data-m="pop">Населення</button>
        <button class="chip" data-m="type">Тип одиниці</button><button class="chip" data-m="game">🎯 Гра: знайди провінцію</button></div>
      <div id="mq"></div>
      <div class="mapbox" id="mbox"><svg viewBox="0 0 ${MP.w} ${MP.h}" id="msvg" role="img" aria-label="Мапа провінцій Китаю">
        ${P.map(p=>MP.p[p.id]?`<path d="${MP.p[p.id].d}" data-id="${p.id}" class="${p.type==="taiwan"?"tw":""}"><title>${p.uk} ${p.zh}</title></path>`:"").join("")}
        ${["810000","820000"].map(id=>`<circle cx="${MP.p[id].cx+(id==="810000"?8:-8)}" cy="${MP.p[id].cy+6}" r="7" data-id="${id}"><title>${byId[id].uk}</title></circle>`).join("")}
        ${labels}</svg>
        <div class="legend" id="leg"></div></div>
    </div><div id="pinfo"></div></div>
    <div class="sec"><h3>Усі регіони списком</h3><div id="plist"></div></div>
    <div class="sources"><h4>Джерела даних</h4><ol>
      <li><a href="https://www.stats.gov.cn/english/PressRelease/202105/t20210510_1817188.html" target="_blank" rel="noopener">Національне бюро статистики КНР — 7-й перепис населення 2020 (за провінціями)</a></li>
      <li><a href="https://www.census2021.gov.hk/en/index.html" target="_blank" rel="noopener">Перепис населення Гонконгу 2021</a>; <a href="https://www.dsec.gov.mo/en-US/" target="_blank" rel="noopener">Статистична служба Макао (DSEC)</a></li>
      <li><a href="https://whc.unesco.org/en/statesparties/cn" target="_blank" rel="noopener">UNESCO World Heritage — China</a></li>
      <li><a href="https://en.wikipedia.org/wiki/Provinces_of_China" target="_blank" rel="noopener">Wikipedia — Provinces of China</a> (площі, скорочення)</li>
      <li>Контури: Apache ECharts 4 (china.json), Apache-2.0. Мапа схематична; кордони — ілюстративні.</li></ol></div>
  </section></div>`;
  const svg = $("#msvg"), tip = $("#tip");
  $$("path, circle", svg).forEach(path=>{
    const p = byId[path.dataset.id];
    path.addEventListener("mousemove", e=>{ if(mapMode==="game") return;
      tip.innerHTML = `<span class="hz">${p.zh}</span> ${p.py} · ${esc(p.uk)}`; tip.style.opacity=1;
      tip.style.left = (e.clientX+14)+"px"; tip.style.top = (e.clientY+14)+"px"; });
    path.addEventListener("mouseleave", ()=> tip.style.opacity=0);
    path.addEventListener("click", ()=>{ tip.style.opacity=0; mapMode==="game" ? gameClick(p, path) : selectProv(p.id, true); });
  });
  $$("[data-m]").forEach(b=>b.onclick=()=>{ setMode(b.dataset.m); });
  // list
  $("#plist").innerHTML = Object.entries(R).map(([k,r])=>`<div style="margin:14px 0 4px;font-weight:600"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${r.color}"></i> ${esc(r.uk)} · <span class="hz">${r.zh}</span> <i class="muted">${r.py}</i></div>
    <div class="plist">${P.filter(p=>p.region===k).map(p=>`<button data-p="${p.id}"><span>${esc(p.uk)} <span class="hz">${p.zh}</span></span><span class="muted" style="font-size:12px">${p.py}</span></button>`).join("")}</div>`).join("");
  $$("[data-p]").forEach(b=>b.onclick=()=>{ if(mapMode==="game") setMode("region"); selectProv(b.dataset.p,true); window.scrollTo({top:$("#mbox").getBoundingClientRect().top+scrollY-90,behavior:"smooth"}); });
  setMode(mapMode==="game"?"region":mapMode);
  selectProv(sel && byId[sel] ? sel : null, false);
}
function setMode(m){
  mapMode = m;
  $$("[data-m]").forEach(b=>b.classList.toggle("on", b.dataset.m===m));
  $$("#msvg path, #msvg circle").forEach(p=>p.style.fill = fillFor(byId[p.dataset.id]));
  $("#mbox").classList.toggle("quizmode", m==="game");
  const leg = $("#leg");
  if(m==="region") leg.innerHTML = Object.values(R).map(r=>`<span><i style="background:${r.color}"></i>${esc(r.uk)} <span class="hz">${r.zh}</span></span>`).join("");
  else if(m==="pop") leg.innerHTML = [3,10,25,50,80,126].map(v=>`<span><i style="background:${popColor(v)}"></i>${v} млн</span>`).join("")+`<span class="muted">· перепис 2020</span>`;
  else if(m==="type") leg.innerHTML = Object.entries(TY).map(([k,t])=>`<span><i style="background:${typeColor[k]}"></i>${esc(t.uk)} <span class="hz">${t.zh}</span></span>`).join("");
  else leg.innerHTML = "";
  if(m==="game") startGame(); else $("#mq").innerHTML="";
}
function selectProv(id, scroll){
  $$("#msvg path, #msvg circle").forEach(p=>p.classList.toggle("sel", p.dataset.id===id));
  const box = $("#pinfo");
  if(!id){ box.innerHTML = `<div class="pinfo"><div class="empty"><span class="hz">省</span><b>Обери регіон на мапі</b><br>
    <span class="muted">Китайською «провінція» — ${fmt("{省|shěng|провінція}")}. Скорочені назви провінцій (наприклад, 京 для Пекіна) пишуть на автомобільних номерах.</span></div></div>`; return; }
  const p = byId[id]; const t = TY[p.type]; const r = R[p.region];
  if(history.replaceState) history.replaceState(null,"","#/map/"+id);
  box.innerHTML = `<div class="pinfo fade" style="--c:${r.color}">
    <div class="ph" data-wiki="${p.wiki}"><div class="nm"><b>${p.zh}</b><span>${p.py}</span></div></div>
    <div class="bd"><h3>${esc(p.uk)} <button class="say" data-say="${p.zh}" style="vertical-align:middle">🔊</button></h3>
    <span class="badge">${esc(t.uk)} · ${t.zh} ${t.py}</span><span class="badge" style="background:${r.color};color:#fff">${esc(r.uk)} · ${r.zh}</span>
    ${p.status?`<div class="note">${fmt(p.status)}</div>`:""}
    <dl class="kv">
      ${p.meaning?`<dt>Значення назви</dt><dd>${esc(p.meaning)}</dd>`:""}
      <dt>Скорочення</dt><dd>${fmt(`{${p.abbr[0]}|${p.abbr[1]}|скорочена назва}`)}</dd>
      ${p.cap?`<dt>Адмін. центр</dt><dd>${fmt(`{${p.cap[1]}|${p.cap[2]}|${p.cap[0]}}`)}</dd>`:""}
      <dt>Населення</dt><dd>≈ ${p.pop.toLocaleString("uk-UA",{maximumFractionDigits:2})} млн <span class="muted">(${p.popNote||"перепис 2020"})</span></dd>
      <dt>Площа</dt><dd>≈ ${p.area>=1?Math.round(p.area).toLocaleString("uk-UA")+" тис. км²":Math.round(p.area*1000)+" км²"}</dd>
    </dl>
    <h5>Що подивитися</h5><div class="tiles">${p.sights.map(tile).join("")}</div>
    <h5>Що скуштувати</h5><div class="tiles">${p.food.map(tile).join("")}</div>
    <h5>Цікаво знати</h5><ul>${p.facts.map(s=>`<li>${fmt(s)}</li>`).join("")}</ul>
    </div></div>`;
  loadPhotos(box);
  if(scroll && innerWidth<960) box.scrollIntoView({behavior:"smooth",block:"start"});
}
/* map game */
let game = null;
function startGame(){
  const ids = shuffle(P.filter(p=>p.type!=="sar").map(p=>p.id)).slice(0,10);
  game = {ids, n:0, score:0, tries:0};
  $$("#msvg path, #msvg circle").forEach(p=>{p.style.fill="#cbbfa8";});
  nextGame();
}
function nextGame(){
  const box = $("#mq");
  if(game.n>=game.ids.length){
    box.innerHTML = `<div class="mquiz"><b>Результат: ${game.score} / ${game.ids.length} 🎉</b><button class="btn sm red" id="gre">Ще раз</button></div>`;
    $("#gre").onclick = startGame; return;
  }
  const p = byId[game.ids[game.n]]; game.tries = 0;
  box.innerHTML = `<div class="mquiz"><div>Знайди на мапі: <span class="hz">${p.zh}</span> <i>${p.py}</i> — ${esc(p.uk)}</div><span>${game.n+1}/${game.ids.length} · ✓ ${game.score}</span></div>`;
}
function gameClick(p, path){
  const target = game.ids[game.n];
  if(game.n>=game.ids.length) return;
  if(p.id===target){
    if(game.tries===0) game.score++;
    path.style.fill = game.tries===0 ? "#2e6b5e" : "#c49a45";
    say(p.zh); game.n++; setTimeout(nextGame, 500);
  } else {
    game.tries++;
    toast(`Це ${p.uk} (${p.zh} ${p.py}). Спробуй ще!`);
    if(game.tries>=2){ const t = $(`#msvg path[data-id="${target}"]`); t.style.fill="#b8232f"; }
  }
}

/* ---------- DICTIONARY ---------- */
function dict(){
  app.innerHTML = `<div class="wrap"><section class="blk">
    <div class="ttl"><h3>Словник</h3><span class="hz">词典</span><span class="py">cídiǎn</span></div>
    <div class="dtools"><input class="search" id="q" placeholder="Пошук: ієрогліф, піньїнь (можна без тонів) або українською…" autocomplete="off">
      <select id="tf"><option value="">Усі теми</option>${T.map(t=>`<option value="${t.id}">${esc(t.uk)}</option>`).join("")}<option value="map">Провінції</option><option value="star">★ Позначені</option></select>
      <button class="chip on" data-dm="list">Список</button><button class="chip" data-dm="cards">Картки</button></div>
    <p class="muted" id="cnt"></p><div id="dl"></div></section></div>`;
  let mode = "list";
  const draw = ()=>{
    const q = norm($("#q").value.trim()), tf = $("#tf").value;
    const seen = new Set();
    const list = VOCAB.filter(w=>{
      if(tf==="star" ? !stars.includes(w.zh) : (tf && w.topic!==tf)) return false;
      if(q && !(w.zh.includes($("#q").value.trim()) || norm(w.py).includes(q) || norm(w.uk).includes(q))) return false;
      if(seen.has(w.zh)) return false; seen.add(w.zh); return true;
    });
    $("#cnt").textContent = `Знайдено: ${list.length}`;
    if(!list.length){ $("#dl").innerHTML = `<div class="empty"><span class="hz">无</span>Нічого не знайдено</div>`; return; }
    mode==="list" ? $("#dl").innerHTML = vocabTable(list) : flashcards($("#dl"), list);
  };
  $("#q").oninput = draw; $("#tf").onchange = draw;
  $$("[data-dm]").forEach(b=>b.onclick=()=>{ mode=b.dataset.dm; $$("[data-dm]").forEach(x=>x.classList.toggle("on",x===b)); draw(); });
  draw();
}

/* ---------- QUIZ PAGE ---------- */
function provQuestions(){
  const withCap = P.filter(p=>p.cap);
  const qs = [];
  shuffle(withCap).slice(0,4).forEach(p=>{
    const wrong = shuffle(withCap.filter(x=>x!==p)).slice(0,3).map(x=>`${x.cap[1]} ${x.cap[2]}`);
    qs.push({q:`Адміністративний центр регіону ${p.uk} (${p.zh} ${p.py})?`, a:[`${p.cap[1]} ${p.cap[2]}`,...wrong], c:0, e:`{${p.cap[1]}|${p.cap[2]}|${p.cap[0]}}`});
  });
  shuffle(P).slice(0,3).forEach(p=>{
    const wrong = shuffle(P.filter(x=>x!==p)).slice(0,3).map(x=>`${x.abbr[0]} ${x.abbr[1]}`);
    qs.push({q:`Яке однознакове скорочення має ${p.uk} (${p.zh})?`, a:[`${p.abbr[0]} ${p.abbr[1]}`,...wrong], c:0, e:`Скорочення використовують, зокрема, на автомобільних номерах.`});
  });
  shuffle(P.filter(p=>p.type==="province")).slice(0,3).forEach(p=>{
    const wrong = shuffle(P.filter(x=>x!==p)).slice(0,3).map(x=>x.uk);
    qs.push({q:`Як українською називається ${p.zh} ${p.py}?`, a:[p.uk,...wrong], c:0, e:`${p.zh} ${p.py} — ${p.uk}.`});
  });
  return shuffle(qs);
}
function quizPage(which){
  const opts = [["mix","🎲 Мікс з усіх тем"],["prov","🗺️ Провінції"],...T.map(t=>[t.id,t.uk])];
  app.innerHTML = `<div class="wrap"><section class="blk">
    <div class="ttl"><h3>Тести</h3><span class="hz">考试</span><span class="py">kǎoshì</span></div>
    <div class="mtools">${opts.map(o=>`<button class="chip ${o[0]===(which||"mix")?"on":""}" data-q="${o[0]}">${esc(o[1])}${best["t_"+o[0]]!=null?` · ${best["t_"+o[0]]}%`:""}</button>`).join("")}</div>
    <div id="qbox" style="margin-top:14px"></div></section></div>`;
  $$("[data-q]").forEach(b=>b.onclick=()=>{ location.hash = "#/quiz/"+b.dataset.q; });
  const w = which || "mix";
  let qs;
  if(w==="mix") qs = shuffle(T.flatMap(t=>t.quiz)).slice(0,12);
  else if(w==="prov") qs = provQuestions();
  else { const t = T.find(x=>x.id===w); qs = t ? t.quiz : []; }
  runQuiz($("#qbox"), qs, "t_"+w);
}

route();
})();
