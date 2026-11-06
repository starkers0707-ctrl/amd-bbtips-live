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
      // acha o jogo original pra pegar horario/casa/fora
      const orig = upcoming.find(u => u.nome === r.game.name) || {};
      return {
        nome: r.game.name,
        horario: orig.horario || "",
        casa: orig.casa || "",
        fora: orig.fora || "",
        odd: r.game.odd || null,
        score: a.score ?? null,
        status: a.status || "â€”",
        motivo: a.motivo || "â€”",
        prob: Number.isFinite(a.prob) ? +a.prob.toFixed(1) : null,
        justa: Number.isFinite(a.fairOdd) ? +a.fairOdd.toFixed(2) : null,
        ev: Number.isFinite(a.ev) ? +a.ev.toFixed(1) : null,
        edge: Number.isFinite(a.probEdge) ? +a.probEdge.toFixed(1) : null,
        evGale: Number.isFinite(a.evGale) ? +a.evGale.toFixed(1) : null,
        teamBase: a.team && Number.isFinite(a.team.p) ? `${a.team.g}/${a.team.j} ${a.team.p.toFixed(0)}%` : "sem base",
        oddBase: a.odd && Number.isFinite(a.odd.p) ? `${a.odd.g}/${a.odd.j} ${a.odd.p.toFixed(0)}%` : "sem base",
        ciclo: a.cycle ? `${a.cycle.streak} ${a.cycle.cur} | ${a.cycle.fase} | pressÃ£o ${Math.round(a.cycle.pressao || 0)}` : "â€”",
        coldOdd: !!a.coldOdd,
        ready: !!(a.combo && a.combo.ready),
        pontos: a.combo ? a.combo.points : null,
        // detalhes completos (igual extensao)
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
// libera CORS pra extensao no caramelo conseguir mandar a curva
// ===== BLINDAGEM ANTI-SCRAPING: so o proprio site consome a API =====
const ORIGENS_OK = (process.env.ORIGENS_OK || "https://amd-bbtips-live.onrender.com").split(",").map(x => x.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const p = req.path;
  // SONDAS precisam enviar cross-origin (rodam no caramelo/bet365): CORS LIBERADO nelas.
  // O envio ja e protegido pela impressao digital de liga (porteiro de conteudo).
  const ehSonda = p === "/api/snapshot" || p === "/api/snapshot2";
  if (ehSonda) res.header("Access-Control-Allow-Origin", "*");
  else if (ORIGENS_OK.includes(origin)) res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,X-Acesso");
  res.header("X-Frame-Options", "SAMEORIGIN");            // nao deixa embutir o site em iframe de terceiros
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Referrer-Policy", "same-origin");
  res.header("X-Robots-Tag", "noindex, nofollow");        // fora dos buscadores
  if (req.method === "OPTIONS") return res.sendStatus(204);
  // API de dados: exige vir do PROPRIO site (referer/origin), fecha para curl/bots/outros sites.
  const ehApiDado = p.startsWith("/api/") && !p.startsWith("/api/snapshot") && !p.startsWith("/api/dados") && !p.startsWith("/api/bbtips") && !p.startsWith("/api/admin") && !p.startsWith("/api/acesso") && !p.startsWith("/api/eventos") && p !== "/api/grade";
  if (ehApiDado) {
    const ref = (req.headers.referer || req.headers.origin || "");
    // bloqueia SO quando o referer aponta claramente para OUTRO site (scraping via browser de terceiro).
    // Sem referer (navegacao direta, app instalado, reload) e permitido - a protecao real e o codigo de acesso.
    const deOutroSite = ref && !ORIGENS_OK.some(o => ref.startsWith(o));
    if (deOutroSite) return res.status(403).json({ erro: "acesso restrito ao aplicativo" });
  }
  next();
});
app.use(express.json({ limit: "25mb" }));

// ===== ACESSO POR CODIGO + ADMIN (controle de testes 1 dia e assinantes 30 dias) =====
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const GH_T = process.env.GH_TOKEN || "";
const GH_REPO = process.env.GH_REPO || "starkers0707-ctrl/amd-bbtips-live";
const GH_BRANCH = process.env.GH_BRANCH || "main";
let webpush = null;
try { webpush = require("web-push"); } catch (e) { console.log("web-push indisponivel:", e.message); }

const GH_FILE = "codigos.json";
let codigos = {}; // codigo -> {nome, criado, expira, usos, ultimoUso}
let ghSha = null;
let ghErro = null; // ultimo erro de salvamento (visivel no /admin)
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
    else { ghErro = "HTTP " + r.status + " â€” token sem permissÃ£o Contents:Read/Write nesse repo, ou token invÃ¡lido"; }
  } catch (e) { ghErro = e.message; }
}
carregaCodigos();
const CODIGO_MESTRE = String(process.env.CODIGO_MESTRE || "").toUpperCase().trim();

// ===== AUTO-COLETA BBTIPS =====
let bbtipsAuto = null;
import("./bbtips-auto.mjs").then(m => { bbtipsAuto = m; console.log("[bbtips] auto-coleta carregada"); }).catch(e => console.log("[bbtips] modulo nao carregado:", e.message));
function limpaToken(v) { const m = String(v || "").match(/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/); return m ? m[0] : ""; }
let BB_TOKEN = limpaToken(process.env.BBTIPS_TOKEN);
let bbUltima = { ts: 0, ligas: 0, nomes: 0, porCasa: {}, erro: null, rodando: false };
function codigoValido(c) {
  if (CODIGO_MESTRE && c === CODIGO_MESTRE) return true;
  const d = codigos[c]; if (!d) return false;
  if (Date.now() > d.expira) return false;
  d.usos = (d.usos || 0) + 1; d.ultimoUso = Date.now(); return true;
}
// PORTAO: protege os dados; deixa livre snapshot (sonda), eventos (SSE), acesso/admin e arquivos estaticos
app.use((req, res, next) => {
  const p = req.path;
  const livre = p === "/api/snapshot" || p === "/api/snapshot2" || p === "/api/dados" || p.startsWith("/api/bbtips") || p === "/api/eventos" || p === "/api/grade" || p.startsWith("/api/acesso") || p.startsWith("/api/admin") || !p.startsWith("/api/");
  if (livre) return next();
  const c = String(req.headers["x-acesso"] || req.query.c || "").toUpperCase().trim();
  if (codigoValido(c)) return next();
  res.status(401).json({ erro: "acesso" });
});
app.post("/api/acesso/validar", (req, res) => {
  const c = String((req.body || {}).codigo || "").toUpperCase().trim();
  if (codigoValido(c)) { const d = codigos[c] || { nome: "mestre", expira: Date.now() + 3153600000000 }; res.json({ ok: true, nome: d.nome, expira: d.expira }); }
  else res.status(401).json({ ok: false, erro: "cÃ³digo invÃ¡lido ou expirado" });
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
// pagina /admin (painel do dono)
app.get("/admin", (req, res) => {
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin â€” AMD Live</title>
<style>body{background:#0d1117;color:#e8edf4;font-family:system-ui;margin:0;padding:20px;max-width:760px;margin:auto}h2{color:#3fb950}input,select,button{padding:9px 12px;border-radius:8px;border:1px solid #2d3646;background:#1c2333;color:#e8edf4;font-size:14px}button{cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}td,th{padding:8px;border-bottom:1px solid #2d3646;text-align:left}.ok{color:#3fb950}.exp{color:#f85149}.note{color:#8b98a8;font-size:12px}</style></head><body>
<h2>ðŸ”‘ Admin â€” AMD Live</h2>
<div id="login"><p>Senha do admin: <input id="k" type="password"> <button onclick="entrar()">Entrar</button></p><p class="note" id="dica"></p></div>
<div id="painel" style="display:none">
  <p>Nome: <input id="nome" placeholder="ex: JoÃ£o teste"> DuraÃ§Ã£o:
    <select id="dias"><option value="1">1 dia (teste)</option><option value="30">30 dias</option><option value="7">7 dias</option><option value="0.125">3 horas</option></select>
    <button onclick="criar()">âž• Criar cÃ³digo</button> <button onclick="teste()">ðŸ”” Testar alerta</button></p>
  <p id="novo" style="font-weight:700;color:#3fb950"></p>
  <table><thead><tr><th>CÃ³digo</th><th>Nome</th><th>Expira</th><th>Usos</th><th></th></tr></thead><tbody id="lista"></tbody></table>
  <p class="note" id="aviso"></p>
</div>
<script>
let K='';
async function api(p,m,b){const r=await fetch(p+(p.includes('?')?'&':'?')+'k='+encodeURIComponent(K),{method:m||'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});if(r.status===401)throw new Error('senha errada');return r.json();}
async function entrar(){K=document.getElementById('k').value;try{await lista();document.getElementById('login').style.display='none';document.getElementById('painel').style.display='block';}catch(e){document.getElementById('dica').textContent='Senha incorreta (ou ADMIN_KEY nÃ£o definida no Render).';}}
async function lista(){const j=await api('/api/admin/codigos');const tb=document.getElementById('lista');tb.innerHTML='';
 const agora=Date.now();
 Object.entries(j.codigos).sort((a,b)=>b[1].criado-a[1].criado).forEach(([c,d])=>{
  const exp=new Date(d.expira);const ativo=agora<d.expira;
  tb.innerHTML+=\`<tr><td><b>\${c}</b></td><td>\${d.nome||'â€”'}</td><td class="\${ativo?'ok':'exp'}">\${exp.toLocaleString('pt-BR')} \${ativo?'âœ…':'â›” expirado'}</td><td>\${d.usos||0}\${d.ultimoUso?' <span class=note>('+new Date(d.ultimoUso).toLocaleTimeString('pt-BR')+')</span>':''}</td><td><button onclick="revogar('\${c}')">ðŸ—‘ï¸</button></td></tr>\`;});
 document.getElementById('aviso').textContent=j.persistencia?'âœ” cÃ³digos salvos com persistÃªncia (sobrevivem a reinÃ­cio)':(j.tokenPresente?('âš ï¸ GH_TOKEN presente mas o salvamento FALHOU: '+(j.erroSave||'crie um cÃ³digo para testar')):'âš ï¸ SEM persistÃªncia â€” falta GH_TOKEN no Render; cÃ³digos somem a cada reinÃ­cio');}
async function criar(){const j=await api('/api/admin/criar','POST',{nome:document.getElementById('nome').value,dias:document.getElementById('dias').value});
 document.getElementById('novo').textContent='CÃ³digo criado: '+j.codigo+' â€” envie ao usuÃ¡rio';await lista();}
async function teste(){await api('/api/admin/testar-alerta','POST',{});alert('Alerta de teste enviado! Olhe a notificaÃ§Ã£o no canto (com o site aberto em outra aba).');}
async function revogar(c){if(!confirm('Revogar '+c+'?'))return;await api('/api/admin/revogar','POST',{codigo:c});await lista();}
</script></body></html>`);
});

// Fontes ativas: Kiron (CAM/COP/AME) e 1Win (ENG/SPA/ITA). A trava impede que
// scripts antigos voltem a misturar as ligas que nao fazem parte desta tela.
const LIGAS_PERMITIDAS = new Set(["cam", "cop", "ame", "eng", "spa", "ita"]);
const LIGAS = (process.env.LIGAS || "cam,cop,ame,eng,spa,ita").split(",").map(x => x.trim())
  .filter(x => LIGAS_PERMITIDAS.has(x));
function registraLiga(l) { if (LIGAS_PERMITIDAS.has(l) && !LIGAS.includes(l)) LIGAS.push(l); }
function slugLiga(v) {
  return String(v == null ? "" : v).trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/*
 * A extensao pode mandar tanto o codigo tecnico (playpix-eng, liga-2, ...)
 * quanto o nome mostrado na aba. A grade, porem, trabalha sempre com UMA
 * chave por campeonato. Nunca use a ordem da varredura para adivinhar uma
 * liga: isso era o que fazia ENG abrir os jogos da SPA quando o lote chegava.
 */
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
  // O nome da aba e a fonte de verdade. Alguns coletores mantem `liga` da aba
  // anterior durante a troca, mas ja enviam o nome atual dentro do payload.
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
/*
 * O coletor atual troca ENG/SPA em alguns ciclos: o rotulo chega como ENG,
 * mas o proprio lote contem BAR, RMA, BET, OSA etc. Corrigimos somente esse
 * par pela identidade dos times; as demais ligas continuam usando o rotulo
 * original enviado pela extensao.
 */
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

// A classificacao tambem precisa valer para o lote que ja estava em memoria
// quando o servidor foi atualizado. Sem isto a aba ENG ficava exibindo a
// Espanha ate o proximo ciclo completo da extensao.
function reclassificaEngSpaEmMemoria() {
  for (const origem of ["eng", "spa"]) {
    const dado = store[origem];
    if (!dado) continue;
    const destino = ligaPeloConteudo(origem, dado.games, dado.upcomingRaw);
    if (destino === origem) continue;
    const jaExiste = store[destino];
    // Nunca sobrescreve um lote correto e mais recente da outra liga.
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

// cache em memoria: liga -> { games, computed, lastUpdated, fetchedAt }
const store = {};
const liveCurves = {}; // curva REAL capturada da extensao: liga|mkt -> {curva,mm1,mm2,topo,fundo,ts}

function parseOdds(s) {
  const odds = {};
  s.replace(/([a-z0-9]+)@([\d.]+)/gi, (_, k, v) => { odds[k] = parseFloat(v); });
  // os jogos FUTUROS do caramelo as vezes so trazem as odds de UNDER (u15/u25/u35)
  // e ambn. Como over e under sao mercados complementares (ou da um, ou da outro),
  // derivamos a odd de OVER a partir da de UNDER quando a de over nao veio.
  // prob_under = 1/odd_under (sem margem); prob_over = 1 - prob_under; odd_over = 1/prob_over.
  const deriveOver = (uKey, oKey) => {
    if (odds[oKey] == null && odds[uKey] != null && odds[uKey] > 1) {
      const pUnder = 1 / odds[uK…53374 tokens truncated… 2], mkt) || pays(games[gi + 3], mkt)) frio2H++;
      }
    }
    const aposPagamento = {
      seguinte_apos_GREEN: ppN ? Math.round(ppH / ppN * 100) : null,
      seguinte_apos_RED: pnN ? Math.round(pnH / pnN * 100) : null,
      amostras: { aposGreen: ppN, aposRed: pnN },
      primeiroGreen_da_seca_fria: { eventos: frioN,
        seguinte_pagou: frioN ? Math.round(frioH / frioN * 100) : null,
        pagou_em_2: frioN ? Math.round(frio2H / frioN * 100) : null }
    };
    const out = { liga, mkt, base: basePct, aposPagamento,
      regua_sem_sinal: regua,
      minima: mede(evMin), subida: mede(evSub), quebraLTB: mede(evLtb),
      evPositivo: { eventos: evPosIdx.length, oProprioJogoPagou: evPosIdx.length ? Math.round(evPosGreen / evPosIdx.length * 100) : null, ...mede(evPosIdx) },
      temperatura };
    estudoCache[key] = { ts: Date.now(), lu: d.lastUpdated, out };
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// MEDICAO: o que aconteceu historicamente APOS cada quebra de LTB pra cima?
app.get("/api/ltbtest/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o35";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 200) return res.json({ erro: "historico insuficiente" });
    const games = d.games;
    const JAN = Math.max(2, Math.min(20, games.length));
    const serieFull = chartSeries(games, mkt, JAN); // ponto k <-> jogo k+JAN-1
    const eventos = []; let ultI = -99;
    for (let i = 25; i <= serieFull.length; i++) {
      const win = serieFull.slice(Math.max(0, i - 20), i);
      let r = null;
      try { const t = trendLines(win); r = t && t.rompimento; } catch (e) {}
      if (r && r.tipo === "ROMPEU_LTB_CIMA" && i - ultI >= 3) {
        ultI = i;
        const gi = (i - 1) + JAN - 1;
        const nx = games[gi + 1], nx3 = games.slice(gi + 1, gi + 4);
        if (nx) eventos.push({ hora: games[gi].horario || "", prox: pays(nx, mkt), em3: nx3.some(g => pays(g, mkt)) });
      }
    }
    const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 100);
    const pc = (arr, f) => arr.length ? Math.round(arr.filter(f).length / arr.length * 100) : null;
    res.json({ liga, mkt, base, quebras: eventos.length,
      pagouProximoJogo: pc(eventos, e => e.prox),
      pagouEmAte3Jogos: pc(eventos, e => e.em3),
      ultimas5: eventos.slice(-5) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== RADAR GLOBAL: minima/subida em TODAS as ligas+mercados (nao altera analises) =====
// Le o sinal ja calculado em s.computed (zero recalculo). Na TRANSICAO (entrou no fundo /
// virou subida) manda aviso via SSE com liga+mercado; quando a condicao acaba, sai do painel.
const RADAR_MKTS = ["o25", "o35", "ge5", "ambas"]; // unders FORA do radar/FIGHT por decisao do usuario (so consulta)
const radarEstado = {}; // liga|mkt -> {fundo, sobe, golden}
const radarAtivos = {}; // liga|mkt|tipo -> info (painel do momento)
const radarUltimoAviso = {}; // liga|mkt|tipo -> ts (nao repete o mesmo aviso em <30min)
function podeAvisar(chave) {
  const ag = Date.now();
  const tregua = chave.endsWith("|minima") ? 60 * 60000 : 30 * 60000; // FIGHT: no maximo 1 por combo por hora
  if (radarUltimoAviso[chave] && ag - radarUltimoAviso[chave] < tregua) return false;
  radarUltimoAviso[chave] = ag; return true;
}
// SERIE DO DIA (a mesma do grafico acumulado 00h): corta na virada do relogio do JOGO e
// monta a media movel com aquecimento - ja existe ponto nos primeiros jogos do dia.
function serieDoDia(gAll, mkt, JAN) {
  let idx = 0;
  for (let i = 1; i < gAll.length; i++) {
    const h1 = parseInt((gAll[i].horario || "").split(":")[0]);
    const h0 = parseInt((gAll[i - 1].horario || "").split(":")[0]);
    if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idx = i;
  }
  const dia = gAll.slice(idx);
  if (dia.length < 3) return null;
  const out = [];
  for (let k = 0; k < dia.length; k++) {
    const ini = Math.max(0, k - JAN + 1);
    const jan = dia.slice(ini, k + 1);
    out.push(Math.round(jan.filter(g => pays(g, mkt)).length / jan.length * 1000) / 10);
  }
  return out;
}

function jogosRadarEmOrdem(games) {
  const lista = Array.isArray(games) ? games.slice() : [];
  const agoraBR = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  const minutoAtual = (agoraBR.hour || 0) * 60 + (agoraBR.minute || 0);
  return lista.map((g, i) => {
    const partes = String(g.horario || g.hora || '').match(/(\d{1,2}):(\d{2})/);
    const minuto = partes ? Number(partes[1]) * 60 + Number(partes[2]) : i;
    // Em um lote de 24h, horarios bem a frente do relogio atual pertencem a
    // ontem. Assim 23h de ontem fica antes de 00h/16h de hoje no radar.
    const dia = minuto > minutoAtual + 10 ? -1 : 0;
    return { g, ordem: dia * 1440 + minuto, i };
  }).sort((a, b) => a.ordem - b.ordem || a.i - b.i).map(x => x.g);
}

function atualizaRadar(liga, s) {
  try {
    // snapshot2 chamava esta funcao sem `s`; alem disso, listaCheia(s) ignora o
    // overlay da sonda rapida. Os dois casos faziam o Golden esperar o feed
    // oficial (~9min). O store continua fornecendo base/computed e a serie usa
    // os resultados fundidos, incluindo os que acabaram de chegar pela sonda 2.
    s = s || store[liga];
    if (!s) return;
    for (const mkt of RADAR_MKTS) {
      const c = s.computed && s.computed[mkt]; if (!c || !c.sinal) continue;
      // RADAR SEM DROP-2: usa gamesAll (inclui os 2 jogos mais recentes) â€” alerta no
      // fechamento real do jogo. Grafico/analises continuam com drop-2 (fieis ao caramelo).
      const gAll = jogosRadarEmOrdem(gamesFundidos(liga));
      const JANR = Math.max(2, Math.min(20, gAll.length));
      // RADAR BASEADO NO GRAFICO ACUMULADO 00H (pedido do usuario): so jogos do dia atual
      const serieDia = gAll.length ? serieDoDia(gAll, mkt, JANR) : null;
      const serie = (serieDia && serieDia.length >= 3) ? serieDia : (gAll.length ? chartSeries(gAll, mkt, JANR).slice(-20) : (c.serie || []));
      const cur = serie.length ? serie[serie.length - 1] : null; // taxa atual (ultimo ponto, sem drop)
      const fita = gAll.slice(-6).map(g => ({ p: pays(g, mkt) ? 1 : 0, m: (g.horario || "").split(":")[1] || "" })); // jogo a jogo com o MINUTO de cada um (aprender a olho nu)
      const k = liga + "|" + mkt;
      const prev = radarEstado[k] || {};
      // ZONA DE OPERACAO (estudo): minima = pagando <=60% do normal (janela dos ~31%).
      // Desarma no 1o GREEN (o edge cai apos o 1o pagamento â€” medido) e re-arma so apos
      // novo jogo sem pagar ainda na zona. Histerese de saida: >=85% do normal.
      const ultimoPagou = gAll.length ? pays(gAll[gAll.length - 1], mkt) : false;
      // mercados de base pequena (<15%, ex: 5+ gols) ficam FORA da minima: a janela de 20
      // jogos pula dezenas de pontos com 1 jogo â€” "<60%" ali e ruido, nao seca
      const fundo = cur != null && c.base != null && c.base >= 15 && !ultimoPagou &&
        (prev.fundo ? cur < c.base * 0.85 : cur <= c.base * 0.6);
      // SUBIDA SIMPLES: taxa subiu >=10 pontos nos ultimos 5 jogos (movimento real) e ainda
      // nao passou muito do normal (<=120%; chegar depois disso e atrasado).
      // Histerese: permanece enquanto o ganho nao morrer (>=3 pontos) e nao esticar (<=135%).
      const antes = serie.length >= 6 ? serie[serie.length - 6] : null;
      const ganho = (cur != null && antes != null) ? cur - antes : null;
      const sobe = ganho != null && c.base != null &&
        (prev.sobe ? (ganho >= 3 && cur <= c.base * 1.35) : (ganho >= 10 && cur <= c.base * 1.2));
      const primeira = !(k in radarEstado); // 1a leitura apos ligar: registra SEM avisar (mata a enxurrada pos-restart)
      if (fundo && !prev.fundo) {
        radarAtivos[k + "|minima"] = { liga, mkt, tipo: "minima", pagando: cur, base: c.base, rel: c.base ? Math.round(cur / c.base * 100) : null, fita, ts: Date.now() };
        if (!primeira && podeAvisar(k + "|minima")) avisaRadar(radarAtivos[k + "|minima"]);
      } else if (!fundo) delete radarAtivos[k + "|minima"];
      if (sobe && !prev.sobe) {
        radarAtivos[k + "|subida"] = { liga, mkt, tipo: "subida", pagando: cur, deOnde: antes, base: c.base, fita, ts: Date.now() };
        if (!primeira && podeAvisar(k + "|subida")) avisaRadar(radarAtivos[k + "|subida"]);
      } else if (!sobe) delete radarAtivos[k + "|subida"];
      // ðŸ’¥ QUEBRA DE LTB pra cima (detector oficial do grafico, na serie SEM drop-2)
      let quebrouLTB = false;
      try { const t = trendLines(serie); quebrouLTB = !!(t && t.rompimento && t.rompimento.tipo === "ROMPEU_LTB_CIMA"); } catch (e) {}
      if (quebrouLTB && !prev.ltb) {
        radarAtivos[k + "|ltb"] = { liga, mkt, tipo: "ltb", pagando: cur, base: c.base, fita, ts: Date.now() };
        if (!primeira && podeAvisar(k + "|ltb")) avisaRadar(radarAtivos[k + "|ltb"]);
      } else if (!quebrouLTB) delete radarAtivos[k + "|ltb"];
      // ðŸ§Š MINIMA DE JANELA: a linha pagante tocando o FUNDO das ultimas 3/6/12/24 horas
      let nivelMin = null;
      try {
        if (cur != null && c.base != null && c.base >= 15 && gAll.length >= 60) {
          const serieLonga = chartSeries(gAll, mkt, JANR);
          for (const hz of [24, 12, 6, 3]) {
            const pts = hz * 20;
            if (serieLonga.length >= pts) {
              const rec = serieLonga.slice(-pts);
              if (cur <= Math.min(...rec)) { nivelMin = hz; break; }
            }
          }
        }
      } catch (e) {}
      if (nivelMin) {
        const antes2 = (radarAtivos[k + "|minjan"] || {}).nivel || null;
        radarAtivos[k + "|minjan"] = { liga, mkt, tipo: "minjan", nivel: nivelMin, pagando: cur, base: c.base, rel: c.base ? Math.round(cur / c.base * 100) : null, fita, ts: Date.now() };
        if (!primeira && nivelMin !== antes2 && nivelMin >= 6 && podeAvisar(k + "|minjan" + nivelMin)) avisaRadar(radarAtivos[k + "|minjan"]);
      } else delete radarAtivos[k + "|minjan"];
      // ðŸ’  PULLBACK: linha acima do normal, recuou 8-25 pts do topo recente e VOLTOU a subir
      let pull = false, topoRec = null;
      try {
        if (cur != null && c.base != null && serie.length >= 6) {
          topoRec = Math.max(...serie.slice(-10));
          const recuo = topoRec - cur;
          const retomou = serie[serie.length - 1] > serie[serie.length - 2];
          pull = cur >= c.base && recuo >= 8 && recuo <= 25 && retomou;
        }
      } catch (e) {}
      if (pull && !prev.pull) {
        radarAtivos[k + "|pull"] = { liga, mkt, tipo: "pull", pagando: cur, topo: topoRec, base: c.base, fita, ts: Date.now() };
        if (!primeira && podeAvisar(k + "|pull")) avisaRadar(radarAtivos[k + "|pull"]);
      } else if (!pull) delete radarAtivos[k + "|pull"];
      // GOLDEN CROSS: EMA10 acima da EMA20. O alerta dispara apenas no cruzamento;
      // o chip permanece no radar enquanto a media curta continuar acima da longa.
      const golden = goldenCrossData(serie);
      if (golden.active) {
        const chaveGolden = k + "|golden";
        const goldenAnterior = radarAtivos[chaveGolden];
        const jogoCross = golden.index == null ? null : gAll[gAll.length - serie.length + golden.index];
        const horaCross = horaCurta(jogoCross && (jogoCross.horario || jogoCross.hora));
        const cruzouEm = golden.crossedNow ? Date.now() : (goldenAnterior && goldenAnterior.cruzouEm) || null;
        const hora = golden.crossedNow ? horaBR() : (goldenAnterior && goldenAnterior.hora) || horaBR();
        const horaFonte = horaCross || (goldenAnterior && goldenAnterior.horaFonte) || hora;
        const atrasoMin = atrasoMinutos(horaFonte, hora);
        radarAtivos[chaveGolden] = { liga, mkt, tipo: "golden", pagando: cur, base: c.base, fita, mm10: golden.fast, mm20: golden.slow, spread: golden.spread, barsAgo: golden.barsAgo, hora, horaFonte, atrasoMin, cruzouEm, ts: Date.now() };
        // A sonda pode mandar um pequeno lote de resultados. Nesse caso o
        // cruzamento pode estar ate 5 pontos antes do ultimo e crossedNow=false,
        // embora tenha acabado de chegar. Avise a transicao se ela for recente.
        const cruzamentoRecente = golden.crossedNow || (golden.barsAgo != null && golden.barsAgo <= 5);
        if (cruzamentoRecente && !prev.golden && !primeira && podeAvisar(chaveGolden)) avisaRadar(radarAtivos[chaveGolden]);
      } else delete radarAtivos[k + "|golden"];
      radarEstado[k] = { fundo, sobe, ltb: quebrouLTB, nivelMin, pull, golden: golden.active };
    }
  } catch (e) { console.error("erro atualizaRadar " + liga + ":", e.message); }
}

// ===== WEB PUSH: alerta de ZONA DE OPERACAO direto no sistema (funciona com aba congelada/fechada) =====
const PUSH_FILE = "push.json";
let pushSha = null;
let pushData = { vapid: null, subs: [] };
const NOMES_L = { ita: "ITA", eng: "ENG", spa: "SPA", mnd: "MND", bra: "BRA", lat: "LAT", cam: "CAM", cop: "COP", ame: "AME", split: "Split" };
const NOMES_M = { o25: "Over 2.5", o35: "Over 3.5", ambas: "Ambas Marcam", ge5: "5+ gols" };
async function salvaPush() {
  if (!GH_T) return;
  try {
    const body = { message: "push", content: Buffer.from(JSON.stringify(pushData, null, 1)).toString("base64"), branch: GH_BRANCH };
    if (pushSha) body.sha = pushSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${PUSH_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); pushSha = j.content.sha; }
  } catch (e) {}
}
async function carregaPush() {
  if (GH_T) {
    try {
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${PUSH_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
      if (r.ok) { const j = await r.json(); pushSha = j.sha; const dados = JSON.parse(Buffer.from(j.content, "base64").toString()); if (dados) pushData = { vapid: dados.vapid || null, subs: dados.subs || [] }; }
    } catch (e) {}
  }
  if (webpush) {
    if (!pushData.vapid) { pushData.vapid = webpush.generateVAPIDKeys(); salvaPush(); }
    try { webpush.setVapidDetails("mailto:amd@live.local", pushData.vapid.publicKey, pushData.vapid.privateKey); } catch (e) {}
  }
}
carregaPush();
function enviaPushRobo(titulo, corpo, tag) {
  if (!webpush || !pushData.vapid || !pushData.subs.length) return;
  const payload = JSON.stringify({ t: titulo, b: corpo, tag: tag || "robo" });
  for (const s of [...pushData.subs]) {
    webpush.sendNotification(s, payload).catch(err => {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        pushData.subs = pushData.subs.filter(x => x.endpoint !== s.endpoint);
        salvaPush();
      }
    });
  }
}

function enviaPushRadar(info) {
  if (!webpush || !pushData.vapid || !pushData.subs.length) return;
  if (!info || info.tipo !== "golden") return;
  const liga = NOMES_L[info.liga] || info.liga;
  const mercado = NOMES_M[info.mkt] || info.mkt;
  const titulo = `âœ¨ GOLDEN CROSS AGORA${info.hora ? ` ${info.hora}` : ""} â€” ${liga} Â· ${mercado}`;
  const corpo = `Confirmado assim que o resultado chegou${info.horaFonte ? ` Â· jogo ${info.horaFonte}` : ""} â€” EMA10 ${info.mm10 ?? "â€”"} acima da EMA20 ${info.mm20 ?? "â€”"}`;
  const payload = JSON.stringify({ t: titulo, b: corpo, tag: info.liga + "|" + info.mkt + "|" + info.tipo });
  for (const s of [...pushData.subs]) {
    webpush.sendNotification(s, payload).catch(err => {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        pushData.subs = pushData.subs.filter(x => x.endpoint !== s.endpoint);
        salvaPush();
      }
    });
  }
}

function avisaRadar(info) {
  const msg = `data: ${JSON.stringify({ tipo: "radar", alerta: info })}\n\n`; // BUGFIX: info.tipo sobrescrevia o rotulo "radar"
  for (const res of sseClientes) { try { res.write(msg); } catch (e) { sseClientes.delete(res); } }
  enviaPushRadar(info); // WEB PUSH: somente Golden Cross, mesmo com aba congelada/fechada
}
app.get("/api/push/key", (req, res) => res.json({ key: (pushData.vapid && pushData.vapid.publicKey) || null, pronto: !!(webpush && pushData.vapid), inscritos: pushData.subs.length }));
app.post("/api/push/sub", (req, res) => {
  try {
    const s = req.body;
    if (!s || !s.endpoint) return res.status(400).json({ erro: "inscricao invalida" });
    if (!pushData.subs.find(x => x.endpoint === s.endpoint)) {
      pushData.subs.push(s);
      if (pushData.subs.length > 50) pushData.subs = pushData.subs.slice(-50);
      salvaPush();
    }
    res.json({ ok: true, inscritos: pushData.subs.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});
// RADAR ENXUTO (pedido do usuario): so o que ele opera - movimento de SUBIDA,
// QUEBRA DE LTB e MINIMA do dia. Os avisos de minima de janela curta e de repique
// (minjan / pull) sao ruido para essa leitura e ficam de fora.
const RADAR_TIPOS = ["golden", "subida", "ltb", "minima", "pull"]; // inclui Golden Cross EMA10 x EMA20
app.get("/api/radar", (req, res) => res.json(
  Object.values(radarAtivos).filter(r => RADAR_TIPOS.includes(r.tipo)).sort((a, b) => b.ts - a.ts)
));

// ===== SSE (Server-Sent Events): canal de aviso em tempo real p/ as telas =====
// NAO altera nenhuma analise/calculo. So avisa "liga X atualizou" pra tela buscar na hora
// em vez de esperar o ciclo de 10s. Fallback: o ciclo de 10s continua funcionando igual.
const sseClientes = new Set();
function avisaClientes(liga) {
  const msg = `data: ${JSON.stringify({ tipo: "liga", liga, ts: Date.now() })}\n\n`;
  for (const res of sseClientes) { try { res.write(msg); } catch (e) { sseClientes.delete(res); } }
}
app.get("/api/eventos", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  res.write(`data: ${JSON.stringify({ tipo: "oi", ts: Date.now() })}\n\n`);
  sseClientes.add(res);
  req.on("close", () => sseClientes.delete(res));
});
// batimento a cada 25s pra conexao nao ser derrubada por proxies/idle
setInterval(() => {
  for (const res of sseClientes) { try { res.write(": ping\n\n"); } catch (e) { sseClientes.delete(res); } }
}, 25000);

app.get("/api/admin/zerar-liga", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ erro: "admin" });
  const liga = req.query.liga;
  if (liga && store[liga]) { delete store[liga]; return res.json({ ok: true, zerada: liga }); }
  res.json({ ok: false, erro: "liga nao encontrada" });
});
app.get("/api/admin/limpar-erro", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ erro: "admin" });
  let limpos = 0;
  for (const l of Object.keys(store)) { if (store[l] && store[l].erro) { delete store[l].erro; limpos++; } }
  res.json({ ok: true, limpos });
});
app.get("/robots.txt", (req, res) => { res.type("text/plain").send("User-agent: *\nDisallow: /\n"); });

  app.use(express.static(join(__dirname, "public")));
  // Render deve abrir o painel diretamente na raiz; manter fallback explÃ­cito
  // evita 404 quando o middleware estÃ¡ atrÃ¡s de alguma configuraÃ§Ã£o de rota.
  app.get("/", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));
  app.get("/index.html", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));

  app.listen(PORT, () => console.log("AMD Live rodando na porta " + PORT));

