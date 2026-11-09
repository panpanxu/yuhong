/* 把 engine.js + story.js + part_*.js 合成为一个可双击运行的单文件 HTML */
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const parts = ['story.js'];
for (const f of ['part_liu.js', 'part_liu_out.js', 'part_hao.js', 'part_hao_out.js', 'part_jie.js', 'part_chen.js', 'part_chen_out.js']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) parts.push(f);
  else console.warn('缺少（跳过）：' + f);
}
parts.push('engine.js');

const js = parts.map(f => {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  return '\n/* ===== ' + f + ' ===== */\n' + src;
}).join('\n');

const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const shell = fs.readFileSync(path.join(dir, 'shell.html'), 'utf8');

const out = shell
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const target = path.join(dir, '..', '于洪.html');
fs.writeFileSync(target, out, 'utf8');
console.log('已生成：' + target + '  (' + (out.length / 1024).toFixed(1) + ' KB)');

// 场景连通性检查
const sceneIds = [...out.matchAll(/SCENES\.([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]);
const nexts = [...js.matchAll(/next:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
const set = new Set(sceneIds);
const missing = [...new Set(nexts.filter(n => !set.has(n)))];
console.log('场景数：' + sceneIds.length);
console.log(missing.length ? ('未定义的目标场景：' + missing.join(', ')) : '所有 next 目标均已定义 ✔');
