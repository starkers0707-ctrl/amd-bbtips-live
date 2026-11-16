import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let brainAdapter = null;
try {
  brainAdapter = require("./brain/adapter.cjs");
  console.log("Cerebro da extensao carregado (robot.js real)");
} catch (e) {
  console.error("Falha ao carregar cerebro:", e.message);
}
const BRAIN_MKT = { o35: "over35", o25: "over25", ge5: "over5", ambas: "ambas_sim" };

function brainEval(games, upcoming, liga, mkt) {
  if (!brainAdapter) return null;
  const bk = BRAIN_MKT[mkt];
  if (!bk) return null;
  try {
    const res = brainAdapter.analyzeWithBrain(games, upcoming, liga, bk);
    return res.map(r => {
      if (r.error || !r.analysis) return { nome: r.game?.name || "?", erro: r.error || "sem analise" };
      const a = r.analysis;
      const orig = upcoming.find(u => u.nome === r.game.name) || {};
      return {
        nome: r.game.name,
        horario: orig.horario || "",
        casa: orig.casa || "",
        fora: orig.fora || "",
        odd: r.game.odd || null,
        score: a.score ?? null,
        status: a.status || "—",
        motivo: a.motivo || "—",
        prob: Number.isFinite(a.prob) ? +a.prob.toFixed(1) : null,
        justa: Number.isFinite(a.fairOdd) ? +a.fairOdd.toFixed(2) : null,
        ev: Number.isFinite(a.ev) ? +a.ev.toFixed(1) : null,
        edge: Number.isFinite(a.probEdge) ? +a.probEdge.toFixed(1) : null,
        evGale: Number.isFinite(a.evGale) ? +a.evGale.toFixed(1) : null,
        teamBase: a.team && Number.isFinite(a.team.p) ? `${a.team.g}/${a.team.j} ${a.team.p.toFixed(0)}%` : "sem base",
        oddBase: a.odd && Number.isFinite(a.odd.p) ? `${a.odd.g}/${a.odd.j} ${a.odd.p.toFixed(0)}%` : "sem base",
        ciclo: a.cycle ? `${a.cycle.streak} ${a.cycle.cur} | ${a.cycle.fase} | pressão ${Math.round(a.cycle.pressao || 0)}` : "—",
        coldOdd: !!a.coldOdd,
        ready: !!(a.combo && a.combo.ready),
        pontos: a.combo ? a.combo.points : null,
        oddFixa: r.detalhes?.oddFixa || null,
        horarioStat: r.detalhes?.horario || null,
        ligaStat: r.detalhes?.liga || null,
        teamDetail: r.detalhes?.teamDetail || null,
        placarCorreto: r.detalhes?.placar || null,
        oneXTwo: r.detalhes?.oneXTwo || null,
        cicloTxt: r.detalhes?.cicloTxt || null,
        teamGeral: r.detalhes?.teamGeral || null
      };
    });
  } catch (e) {
    return [{ erro: "brain: " + e.message }];
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const ORIGENS_OK = (process.env.ORIGENS_OK || "https://amd-bbtips-live.onrender.com").split(",").map(x => x.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const p = req.path;
  const ehSonda = p === "/api/snapshot" || p === "/api/snapshot2";
  if (ehSonda) res.header("Access-Control-Allow-Origin", "*");
  else if (ORIGENS_OK.includes(origin)) res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,X-Acesso");
  res.header("X-Frame-Options", "SAMEORIGIN");
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Referrer-Policy", "same-origin");
  res.header("X-Robots-Tag", "noindex, nofollow");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const ehApiDado = p.startsWith("/api/") && !p.startsWith("/api/snapshot") && !p.startsWith("/api/dados") && !p.startsWith("/api/tampermonkey") && !p.startsWith("/api/bbtips") && !p.startsWith("/api/admin") && !p.startsWith("/api/acesso") && !p.startsWith("/api/eventos") && p !== "/api/grade";
  if (ehApiDado) {
    const ref = (req.headers.referer || req.headers.origin || "");
    const deOutroSite = ref && !ORIGENS_OK.some(o => ref.startsWith(o));
    if (deOutroSite) return res.status(403).json({ erro: "acesso restrito ao aplicativo" });
  }
  next();
});
app.use(express.json({ limit: "25mb" }));

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const GH_T = process.env.GH_TOKEN || "";
const GH_REPO = process.env.GH_REPO || "starkers0707-ctrl/amd-bbtips-live";
const GH_BRANCH = process.env.GH_BRANCH || "main";
let webpush = null;
try { webpush = require("web-push"); } catch (e) { console.log("web-push indisponivel:", e.message); }

const GH_FILE = "codigos.json";
let codigos = {}; 
let ghSha = null;
let ghErro = null; 
const ghHead = () => ({ "Authorization": "Bearer " + GH_T, "Accept": "application/vnd.github+json", "User-Agent": "caramelo-live" });
async function carregaCodigos() {
  if (!GH_T) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
    if (r.ok) { const j = await r.json(); ghSha = j.sha; codigos = JSON.parse(Buffer.from(j.content, "base64").toString()); }
  } catch (e) {}
}
async function salvaCodigos() {
  if (!GH_T) return;
  try {
    const body = { message: "codigos", content: Buffer.from(JSON.stringify(codigos, null, 1)).toString("base64"), branch: GH_BRANCH };
    if (ghSha) body.sha = ghSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); ghSha = j.content.sha; ghErro = null; }
    else { ghErro = "HTTP " + r.status + " — token sem permissão Contents:Read/Write nesse repo, ou token inválido"; }
  } catch (e) { ghErro = e.message; }
}
carregaCodigos();
const CODIGO_MESTRE = String(process.env.CODIGO_MESTRE || "").toUpperCase().trim();

const BBTIPS_ENABLED = process.env.BBTIPS_ENABLED === "1";
let bbtipsAuto = null;
if (BBTIPS_ENABLED) {
  import("./bbtips-auto.mjs").then(m => { bbtipsAuto = m; console.log("[bbtips] auto-coleta carregada"); }).catch(e => console.log("[bbtips] modulo nao carregado:", e.message));
}

let vavadaKiron = null;
import("./vavada-kiron.mjs").then(m => { 
  vavadaKiron = m; 
  console.log("[vavada] coletor Kiron carregado"); 
  if (m.iniciar) {
    m.iniciar((liga, fechados, futuros) => {
      if (fechados.length || futuros.length) {
        console.log(`[vavada] ${liga}: ${fechados.length} passados, ${futuros.length} futuros`);
      }
    });
  }
}).catch(e => console.log("[vavada] modulo nao carregado:", e.message));

function limpaToken(v) { const m = String(v || "").match(/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/); return m ? m[0] : ""; }
let BB_TOKEN = limpaToken(process.env.BBTIPS_TOKEN);
let bbUltima = { ts: 0, ligas: 0, nomes: 0, porCasa: {}, erro: null, rodando: false };

function codigoValido(c) {
  if (CODIGO_MESTRE && c === CODIGO_MESTRE) return true;
  const d = codigos[c]; if (!d) return false;
  if (Date.now() > d.expira) return false;
  d.usos = (d.usos || 0) + 1; d.ultimoUso = Date.now(); return true;
}

app.use((req, res, next) => {
  const p = req.path;
  const livre = p === "/api/snapshot" || p === "/api/snapshot2" || p === "/api/dados" || p === "/api/tampermonkey" || p.startsWith("/api/bbtips") || p === "/api/eventos" || p === "/api/grade" || p.startsWith("/api/acesso") || p.startsWith("/api/admin") || !p.startsWith("/api/");
  if (livre) return next();
  const c = String(req.headers["x-acesso"] || req.query.c || "").toUpperCase().trim();
  if (codigoValido(c)) return next();
  res.status(401).json({ erro: "acesso" });
});

app.post("/api/acesso/validar", (req, res) => {
  const c = String((req.body || {}).codigo || "").toUpperCase().trim();
  if (codigoValido(c)) { const d = codigos[c] || { nome: "mestre", expira: Date.now() + 3153600000000 }; res.json({ ok: true, nome: d.nome, expira: d.expira }); }
  else res.status(401).json({ ok: false, erro: "código inválido ou expirado" });
});

const isAdmin = req => ADMIN_KEY && (req.headers["x-admin"] === ADMIN_KEY || req.query.k === ADMIN_KEY);
app.post("/api/admin/testar-alerta", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  avisaRadar({ liga: "copa", mkt: "o25", tipo: "subida", pagando: 35, deOnde: 25, base: 38, fita: [0,1,1,0,1,1], teste: true, ts: Date.now() });
  res.json({ ok: true, msg: "alerta de teste enviado a todas as telas abertas" });
});
app.get("/api/admin/codigos", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  res.json({ codigos, persistencia: !!GH_T && !ghErro && !!ghSha, tokenPresente: !!GH_T, erroSave: ghErro, adminKeyDefinida: !!ADMIN_KEY });
});
app.post("/api/admin/criar", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const { nome, dias } = req.body || {};
  const cod = "CL-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  codigos[cod] = { nome: String(nome || ""), criado: Date.now(), expira: Date.now() + (parseFloat(dias) || 1) * 86400000, usos: 0 };
  await salvaCodigos();
  res.json({ ok: true, codigo: cod, expira: codigos[cod].expira });
});
app.post("/api/admin/revogar", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  delete codigos[String((req.body || {}).codigo || "").toUpperCase().trim()];
  await salvaCodigos();
  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — AMD Live</title>
<style>body{background:#0d1117;color:#e8edf4;font-family:system-ui;margin:0;padding:20px;max-width:760px;margin:auto}h2{color:#3fb950}input,select,button{padding:9px 12px;border-radius:8px;border:1px solid #2d3646;background:#1c2333;color:#e8edf4;font-size:14px}button{cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}td,th{padding:8px;border-bottom:1px solid #2d3646;text-align:left}.ok{color:#3fb950}.exp{color:#f85149}.note{color:#8b98a8;font-size:12px}</style></head><body>
<h2>🔑 Admin — AMD Live</h2>
<div id="login"><p>Senha do admin: <input id="k" type="password"> <button onclick="entrar()">Entrar</button></p><p class="note" id="dica"></p></div>
<div id="painel" style="display:none">
  <p>Nome: <input id="nome" placeholder="ex: João teste"> Duração:
    <select id="dias"><option value="1">1 dia (teste)</option><option value="30">30 dias</option><option value="7">7 dias</option><option value="0.125">3 horas</option></select>
    <button onclick="criar()">➕ Criar código</button> <button onclick="teste()">🔔 Testar alerta</button></p>
  <p id="novo" style="font-weight:700;color:#3fb950"></p>
  <table><thead><tr><th>Código</th><th>Nome</th><th>Expira</th><th>Usos</th><th></th></tr></thead><tbody id="lista"></tbody></table>
  <p class="note" id="aviso"></p>
</div>
<script>
let K='';
async function api(p,m,b){const r=await fetch(p+(p.includes('?')?'&':'?')+'k='+encodeURIComponent(K),{method:m||'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});if(r.status===401)throw new Error('senha errada');return r.json();}
async function entrar(){K=document.getElementById('k').value;try{await lista();document.getElementById('login').style.display='none';document.getElementById('painel').style.display='block';}catch(e){document.getElementById('dica').textContent='Senha incorreta (ou ADMIN_KEY não definida no Render).';}}
async function lista(){const j=await api('/api/admin/codigos');const tb=document.getElementById('lista');tb.innerHTML='';
 const agora=Date.now();
 Object.entries(j.codigos).sort((a,b)=>b[1].criado-a[1].criado).forEach(([c,d])=>{
  const exp=new Date(d.expira);const ativo=agora<d.expira;
  tb.innerHTML+=\`<tr><td><b>\${c}</b></td><td>\${d.nome||'—'}</td><td class="\${ativo?'ok':'exp'}">\${exp.toLocaleString('pt-BR')} \${ativo?'✅':'⛔ expirado'}</td><td>\${d.usos||0}\${d.ultimoUso?' <span class=note>('+new Date(d.ultimoUso).toLocaleTimeString('pt-BR')+')</span>':''}</td><td><button onclick="revogar('\${c}')">🗑️</button></td></tr>\`;});
 document.getElementById('aviso').textContent=j.persistencia?'✔ códigos salvos com persistência (sobrevivem a reinício)':(j.tokenPresente?('⚠️ GH_TOKEN presente mas o salvamento FALHOU: '+(j.erroSave||'crie um código para testar')):'⚠️ SEM persistência — falta GH_TOKEN no Render; códigos somem a cada reinício');}
async function criar(){const j=await api('/api/admin/criar','POST',{nome:document.getElementById('nome').value,dias:document.getElementById('dias').value});
 document.getElementById('novo').textContent='Código criado: '+j.codigo+' — envie ao usuário';await lista();}
async function teste(){await api('/api/admin/testar-alerta','POST',{});alert('Alerta de teste enviado! Olhe a notificação no canto (com o site aberto em outra aba).');}
async function revogar(c){if(!confirm('Revogar '+c+'?'))return;await api('/api/admin/revogar','POST',{codigo:c});await lista();}
</script></body></html>`);
});

const LIGAS_PERMITIDAS = new Set(["eng", "ita", "spa", "mnd", "bra", "lat"]);
const LIGAS = ["eng", "ita", "spa", "mnd", "bra", "lat"];
function registraLiga(l) { if (LIGAS_PERMITIDAS.has(l) && !LIGAS.includes(l)) LIGAS.push(l); }
function slugLiga(v) {
  return String(v == null ? "" : v).trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const CODIGO_PLAYPIX = Object.freeze({
  "1": "ita", "2": "eng", "3": "spa", "4": "bra", "5": "lat",
  "6": "cam", "7": "cop", "8": "ame", "9": "mnd"
});
const APELIDOS_LIGA = Object.freeze({
  ita: "ita", italia: "ita", italy: "ita",
  eng: "eng", inglaterra: "eng", england: "eng",
  spa: "spa", espanha: "spa", spain: "spa",
  mnd: "mnd", mun: "mnd", mundo: "mnd", world: "mnd",
  bra: "bra", brasil: "bra", brazil: "bra",
  lat: "lat", latino: "lat", latin: "lat",
  cam: "cam", champions: "cam",
  cop: "cop", copa: "cop",
  ame: "ame", america: "ame"
});
function codigoLiga(v) {
  const s = slugLiga(v);
  if (!s) return "";
  if (APELIDOS_LIGA[s]) return APELIDOS_LIGA[s];
  const direto = s.match(/^(?:playpix|betano|bet365)-(?:liga-)?([1-9])$/);
  if (direto) return CODIGO_PLAYPIX[direto[1]] || "";
  const partes = s.split("-");
  const semCasa = /^(?:playpix|betano|bet365)$/.test(partes[0]) ? partes.slice(1).join("-") : s;
  if (APELIDOS_LIGA[semCasa]) return APELIDOS_LIGA[semCasa];
  if (CODIGO_PLAYPIX[semCasa]) return CODIGO_PLAYPIX[semCasa];
  const porLiga = semCasa.match(/^liga-([1-9])$/);
  return porLiga ? (CODIGO_PLAYPIX[porLiga[1]] || "") : "";
}
function ligaRecebida(body) {
  const data = (body && body.data && typeof body.data === "object") ? body.data : {};
  const nomes = [
    body && body.nomeLiga, body && body.ligaNome, body && body.leagueName, body && body.nome_liga,
    data.nomeLiga, data.ligaNome, data.leagueName, data.nome_liga, data.nome
  ];
  for (const nome of nomes) {
    const codigo = codigoLiga(nome);
    if (codigo) return codigo;
  }
  const brutos = [
    body && body.liga, data.liga, data.codigoLiga,
    body && body.casaFonte, body && body.bookmaker, body && body.casa
  ];
  for (const bruto of brutos) {
    const codigo = codigoLiga(bruto);
    if (codigo) return codigo;
  }
  return "";
}

const TIMES_SPA = new Set(["BAR", "RMA", "BET", "OSA", "LEV", "VAL", "GET", "RAY", "MLG", "VIL", "SEV", "ALV", "ELC", "ATH", "DLC", "ESP", "RST"]);
const TIMES_ENG = new Set(["ARS", "CHE", "LIV", "MCI", "MUN", "NEW", "TOT", "EVE", "WHU", "WOL", "LEE", "SOU", "BRI", "CRY", "BRE", "FOR", "BOU", "BUR", "AVL"]);
function ligaPeloConteudo(liga, games, upcoming) {
  if (liga !== "eng" && liga !== "spa") return liga;
  const nomes = (games || []).concat(upcoming || []).slice(-120)
    .flatMap(g => [g && g.casa, g && g.fora]);
  const conta = conjunto => nomes.reduce((n, nome) => n + (conjunto.has(String(nome || "").trim().toUpperCase()) ? 1 : 0), 0);
  const spa = conta(TIMES_SPA), eng = conta(TIMES_ENG);
  if (spa >= 2 && spa > eng) return "spa";
  if (eng >= 2 && eng > spa) return "eng";
  return liga;
}

function reclassificaEngSpaEmMemoria() {
  for (const origem of ["eng", "spa"]) {
    const dado = store[origem];
    if (!dado) continue;
    const destino = ligaPeloConteudo(origem, dado.games, dado.upcomingRaw);
    if (destino === origem) continue;
    const jaExiste = store[destino];
    if (jaExiste && ligaPeloConteudo(destino, jaExiste.games, jaExiste.upcomingRaw) === destino) continue;
    store[destino] = dado;
    delete store[origem];
    for (const chave of Object.keys(liveCurves)) {
      if (!chave.startsWith(origem + "|")) continue;
      const mercado = chave.slice(origem.length);
      liveCurves[destino + mercado] = liveCurves[chave];
      delete liveCurves[chave];
    }
  }
}
const BASE = "https://www.caramelotips.com.br/final/";
const REFRESH_MS = 15000;

const store = {};
const liveCurves = {};

function parseOdds(s) {
  const odds = {};
  s.replace(/([a-z0-9]+)@([\d.]+)/gi, (_, k, v) => { odds[k] = parseFloat(v); });
  const deriveOver = (uKey, oKey) => {
    if (odds[oKey] == null && odds[uKey] != null && odds[uKey] > 1) {
      const pUnder = 1 / odds[uKey];
      const pOver = 1 - pUnder;
      if (pOver > 0.01) odds[oKey] = +(1 / pOver).toFixed(2);
    }
  };
  deriveOver("u15", "o15");
  deriveOver("u25", "o25");
  deriveOver("u35", "o35");
  const deriveUnder = (oKey, uKey) => {
    if (odds[uKey] == null && odds[oKey] != null && odds[oKey] > 1) {
      const pOver = 1 / odds[oKey];
      const pUnder = 1 - pOver;
      if (pUnder > 0.01) odds[uKey] = +(1 / pUnder).toFixed(2);
    }
  };
  deriveUnder("o15", "u15");
  deriveUnder("o25", "u25");
  if (odds.ambs == null && odds.ambn != null && odds.ambn > 1) {
    const pNao = 1 / odds.ambn, pSim = 1 - pNao;
    if (pSim > 0.01) odds.ambs = +(1 / pSim).toFixed(2);
  }
  return odds;
}

function parseGame(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(.+?)(\d+|\d*\+)-(\d+|\d*\+)/);
  if (!m) return null;
  const norm = x => x.includes("+") ? 5 : +x;
  const a = norm(m[2]), b = norm(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { nome: m[1].trim(), a, b, total: a + b, odds: parseOdds(s) };
}

function parseUpcoming(s) {
  if (typeof s !== "string") return null;
  if (/\d-\d|\d\+-|-\d\+/.test(s)) return null;
  if (!/@[\d.]+/.test(s)) return null;
  const nome = s.split(/\s{2,}|\n/)[0].replace(/[a-z0-9]+@[\d.]+/gi, "").trim();
  let horario = "";
  for (const line of s.split(/\n/).map(x => x.trim()).slice(0, 5)) {
    const m = line.match(/^(?:hor[aá]rio|hora)?\s*[:\-]?\s*(\d{1,2})[.:](\d{2})$/i);
    if (m) { horario = `${m[1]}:${m[2]}`; break; }
  }
  const partes = nome.split(/\s+x\s+/i);
  const casa = partes[0] ? partes[0].trim() : "";
  const fora = partes[1] ? partes[1].trim() : "";
  return { nome, horario, casa, fora, odds: parseOdds(s) };
}

function decodeRows(json) {
  const rows = (json && json.table && json.table.rows) || [];
  const games = [], upcoming = [];
  for (const row of rows) {
    for (const cell of (row.c || [])) {
      const v = cell && cell.v;
      const u = parseUpcoming(v);
      if (u && u.nome) { upcoming.push(u); continue; }
      const g = parseGame(v);
      if (g) games.push(g);
    }
  }
  return { games, upcoming };
}

function pays(g, mkt) {
  if (mkt === "o25") return g.total >= 3;
  if (mkt === "o35") return g.total >= 4;
  if (mkt === "ge5") return g.total >= 5;
  if (mkt === "ambas") return g.a > 0 && g.b > 0;
  if (mkt === "u05") return g.total <= 0;
  if (mkt === "u15") return g.total <= 1;
  if (mkt === "u25") return g.total <= 2;
  return false;
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function windowPct(games, mkt, n) {
  const s = games.slice(-n);
  if (!s.length) return null;
  return pct(s.filter(g => pays(g, mkt)).length, s.length);
}

function pivots(serie) {
  const topos = [], fundos = [];
  for (let i = 1; i < serie.length - 1; i++) {
    if (serie[i] >= serie[i - 1] && serie[i] > serie[i + 1]) topos.push({ i, v: serie[i] });
    if (serie[i] <= serie[i - 1] && serie[i] < serie[i + 1]) fundos.push({ i, v: serie[i] });
  }
  return { topos, fundos };
}

function trendLines(serie) {
  if (!serie || serie.length < 6) return null;
  const n = serie.length;
  const jan = Math.min(20, n);
  const ini = n - jan;
  const sub = serie.slice(ini);
  const { topos, fundos } = pivots(sub);
  topos.forEach(p => p.i += ini);
  fundos.forEach(p => p.i += ini);
  const lineFrom = (p1, p2) => {
    if (!p1 || !p2 || p2.i === p1.i) return null;
    const m = (p2.v - p1.v) / (p2.i - p1.i);
    const projeta = x => p1.v + m * (x - p1.i);
    return { m, p1, p2, valorEm: projeta, atual: projeta(n - 1) };
  };
  let lta = null;
  for (let j = fundos.length - 1; j >= 1; j--) {
    const f2 = fundos[j], f1 = fundos[j - 1];
    if (f2.v > f1.v) { lta = lineFrom(f1, f2); break; }
  }
  let ltb = null;
  for (let j = topos.length - 1; j >= 1; j--) {
    const t2 = topos[j], t1 = topos[j - 1];
    if (t2.v < t1.v) { ltb = lineFrom(t1, t2); break; }
  }
  const atual = serie[n - 1], ant = serie[n - 2];
  let rompimento = null;
  if (ltb) {
    const linhaAtual = ltb.atual, linhaAnt = ltb.valorEm(n - 2);
    if (ant <= linhaAnt && atual > linhaAtual) {
      rompimento = { tipo: "ROMPEU_LTB_CIMA", cor: "verde", msg: "ROMPEU LTB pra cima — ciclo virou, mercado vai pagar Over. Sinal de ENTRADA." };
    }
  }
  if (lta && !rompimento) {
    const linhaAtual = lta.atual, linhaAnt = lta.valorEm(n - 2);
    if (ant >= linhaAnt && atual < linhaAtual) {
      rompimento = { tipo: "ROMPEU_LTA_BAIXO", cor: "vermelho", msg: "ROMPEU LTA pra baixo — mercado saturou, vai pro Under. SEGURA A MÃO / proteja." };
    }
  }
  let tendencia = "lateral";
  if (lta && atual >= lta.atual && (!ltb || atual < ltb.atual)) tendencia = "alta (sobre a LTA)";
  else if (ltb && atual <= ltb.atual) tendencia = "baixa (sob a LTB)";
  const sMin = Math.min(...serie), sMax = Math.max(...serie);
  const margem = Math.max(5, (sMax - sMin) * 0.3);
  const clamp = v => Math.max(sMin - margem, Math.min(sMax + margem, Math.round(v * 10) / 10));
  const ltaSerie = lta ? serie.map((_, x) => x >= lta.p1.i ? clamp(lta.valorEm(x)) : null) : null;
  const ltbSerie = ltb ? serie.map((_, x) => x >= ltb.p1.i ? clamp(ltb.valorEm(x)) : null) : null;
  return {
    lta: lta ? { inclinacao: +lta.m.toFixed(2), atual: Math.round(lta.atual), serie: ltaSerie } : null,
    ltb: ltb ? { inclinacao: +ltb.m.toFixed(2), atual: Math.round(ltb.atual), serie: ltbSerie } : null,
    rompimento, tendencia
  };
}

function chartSeries(games, mkt, qtdJogos = 20) {
  const vals = [];
  for (let i = qtdJogos; i <= games.length; i++) {
    const block = games.slice(i - qtdJogos, i);
    if (mkt === "totft")
