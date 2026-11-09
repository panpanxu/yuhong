/* ============================================================
 *  《于洪》互动小说引擎
 * ============================================================ */
const BASE_FLAGS = {
  calledLi: null, tippedLi: null, roleInJob: null, borrowedMoto: null, borrowedName: null,
  toldChenRed: null,
  // ==== 关键转折（决定命运走向，不再只是态度）====
  liuTurn: null,   // 'in' 入伙 | 'out' 退出 | 'reported' 举报
  haoTurn: null,   // 'stayed' 留下 | 'ran' 逃亡 | 'reported' 报警
  chenTurn: null,  // 'hired' 招了刘阳 | 'fired' 赶走刘阳
  liuHaojie: 0, liuChenHong: 0, haoHaojie: 0, chenLiu: 0, chenTruth: 0,
  money: 0, policeHeat: 0, liuSuspected: 0, haoWanted: 0, haoRage: 40,
  jieLiu: 20, jieWater: 55,
  jieHospital: false, kangKang: 'normal', kangKangAlive: true,
  jieAlive: true, liuAlive: true, haoAlive: true, chenAlive: true,
};

/* ---------------- 状态 ---------------- */
const G = {
  scene: null,
  flags: {},
  seen: {},
  char: null,
  log: [],
  history: [],
  typing: false,
  typeTimer: null,
  waitingClick: false,
  pending: null,
  curLines: [],
  curIdx: 0,
  inScene: false,
};

/* ---------------- 模型接入（OpenAI 兼容）---------------- */
const LLM = { url: '', model: '', key: '', enabled: false };

function setLLMConfig(cfg) {
  cfg = cfg || {};
  LLM.url = (cfg.url || '').trim();
  LLM.model = (cfg.model || '').trim();
  LLM.key = (cfg.key || '').trim();
  LLM.enabled = !!(LLM.url && LLM.model);
}

function llmReady() { return LLM.enabled; }

async function llmChat(messages, opts) {
  opts = opts || {};
  if (!LLM.enabled) throw new Error('没有配置模型');
  const headers = { 'Content-Type': 'application/json' };
  if (LLM.key) headers['Authorization'] = 'Bearer ' + LLM.key;
  const body = {
    model: LLM.model,
    messages: messages,
    temperature: opts.temperature == null ? 0.9 : opts.temperature,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 60000);
  let res;
  try {
    res = await fetch(LLM.url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 160));
  }
  const data = await res.json();
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const text = msg ? (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) : '';
  if (!text) throw new Error('返回内容为空');
  return text.trim();
}

async function llmTest(cfg) {
  const saved = { url: LLM.url, model: LLM.model, key: LLM.key, enabled: LLM.enabled };
  LLM.url = cfg.url; LLM.model = cfg.model; LLM.key = cfg.key || ''; LLM.enabled = true;
  try {
    const reply = await llmChat(
      [{ role: 'user', content: '只回复两个字：正常' }],
      { temperature: 0, maxTokens: 16, timeout: 20000 }
    );
    return LLM.model + ' 已响应「' + reply.slice(0, 20) + '」';
  } finally {
    LLM.url = saved.url; LLM.model = saved.model; LLM.key = saved.key; LLM.enabled = saved.enabled;
  }
}

/* 让模型给当前节点续写一小段（离线时返回 null，由剧本原文接上） */
async function llmNarrate(sceneId, sceneTitle, recentLines, charName) {
  if (!LLM.enabled) return null;
  const sys = [
    '你在续写一篇以沈阳为背景的中文短篇小说，风格参考班宇：',
    '句子短，口语化，多用具体物件，不写心理总结，不解释人物动机，不出现现代词汇。',
    '只输出正文，不要标题，不要任何说明，80 到 140 字。'
  ].join('');
  const user = [
    '当前章节：' + (sceneTitle || ''),
    '正在叙述的人：' + (charName || ''),
    '刚刚发生的几句：',
    (recentLines || []).slice(-6).map(l => l.text || l).join('\n'),
    '请接一段，保持同样的口吻，往前推一点点。'
  ].join('\n');
  try {
    return await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: 400 });
  } catch (e) {
    return null; // 失败就静默回落到离线剧情
  }
}

function resetState() {
  G.scene = null; G.flags = JSON.parse(JSON.stringify(BASE_FLAGS));
  G.seen = {}; G.char = null; G.log = []; G.history = [];
  G.typing = false; G.waitingClick = false; G.pending = null;
  G.curLines = []; G.curIdx = 0; G.inScene = false;
}
function snapshot() {
  return JSON.stringify({ scene: G.scene, flags: G.flags, seen: G.seen, char: G.char, log: G.log.slice(-300) });
}
function restore(str) {
  const s = JSON.parse(str);
  resetState();
  G.scene = s.scene; G.flags = s.flags; G.seen = s.seen || {}; G.char = s.char; G.log = s.log || [];
}
function setFlag(k, v) {
  if (typeof v === 'number') G.flags[k] = (G.flags[k] || 0) + v;
  else G.flags[k] = v;
}
function clampFlags() {
  const lo = ['liuHaojie','liuChenHong','haoHaojie','chenLiu','chenTruth','money','policeHeat','liuSuspected','haoWanted','haoRage','jieLiu','jieWater'];
  lo.forEach(k => {
    if (typeof G.flags[k] === 'number') G.flags[k] = Math.max(0, Math.min(100, G.flags[k]));
  });
}
function has(scene) { return !!G.seen[scene]; }

/* ---------------- 角色 ---------------- */
const CHARS = {
  liu:  { name: '刘阳',   title: '退伍兵 · 于洪广场的烟摊 · 叙述者', color: '#8b1d18' },
  hao:  { name: '郝鹏飞', title: '外号三眼儿 · 侦察兵出身 · 背了五年黑锅的人', color: '#1d3f6e' },
  jie:  { name: '郝洁',   title: '郝鹏飞的姐姐 · 从大连回来的人 · 读书的人', color: '#7a5b1e' },
  chen: { name: '陈红',   title: '物流公司女老板 · 李德武的前妻 · 钱的主人', color: '#6b2d5e' },
};

/* ---------------- 打字器 ---------------- */
const SPEED = 13;
function clearTimers() {
  if (G.typeTimer) { clearTimeout(G.typeTimer); G.typeTimer = null; }
  G.typing = false;
}

function line(opts) {
  const el = document.createElement('div');
  el.className = 'line ' + (opts.cls || '');
  if (opts.who) {
    const w = document.createElement('span');
    w.className = 'who ' + (opts.whoKey || '');
    w.textContent = opts.who;
    el.appendChild(w);
  }
  const body = document.createElement('span');
  body.className = 'body';
  body.dataset.full = opts.text || '';
  el.appendChild(body);
  const box = document.getElementById('stream');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return { el, body };
}

function typeText(body, text, done) {
  clearTimers();
  G.typing = true;
  let i = 0;
  body.textContent = '';
  const step = () => {
    if (i >= text.length) { G.typing = false; G.typeTimer = null; done && done(); return; }
    const n = Math.max(1, Math.round(Math.random() * 2));
    body.textContent += text.slice(i, i + n);
    i += n;
    const box = document.getElementById('stream');
    box.scrollTop = box.scrollHeight;
    G.typeTimer = setTimeout(step, SPEED + Math.random() * SPEED);
  };
  step();
}

function playLines(lines, done) {
  G.curLines = lines; G.curIdx = 0; G.inScene = true;
  const next = () => {
    if (G.curIdx >= lines.length) { G.inScene = false; done && done(); return; }
    const o = lines[G.curIdx++];
    if (!o) { next(); return; }
    const { body } = line(o);
    if (o.instant) { body.textContent = o.text || ''; next(); return; }
    typeText(body, o.text || '', next);
  };
  next();
}

/* 点击跳过：第一次点补全当前行并继续播剩下的；再点推进 */
document.addEventListener('click', () => {
  if (G.typing) {
    clearTimers();
    const all = document.querySelectorAll('#stream .line .body');
    const last = all[all.length - 1];
    if (last) last.textContent = last.dataset.full || '';
    // 继续播剩余行
    const lines = G.curLines, start = G.curIdx;
    const rest = lines.slice(start);
    playLinesRest(rest);
    return;
  }
}, true);

function playLinesRest(rest) {
  let idx = 0;
  G.typing = false;
  const next = () => {
    if (idx >= rest.length) {
      G.inScene = false;
      if (G._afterLines) { const f = G._afterLines; G._afterLines = null; f(); }
      return;
    }
    const o = rest[idx++];
    if (!o) { next(); return; }
    const { body } = line(o);
    body.textContent = o.text || '';
    body.parentNode.classList.add('quick');
    next();
  };
  next();
}

/* ---------------- 渲染工具 ---------------- */
function renderChoices(list) {
  const box = document.getElementById('choices');
  box.innerHTML = '';
  if (!list || !list.length) return;
  list.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    if (c.tag) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = c.tag;
      btn.appendChild(t);
    }
    const txt = document.createElement('span');
    txt.textContent = c.text;
    btn.appendChild(txt);
    btn.onclick = () => {
      box.innerHTML = '';
      const { body } = line({ cls: 'chosen', text: '' });
      body.textContent = '▶ ' + c.text;
      if (c.effects) Object.keys(c.effects).forEach(k => setFlag(k, c.effects[k]));
      clampFlags();
      G.history.push({ scene: G.scene, choice: c.text, snap: snapshot() });
      G.seen[G.scene] = (G.seen[G.scene] || 0) + 1;
      renderStatus();
      goto(c.next);
    };
    box.appendChild(btn);
  });
}

function renderContinue(text, next) {
  const box = document.getElementById('choices');
  box.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'choice continue';
  btn.textContent = text || '继续';
  btn.onclick = () => { box.innerHTML = ''; goto(next); };
  box.appendChild(btn);
}

/* ---------------- 场景跳转 ---------------- */
function resolve(id) {
  if (!id) return { lines: [{ text: '（故事到此为止。）' }] };
  if (typeof id === 'function') return { fn: id };
  const s = SCENES[id];
  if (!s) return { lines: [{ text: '（缺失场景：' + id + '）', cls: 'err' }] };
  // 结局路由是以函数形式存放的场景，直接交给 goto 执行
  if (typeof s === 'function') return { fn: s };
  const visit = G.seen[id] || 0;
  if (s.variants && s.variants.length) {
    const v = s.variants[Math.min(visit, s.variants.length - 1)];
    return resolve(v);
  }
  return s;
}

function goto(id) {
  if (typeof id === 'string') G.scene = id;
  const sc = resolve(id);
  if (sc.fn) { sc.fn(); return; }
  if (sc.title) {
    const t = document.createElement('div');
    t.className = 'scene-title';
    t.textContent = sc.title;
    document.getElementById('stream').appendChild(t);
  }
  if (sc.where) {
    const t = document.createElement('div');
    t.className = 'scene-where';
    t.textContent = sc.where;
    document.getElementById('stream').appendChild(t);
  }
  const box = document.getElementById('stream');
  box.scrollTop = box.scrollHeight;

  G._afterLines = () => {
    // 配了模型就让它先续一小段，然后再出选项 / 继续按钮
    if (LLM.enabled && sc.lines && sc.lines.length) {
      appendModelLine(sc);
    } else {
      afterScene(sc);
    }
  };
  playLines(sc.lines || [], G._afterLines);
}

function afterScene(sc) {
  if (sc.choices) {
    renderChoices(typeof sc.choices === 'function' ? sc.choices() : sc.choices);
  } else if (sc.next) {
    renderContinue(sc.continueText || '继续', sc.next);
  } else if (sc.end) {
    const btn = document.createElement('button');
    btn.className = 'choice continue';
    btn.textContent = sc.continueText || '……';
    btn.onclick = () => {
      if (typeof sc.end === 'function') sc.end();
      else location.reload();
    };
    document.getElementById('choices').appendChild(btn);
  }
}

/* 在场景末尾追加一段由模型写的文字；失败就跳过，不影响剧情推进 */
function appendModelLine(sc) {
  const stream = document.getElementById('stream');
  const hint = document.createElement('div');
  hint.className = 'model-line pending';
  hint.textContent = '（正在续写……）';
  stream.appendChild(hint);
  stream.scrollTop = stream.scrollHeight;

  const charName = G.char && CHARS[G.char] ? CHARS[G.char].name : '';
  llmNarrate(G.scene, sc.title, sc.lines, charName).then(text => {
    if (!text) {
      hint.remove();
      afterScene(sc);
      return;
    }
    hint.remove();
    const el = document.createElement('div');
    el.className = 'line model-line';
    el.textContent = text;
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
    afterScene(sc);
  });
}

/* ---------------- 存档 ---------------- */
const SAVE_KEY = 'yuhong_save_v2';
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, snapshot()); return true; }
  catch (e) { return false; }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    restore(raw);
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    document.getElementById('ending').classList.add('hidden');
    renderStatus();
    document.getElementById('stream').innerHTML = '';
    goto(G.scene);
    return true;
  } catch (e) { return false; }
}

/* ---------------- 状态面板 ---------------- */
function renderStatus() {
  const box = document.getElementById('status');
  if (!G.char) { box.innerHTML = ''; return; }
  const c = CHARS[G.char];
  const f = G.flags;
  const bar = (label, v, color) => {
    const p = Math.max(0, Math.min(100, v || 0));
    return `<div class="stat"><span class="sl">${label}</span><span class="bar"><i style="width:${p}%;background:${color}"></i></span><span class="sv">${p}</span></div>`;
  };
  const rows = [];
  if (G.char === 'liu') {
    rows.push(bar('与郝洁', f.liuHaojie, '#c08b3e'));
    rows.push(bar('与陈红', f.liuChenHong, '#8e4a8a'));
    rows.push(bar('手里的钱', f.money, '#4d7a4d'));
    rows.push(bar('警方的注意', f.policeHeat, '#b03a2e'));
  } else if (G.char === 'hao') {
    rows.push(bar('对姐姐', f.haoHaojie, '#c08b3e'));
    rows.push(bar('通缉的火候', f.haoWanted, '#b03a2e'));
    rows.push(bar('心里的恨', f.haoRage, '#6b1f18'));
  } else if (G.char === 'jie') {
    rows.push(bar('对刘阳', f.jieLiu, '#8b1d18'));
    rows.push(bar('对弟弟', f.haoHaojie, '#1d3f6e'));
    rows.push(bar('心里压着的水', f.jieWater, '#3a5f7a'));
  } else if (G.char === 'chen') {
    rows.push(bar('对刘阳', f.chenLiu, '#8b1d18'));
    rows.push(bar('账上的钱', f.money, '#4d7a4d'));
    rows.push(bar('警方的注意', f.policeHeat, '#b03a2e'));
  }
  box.innerHTML = `<div class="who-card" style="border-left-color:${c.color}">
      <div class="wname" style="color:${c.color}">${c.name}</div>
      <div class="wtitle">${c.title}</div></div><div class="stats">${rows.join('')}</div>`;
}

/* ---------------- 随机开场 ---------------- */
function randomChar() {
  const keys = ['liu', 'hao', 'jie', 'chen'];
  return keys[Math.floor(Math.random() * keys.length)];
}

function startGame(charKey) {
  if (!CHARS[charKey]) charKey = randomChar();
  resetState();
  G.char = charKey;
  if (charKey === 'jie') { G.flags.jieLiu = 20; G.flags.jieWater = 55; G.flags.haoHaojie = 65; }
  if (charKey === 'chen') { G.flags.chenLiu = 10; G.flags.money = 40; G.flags.chenTruth = 5; }
  if (charKey === 'hao') { G.flags.haoHaojie = 65; G.flags.haoRage = 40; G.flags.haoWanted = 10; }
  if (charKey === 'liu') { G.flags.liuHaojie = 0; G.flags.money = 0; G.flags.policeHeat = 10; }
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('ending').classList.add('hidden');
  renderStatus();
  document.getElementById('stream').innerHTML = '';
  goto({ liu: 'liu_1999', hao: 'hao_1999', jie: 'jie_1999', chen: 'chen_1999' }[charKey]);
}

/* ---------------- 结局卡片 ---------------- */
const ENDINGS = [
  { n: '结局一', t: '直起腰来', d: '走出瀑布，进入海中。' },
  { n: '结局二', t: '水中的两个人', d: '两个人都不肯先放手。' },
  { n: '结局三', t: '各自的命数', d: '活着的日子还得接着过下去。' },
  { n: '结局四', t: '帆影', d: '远处楼群正如帆影，扬起一角，缓缓移动。' },
  { n: '结局五', t: '千禧年的雪', d: '一九九九年的最后一天，雪不大。' },
];

function showEnding(info) {
  info = info || {};
  const box = document.getElementById('ending');
  const c = CHARS[G.char];
  const e = ENDINGS[Math.max(0, Math.min(4, (info.num || 1) - 1))];
  box.innerHTML = `<div class="end-card">
      <div class="end-kicker">${e.n}</div>
      <h2 class="end-title">${e.t}</h2>
      <div class="end-desc">${e.d}</div>
      <div class="end-you">你扮演的是 <b style="color:${c.color}">${c.name}</b></div>
      ${info.summary ? `<div class="end-summary">${info.summary}</div>` : ''}
      ${info.quote ? `<div class="end-quote">${info.quote}</div>` : ''}
      <div class="end-btns">
        <button class="choice continue" onclick="backToMenu()">重开一次（换一个人）</button>
      </div>
    </div>`;
  box.classList.remove('hidden');
  document.getElementById('choices').innerHTML = '';
  try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
}
