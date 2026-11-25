import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

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
app.disable("x-powered-by");
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
// libera CORS pra extensao no caramelo conseguir mandar a curva
// ===== BLINDAGEM ANTI-SCRAPING: so o proprio site consome a API =====
const ORIGENS_OK = (process.env.ORIGENS_OK || "https://amdlive.com.br,https://www.amdlive.com.br,https://amdlive.squareweb.app,https://amd-virtual-live.onrender.com,https://amd-bbtips-live.onrender.com").split(",").map(x => x.trim()).filter(Boolean);
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
  const ehApiDado = p.startsWith("/api/") && !p.startsWith("/api/snapshot") && !p.startsWith("/api/dados") && !p.startsWith("/api/tampermonkey") && !p.startsWith("/api/bbtips") && !p.startsWith("/api/admin") && !p.startsWith("/api/acesso") && !p.startsWith("/api/eventos") && p !== "/api/grade" && p !== "/api/inspired/grade";
  if (ehApiDado) {
    const ref = (req.headers.referer || req.headers.origin || "");
    // bloqueia SO quando o referer aponta claramente para OUTRO site (scraping via browser de terceiro).
    // Sem referer (navegacao direta, app instalado, reload) e permitido - a protecao real e o codigo de acesso.
    const proprio = req.headers.host ? ["https://" + req.headers.host, "http://" + req.headers.host] : [];
    const deOutroSite = ref && !ORIGENS_OK.concat(proprio).some(o => ref.startsWith(o));
    if (deOutroSite) return res.status(403).json({ erro: "acesso restrito ao aplicativo" });
  }
  next();
});
app.use(express.json({ limit: "25mb" }));

// Limite por IP contra flood simples. Alto o bastante para o painel em tempo real.
const trafegoPorIp = new Map();
app.use((req, res, next) => {
  const agora = Date.now(), ip = String(req.ip || req.socket?.remoteAddress || "desconhecido");
  let t = trafegoPorIp.get(ip);
  if (!t || agora - t.inicio >= 60000) t = { inicio: agora, total: 0 };
  t.total++; trafegoPorIp.set(ip, t);
  res.setHeader("RateLimit-Limit", "6000");
  res.setHeader("RateLimit-Remaining", String(Math.max(0, 6000 - t.total)));
  if (t.total > 6000) { res.setHeader("Retry-After", "60"); return res.status(429).json({ erro: "muitas requisicoes" }); }
  if (trafegoPorIp.size > 10000) for (const [chave, item] of trafegoPorIp) if (agora - item.inicio >= 60000) trafegoPorIp.delete(chave);
  next();
});

// ===== ACESSO POR CODIGO + ADMIN (controle de testes 1 dia e assinantes 30 dias) =====
const ADMIN_KEY = process.env.ADMIN_KEY || "";
// aceita o token mesmo colado com espaco, aspas ou texto junto
const GH_T = (() => { const b = String(process.env.GH_TOKEN || ""); const m = b.match(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)/); return m ? m[1] : b.trim().replace(/^["']|["']$/g, ""); })();
console.log(`[github] GH_TOKEN: ${GH_T ? (GH_T.startsWith("github_pat_") ? "fine-grained" : GH_T.startsWith("ghp_") ? "classico" : "formato desconhecido") + ", " + GH_T.length + " caracteres" + (GH_T.length !== String(process.env.GH_TOKEN || "").length ? " (limpo de espacos/texto extra)" : "") : "ausente"}`);
const GH_REPO = process.env.GH_REPO || "starkers0707-ctrl/amd-bbtips-live";
const GH_BRANCH = process.env.GH_BRANCH || "dados"; // branch separado: salvar dados nao dispara deploy
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
    else { ghErro = "HTTP " + r.status + " — token sem permissão Contents:Read/Write nesse repo, ou token inválido"; }
  } catch (e) { ghErro = e.message; }
}
carregaCodigos();
const CODIGO_MESTRE = String(process.env.CODIGO_MESTRE || "").toUpperCase().trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || ADMIN_KEY || CODIGO_MESTRE || "");
const sessoes = new Map();
const tentativasLogin = new Map();
const COOKIE_SESSAO = "amd_session";

function igualSeguro(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
}
function assinaturaSessao(id) { return createHmac("sha256", SESSION_SECRET).update(id).digest("base64url"); }
function cookieValor(req, nome) {
  for (const item of String(req.headers.cookie || "").split(";")) {
    const i = item.indexOf("=");
    if (i > 0 && item.slice(0, i).trim() === nome) return decodeURIComponent(item.slice(i + 1).trim());
  }
  return "";
}
// Codigos e sessoes AUTOASSINADOS: a validade vai dentro do proprio codigo,
// assinada com o CODIGO_MESTRE. Nao dependem de memoria nem de banco, entao
// sobrevivem a reinicio, deploy e troca de servidor (Render/DigitalOcean).
const CHAVE_CODIGOS = createHmac("sha256", String(CODIGO_MESTRE || ADMIN_KEY || "")).update("amd-codigos-v2").digest();
const revogados = new Set();
function assinaCodigo(buf) { return createHmac("sha256", CHAVE_CODIGOS).update(buf).digest().subarray(0, 5); }
function geraCodigoAssinado(expira) {
  const corpo = Buffer.alloc(7);
  corpo.writeUInt32BE(Math.floor(expira / 60000), 0);
  randomBytes(3).copy(corpo, 4);
  return "AMD-" + Buffer.concat([corpo, assinaCodigo(corpo)]).toString("hex").toUpperCase();
}
function leCodigoAssinado(c) {
  const m = String(c || "").toUpperCase().trim().match(/^AMD-([0-9A-F]{24})$/);
  if (!m || !CODIGO_MESTRE && !ADMIN_KEY) return null;
  const b = Buffer.from(m[1], "hex"), corpo = b.subarray(0, 7);
  if (!timingSafeEqual(b.subarray(7), assinaCodigo(corpo))) return null;
  return { expira: corpo.readUInt32BE(0) * 60000 };
}
function codigoAtivo(c) {
  if (ADMIN_KEY && igualSeguro(String(c || "").toUpperCase(), ADMIN_KEY.trim().toUpperCase())) return { nome: "Administrador", expira: Date.now() + 30 * 86400000, mestre: true };
  if (CODIGO_MESTRE && igualSeguro(String(c || "").toUpperCase(), CODIGO_MESTRE.trim().toUpperCase())) return { nome: "Administrador", expira: Date.now() + 30 * 86400000, mestre: true };
  const cod = String(c || "").toUpperCase().trim();
  if (revogados.has(cod)) return null;
  const assinado = leCodigoAssinado(cod);
  if (assinado) {
    if (Date.now() > assinado.expira) return null;
    const salvo = codigos[cod] || (codigos[cod] = { nome: "", criado: null, expira: assinado.expira, usos: 0 });
    salvo.expira = assinado.expira;
    return salvo;
  }
  const d = codigos[cod];
  return d && !d.bloqueado && Date.now() <= Number(d.expira || 0) ? d : null;
}
function sessaoValida(req) {
  if (!SESSION_SECRET) return null;
  const bruto = cookieValor(req, COOKIE_SESSAO); const ponto = bruto.lastIndexOf(".");
  if (ponto < 1) return null;
  const id = bruto.slice(0, ponto), assinatura = bruto.slice(ponto + 1);
  if (!igualSeguro(assinatura, assinaturaSessao(id))) return null;
  let s = sessoes.get(id);
  if (!s) { try { s = JSON.parse(Buffer.from(id, "base64url").toString()); } catch (e) { return null; } }
  if (!s || !s.codigo || Date.now() > Number(s.expira || 0)) return null;
  const ativo = codigoAtivo(s.codigo);
  if (!ativo) return null;
  if (ativo.nome && !s.nome) s.nome = ativo.nome;
  if (!ativo.mestre) { // tempo de uso: soma os intervalos entre requisicoes (site aberto)
    const ag = Date.now();
    if (ativo.visto && ag - ativo.visto < 180000) ativo.tempoUso = (ativo.tempoUso || 0) + (ag - ativo.visto);
    if (!ativo.primeiroUso) ativo.primeiroUso = ag;
    ativo.visto = ag; ativo.ultimoUso = ag;
  }
  s.ultimoUso = Date.now(); return s;
}
function criaSessao(res, codigo, dados) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET/CODIGO_MESTRE nao configurado");
  const expira = Math.min(Number(dados.expira || Date.now() + 30 * 86400000), Date.now() + 30 * 86400000);
  const id = Buffer.from(JSON.stringify({ codigo, nome: dados.nome || "Usuario", expira, r: randomBytes(6).toString("hex") })).toString("base64url");
  const maxAge = Math.max(60, Math.floor((expira - Date.now()) / 1000));
  res.setHeader("Set-Cookie", `${COOKIE_SESSAO}=${id}.${assinaturaSessao(id)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
  return expira;
}
function ipCliente(req) { return String(req.ip || req.socket?.remoteAddress || "desconhecido"); }
function loginBloqueado(req) {
  const agora = Date.now(), ip = ipCliente(req); let t = tentativasLogin.get(ip);
  if (!t || agora - t.inicio > 15 * 60000) t = { inicio: agora, falhas: 0, bloqueadoAte: 0 };
  tentativasLogin.set(ip, t);
  return t.bloqueadoAte > agora ? Math.ceil((t.bloqueadoAte - agora) / 1000) : 0;
}
function registraFalhaLogin(req) {
  const agora = Date.now(), ip = ipCliente(req); let t = tentativasLogin.get(ip) || { inicio: agora, falhas: 0, bloqueadoAte: 0 };
  if (agora - t.inicio > 15 * 60000) t = { inicio: agora, falhas: 0, bloqueadoAte: 0 };
  if (++t.falhas >= 7) t.bloqueadoAte = agora + 30 * 60000;
  tentativasLogin.set(ip, t);
}
setInterval(() => {
  const agora = Date.now(), limite = agora - 35 * 60000;
  for (const [ip, t] of tentativasLogin) if (t.inicio < limite && t.bloqueadoAte < agora) tentativasLogin.delete(ip);
  for (const [id, s] of sessoes) if (s.expira < agora) sessoes.delete(id);
}, 10 * 60000).unref();

// ===== AUTO-COLETA BBTIPS =====
// Legado desligado: as seis ligas atuais pertencem exclusivamente à Vavada.
// Só pode ser reativado de forma explícita com BBTIPS_ENABLED=1.
const BBTIPS_ENABLED = process.env.BBTIPS_ENABLED === "1";
let bbtipsAuto = null;
if (BBTIPS_ENABLED) {
  import("./bbtips-auto.mjs").then(m => { bbtipsAuto = m; console.log("[bbtips] auto-coleta carregada"); }).catch(e => console.log("[bbtips] modulo nao carregado:", e.message));
}
let vavadaKiron = null;
import("./vavada-kiron.mjs").then(m => { vavadaKiron = m; console.log("[vavada] coletor Kiron carregado"); }).catch(e => console.log("[vavada] modulo nao carregado:", e.message));
function limpaToken(v) { const m = String(v || "").match(/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/); return m ? m[0] : ""; }
let BB_TOKEN = limpaToken(process.env.BBTIPS_TOKEN);
let bbUltima = { ts: 0, ligas: 0, nomes: 0, porCasa: {}, erro: null, rodando: false };
function codigoValido(c) {
  const d = codigoAtivo(c); if (!d) return false;
  d.usos = (d.usos || 0) + 1; d.ultimoUso = Date.now(); return true;
}
// PORTAO: protege os dados; deixa livre snapshot (sonda), eventos (SSE), acesso/admin e arquivos estaticos
app.use((req, res, next) => {
  const p = req.path;
  const livre = p === "/login" || p === "/robots.txt" || p === "/favicon.ico" || p === "/admin" ||
    p.startsWith("/api/acesso") || p.startsWith("/api/admin") ||
    ((p === "/api/snapshot" || p === "/api/snapshot2" || p === "/api/dados" || p === "/api/tampermonkey" || p === "/api/bbtips/token" || p === "/api/inspired/grade") && req.method === "POST") ||
    p === "/amd-inspired.user.js";
  if (livre) return next();
  if (sessaoValida(req)) return next();
  const c = String(req.headers["x-acesso"] || req.query.c || "").toUpperCase().trim();
  if (codigoValido(c)) return next();
  if (p.startsWith("/api/")) return res.status(401).json({ erro: "login necessario" });
  return res.redirect(302, "/login");
});
app.post("/api/acesso/validar-legado", (req, res) => {
  const c = String((req.body || {}).codigo || "").toUpperCase().trim();
  if (codigoValido(c)) { const d = codigos[c] || { nome: "mestre", expira: Date.now() + 3153600000000 }; res.json({ ok: true, nome: d.nome, expira: d.expira }); }
  else res.status(401).json({ ok: false, erro: "código inválido ou expirado" });
});
function loginComCodigo(req, res) {
  const espera = loginBloqueado(req);
  if (espera) { res.setHeader("Retry-After", String(espera)); return res.status(429).json({ ok: false, erro: "muitas tentativas; aguarde" }); }
  const c = String((req.body || {}).codigo || "").toUpperCase().trim();
  if (!codigoValido(c)) { registraFalhaLogin(req); return res.status(401).json({ ok: false, erro: "codigo invalido ou expirado" }); }
  tentativasLogin.delete(ipCliente(req));
  const d = codigoAtivo(c), expira = criaSessao(res, c, d);
  res.json({ ok: true, nome: d.nome, expira });
}
app.post(["/api/acesso/login", "/api/acesso/validar"], loginComCodigo);
app.get("/api/acesso/sessao", (req, res) => {
  const s = sessaoValida(req);
  if (!s) return res.status(401).json({ ok: false });
  res.json({ ok: true, nome: s.nome, expira: s.expira });
});
app.post("/api/acesso/logout", (req, res) => {
  const bruto = cookieValor(req, COOKIE_SESSAO), ponto = bruto.lastIndexOf(".");
  if (ponto > 0) sessoes.delete(bruto.slice(0, ponto));
  res.setHeader("Set-Cookie", `${COOKIE_SESSAO}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});
const isAdmin = req => {
  const recebido = String(req.headers["x-admin"] || req.query.k || "").trim();
  return !!((ADMIN_KEY && igualSeguro(recebido, ADMIN_KEY)) ||
    (CODIGO_MESTRE && igualSeguro(recebido.toUpperCase(), CODIGO_MESTRE)));
};
// ===== Telegram: avisos dos robos manuais =====
// Cada acesso (codigo) liga o proprio chat pelo link t.me/<bot>?start=<token>.
const TG_TOKEN = (String(process.env.TELEGRAM_BOT_TOKEN || "").match(/\d{6,}:[A-Za-z0-9_-]{30,}/) || [""])[0];
const TG_FILE = "telegram.json";
let tgChats = {}, tgSha = null, tgBot = "", tgOffset = 0;
const tgPendentes = new Map(), tgTaxa = new Map(), tgPedidos = new Map(); // tgPedidos: request_id -> {dono, canal}
const TG_MAX_DESTINOS = 5;
function tgDireitos(canal) {
  return { is_anonymous: false, can_manage_chat: false, can_delete_messages: false, can_manage_video_chats: false,
    can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: false,
    can_post_stories: false, can_edit_stories: false, can_delete_stories: false, ...(canal ? { can_post_messages: true } : {}) };
}
function tgAdicionaDestino(dono, chat, nome, tipo) {
  const d = tgChats[dono] || (tgChats[dono] = { chat: null, nome: "", desde: Date.now() });
  d.canais = (d.canais || []).filter(c => c.chat !== chat);
  if (d.canais.length >= TG_MAX_DESTINOS) return false;
  d.canais.push({ chat, nome: nome || String(chat), tipo });
  tgSalva(); return true;
}
function tgApi(metodo, corpo, ms = 20000) {
  return fetch(`https://api.telegram.org/bot${TG_TOKEN}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo || {}), signal: AbortSignal.timeout(ms) }).then(r => r.json()).catch(e => ({ ok: false, description: e.message }));
}
async function tgCarrega() {
  if (!GH_T) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${TG_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
    if (r.ok) { const j = await r.json(); tgSha = j.sha; tgChats = JSON.parse(Buffer.from(j.content, "base64").toString()) || {}; }
  } catch (e) {}
}
async function tgSalva(tentativa = 0) {
  if (!GH_T) return;
  try {
    const body = { message: "telegram", content: Buffer.from(JSON.stringify(tgChats)).toString("base64"), branch: GH_BRANCH };
    if (tgSha) body.sha = tgSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${TG_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { tgSha = (await r.json()).content.sha; return; }
    if ((r.status === 409 || r.status === 422) && tentativa < 2) {
      const g = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${TG_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
      tgSha = g.ok ? (await g.json()).sha : null; return tgSalva(tentativa + 1);
    }
    console.log("[telegram] falha ao salvar chats: HTTP " + r.status);
  } catch (e) { console.log("[telegram] falha ao salvar chats:", e.message); }
}
function tgDono(req) {
  const s = sessaoValida(req);
  const cod = String((s && s.codigo) || req.headers["x-acesso"] || "").toUpperCase().trim();
  return cod ? createHmac("sha256", "amd-telegram").update(cod).digest("hex").slice(0, 24) : "";
}
async function tgLoop() {
  if (!TG_TOKEN) { console.log("[telegram] TELEGRAM_BOT_TOKEN ausente: avisos so no site"); return; }
  await tgCarrega();
  const me = await tgApi("getMe");
  if (!me.ok) { console.log("[telegram] token invalido:", me.description); return; }
  tgBot = me.result.username; console.log(`[telegram] bot @${tgBot} ativo, ${Object.keys(tgChats).length} chats`);
  await tgApi("deleteWebhook");
  for (;;) {
    const r = await tgApi("getUpdates", { offset: tgOffset, timeout: 45, allowed_updates: ["message", "channel_post"] }, 60000);
    if (!r.ok) { await new Promise(ok => setTimeout(ok, 10000)); continue; }
    for (const u of r.result || []) {
      tgOffset = u.update_id + 1;
      const m = u.message || u.channel_post; if (!m) continue;
      if (m.chat_shared) {
        const ped = tgPedidos.get(m.chat_shared.request_id);
        if (ped && ped.ate > Date.now()) {
          tgPedidos.delete(m.chat_shared.request_id);
          const id = m.chat_shared.chat_id, ok = tgAdicionaDestino(ped.dono, id, m.chat_shared.title, ped.canal ? "channel" : "group");
          tgApi("sendMessage", { chat_id: m.chat.id, reply_markup: { remove_keyboard: true },
            text: ok ? "✅ " + (ped.canal ? "Canal" : "Grupo") + " \"" + (m.chat_shared.title || id) + "\" conectado. Escolha ele no Destino do robô." : "Limite de " + TG_MAX_DESTINOS + " destinos atingido. Remova um no site." });
          if (ok) tgApi("sendMessage", { chat_id: id, text: "✅ Conectado ao AMD Live. Os robôs com este destino vão postar aqui." });
        }
        continue;
      }
      if (!m.text) continue;
      const chat = m.chat.id;
      const con = m.text.match(/^\/conectar(?:@\w+)?\s+(\S+)/);
      if (con) {
        const p = tgPendentes.get(con[1]);
        if (p && p.ate > Date.now() && p.canal) {
          tgPendentes.delete(con[1]);
          tgAdicionaDestino(p.dono, chat, m.chat.title || m.chat.username || String(chat), m.chat.type);
          tgApi("sendMessage", { chat_id: chat, text: "✅ Este " + (m.chat.type === "channel" ? "canal" : "grupo") + " foi conectado ao AMD Live. Os robôs com este destino vão postar aqui." });
        } else tgApi("sendMessage", { chat_id: chat, text: "Código inválido ou vencido. Gere outro no AMD Live → Criar robô → Destino → +." });
        continue;
      }
      if (m.chat.type !== "private") continue;
      const ini = m.text.match(/^\/start(?:\s+(\S+))?/);
      const esc = ini && ini[1] && ini[1].match(/^([cg])_(.+)$/);
      if (esc) {
        const p = tgPendentes.get(esc[2]);
        if (!p || p.ate < Date.now()) { tgApi("sendMessage", { chat_id: chat, text: "Link vencido. Gere outro no AMD Live → Criar robô → Destino → +." }); continue; }
        tgPendentes.delete(esc[2]);
        const canal = esc[1] === "c", rid = Math.floor(Math.random() * 2e9) + 1;
        tgPedidos.set(rid, { dono: p.dono, canal, ate: Date.now() + 30 * 60000 });
        const botao = { text: canal ? "📢 Escolher canal" : "👥 Escolher grupo",
          request_chat: { request_id: rid, chat_is_channel: canal, request_title: true, bot_administrator_rights: tgDireitos(canal), user_administrator_rights: tgDireitos(canal) } };
        if (!canal) { delete botao.request_chat.user_administrator_rights; }
        tgApi("sendMessage", { chat_id: chat, text: canal ? "Toque no botão abaixo e escolha o canal. O bot entra como administrador para postar os sinais." : "Toque no botão abaixo e escolha o grupo. O bot entra no grupo para postar os sinais.",
          reply_markup: { keyboard: [[botao]], resize_keyboard: true, one_time_keyboard: true } });
        continue;
      }
      if (ini) {
        const p = ini[1] && tgPendentes.get(ini[1]);
        if (p && p.ate > Date.now()) {
          tgPendentes.delete(ini[1]);
          tgChats[p.dono] = Object.assign(tgChats[p.dono] || {}, { chat, nome: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" "), desde: Date.now() });
          tgSalva();
          tgApi("sendMessage", { chat_id: chat, text: "✅ Conectado ao AMD Live.\nOs avisos dos seus robôs vão chegar aqui. Para desligar, envie /sair." });
        } else tgApi("sendMessage", { chat_id: chat, text: "Para conectar: AMD Live → Criar robô → Destino → botão +." });
      } else if (/^\/sair/.test(m.text)) {
        for (const v of Object.values(tgChats)) if (v.chat === chat) v.chat = null;
        tgSalva(); tgApi("sendMessage", { chat_id: chat, text: "Desconectado. Você não vai mais receber avisos aqui." });
      }
    }
  }
}
app.get("/api/telegram/status", (req, res) => {
  const d = tgChats[tgDono(req)];
  res.json({ configurado: !!(TG_TOKEN && tgBot), bot: tgBot, conectado: !!(d && d.chat), nome: d ? d.nome : "",
    canais: ((d && d.canais) || []).map(c => ({ id: String(c.chat), nome: c.nome, tipo: c.tipo })), max: TG_MAX_DESTINOS });
});
app.post("/api/telegram/vincular", (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  if (!TG_TOKEN || !tgBot) return res.status(503).json({ erro: "Telegram nao configurado no servidor" });
  for (const [k, v] of tgPendentes) if (v.ate < Date.now()) tgPendentes.delete(k);
  const token = randomBytes(9).toString("hex");
  const tipo = String((req.body || {}).tipo || "");
  const d = tgChats[dono];
  if ((tipo === "canal" || tipo === "grupo") && d && (d.canais || []).length >= TG_MAX_DESTINOS) return res.status(400).json({ erro: "limite de " + TG_MAX_DESTINOS + " destinos" });
  tgPendentes.set(token, { dono, canal: true, ate: Date.now() + 15 * 60000 });
  const pre = tipo === "canal" ? "c_" : tipo === "grupo" ? "g_" : "";
  res.json({ link: `https://t.me/${tgBot}?start=${pre}${token}`, comando: `/conectar ${token}`, bot: tgBot, max: TG_MAX_DESTINOS });
});
app.post("/api/telegram/desvincular", (req, res) => {
  const dono = tgDono(req);
  const d = dono && tgChats[dono], canal = String((req.body || {}).canal || "");
  if (d) {
    if (canal) d.canais = (d.canais || []).filter(c => String(c.chat) !== canal);
    else d.chat = null;
    tgSalva();
  }
  res.json({ ok: true });
});
app.post("/api/telegram/enviar", async (req, res) => {
  const dono = tgDono(req), d = tgChats[dono], canal = String((req.body || {}).canal || "");
  const alvo = !d ? null : canal ? ((d.canais || []).find(c => String(c.chat) === canal) || {}).chat : d.chat;
  if (!alvo || !TG_TOKEN) return res.status(404).json({ erro: "telegram nao conectado" });
  const agora = Date.now(), t = (tgTaxa.get(dono) || []).filter(x => agora - x < 60000);
  if (t.length >= 20) return res.status(429).json({ erro: "muitos avisos por minuto" });
  t.push(agora); tgTaxa.set(dono, t);
  const texto = String((req.body || {}).texto || "").slice(0, 1000);
  if (!texto) return res.status(400).json({ erro: "texto vazio" });
  const r = await tgApi("sendMessage", { chat_id: alvo, text: texto, disable_web_page_preview: true });
  if (!r.ok) console.log("[telegram] envio falhou:", r.description);
  res.status(r.ok ? 200 : 502).json({ ok: !!r.ok });
});
setTimeout(() => tgLoop().catch(e => console.log("[telegram] parou:", e.message)), 5000);

// ===== ROBOS MANUAIS NO SERVIDOR =====
// O navegador sincroniza os robos de cada acesso; o servidor vigia a grade e
// manda no Telegram mesmo com o PC/celular desligado. Usa exatamente a mesma
// logica do monitor do navegador (public/robo-manual-monitor.js).
const ROBOS_FILE = "robos.json";
let robosDono = {}, robosSha = null, robosSujo = false;
let RM = null;
try {
  const vm = require("vm");
  const mem = new Map();
  const sandbox = {
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    crypto: { randomUUID: () => randomBytes(16).toString("hex") },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: function () {}, setInterval() { return 0; }, setTimeout() { return 0; },
    navigator: {}, Notification: undefined, console,
    document: { createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {} }), head: { appendChild() {} }, body: { appendChild() {} } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(require("fs").readFileSync(join(__dirname, "public", "robo-manual-monitor.js"), "utf8"), sandbox);
  RM = sandbox.AMDManualMonitor;
  console.log("[robos] monitor do servidor carregado");
} catch (e) { console.log("[robos] monitor do servidor indisponivel:", e.message); }

async function robosCarrega() {
  if (!GH_T) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBOS_FILE}?ref=${GH_BRANCH}`, { headers: { ...ghHead(), Accept: "application/vnd.github.raw" } });
    if (r.ok) robosDono = JSON.parse(await r.text()) || {};
    const m = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBOS_FILE}?ref=${GH_BRANCH}`, { headers: ghHead(), method: "GET" });
    if (m.ok) { const j = await m.json().catch(() => ({})); robosSha = j.sha || null; }
  } catch (e) {}
}
async function robosSalva(tentativa = 0) {
  if (!GH_T || !robosSujo) return;
  robosSujo = false;
  try {
    const body = { message: "robos", content: Buffer.from(JSON.stringify(robosDono)).toString("base64"), branch: GH_BRANCH };
    if (robosSha) body.sha = robosSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBOS_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { robosSha = (await r.json()).content.sha; return; }
    robosSujo = true;
    if ((r.status === 409 || r.status === 422) && tentativa < 2) {
      const g = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBOS_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
      robosSha = g.ok ? (await g.json()).sha : null; return robosSalva(tentativa + 1);
    }
  } catch (e) { robosSujo = true; }
}
setInterval(() => robosSalva(), 60000);

app.post("/api/robos/sync", (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  const lista = Array.isArray((req.body || {}).robots) ? req.body.robots.slice(0, 60) : [];
  if (!lista.length && ((robosDono[dono] || {}).robots || []).length && !(req.body || {}).vazioOk) return res.json({ ok: true, ignorado: "lista vazia" });
  if (JSON.stringify(lista).length > 400000) return res.status(413).json({ erro: "robos grandes demais" });
  const d = robosDono[dono] || (robosDono[dono] = { signals: [], sent: [] });
  d.robots = lista; d.atualizado = Date.now(); robosSujo = true;
  res.json({ ok: true, robos: lista.length });
});

let MONITOR_V = "";
try { MONITOR_V = (require("fs").readFileSync(join(__dirname, "public", "robo-manual-monitor.js"), "utf8").match(/MONITOR_V='([^']+)'/) || [])[1] || ""; } catch (e) {}
app.get("/api/robos/lista", (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ robots: (robosDono[dono] || {}).robots || [] });
});
app.get("/api/robos/sinais", (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  res.setHeader("Cache-Control", "no-store");
  const robots = (robosDono[dono] || {}).robots || [];
  res.json({ v: MONITOR_V, sinais: ((robosDono[dono] || {}).signals || []).slice(0, 100).map(x => { const c = { ...x }; delete c.tg; c.destino = ((robots.find(r => String(r.id) === String(x.robotId)) || {}).destino) || "todos"; return c; }) });
});
app.get("/api/robos/estado", async (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  const st = robosDono[dono] || {}, tg = tgChats[dono] || {};
  const robots = (st.robots || []).filter(r => r);
  const out = [];
  for (const r of robots) {
    const info = { nome: r.name, ativo: !!r.active, destino: r.destino || "todos", ligas: RM ? RM.robotLeagues(r) : [], limiar: Number(r.threshold) || 0, ligasAgora: {} };
    if (RM && r.active) for (const l of info.ligas) {
      try {
        const all = await gradeInterna(l);
        const m = RM.eligibleMatch(r, all);
        const mk = (r.pattern || []).find(p => p.markType === "entry");
        const mp = RM.metricsPass(r, { [l]: all }, l, (mk && (mk.entryMarket || mk.market)) || r.entryMarket || "Over 2.5");
        info.ligasAgora[l] = { jogos: all.filter(g => g.resultado_ft).length, padraoAgora: !!m, metricas: mp.text || (mp.ok ? "desligadas" : ""), metricasOk: mp.ok };
      } catch (e) { info.ligasAgora[l] = { erro: e.message }; }
    }
    out.push(info);
  }
  res.json({ telegramPrivado: !!tg.chat, canais: (tg.canais || []).map(c => c.nome), robos: out, entradas: (st.signals || []).slice(0, 10).map(s => ({ robo: s.robotName, liga: s.league, jogo: s.timeA + " x " + s.timeB, status: s.status, em: s.sentAt })) });
});
app.post("/api/robos/teste", async (req, res) => {
  const dono = tgDono(req);
  if (!dono) return res.status(401).json({ erro: "login necessario" });
  const robots = ((robosDono[dono] || {}).robots || []).filter(r => r && r.active);
  if (!robots.length) return res.status(404).json({ erro: "nenhum robo ativo no servidor" });
  for (const r of robots) await tgEnviaDono(dono, r.destino, `🧪 TESTE · ${r.name || "Robô manual"}\nSe chegou aqui, este robô vai avisar neste chat quando o padrão aparecer.\nLigas: ${(RM ? RM.robotLeagues(r) : []).join(", ").toUpperCase()}`);
  res.json({ ok: true, robos: robots.length });
});
async function gradeInterna(liga) {
  const chave = CODIGO_MESTRE || ADMIN_KEY;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/grade?liga=${liga}&horas=6&compacto=1&_=${Date.now()}`, { headers: { "x-acesso": chave }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("grade " + liga + " HTTP " + r.status);
  return (await r.json()).partidas || [];
}
async function tgEnviaDono(dono, destino, texto) {
  const d = tgChats[dono]; if (!d || !TG_TOKEN || destino === "site") return;
  const alvo = String(destino || "").startsWith("canal:") ? ((d.canais || []).find(c => String(c.chat) === destino.slice(6)) || {}).chat : d.chat;
  if (!alvo) return;
  const r = await tgApi("sendMessage", { chat_id: alvo, text: texto, disable_web_page_preview: true });
  if (!r.ok) console.log("[robos] telegram falhou:", r.description);
}
const ROBO_LIGA_NOME = { eng: "Inglaterra", ita: "Itália", spa: "Espanha", mnd: "Mundo", bra: "Brasil", lat: "América Latina", cam: "Liga dos Campeões", cop: "Copa do Mundo", ame: "América" };
const ROBO_ODD = { "Over 0.5": "odd_over_0.5", "Over 1.5": "odd_over_1.5", "Over 2.5": "odd_over_2.5", "Over 3.5": "odd_over_3.5", "Under 0.5": "odd_under_0.5", "Under 1.5": "odd_under_1.5", "Under 2.5": "odd_under_2.5", "Under 3.5": "odd_under_3.5", "Ambas Marcam (Sim)": "odd_ambas_sim", "Ambas Marcam (Não)": "odd_ambas_nao", "5+ Gols": "odd_total_gols_extatos_5", "Casa FT": "odd_resultado_final_casa", "Empate FT": "odd_resultado_final_empate", "Fora FT": "odd_resultado_final_fora" };
const tiroNome = n => (Number(n) <= 1 ? "SG" : "G" + (Number(n) - 1));
const hhmm = (h, m) => (Number.isFinite(Number(h)) && Number.isFinite(Number(m)) ? String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") : "--:--");
const escH = v => String(v == null ? "" : v).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function textoSinal(s, st) {
  const res = (st.signals || []).filter(x => x.robotId === s.robotId && x.status !== "PENDENTE");
  const g = res.filter(x => x.status === "GREEN").length, r = res.filter(x => x.status === "RED").length;
  const an = res.filter(x => x.status === "ANULADO").length;
  const pct = g + r ? Math.round(g / (g + r) * 100) : 0;
  const max = Math.max(1, Number(s.shots || 1)), plano = Array.isArray(s.plano) ? s.plano : [];
  const tent = {}; (s.attempts || []).forEach(a => { tent[a.number] = a; });
  const horaDe = n => (tent[n] && tent[n].gameHour) || plano[n - 1] || (n === Number(s.currentShot) ? hhmm(s.gameHour, s.gameMinute) : "--:--");
  const agenda = [];
  for (let n = 1; n <= max; n++) agenda.push(`⏱️ ${tiroNome(n)} <b>${escH(horaDe(n))}</b>`);
  const result = [];
  const ultimo = s.status === "GREEN" ? Number(s.winningShot || 1) : s.abortado ? (s.attempts || []).length : max;
  for (let n = 1; n <= ultimo; n++) {
    const a = tent[n];
    if (a) result.push(`${tiroNome(n)} ${escH(horaDe(n))} · ${escH(String(a.score || "").replace("-", "–"))} ${a.status === "GREEN" ? "🟩" : "🟥"}`);
    else if (s.status === "PENDENTE" && n === Number(s.currentShot || 1)) { result.push(`${tiroNome(n)} ${escH(horaDe(n))} · ⏳`); break; }
  }
  let topo = "";
  if (s.status === "GREEN") topo = `<b>🟩 GREEN no ${tiroNome(s.winningShot || 1)}</b>\n`;
  else if (s.status === "RED") topo = "<b>🟥 RED</b>\n";
  else if (s.abortado) topo = `<b>🛑 ABORTADO · GRÁFICO VIROU</b>\n<i>${escH(s.motivoAborto || "")} · tiros restantes cancelados</i>\n`;
  const odd = Number(s.odd) > 1 ? " @" + Number(s.odd).toFixed(2).replace(".", ",") : "";
  return `${topo}<b>🤖 ${escH(s.robotName || "Robô")}</b>\n🏆 ${escH(ROBO_LIGA_NOME[s.league] || String(s.league || "").toUpperCase())} · 💚 AMD Live\n\n🎯 <b>${escH(s.market)}</b>${odd}\n\n${agenda.join("\n")}\n\n✅ ${g} ❌ ${r} 🛡️ ${an} 📈 ${pct}%\n\n🔗 https://amdlive.com.br` +
    (result.length ? `\n\n${result.join("\n")}` : "");
}
function alvosDono(dono, destino) {
  const d = tgChats[dono]; if (!d || destino === "site") return [];
  if (String(destino || "").startsWith("canal:")) { const c = (d.canais || []).find(x => String(x.chat) === destino.slice(6)); return c ? [c.chat] : []; }
  return d.chat ? [d.chat] : [];
}
async function sinalTelegram(dono, destino, s, st) {
  const texto = textoSinal(s, st);
  s.tg = s.tg || {};
  for (const chat of alvosDono(dono, destino)) {
    const msg = s.tg[chat];
    if (msg) {
      const r = await tgApi("editMessageText", { chat_id: chat, message_id: msg, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
      if (r.ok || /not modified/i.test(r.description || "")) continue;
    }
    const r = await tgApi("sendMessage", { chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
    if (r.ok) s.tg[chat] = r.result.message_id; else console.log("[robos] telegram falhou:", r.description);
  }
}
let robosRodando = false;
async function robosTick() {
  if (!RM || robosRodando) return;
  robosRodando = true;
  try {
    const donos = Object.keys(robosDono).filter(k => (robosDono[k].robots || []).some(r => r && r.active) || (robosDono[k].signals || []).some(s => s.status === "PENDENTE"));
    if (!donos.length) return;
    const ligas = new Set();
    for (const k of donos) {
      for (const r of robosDono[k].robots || []) if (r && r.active) RM.robotLeagues(r).forEach(l => ligas.add(l));
      for (const s of robosDono[k].signals || []) if (s.status === "PENDENTE") ligas.add(s.league || "copa");
    }
    const data = {};
    await Promise.all([...ligas].map(async l => { try { data[l] = await gradeInterna(l); } catch (e) { data[l] = []; } }));
    for (const dono of donos) {
      const st = robosDono[dono]; st.signals = st.signals || []; st.sent = st.sent || [];
      const robots = (st.robots || []).filter(r => r && r.active && Array.isArray(r.pattern));
      const porId = id => (st.robots || []).find(r => String(r.id) === String(id)) || {};
      const follow = RM.reconcileSignals(st.signals, data) || [];
      const mexidos = new Set([...follow.map(f => f.signal), ...(follow.resolved || [])]);
      for (const s of mexidos) { await sinalTelegram(dono, porId(s.robotId).destino, s, st); robosSujo = true; }
      for (const robot of robots) {
        for (const liga of RM.robotLeagues(robot)) {
          const all = data[liga] || [];
          if (RM.hasOpenCycle(st.signals, robot.id, liga)) continue;
          const match = RM.eligibleMatch(robot, all); if (!match) continue;
          const up = RM.nextGame(all, match.trigger, match.skip); if (!up) continue;
          const mk = match.entry.entryMarket || robot.entryMarket || match.entry.market || "Over 2.5";
          const nTiros = Math.max(1, Number(robot.shots || 1)), t0 = Date.parse(up.slot_em || "") || 0;
          const jogosTiros = all.filter(x => (Date.parse(x.slot_em || "") || 0) >= t0).sort((x, y) => Date.parse(x.slot_em) - Date.parse(y.slot_em)).slice(0, nTiros);
          const mp = RM.metricsPass(robot, data, liga, mk, jogosTiros); if (!mp.ok) continue;
          const key = [robot.id, liga, match.row, RM.gameKey(match.trigger), up.id || up.slot_em].join("|");
          if (st.sent.includes(key)) continue;
          // Robos iguais (mesma liga, mercado, gatilho, jogo e destino) mandam uma vez so.
          const igual = [liga, mk, RM.gameKey(match.trigger), up.id || up.slot_em, robot.destino || "todos", Number(robot.shots || 1)].join("|");
          st.iguais = st.iguais || [];
          if (st.iguais.includes(igual)) { st.sent.unshift(key); continue; }
          st.iguais.unshift(igual); st.iguais = st.iguais.slice(0, 300);
          st.sent.unshift(key); st.sent = st.sent.slice(0, 300);
          const max = Math.max(1, Number(robot.shots || 1));
          st.signals.unshift({ id: key, key, robotId: robot.id, robotName: robot.name || "Robô manual", league: liga, market: mk, shots: max, currentShot: 1, attempts: [], cycleVersion: 2,
            timeA: up.time_a || "?", timeB: up.time_b || "?", gameId: up.id || "", gameSlot: up.slot_em || up.criado_em || "", gameHour: up.hora, gameMinute: up.minuto, status: "PENDENTE", sentAt: new Date().toISOString(), score: "",
            odd: Number((up.odds || {})[ROBO_ODD[mk]]) || null,
            plano: (() => { const t0 = Date.parse(up.slot_em || "") || 0; return all.filter(x => (Date.parse(x.slot_em || "") || 0) >= t0)
              .sort((x, y) => Date.parse(x.slot_em) - Date.parse(y.slot_em)).slice(0, max).map(x => hhmm(x.hora, x.minuto)); })() });
          st.signals = st.signals.slice(0, 200);
          robosSujo = true;
          await sinalTelegram(dono, robot.destino, st.signals[0], st);
          console.log(`[robos] entrada ${robot.name} ${liga} ${mk} ${up.time_a} x ${up.time_b}`);
        }
      }
    }
  } catch (e) { console.log("[robos] erro:", e.message); }
  finally { robosRodando = false; }
}
setTimeout(() => { robosCarrega().then(() => setInterval(robosTick, 15000)); }, 8000);


app.use("/api/admin", (req, res, next) => {
  const espera = loginBloqueado(req);
  if (espera) { res.setHeader("Retry-After", String(espera)); return res.status(429).json({ erro: "muitas tentativas; aguarde" }); }
  if (!isAdmin(req)) { registraFalhaLogin(req); return res.status(401).json({ erro: "admin" }); }
  tentativasLogin.delete(ipCliente(req));
  next();
});
app.post("/api/admin/testar-alerta", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const hora = horaBR();
  avisaRadar({ liga: "eng", mkt: "o35", tipo: "golden", pagando: 35, base: 38,
    fita: [0,1,1,0,1,1], mm10: 29.4, mm20: 29.1, spread: 0.3, barsAgo: 0,
    hora, horaFonte: hora, cruzouEm: Date.now(), teste: true, ts: Date.now() });
  res.json({ ok: true, msg: "Golden Cross de teste enviado com mercado Over 3.5" });
});
app.get("/api/admin/codigos", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  res.json({ codigos, autoassinado: !!(CODIGO_MESTRE || ADMIN_KEY), persistencia: !!GH_T && !ghErro && !!ghSha, tokenPresente: !!GH_T, erroSave: ghErro, adminKeyDefinida: !!ADMIN_KEY });
});
app.post("/api/admin/criar", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const { nome, dias } = req.body || {};
  const expiraNovo = Date.now() + (parseFloat(dias) || 1) * 86400000;
  const cod = geraCodigoAssinado(expiraNovo);
  codigos[cod] = { nome: String(nome || ""), criado: Date.now(), expira: leCodigoAssinado(cod).expira, usos: 0 };
  await salvaCodigos(); kvSalva();
  res.json({ ok: true, codigo: cod, expira: codigos[cod].expira });
});
app.post("/api/admin/consultar", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const cod = String((req.body || {}).codigo || "").toUpperCase().trim();
  const a = leCodigoAssinado(cod), d = codigos[cod];
  const expira = a ? a.expira : (d ? d.expira : null);
  res.json({ ok: true, valido: !!codigoAtivo(cod), assinado: !!a, revogado: revogados.has(cod), expira, nome: d ? d.nome : null, tempoUso: d ? d.tempoUso || 0 : 0, ultimoUso: d ? d.ultimoUso || null : null });
});
app.post("/api/admin/bloquear", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const cod = String((req.body || {}).codigo || "").toUpperCase().trim();
  const bloquear = !!(req.body || {}).bloquear;
  if (!codigos[cod] && !leCodigoAssinado(cod)) return res.status(404).json({ erro: "codigo" });
  const d = codigos[cod] || (codigos[cod] = { nome: "", criado: null, expira: (leCodigoAssinado(cod) || {}).expira, usos: 0 });
  d.bloqueado = bloquear;
  if (bloquear) revogados.add(cod); else revogados.delete(cod);
  await salvaCodigos(); kvSalva();
  res.json({ ok: true, bloqueado: bloquear });
});
app.post("/api/admin/revogar", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ erro: "admin" });
  const codRev = String((req.body || {}).codigo || "").toUpperCase().trim();
  delete codigos[codRev];
  if (leCodigoAssinado(codRev)) revogados.add(codRev);
  await salvaCodigos(); kvSalva();
  res.json({ ok: true });
});
// pagina /admin (painel do dono)
app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(require("fs").readFileSync(join(__dirname, "admin-page.html"), "utf8"));
});

app.get("/login", (req, res) => {
  if (sessaoValida(req)) return res.redirect(302, "/");
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar — AMD Live</title><meta name="robots" content="noindex,nofollow">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 10%,#10251a,#030807 55%);color:#edf7f0;font-family:system-ui,-apple-system,sans-serif;padding:20px}.card{width:min(420px,100%);background:#0b1210;border:1px solid #1e3a2a;border-radius:18px;padding:30px;box-shadow:0 24px 80px #000a}.logo{font-size:12px;letter-spacing:.22em;color:#31e76c;font-weight:800}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#31e76c;box-shadow:0 0 16px #31e76c;margin-right:8px}h1{font-size:27px;margin:18px 0 8px}p{color:#91a49a;font-size:14px;line-height:1.5}label{display:block;font-size:12px;font-weight:700;margin:24px 0 8px}input,button{width:100%;border-radius:10px;padding:14px;font-size:16px}input{color:#fff;background:#07100c;border:1px solid #294535;outline:none}input:focus{border-color:#31e76c;box-shadow:0 0 0 3px #31e76c22}button{margin-top:12px;border:0;background:#27c95b;color:#031007;font-weight:800;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.erro{min-height:20px;color:#ff7373;font-size:13px;margin-top:12px}.seg{border-top:1px solid #18271f;margin-top:22px;padding-top:16px;font-size:11px;color:#617269}</style></head>
<body data-build="20261118-robo-painel"><main class="card"><div class="logo"><span class="dot"></span>AMD LIVE</div><h1>Acesso protegido</h1><p>Digite o código criado pelo administrador para abrir o painel.</p>
<form id="form"><label for="codigo">Código de acesso</label><input id="codigo" name="codigo" type="password" autocomplete="current-password" maxlength="80" required autofocus><button id="entrar" type="submit">Entrar com segurança</button><div class="erro" id="erro" role="alert"></div></form>
<div class="seg">Sessão protegida por cookie HttpOnly. Tentativas repetidas são bloqueadas automaticamente.</div></main>
<script>const f=document.getElementById('form'),b=document.getElementById('entrar'),e=document.getElementById('erro'),c=document.getElementById('codigo');f.addEventListener('submit',async x=>{x.preventDefault();b.disabled=true;e.textContent='';try{const r=await fetch('/api/acesso/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:c.value})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.erro||'Acesso negado');location.replace('/');}catch(err){e.textContent=err.message;b.disabled=false;c.select();}});</script></body></html>`);
});

// Fonte oficial do painel: seis ligas Kiron recebidas diretamente da Vavada.
// A trava impede que identificadores antigos voltem a contaminar as telas.
// CAM, COP e AME (Inspired) chegam pelo BBTips/PlayPix (inspired-bbtips.mjs).
const LIGAS_INSPIRED = new Set(["cam", "cop", "ame"]);
const LIGAS_PERMITIDAS = new Set(["eng", "ita", "spa", "mnd", "bra", "lat", "cam", "cop", "ame"]);
const LIGAS = ["eng", "ita", "spa", "mnd", "bra", "lat", "cam", "cop", "ame"];
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
      const pUnder = 1 / odds[uKey];
      const pOver = 1 - pUnder;
      if (pOver > 0.01) odds[oKey] = +(1 / pOver).toFixed(2);
    }
  };
  deriveOver("u15", "o15");
  deriveOver("u25", "o25");
  deriveOver("u35", "o35");
  // e o caminho inverso: deriva UNDER quando so veio o OVER (mercados complementares)
  const deriveUnder = (oKey, uKey) => {
    if (odds[uKey] == null && odds[oKey] != null && odds[oKey] > 1) {
      const pOver = 1 / odds[oKey];
      const pUnder = 1 - pOver;
      if (pUnder > 0.01) odds[uKey] = +(1 / pUnder).toFixed(2);
    }
  };
  deriveUnder("o15", "u15");
  deriveUnder("o25", "u25");
  // ambas sim a partir de ambas nao
  if (odds.ambs == null && odds.ambn != null && odds.ambn > 1) {
    const pNao = 1 / odds.ambn, pSim = 1 - pNao;
    if (pSim > 0.01) odds.ambs = +(1 / pSim).toFixed(2);
  }
  // 5+ (ge5): se nao veio, deriva de o35 (aproximacao: 5+ e mais raro que 3.5+)
  // melhor deixar sem do que inventar; ge5 fica ausente se nao houver base
  return odds;
}

function parseGame(s) {
  if (typeof s !== "string") return null;
  // aceita placar normal (1-3) e notacao 5+ (ex: 5+-0, 1-5+)
  const m = s.match(/^(.+?)(\d+|\d*\+)-(\d+|\d*\+)/);
  if (!m) return null;
  const norm = x => x.includes("+") ? 5 : +x;
  const a = norm(m[2]), b = norm(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { nome: m[1].trim(), a, b, total: a + b, odds: parseOdds(s) };
}

function parseUpcoming(s) {
  if (typeof s !== "string") return null;
  if (/\d-\d|\d\+-|-\d\+/.test(s)) return null;  // tem placar (inc. 5+) = nao e futuro
  if (!/@[\d.]+/.test(s)) return null;
  const nome = s.split(/\s{2,}|\n/)[0].replace(/[a-z0-9]+@[\d.]+/gi, "").trim();
  // horario: procura H.MM ou H:MM nas linhas (igual timeFromGameText do robo)
  let horario = "";
  for (const line of s.split(/\n/).map(x => x.trim()).slice(0, 5)) {
    const m = line.match(/^(?:hor[aá]rio|hora)?\s*[:\-]?\s*(\d{1,2})[.:](\d{2})$/i);
    if (m) { horario = `${m[1]}:${m[2]}`; break; }
  }
  // times separados (casa x fora)
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

// ===== LINHAS DE TENDENCIA (LTA / LTB) + GATILHO DE ROMPIMENTO =====
// Metodo do usuario (price action no virtual): LTA liga 2 fundos ascendentes
// (suporte, fica ABAIXO da curva); LTB liga 2 topos descendentes (resistencia,
// fica ACIMA). O sinal de ouro e o ROMPIMENTO (reversao/fim de ciclo).
function pivots(serie) {
  // acha topos e fundos locais (um ponto maior/menor que os vizinhos)
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
  // foca na tendencia RECENTE (ultimos ~20 pontos = micro/macro do virtual)
  const jan = Math.min(20, n);
  const ini = n - jan;
  const sub = serie.slice(ini);
  const { topos, fundos } = pivots(sub);
  // reindexa pivots pro indice global da serie
  topos.forEach(p => p.i += ini);
  fundos.forEach(p => p.i += ini);
  const lineFrom = (p1, p2) => {
    if (!p1 || !p2 || p2.i === p1.i) return null;
    const m = (p2.v - p1.v) / (p2.i - p1.i);
    const projeta = x => p1.v + m * (x - p1.i);
    return { m, p1, p2, valorEm: projeta, atual: projeta(n - 1) };
  };

  // LTA: 2 fundos ASCENDENTES mais recentes
  let lta = null;
  for (let j = fundos.length - 1; j >= 1; j--) {
    const f2 = fundos[j], f1 = fundos[j - 1];
    if (f2.v > f1.v) { lta = lineFrom(f1, f2); break; }
  }
  // LTB: 2 topos DESCENDENTES mais recentes
  let ltb = null;
  for (let j = topos.length - 1; j >= 1; j--) {
    const t2 = topos[j], t1 = topos[j - 1];
    if (t2.v < t1.v) { ltb = lineFrom(t1, t2); break; }
  }

  // GATILHO: a curva rompeu alguma linha no ultimo ponto?
  const atual = serie[n - 1], ant = serie[n - 2];
  let rompimento = null;
  if (ltb) {
    const linhaAtual = ltb.atual, linhaAnt = ltb.valorEm(n - 2);
    // rompeu pra CIMA: antes estava abaixo da LTB, agora fechou acima
    if (ant <= linhaAnt && atual > linhaAtual) {
      rompimento = { tipo: "ROMPEU_LTB_CIMA", cor: "verde",
        msg: "ROMPEU LTB pra cima — ciclo virou, mercado vai pagar Over. Sinal de ENTRADA." };
    }
  }
  if (lta && !rompimento) {
    const linhaAtual = lta.atual, linhaAnt = lta.valorEm(n - 2);
    // rompeu pra BAIXO: antes acima da LTA, agora fechou abaixo
    if (ant >= linhaAnt && atual < linhaAtual) {
      rompimento = { tipo: "ROMPEU_LTA_BAIXO", cor: "vermelho",
        msg: "ROMPEU LTA pra baixo — mercado saturou, vai pro Under. SEGURA A MÃO / proteja." };
    }
  }

  // status da tendencia vigente (sem rompimento)
  let tendencia = "lateral";
  if (lta && atual >= lta.atual && (!ltb || atual < ltb.atual)) tendencia = "alta (sobre a LTA)";
  else if (ltb && atual <= ltb.atual) tendencia = "baixa (sob a LTB)";

  // serie projetada das linhas (pra desenhar) - so a partir do 1o pivo, clampada
  // na faixa da propria curva (nao deixa a reta disparar longe da curva)
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
  // EXATO como o caramelo: janela rolante de qtdJogos. Cada ponto = % do mercado nos
  // ultimos qtdJogos jogos. Gera todos os pontos possiveis (nao corta no final —
  // o frontend ja recebe a serie inteira e renderiza).
  const vals = [];
  for (let i = qtdJogos; i <= games.length; i++) {
    const block = games.slice(i - qtdJogos, i);
    if (mkt === "totft") {
      // Total Gols (FT): media de gols por jogo na janela, x10 (ex: 2.8 gols -> 28)
      const avg = block.reduce((s, g) => s + (g.total || 0), 0) / qtdJogos;
      vals.push(Math.round(avg * 10));
    } else {
      vals.push(Math.round(block.filter(g => pays(g, mkt)).length / qtdJogos * 100));
    }
  }
  return vals;
}

function ema(arr, period) {
  // media movel exponencial (como MM do caramelo)
  if (!arr.length) return [];
  const k = 2 / (period + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}

function slopeOf(series){
  const n=series.length;
  if(n<3)return 0;
  const xm=(n-1)/2, ym=series.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  series.forEach((y,x)=>{num+=(x-xm)*(y-ym);den+=(x-xm)**2;});
  return den?num/den:0;
}

function macdData(series) {
  // MM1 curta (10), MM2 longa (20), igual ao caramelo. MACD = MM1 - MM2
  const mm1 = ema(series, 10), mm2 = ema(series, 20);
  const hist = series.map((_, i) => +(mm1[i] - mm2[i]).toFixed(2));
  return { mm1, mm2, hist };
}

function goldenCrossData(series) {
  // O grafico operacional usa MM9/MM21. O radar precisa observar exatamente
  // as mesmas linhas para o aviso coincidir com o desenho exibido.
  const mm1 = ema(series, 9), mm2 = ema(series, 21);
  const hist = series.map((_, i) => +(mm1[i] - mm2[i]).toFixed(2));
  const last = hist.length - 1;
  if (last < 0) return { active: false, crossedNow: false, index: null, barsAgo: null, fast: null, slow: null, spread: 0 };
  let index = null;
  for (let i = 1; i <= last; i++) {
    if (hist[i] > 0 && hist[i - 1] <= 0) index = i;
  }
  const active = hist[last] > 0;
  return {
    active,
    crossedNow: last > 0 && hist[last] > 0 && hist[last - 1] <= 0,
    index,
    barsAgo: index == null ? null : last - index,
    fast: +mm1[last].toFixed(1),
    slow: +mm2[last].toFixed(1),
    spread: +hist[last].toFixed(2)
  };
}

function deathCrossData(series) {
  // Espelho do Golden: EMA9 cruza a EMA21 de cima para baixo.
  const mm1 = ema(series, 9), mm2 = ema(series, 21);
  const hist = series.map((_, i) => +(mm1[i] - mm2[i]).toFixed(2));
  const last = hist.length - 1;
  if (last < 0) return { active: false, crossedNow: false, index: null, barsAgo: null, fast: null, slow: null, spread: 0 };
  let index = null;
  for (let i = 1; i <= last; i++) {
    if (hist[i] < 0 && hist[i - 1] >= 0) index = i;
  }
  const active = hist[last] < 0;
  return {
    active,
    crossedNow: last > 0 && hist[last] < 0 && hist[last - 1] >= 0,
    index,
    barsAgo: index == null ? null : last - index,
    fast: +mm1[last].toFixed(1),
    slow: +mm2[last].toFixed(1),
    spread: +hist[last].toFixed(2)
  };
}

function zoneSignal(series){
  if(!series.length)return{zona:"—",zonaPct:0,direcao:"—",pagamento:"—",sinal:"AGUARDAR",macd:0,mm1:0,mm2:0,goldenCross:goldenCrossData(series)};
  const sorted=series.slice().sort((a,b)=>a-b);
  const p=(q)=>sorted[Math.min(sorted.length-1,Math.max(0,Math.round((sorted.length-1)*q)))];
  const min=p(0.05),max=p(0.95),cur=series[series.length-1];
  const range=Math.max(1,max-min);
  const zonaPct=Math.round((Math.max(min,Math.min(max,cur))-min)/range*100);

  // DIRECAO CORRETA (como o caramelo): MACD = MM1(10) - MM2(20)
  const { mm1, mm2, hist } = macdData(series);
  const macd = hist[hist.length - 1];
  const macdPrev = hist[hist.length - 4] ?? macd;
  // direcao = sinal do MACD + se ele esta crescendo (histograma abrindo pra cima)
  const macdSubindo = macd > 0 && macd >= macdPrev;
  const macdDescendo = macd < 0 || (macd < macdPrev);
  const subindo = macd > 0.2 && macd >= macdPrev;   // so "subindo" se MACD positivo E abrindo
  const descendo = macd < -0.2 || (macd < macdPrev - 0.2);

  const zona=zonaPct<=25?"Fundo":zonaPct<=45?"Baixa":zonaPct>=78?"Topo":zonaPct>=60?"Alta":"Meio";
  let sinal="AGUARDAR",pagamento="—";
  // REGRA CORRIGIDA: so COMPRA no fundo subindo com MACD positivo. NUNCA compra no topo.
  if(zonaPct>=78){sinal="TOPO - NAO ENTRAR (risco RED)";pagamento=descendo?"Saída/pagamento":"—";}
  else if(zonaPct>=60&&descendo){sinal="PROTEGER PARCIAL";pagamento="Parcial";}
  else if(zonaPct<=35&&subindo){sinal="COMPRA (fundo subindo)";pagamento="Alvo meio";}
  else if(zonaPct<=35&&!subindo){sinal="FUNDO - aguardar virada";}
  else if(subindo&&zonaPct<60){sinal="SUBINDO (a favor)";}
  else if(descendo){sinal="RECUO";}
  return{
    zona,zonaPct,
    direcao:subindo?"Subindo":descendo?"Descendo":"Lateral",
    pagamento,sinal,
    macd:+macd.toFixed(2),
    mm1:+mm1[mm1.length-1].toFixed(1),
    mm2:+mm2[mm2.length-1].toFixed(1),
    goldenCross:goldenCrossData(series)
  };
}

function evalUpcoming(upcoming, games, mkt) {
  const byOdd = {};
  for (const g of games) {
    const o = g.odds[mkt]; if (!o) continue;
    const k = o.toFixed(2);
    (byOdd[k] = byOdd[k] || { tot: 0, hit: 0 });
    byOdd[k].tot++; if (pays(g, mkt)) byOdd[k].hit++;
  }
  const baseGeral = pct(games.filter(g => pays(g, mkt)).length, games.length);
  return upcoming.map(u => {
    const odd = u.odds[mkt];
    let p = baseGeral, amostra = "geral";
    if (odd) {
      const k = odd.toFixed(2);
      if (byOdd[k] && byOdd[k].tot >= 5) { p = pct(byOdd[k].hit, byOdd[k].tot); amostra = byOdd[k].hit + "/" + byOdd[k].tot; }
    }
    const justa = p > 0 ? +(100 / p).toFixed(2) : null;
    const ev = odd ? Math.round((p / 100 * odd - 1) * 1000) / 10 : null;
    return { nome: u.nome, odd: odd || null, base: p, amostra, justa, ev, vale: ev != null && ev > 0 };

  });
}

function confluencia(games, mkt) {
  // janelas crescentes (proxy de 3h/6h/12h por quantidade de jogos recentes)
  // jogos rolam ~a cada 3min, entao 3h~60 jogos, 6h~120, 12h~240
  const janelas = [{ nome: "3h", n: 60 }, { nome: "6h", n: 120 }, { nome: "12h", n: 240 }];
  const win = 20;
  const out = janelas.map(j => {
    const sub = games.slice(-j.n);
    if (sub.length < win + 3) return { nome: j.nome, dir: "—", slope: 0, pct: null };
    const serie = [];
    for (let i = win; i <= sub.length; i++) serie.push(pct(sub.slice(i - win, i).filter(g => pays(g, mkt)).length, win));
    const s = slopeOf(serie.slice(-Math.min(10, serie.length)));
    return { nome: j.nome, dir: s > 0.3 ? "Subindo" : s < -0.3 ? "Descendo" : "Lateral", slope: +s.toFixed(2), pct: serie[serie.length - 1] };
  });
  // confluencia: todas as janelas com dados apontam pro mesmo lado?
  const dirs = out.filter(o => o.dir !== "—").map(o => o.dir);
  const todasSubindo = dirs.length && dirs.every(d => d === "Subindo");
  const todasDescendo = dirs.length && dirs.every(d => d === "Descendo");
  const forte = todasSubindo ? "Subindo (confluência forte)" : todasDescendo ? "Descendo (confluência forte)" : "Misto";
  return { janelas: out, confluencia: forte };
}

function teamNames(nome) {
  if (!nome) return [];
  return nome.toLowerCase().split(/\s+x\s+/).map(s => s.trim()).filter(Boolean);
}

function teamPayPct(games, nome, mkt) {
  const names = teamNames(nome);
  if (!names.length) return { g: 0, j: 0, p: null };
  // Siglas da Vavada/Kiron: compara o time exato, nao trecho do nome.
  const rows = games.filter(g => {
    const times = teamNames(g.nome);
    return names.some(n => n && times.includes(n));
  });
  const g = rows.filter(x => pays(x, mkt)).length;
  return { g, j: rows.length, p: rows.length ? Math.round(g / rows.length * 1000) / 10 : null };
}

function oddPayPct(games, odd, mkt) {
  if (!odd) return { g: 0, j: 0, p: null };
  const k = oddKey(mkt);
  const rows = games.filter(g => {
    const o = g.odds[k];
    return o && Math.abs(o - odd) <= 0.05;
  });
  const g = rows.filter(x => pays(x, mkt)).length;
  return { g, j: rows.length, p: rows.length ? Math.round(g / rows.length * 1000) / 10 : null };
}

function statForRows(games, mkt, n) {
  const sub = games.slice(-n);
  const g = sub.filter(x => pays(x, mkt)).length;
  return { g, j: sub.length, p: sub.length ? Math.round(g / sub.length * 1000) / 10 : null };
}

function radarDecision(s15, s30, s120) {
  if (!s30.j || s30.j < 12) return { label: "JUNTANDO BASE", cls: "warn" };
  const p15 = Number.isFinite(s15.p) ? s15.p : s30.p;
  const p30 = s30.p, p120 = Number.isFinite(s120.p) ? s120.p : p30;
  const delta = p15 - p30;
  if (p15 >= 58 && p30 >= 52 && delta >= -6) return { label: "LIGA QUENTE", cls: "ok" };
  if (p15 >= 50 && delta >= 8 && p15 >= p120) return { label: "VIRANDO P/ ALTA", cls: "ok" };
  if (p15 <= 35 && p30 <= 42) return { label: "LIGA FRIA", cls: "bad" };
  if (delta <= -10) return { label: "CAINDO", cls: "bad" };
  if (p30 <= 42 && p15 >= p30 + 6) return { label: "FUNDO REAGINDO", cls: "warn" };
  return { label: "NEUTRA", cls: "warn" };
}

function comboScore({ graphSubindo, graphTopo, temMinima, minimaLonga, cycleStrong, cycleBuilding, probStrong, evStrong, baseForte, coldOdd }) {
  // FORMULA FIEL DA EXTENSAO (comboScoreForGame)
  const points = {
    hist: graphSubindo ? 15 : graphTopo ? -15 : 0,       // histograma/direcao
    trend: graphSubindo ? 10 : graphTopo ? -10 : 0,       // tendencia
    minimum: temMinima ? 25 : 0,                           // mínima = maior peso
    cycle: cycleStrong ? 15 : cycleBuilding ? 8 : 0,
    prob: probStrong ? 15 : 0,
    ev: evStrong ? 10 : 0,
    base: baseForte ? 10 : 0,
    longMinimum: minimaLonga ? 5 : 0
  };
  let score = Object.values(points).reduce((a, b) => a + b, 0);
  score = Math.max(0, Math.min(100, score));
  // tetos de seguranca (igual extensao)
  if (!temMinima || !graphSubindo) score = Math.min(score, 64);
  if (coldOdd || !probStrong || !evStrong) score = Math.min(score, 54);
  const ready = score >= 70 && temMinima && graphSubindo && probStrong && evStrong && baseForte && !coldOdd;
  return { score: Math.round(score), ready, points };
}

// ---------------------------------------------------------------------------
// PROBABILIDADE KIRON: a odd ja traz a forca do jogo + margem da casa
// (~6.5% nos totais/ambas, ~14% no 5+). A probabilidade de partida e a JUSTA
// (sem margem) e so sobe se os jogos com a mesma prob. justa estiverem pagando
// acima do esperado. EV = prob * odd - 1 contra a odd real.
// ---------------------------------------------------------------------------
const MARGEM_PADRAO = { ge5: 1.14 };
function probJusta(g, mkt) {
  const k = oddKey(mkt), o = g && g.odds ? g.odds : {};
  if (o.pj && o.pj[k] != null) return Number(o.pj[k]);
  const odd = Number(o[k]);
  return odd > 1 ? (1 / odd) / (MARGEM_PADRAO[mkt] || 1.065) : null;
}
function probKiron(games, u, mkt) {
  const pF = probJusta(u, mkt);
  if (pF == null) return null;
  const rows = games.filter(g => { const p = probJusta(g, mkt); return p != null && Math.abs(p - pF) <= 0.03; });
  const j = rows.length, hits = rows.filter(g => pays(g, mkt)).length;
  const M = 40; // peso da prob. justa: 40 jogos "virtuais" puxando para o preco da Kiron
  const pEst = (hits + M * pF) / (j + M);
  const z = j >= 20 ? (hits / j - pF) / Math.sqrt(Math.max(1e-6, pF * (1 - pF) / j)) : 0;
  return { pF, pEst, j, hits, real: j ? hits / j : null, z };
}
// Cadencia real: ENG/ITA/SPA/MND 30 jogos/h, BRA/LAT 20 jogos/h.
function jogosPorHora(liga) { return /^(eng|ita|spa|mnd)$/.test(String(liga || "")) ? 30 : 20; }
function fullEvalUpcoming(upcoming, games, mkt, opts = {}) {
  const jph = opts.jogosHora || 20;
  const baseGeral = pct(games.filter(g => pays(g, mkt)).length, games.length);
  const cycle = cycleStats(games, mkt, 4 * jph);
  // sinal do grafico da liga (direcao/zona): janela de 1 hora da liga
  const serie = chartSeries(games, mkt, jph);
  const sinal = zoneSignal(serie);
  const cur = serie.length ? serie[serie.length - 1] : 0;
  const minSerie = serie.length ? Math.min(...serie) : 0;
  return upcoming.map(u => {
    const odd = u.odds[oddKey(mkt)];
    const oddBase = oddPayPct(games, odd, mkt);
    const teamBase = teamPayPct(games, u.nome, mkt);
    const dist = odd ? scoreDistribution(games, odd, mkt) : null;
    const pk = probKiron(games, u, mkt);
    let prob = baseGeral;
    if (pk) prob = pk.pEst * 100;
    else if (oddBase.j >= 5) prob = (oddBase.p * 2 + baseGeral) / 3;
    prob = Math.round(prob * 10) / 10;
    const justa = prob > 0 ? +(100 / prob).toFixed(2) : null;
    const ev = odd ? Math.round((prob / 100 * odd - 1) * 1000) / 10 : null;
    const edge = odd && justa ? Math.round((odd - justa) / odd * 1000) / 10 : null;

    // ingredientes do combo (os 3 pilares: grafico + base + ev/prob)
    const graphSubindo = sinal.direcao === "Subindo" && sinal.zonaPct < 70;
    const graphTopo = sinal.zonaPct >= 78;
    const temMinima = cur <= minSerie + 5 && sinal.zonaPct <= 40; // perto do fundo
    const cycleStrong = cycle && cycle.cur === "RED" && cycle.avgRed && cycle.streak >= cycle.avgRed;
    const cycleBuilding = cycle && cycle.cur === "RED" && cycle.pressao >= 35;
    // Forte = os jogos com essa prob. justa estao pagando acima dela (z >= 1).
    const probStrong = pk ? pk.z >= 1 : prob >= (mkt === "ge5" ? 12 : mkt === "o35" ? 28 : 45);
    const evStrong = ev != null && ev >= 0;
    const baseForte = (teamBase.j >= 6 && teamBase.p >= 52) || (oddBase.j >= 8 && oddBase.p >= 52);
    const coldOdd = oddBase.j >= 8 && oddBase.p < 30;
    const combo = comboScore({ graphSubindo, graphTopo, temMinima, minimaLonga: false, cycleStrong, cycleBuilding, probStrong, evStrong, baseForte, coldOdd });

    // status agora reflete o COMBO (nao so EV) - protege contra RED
    let status = "PASSAR";
    if (combo.ready) status = "ENTRADA FORTE";
    else if (combo.score >= 58) status = "OBSERVAR";
    else if (graphTopo) status = "TOPO - EVITAR";
    else if (ev != null && ev > 0) status = "LEVE VANTAGEM";
    else status = "PASSAR";

    return {
      nome: u.nome, odd: odd || null,
      score: combo.score, ready: combo.ready,
      prob, justa, ev, edge, status,
      probJusta: pk ? Math.round(pk.pF * 1000) / 10 : null,
      pagandoReal: pk && pk.real != null ? Math.round(pk.real * 1000) / 10 : null,
      amostraJusta: pk ? pk.j : 0,
      oddBase: oddBase.j ? `${oddBase.g}/${oddBase.j} ${oddBase.p}%` : "sem base",
      teamBase: teamBase.j ? `${teamBase.g}/${teamBase.j} ${teamBase.p}%` : "sem base",
      placarCorreto: dist ? dist.top.join(" | ") : "—",
      mercadoBase: dist ? `${dist.marketP}% (${dist.j} jogos)` : "—",
      ciclo: cycle ? `${cycle.streak} ${cycle.cur} | fase ${cycle.fase} | pressão ${cycle.pressao}` : "—",
      pilares: { grafico: graphSubindo ? "+" : graphTopo ? "-" : "0", base: baseForte ? "+" : "0", ev: evStrong ? "+" : "0" },
      vale: combo.ready
    };
  });
}

function oddKey(mkt) { return mkt === "ambas" ? "ambs" : mkt === "ambasN" ? "ambn" : mkt; }

function cycleStats(games, mkt, janela = 80) {
  // ultimos ~4h de resultados como GREEN(paga)/RED(nao paga), do mais novo
  const hist = games.slice(-janela).reverse().map(g => pays(g, mkt));
  if (!hist.length) return null;
  const cur = hist[0] ? "GREEN" : "RED";
  let streak = 0;
  for (const h of hist) { if ((h ? "GREEN" : "RED") === cur) streak++; else break; }
  let lastGreen = null;
  for (let i = 0; i < hist.length; i++) { if (hist[i]) { lastGreen = i; break; } }
  const blocks = { GREEN: [], RED: [] };
  let last = hist[0] ? "GREEN" : "RED", n = 0;
  hist.forEach(x => { const s = x ? "GREEN" : "RED"; if (s === last) n++; else { blocks[last].push(n); last = s; n = 1; } });
  blocks[last].push(n);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const avgRed = avg(blocks.RED), avgGreen = avg(blocks.GREEN);
  const fase = cur === "RED" && avgRed && streak >= avgRed ? "ponto de virada" : cur === "RED" ? "inicio/meio" : "bloco green";
  const pressao = cur === "RED" && avgRed ? Math.min(100, streak / avgRed * 50) : 0;
  return { cur, streak, lastGreen, avgRed: avgRed ? +avgRed.toFixed(1) : null, avgGreen: avgGreen ? +avgGreen.toFixed(1) : null, fase, pressao: Math.round(pressao) };
}

function scoreDistribution(games, odd, mkt) {
  // jogos com odd parecida; top placares e % que o mercado pagou
  const band = games.filter(g => { const o = g.odds[oddKey(mkt)]; return o && Math.abs(o - odd) <= 0.4; });
  if (!band.length) return null;
  const counts = {};
  band.forEach(g => { const k = g.a + "-" + g.b; counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v / band.length * 100)}%`);
  const green = band.filter(g => pays(g, mkt)).length;
  return { j: band.length, top, marketP: Math.round(green / band.length * 1000) / 10 };
}

function buildAlerts(games, serie, sinal, mkt, base) {
  if (mkt === "totft") return []; // Total Gols nao tem alerta de over/under
  const alertas = [];
  if (!serie.length) return alertas;
  const cur = serie[serie.length - 1];
  const min = Math.min(...serie), max = Math.max(...serie);

  // GOLDEN CROSS: EMA10 cruza a EMA20 de baixo para cima neste ultimo ponto.
  const golden = sinal.goldenCross || goldenCrossData(serie);
  if (golden.crossedNow) {
    const jogoCross = golden.index == null ? null : games[games.length - serie.length + golden.index];
    const horaFonte = horaCurta(jogoCross && (jogoCross.horario || jogoCross.hora));
    const hora = horaFonte || horaBR();
    alertas.push({ tipo: "GOLDEN CROSS", cls: "ok", hora, horaFonte, txt: `${mktNome(mkt)}: GOLDEN bateu às ${hora} (Brasília) — EMA10 ${golden.fast} x EMA20 ${golden.slow}, abertura +${golden.spread}.` });
  }

  // 1) ALERTA DE MINIMA: mercado no fundo historico (oportunidade de formacao)
  if (cur <= min + 2 && sinal.zonaPct <= 20) {
    alertas.push({ tipo: "MINIMA", cls: "warn", txt: `Mercado na MÍNIMA (${cur}%) — fundo. Espere VIRAR pra cima antes de entrar.` });
  }

  // 2) ALERTA DE TENDENCIA (so quando SUBINDO de verdade: MACD positivo e abrindo, fora do topo)
  if (sinal.macd > 0.2 && sinal.direcao === "Subindo" && sinal.zonaPct < 70) {
    alertas.push({ tipo: "TENDENCIA ALTA", cls: "ok", txt: `${mktNome(mkt)} SUBINDO (MACD +${sinal.macd}, zona ${sinal.zonaPct}%) — tendência a favor.` });
  }
  // alerta de topo (protecao contra o RED)
  if (sinal.zonaPct >= 78) {
    alertas.push({ tipo: "TOPO", cls: "bad", txt: `${mktNome(mkt)} no TOPO (${sinal.zonaPct}%) — NÃO entrar, risco de RED. Mercado já pagou.` });
  }

  // 3) ALERTA DE ANCORA: nos ultimos ~6 jogos, algum padrao de odd/time que paga forte
  const recent = games.slice(-30);
  const byOdd = {};
  for (const g of recent) {
    const o = g.odds[oddKey(mkt)]; if (!o) continue;
    const k = o.toFixed(2);
    (byOdd[k] = byOdd[k] || { tot: 0, hit: 0, odd: o });
    byOdd[k].tot++; if (pays(g, mkt)) byOdd[k].hit++;
  }
  Object.values(byOdd).forEach(r => {
    if (r.tot >= 6 && r.hit / r.tot >= 0.6) {
      alertas.push({ tipo: "ÂNCORA ODD", cls: "ok", txt: `Odd @${r.odd.toFixed(2)} pagou ${r.hit}/${r.tot} (${Math.round(r.hit / r.tot * 100)}%) nos últimos jogos — âncora forte.` });
    }
  });

  return alertas;
}

function mktNome(m) { return { o35: "Over 3.5", ge5: "5+ gols", o25: "Over 2.5", ambas: "Ambas" }[m] || m; }
function horaBR(ts = Date.now()) {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false
    });
  } catch (e) { return new Date(ts).toISOString().slice(11, 16); }
}
function horaCurta(v) {
  const m = String(v || "").match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
  return m ? String(Number(m[1])).padStart(2, "0") + ":" + m[2] : null;
}
function atrasoMinutos(horaFonte, horaDetectada) {
  if (!horaFonte || !horaDetectada) return null;
  const a = horaFonte.split(":").map(Number), b = horaDetectada.split(":").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return null;
  let d = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;
  return d >= 0 ? d : null;
}

function computeMarket(games, mkt, qtdJogos = 20) {
  // Total Gols (FT): mercado de MEDIA de gols (nao e taxa de acerto). O grafico mostra
  // a media de gols por jogo na janela; nao tem EV/odd justa (nao e aposta sim/nao).
  if (mkt === "totft") {
    const JANELA = Math.max(2, Math.min(20, games.length));
    const serie = chartSeries(games, "totft", JANELA).slice(-qtdJogos);
    const sinal = zoneSignal(serie);
    const { hist: macdHist } = macdData(serie);
    const mediaGols = games.length ? +(games.reduce((s, g) => s + (g.total || 0), 0) / games.length).toFixed(2) : 0;
    return {
      total: games.length, base: mediaGols, justa: null, mediaGols, ehTotalGols: true,
      termometro: [], aquecendo: false, qtdJogos, serie,
      macdHist: macdHist.slice(-qtdJogos), sinal, alertas: [],
      confluencia: null, ligaStatus: {}, stats: {}, ranking: [], signatures: [], atual: null
    };
  }
  const total = games.length;
  const hit = games.filter(g => pays(g, mkt)).length;
  const base = pct(hit, total);
  const justa = base > 0 ? +(100 / base).toFixed(2) : null;

  const wins = [120, 240, 480, 960].map(n => ({ n, v: windowPct(games, mkt, n) }));
  const w120 = wins[0].v, w480 = wins[2].v;
  const aquecendo = w120 != null && w480 != null && w120 > w480;

  // ranking por odd
  const byOdd = {};
  for (const g of games) {
    const o = g.odds[oddKey(mkt)];
    if (!o) continue;
    const k = o.toFixed(2);
    (byOdd[k] = byOdd[k] || { odd: o, tot: 0, hit: 0 });
    byOdd[k].tot++;
    if (pays(g, mkt)) byOdd[k].hit++;
  }
  const ranking = Object.values(byOdd)
    .filter(r => r.tot >= 5)
    .map(r => {
      const p = pct(r.hit, r.tot);
      const ev = Math.round((p / 100 * r.odd - 1) * 1000) / 10;
      return { odd: r.odd, hit: r.hit, tot: r.tot, p, justa: p > 0 ? +(100 / p).toFixed(2) : null, ev };
    })
    .sort((a, b) => b.ev - a.ev);

  // assinaturas
  const sigMap = {};
  for (let i = 5; i < games.length; i++) {
    const sig = games.slice(i - 5, i).map(g => (pays(g, mkt) ? "1" : "0")).join("");
    (sigMap[sig] = sigMap[sig] || { n: 0, paid: 0 });
    sigMap[sig].n++;
    if (pays(games[i], mkt)) sigMap[sig].paid++;
  }
  const atualSig = games.slice(-5).map(g => (pays(g, mkt) ? "1" : "0")).join("");
  const atualStat = sigMap[atualSig] || { n: 0, paid: 0 };
  const signatures = Object.entries(sigMap)
    .filter(([_, d]) => d.n >= 8)
    .map(([sig, d]) => ({ sig, n: d.n, paid: d.paid, p: pct(d.paid, d.n) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 10);

  // JANELA FIXA (forma da curva, igual caramelo); qtd so define quantos pontos exibir.
  // Antes usava qtdJogos como janela -> com poucos jogos ou qtd alto, curva quebrava.
  const JANELA = Math.max(2, Math.min(20, games.length));
  const serieFull = chartSeries(games, mkt, JANELA);
  const serie = serieFull.slice(-qtdJogos);
  const sinal = zoneSignal(serie);
  const { hist: macdHist } = macdData(serie);
  const conf = confluencia(games, mkt);
  const s15 = statForRows(games, mkt, 15), s30 = statForRows(games, mkt, 30), s120 = statForRows(games, mkt, 120);
  const ligaStatus = radarDecision(s15, s30, s120);
  const alertas = buildAlerts(games, serie, sinal, mkt, base);

  return {
    total, base, justa,
    termometro: wins,
    aquecendo,
    qtdJogos,
    serie,
    macdHist: macdHist.slice(-qtdJogos),
    sinal,
    alertas,
    confluencia: conf,
    ligaStatus,
    stats: { s15: s15.p, s30: s30.p, s120: s120.p },
    ranking: ranking.slice(0, 14),
    signatures,
    atual: { sig: atualSig, n: atualStat.n, paid: atualStat.paid, p: pct(atualStat.paid, atualStat.n) }
  };
}

// monta o store de uma liga a partir dos jogos (funciona com qualquer fonte:
// JSON antigo OU placares vindos da sonda ao vivo)
// ===== ANCORAS: times que pagam placares-gatilho (2-1, 3-0, 2-0 HT) =====
// Calcula, por time, a taxa historica de placares-ancora jogando em CASA e FORA.
// Esses placares costumam anteceder/acompanhar big placares (Over 3.5 / 5+).
// Tudo SEPARADO e ADITIVO — nao altera score/EV/grafico existentes.
function ehPlacarAncora(g) {
  const a = g.a, b = g.b;
  // FT 2-1 / 1-2 / 3-0 / 0-3
  if ((a === 2 && b === 1) || (a === 1 && b === 2)) return true;
  if ((a === 3 && b === 0) || (a === 0 && b === 3)) return true;
  // HT 2-0 / 0-2
  const ht = (g.ht || "").replace(/\s/g, "");
  if (ht === "2-0" || ht === "0-2") return true;
  return false;
}
function anchorStats(games) {
  const t = {};
  const get = n => (t[n] || (t[n] = { casaJogos: 0, casaAnc: 0, foraJogos: 0, foraAnc: 0 }));
  for (const g of games) {
    if (!g.casa || !g.fora) continue;
    const anc = ehPlacarAncora(g);
    const c = get(g.casa); c.casaJogos++; if (anc) c.casaAnc++;
    const f = get(g.fora); f.foraJogos++; if (anc) f.foraAnc++;
  }
  return t;
}
// BIG PLACAR: pra cada jogo do time (casa/fora), olha a janela de 3 jogos na ordem
// da liga — o ANTERIOR, o DELE e o SEGUINTE. Se em qualquer um saiu Over 3.5 (>=4)
// ou 5+ (>=5), conta. Mede "esse time costuma aparecer perto de big placar".
function bigPlacarStats(games) {
  const t = {};
  const get = n => (t[n] || (t[n] = { casaJogos: 0, casaO35: 0, casa5: 0, foraJogos: 0, foraO35: 0, fora5: 0 }));
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g.casa || !g.fora) continue;
    const win = [games[i - 1], g, games[i + 1]];
    const o35 = win.some(x => x && x.total >= 4);
    const p5 = win.some(x => x && x.total >= 5);
    const c = get(g.casa); c.casaJogos++; if (o35) c.casaO35++; if (p5) c.casa5++;
    const f = get(g.fora); f.foraJogos++; if (o35) f.foraO35++; if (p5) f.fora5++;
  }
  return t;
}
// RANK DE TIMES: ranqueia os times que mais "pagam" um mercado dentro de uma janela
// de tempo (em numero de jogos recentes). Soma aparicoes em casa+fora.
function teamRanking(games, mkt, nGames, minJogos = 3, topN = 5) {
  const recent = games.slice(-nGames);
  const t = {};
  for (const g of recent) {
    if (!g.casa || !g.fora) continue;
    const paid = pays(g, mkt);
    for (const time of [g.casa, g.fora]) {
      (t[time] = t[time] || { jogos: 0, hit: 0 });
      t[time].jogos++;
      if (paid) t[time].hit++;
    }
  }
  return Object.entries(t)
    .filter(([_, d]) => d.jogos >= minJogos)
    .map(([time, d]) => ({ time, jogos: d.jogos, hit: d.hit, pct: Math.round(d.hit / d.jogos * 100) }))
    .sort((a, b) => b.pct - a.pct || b.jogos - a.jogos)
    .slice(0, topN);
}
// janelas de tempo (virtual ~20 jogos/hora): 3h/6h/12h/24h
const JANELAS_HORA = { h3: 60, h6: 120, h12: 240, h24: 480 };
function rankTimesPorJanela(games, mkt) {
  const out = {};
  for (const [k, n] of Object.entries(JANELAS_HORA)) out[k] = teamRanking(games, mkt, n);
  return out;
}

// PLACAR PROVAVEL: distribuicao de placares dos jogos recentes da liga (peso 1) +
// historico do mandante em casa e do visitante fora (peso 3). Top 2 com %.
function placarProvavel(games, casa, fora, nome) {
  if ((!casa || !fora) && nome && nome.includes(" x ")) {
    const pp = nome.split(" x "); casa = casa || pp[0].trim(); fora = fora || (pp[1] || "").trim();
  }
  // duas distribuicoes: liga (referencia) e confronto (mandante em casa + visitante fora, peso 3 + liga peso 1)
  const liga = {}, conf = {}; let totL = 0, totC = 0;
  const add = (m, g, w) => { if (g.a == null || g.b == null) return 0; const k = g.a + "-" + g.b; m[k] = (m[k] || 0) + w; return w; };
  for (const g of games.slice(-300)) totL += add(liga, g, 1);
  for (const g of games.slice(-150)) totC += add(conf, g, 1);
  if (casa || fora) for (const g of games) {
    if (casa && g.casa === casa) totC += add(conf, g, 3);
    if (fora && g.fora === fora) totC += add(conf, g, 3);
  }
  if (!totC || !totL) return null;
  const soma = k => k.split("-").reduce((a, b) => +a + +b, 0);
  const top = filtro => {
    const e = Object.entries(conf).filter(([k]) => filtro(soma(k))).sort((a, b) => b[1] - a[1])[0];
    return e ? { placar: e[0], pct: Math.round(e[1] / totC * 100) } : null;
  };
  // placar que ESSE confronto puxa acima do normal da liga (lift >= 1.5x, minimo de ocorrencias)
  let puxa = null;
  for (const [k, w] of Object.entries(conf)) {
    if (w < 6) continue;
    const pC = w / totC, pL = (liga[k] || 0.5) / totL;
    const x = pC / pL;
    if (x >= 1.5 && (!puxa || x > puxa.x)) puxa = { placar: k, x: Math.round(x * 10) / 10 };
  }
  return { under: top(t => t <= 2), over: top(t => t >= 3), puxa };
}

const ANCORA_CORTE = 0.30;   // >=30% = alta taxa de placar-gatilho (2-1/3-0/2-0HT)
const ANCORA_MIN_JOGOS = 8;  // amostra minima pra a taxa valer
const BIG_CORTE = 0.65;      // >=65% de Over 3.5 na janela de 3 = "paga big placar" (seletivo)
function avaliaAncora(u, stats, big) {
  const cs = stats[u.casa], fs = stats[u.fora];
  const cb = big[u.casa], fb = big[u.fora];
  const casaRate = cs && cs.casaJogos >= ANCORA_MIN_JOGOS ? cs.casaAnc / cs.casaJogos : null;
  const foraRate = fs && fs.foraJogos >= ANCORA_MIN_JOGOS ? fs.foraAnc / fs.foraJogos : null;
  // taxas de big placar (janela de 3) por lado
  const casaO35 = cb && cb.casaJogos >= ANCORA_MIN_JOGOS ? cb.casaO35 / cb.casaJogos : null;
  const casa5 = cb && cb.casaJogos >= ANCORA_MIN_JOGOS ? cb.casa5 / cb.casaJogos : null;
  const foraO35 = fb && fb.foraJogos >= ANCORA_MIN_JOGOS ? fb.foraO35 / fb.foraJogos : null;
  const fora5 = fb && fb.fora5 >= 0 && fb.foraJogos >= ANCORA_MIN_JOGOS ? fb.fora5 / fb.foraJogos : null;
  // dispara se: alta taxa de placar-gatilho OU alta taxa de big placar (Over 3.5 janela)
  const casaHit = (casaRate != null && casaRate >= ANCORA_CORTE) || (casaO35 != null && casaO35 >= BIG_CORTE);
  const foraHit = (foraRate != null && foraRate >= ANCORA_CORTE) || (foraO35 != null && foraO35 >= BIG_CORTE);
  const nivel = (casaHit && foraHit) ? "forte" : (casaHit || foraHit) ? "normal" : null;
  if (!nivel) return null;
  const pc = x => x != null ? Math.round(x * 100) : null;
  return {
    nivel,
    casa: { time: u.casa, taxa: pc(casaRate), jogos: cs ? cs.casaJogos : 0, hit: casaHit, o35: pc(casaO35), p5: pc(casa5) },
    fora: { time: u.fora, taxa: pc(foraRate), jogos: fs ? fs.foraJogos : 0, hit: foraHit, o35: pc(foraO35), p5: pc(fora5) }
  };
}

/*
 * A extensao varre a grade em etapas. Entre uma etapa e outra ela pode enviar
 * temporariamente zero (ou apenas parte dos) jogos futuros. Se substituirmos o
 * store por esse lote intermediario, os cartoes azuis somem e reaparecem a
 * cada varredura. Mantemos por poucos minutos os futuros ja vistos e os
 * removemos assim que o respectivo resultado chega.
 */
const FUTURO_RETENCAO_MS = 15 * 60 * 1000;
const futurosEstaveis = Object.create(null);
let futuroOrdem = 0;
function chaveFuturo(g) {
  return [String(g && g.horario || ""), normNome(g && (g.casa || "")),
    normNome(g && (g.fora || ""))].join("|");
}
function estabilizaFuturos(liga, incoming, games) {
  const agora = Date.now();
  const mapa = futurosEstaveis[liga] || (futurosEstaveis[liga] = new Map());
  const resolvidos = new Set((games || []).slice(-120).map(chaveFuturo));

  for (const chave of resolvidos) if (chave !== "||") mapa.delete(chave);
  for (const u of (Array.isArray(incoming) ? incoming : [])) {
    if (!u || (!u.nome && !u.casa && !u.fora)) continue;
    const chave = chaveFuturo(u);
    if (chave === "||" || resolvidos.has(chave)) continue;
    const anterior = mapa.get(chave);
    mapa.set(chave, {
      jogo: anterior ? { ...anterior.jogo, ...u,
        odds: { ...(anterior.jogo.odds || {}), ...(u.odds || {}) } } : u,
      vistoEm: agora,
      ordem: anterior ? anterior.ordem : futuroOrdem++
    });
  }

  for (const [chave, item] of mapa) {
    if (!item || agora - item.vistoEm > FUTURO_RETENCAO_MS) mapa.delete(chave);
  }
  return Array.from(mapa.values()).sort((a, b) => a.ordem - b.ordem)
    .map(item => item.jogo);
}

function buildStore(liga, games, upcoming, lastUpdated) {
  upcoming = estabilizaFuturos(liga, upcoming, games);
  const stats = anchorStats(games);
  const big = bigPlacarStats(games);
  // mapa de ancora por nome de jogo futuro (so os que disparam)
  const ancoras = {};
  for (const u of upcoming) { const a = avaliaAncora(u, stats, big); if (a) ancoras[u.nome] = a; }
  return {
    games,
    upcomingRaw: upcoming,
    lastUpdated: lastUpdated || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    computed: {
      o35: computeMarket(games, "o35"),
      ge5: computeMarket(games, "ge5"),
      o25: computeMarket(games, "o25"),
      ambas: computeMarket(games, "ambas"),
      u25: computeMarket(games, "u25"),
      u15: computeMarket(games, "u15"),
      u05: computeMarket(games, "u05"),
      totft: computeMarket(games, "totft")
    },
    upcoming: {
      o35: brainEval(games, upcoming, liga, "o35") || fullEvalUpcoming(upcoming, games, "o35", { jogosHora: jogosPorHora(liga) }),
      ge5: brainEval(games, upcoming, liga, "ge5") || fullEvalUpcoming(upcoming, games, "ge5", { jogosHora: jogosPorHora(liga) }),
      o25: brainEval(games, upcoming, liga, "o25") || fullEvalUpcoming(upcoming, games, "o25", { jogosHora: jogosPorHora(liga) }),
      ambas: brainEval(games, upcoming, liga, "ambas") || fullEvalUpcoming(upcoming, games, "ambas", { jogosHora: jogosPorHora(liga) }),
      u25: fullEvalUpcoming(upcoming, games, "u25", { jogosHora: jogosPorHora(liga) }),
      u15: fullEvalUpcoming(upcoming, games, "u15", { jogosHora: jogosPorHora(liga) }),
      u05: fullEvalUpcoming(upcoming, games, "u05", { jogosHora: jogosPorHora(liga) }),
      // Total Gols (FT): nao e aposta sim/nao, entao mostra so o jogo (sem EV/score)
      totft: upcoming.map(u => ({ nome: u.nome, horario: u.horario, casa: u.casa, fora: u.fora, semEV: true }))
    },
    ultimos: games.slice(-20).map(g => ({ nome: g.nome, placar: g.a + "-" + g.b, total: g.total })),
    ancoras
  };
}

async function refreshLiga(liga) {
  // O JSON estatico do caramelo foi APAGADO (404). A fonte agora e o WebSocket
  // (ver wsConnect). Esta funcao so age como ultimo recurso: se NAO ha dados da
  // WS nem da sonda, tenta o JSON (provavelmente 404, mas nao custa).
  const atual = store[liga];
  if (atual && (atual.fonte === "ws" || atual.fonte === "sonda")) {
    const ts = atual.wsTs || atual.sondaTs || 0;
    if (Date.now() - ts < 180000) return; // dados vivos recentes: nao mexe
  }
  try {
    const r = await fetch(BASE + liga + ".json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const { games, upcoming } = decodeRows(j);
    if (!games.length) throw new Error("zero jogos");
    const lu = j.lastUpdated || (j.table && j.table.lastUpdated) || null;
    if (atual && (atual.fonte === "ws" || atual.fonte === "sonda")) return;
    const s = buildStore(liga, games, upcoming, lu);
    s.fonte = "json";
    store[liga] = s;
  } catch (e) {
    if (!store[liga]) store[liga] = { erro: e.message, fetchedAt: new Date().toISOString() };
  }
}

// ===== FONTE DIRETA: cliente WebSocket do caramelo =====
// O caramelo migrou pra WebSocket (wss://.../ws-dados). Apagou os JSON estaticos.
// A pagina pede dados com {"type":"liga:get","liga":X} e recebe um "snapshot"
// com data.cells[] (cada celula tem times, placar.ft, odds, linha_visual, coluna_visual,
// status). Aqui o SERVIDOR faz o mesmo: conecta, pede cada liga, recebe e processa.
// Robusto: nao depende de aba aberta nem da tela travando.
import { WebSocket as WSClient } from "ws";

const WS_URL = "wss://www.caramelotips.com.br/ws-dados";

// converte o snapshot do caramelo nos games/upcoming que o servidor ja usa
// completa odds complementares (over<->under, sem margem) no objeto que a sonda entrega pronto
function completaOdds(o) {
  const odds = { ...(o || {}) };
  const deriva = (deKey, paraKey) => {
    if (odds[paraKey] == null && odds[deKey] != null && odds[deKey] > 1) {
      const p = 1 - 1 / odds[deKey];
      if (p > 0.01) odds[paraKey] = +(1 / p).toFixed(2);
    }
  };
  deriva("u15", "o15"); deriva("u25", "o25"); deriva("u35", "o35");
  deriva("o15", "u15"); deriva("o25", "u25"); deriva("o35", "u35");
  return odds;
}

// MAXIMAS DE REDS: maior corda de nao-pagamento por janela de tempo (~3min/jogo) + seca atual
function colunaPct(gamesArr, horario, mkt) {
  if (!horario || !horario.includes(":")) return null;
  const min = horario.split(":")[1];
  const hist = [];
  for (let i = gamesArr.length - 1; i >= 0 && hist.length < 24; i--) {
    const h = gamesArr[i].horario || "";
    if (h.endsWith(":" + min)) hist.push(pays(gamesArr[i], mkt) ? 1 : 0);
  }
  if (!hist.length) return null;
  const pc = n => { const s = hist.slice(0, n); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length * 100) : null; };
  return { min, h3: pc(3), h6: pc(6), h12: pc(12), h24: pc(24) };
}
function taxaJanelas(gamesArr, mkt) {
  const out = {};
  for (const [k, n] of Object.entries({ h3: 60, h6: 120, h12: 240, h24: 480 })) {
    const g = gamesArr.slice(-n);
    out[k] = g.length ? Math.round(g.filter(x => pays(x, mkt)).length / g.length * 100) : null;
  }
  return out;
}
function maximasReds(gamesArr, mkt) {
  const janelas = { h3: 60, h6: 120, h12: 240, h24: 480 };
  const out = {};
  for (const [k, n] of Object.entries(janelas)) {
    const g = gamesArr.slice(-n);
    let mx = 0, run = 0;
    for (const x of g) { if (!pays(x, mkt)) { run++; if (run > mx) mx = run; } else run = 0; }
    out[k] = mx;
  }
  let agora = 0;
  for (let i = gamesArr.length - 1; i >= 0; i--) { if (!pays(gamesArr[i], mkt)) agora++; else break; }
  out.agora = agora;
  return out;
}

function decodeSnapshot(data) {
  const cells = (data && data.cells) || [];
  const passados = [], futuros = [];
  for (const c of cells) {
    // O snapshot do WS tem dois formatos possiveis:
    // Formato A (wrapper): { cell: { times, placar, odds, ... }, linha_visual, coluna_visual, status }
    // Formato B (direto):  { times, placar, odds, linha_visual, coluna_visual, status }
    // Suportamos os dois: preferimos .cell se existir, senao usa o proprio c.
    const cell = (c.cell && typeof c.cell === "object") ? c.cell : c;
    const ft = cell.placar && cell.placar.ft;
    const times = cell.times || {};
    const nome = (times.casa || "?") + " x " + (times.fora || "?");
    // ordem cronologica: linha_visual DESC (linha 1 = mais recente/topo), coluna ASC
    const lv = c.linha_visual ?? cell.linha_visual ?? 0;
    const cv = c.coluna_visual ?? cell.coluna_visual ?? 0;
    const ordem = (-lv) * 1000 + cv;
    const status = c.status ?? cell.status;
    const horaJogo = (c.hora_base || cell.hora_base || "") + ":" + String(c.minuto || cell.minuto || "").padStart(2, "0");
    if (status === "futuro" || cell.futuro === true) {
      const o = cell.odds || {};
      futuros.push({
        ordem, linha_visual: lv, coluna_visual: cv,
        nome,
        horario: horaJogo,
        casa: times.casa || "", fora: times.fora || "",
        odds: { o25: o.o25, o35: o.o35, ge5: o.ge5, ambs: o.ambs, u05: o.u05, u15: o.u15, u25: o.u25, o15: o.o15 }
      });
    } else if (ft && /^\d+-\d+$/.test(String(ft).trim())) {
      const m = String(ft).trim().match(/(\d+)-(\d+)/);
      const o = cell.odds || {};
      const ht = (cell.placar && cell.placar.ht) ? String(cell.placar.ht).trim() : "";
      passados.push({
        ordem, linha_visual: lv, coluna_visual: cv, nome, a: +m[1], b: +m[2], total: +m[1] + +m[2],
        casa: times.casa || "", fora: times.fora || "", ht, horario: horaJogo,
        odds: { o25: o.o25, o35: o.o35, ge5: o.ge5, ambs: o.ambs, u05: o.u05, u15: o.u15, u25: o.u25, o15: o.o15 }
      });
    }
  }
  // ordena cronologicamente (mais antigo -> mais novo)
  passados.sort((x, y) => x.ordem - y.ordem);
  futuros.sort((x, y) => x.ordem - y.ordem);
  // os 2 jogos mais recentes ainda nao entram na curva do caramelo (validado: drop2)
  // e limita aos ~1200 jogos recentes: a curva (janela 20) e as stats usam os recentes,
  // e o historico cru pode passar de 4000 jogos (deixa o servidor lento sem necessidade).
  const mapa = g => ({
    nome: g.nome, a: g.a, b: g.b, total: g.total,
    casa: g.casa, fora: g.fora, ht: g.ht, horario: g.horario || "",
    linha_visual: g.linha_visual, coluna_visual: g.coluna_visual,
    odds: completaOdds(g.odds)
  });
  // DROP-2 ABOLIDO (o usuario estava certo): os 2 resultados mais frescos que a fonte ja
  // entrega NAO sao mais descartados - grafico, zonas, estudos e robo rodam na linha cheia.
  // (o descarte existia so para imitar a curva da fonte, que atrasa em relacao ao proprio quadro)
  const games = passados.slice(-1200).map(mapa);
  // gamesAll: SEM o drop-2 (inclui os 2 jogos mais recentes) — usado SO pelo radar,
  // pra alertar no fechamento real (~6 min mais cedo). Grafico/analises seguem com drop-2.
  const gamesAll = passados.slice(-1200).map(mapa);
  const upcoming = futuros.map(u => ({
    nome: u.nome, horario: u.horario, casa: u.casa, fora: u.fora,
    linha_visual: u.linha_visual, coluna_visual: u.coluna_visual, odds: completaOdds(u.odds)
  }));
  console.log(`decodeSnapshot: ${passados.length} passados → ${games.length} games, ${futuros.length} futuros → ${upcoming.length} upcoming`);
  return { games, upcoming, gamesAll };
}

function aplicaSnapshot(liga, data) {
  try {
    let { games, upcoming, gamesAll } = decodeSnapshot(data);
    if (!games.length) return;
    const s = buildStore(liga, games, upcoming, new Date(data.atualizadoEm || Date.now()).toISOString());
    s.fonte = "ws";
    s.wsTs = Date.now();
    store[liga] = s;
    atualizaRadar(liga, s);
    atualizaRoboLedger();
    avisaClientes(liga);
  } catch (e) {
    console.error("erro aplicaSnapshot " + liga + ":", e.message);
  }
}

// NOTA: o WS do caramelo exige LOGIN (fecha com code 4001 sem sessao). Por isso o
// servidor sozinho nao consegue conectar. A sonda (no navegador logado do usuario)
// captura o snapshot do WS e manda pra /api/snapshot. Mantemos decodeSnapshot e o
// cliente WS abaixo desligado (so liga se um dia houver auth no servidor).
const WS_SERVER_ENABLED = false;

let ws = null, wsReady = false, wsReconnectTimer = null;
function wsConnect() {
  if (!WS_SERVER_ENABLED) return;
  try {
    ws = new WSClient(WS_URL, { headers: { Origin: "https://www.caramelotips.com.br" } });
    ws.on("open", () => {
      wsReady = true;
      console.log("WS caramelo conectado");
      LIGAS.forEach(l => pedeLiga(l));
    });
    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === "snapshot" && msg.liga && msg.data) {
          aplicaSnapshot(msg.liga, msg.data);
        } else if (msg.type === "liga:refresh" && msg.liga) {
          pedeLiga(msg.liga); // dados mudaram -> pede snapshot novo
        }
      } catch (e) { /* ignora msgs nao-JSON */ }
    });
    ws.on("close", () => { wsReady = false; agendaReconexao(); });
    ws.on("error", (e) => { wsReady = false; console.error("WS erro:", e.message); });
  } catch (e) {
    console.error("WS connect falhou:", e.message);
    agendaReconexao();
  }
}
function pedeLiga(liga) {
  if (ws && wsReady) { try { ws.send(JSON.stringify({ type: "liga:get", liga })); } catch (e) { } }
}
function agendaReconexao() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; if (process.env.FONTE_WS === "1") wsConnect(); else console.log("[AMD] fonte WS desligada - usando /api/dados"); }, 4000);
}
wsConnect();
// re-pede todas as ligas periodicamente (garante frescor mesmo sem refresh ping)
setInterval(() => { if (WS_SERVER_ENABLED && wsReady) LIGAS.forEach(pedeLiga); }, 20000);

async function refreshAll() {
  if (process.env.FONTE_WS === "1") await Promise.all(LIGAS.map(refreshLiga));
}

// loop de atualizacao
refreshAll();
setInterval(refreshAll, REFRESH_MS);

// API
// recebe o SNAPSHOT CRU do WebSocket do caramelo, capturado pela sonda no
// navegador logado do usuario (o WS exige login, code 4001 sem sessao).
// dados limpos: placares + futuros + odds completas.
// ===== PORTEIRO DE CONTEUDO: impressao digital dos times por liga (rejeita snapshot com liga trocada) =====
const FP_PREMIER = ["Arsenal", "City", "United", "Chelsea", "Liverpool", "Everton", "Newcastle", "Aston", "Tottenham", "West Ham", "Wolves", "Leeds", "Southampton", "Fulham", "Brighton", "Palace", "Brentford", "Forest", "Bournemouth", "Burnley"];
const FP_SUPER = ["Santiago", "Itaquera", "La Boca", "Medellin", "Bogota", "Lima", "Quito", "Asuncion", "Montevideo", "La Plata", "Buenos Aires", "Guayaquil", "Porto Alegre", "Belo Horizonte", "Rio de Janeiro", "Sao Paulo", "São Paulo", "Santos", "Penarol", "Agua Branca", "Água Branca", "Avellaneda"];
const FP_NAO_EUROPEU = ["Brasil", "Argentina", "Japão", "Coreia", "EUA", "México", "Qatar", "Arábia", "Irã", "Iraque", "Marrocos", "Egito", "Senegal", "Gana", "Tunísia", "Colômbia", "Equador", "Uruguai", "Paraguai", "Haiti", "Panamá", "Curação", "Cabo Verde", "Nova Zelândia", "Austrália", "Uzbequistão", "Jordânia", "RD Congo", "África do Sul", "Costa do Marfim", "Argélia", "Canadá", "Peru", "Chile", "Cuba"];
let snapshotsRejeitados = {};
function ligaBateComConteudo(liga, games) {
  try {
    const nomes = new Set();
    for (const g of games.slice(-80)) { if (g.casa) nomes.add(g.casa); if (g.fora) nomes.add(g.fora); }
    const conta = lista => { let n = 0; for (const nm of nomes) if (lista.some(f => nm.includes(f))) n++; return n; };
    const nPrem = conta(FP_PREMIER), nSuper = conta(FP_SUPER), nNaoEu = conta(FP_NAO_EUROPEU);
    if (liga === "premier") return nPrem >= 2 && nSuper === 0;
    if (liga === "super") return nSuper >= 2 && nPrem === 0;
    if (liga === "copa") return nNaoEu >= 2 && nPrem === 0 && nSuper === 0;   // copa tem selecoes do mundo todo
    if (liga === "euro") return nNaoEu === 0 && nPrem === 0 && nSuper === 0;  // euro e 100% selecoes europeias
    return true;
  } catch (e) { return true; }
}

// ===== SONDA 2 (bet365 resultados): resultados RAPIDOS que furam a cortina da fonte 1 =====
// A sonda 2 envia resultados crus sem saber a liga; o servidor identifica a liga casando
// horario+casa com o upcomingRaw de cada uma, e mantem um OVERLAY (rapidos) que alimenta
// robo e radar ~6min antes do feed oficial. Quando o oficial chega, o overlay se dissolve.
let rapidos = {}; // liga -> { "hor|casa": game }
let upVistos = {}; // liga -> [{casa,fora,horario,odds,ts}] futuros vistos nos ultimos 40min (o resultado chega DEPOIS do jogo sair do upcoming)
function registraUpVistos(liga, upcoming) {
  try {
    const arr = upVistos[liga] = upVistos[liga] || [];
    for (const u of upcoming || []) {
      if (!u || !u.casa || !u.fora) continue;
      const ja = arr.find(x => x.casa === u.casa && x.fora === u.fora && x.horario === (u.horario || ""));
      if (ja) { ja.ts = Date.now(); if (u.odds) ja.odds = u.odds; }
      else arr.push({ casa: u.casa, fora: u.fora, horario: u.horario || "", odds: u.odds || null, ts: Date.now() });
    }
    const corte = Date.now() - 40 * 60000;
    upVistos[liga] = arr.filter(x => x.ts >= corte).slice(-80);
  } catch (e) {}
}
let sonda2Stats = { recebidos: 0, casados: 0, ultimoEm: null };
let sonda2Amostras = []; // ultimos crus recebidos (diagnostico de calibracao)
function normNome(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function nomesBatem(a, b) {
  const na = normNome(a), nb = normNome(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter(w => w.length >= 4);
  const tb = nb.split(" ").filter(w => w.length >= 4);
  return ta.some(w => tb.includes(w));
}
function listaCheia(d, alt) { const a = d && d.gamesAll; if (a && a.length) return a; const g = (d && d.games) || alt || []; return (g && g.length) ? g : (alt || []); }
function gamesFundidos(liga) {
  const d = store[liga];
  const ga = listaCheia(d); // fallback a prova de array VAZIO (que e truthy em JS)
  if (fonteDiretaAtiva(liga)) return ga;
  const r = rapidos[liga] || {};
  const cauda = ga.slice(-40);
  const extra = Object.values(r).filter(g => !cauda.some(x => x.horario === g.horario && x.casa === g.casa));
  extra.sort((a, b) => (a.horario < b.horario ? -1 : 1));
  return extra.length ? ga.concat(extra) : ga;
}
app.post("/api/snapshot2", (req, res) => {
  try {
    const jogos = (req.body || {}).jogos || [];
    sonda2Stats.recebidos += jogos.length;
    sonda2Stats.ultimoEm = new Date().toISOString();
    let casados = 0;
    for (const j of jogos) {
      if (!j || !j.casa || !j.fora || j.a == null || j.b == null) continue;
      const temLetras = s => (String(s).match(/[A-Za-zÀ-ÿ]/g) || []).length >= 3;
      const ehLixo = s => /resultado|encerr|ao vivo|final|partida|jogo|data|hora/i.test(String(s));
      if (!temLetras(j.casa) || !temLetras(j.fora) || ehLixo(j.casa) || ehLixo(j.fora)) continue;
      if (parseInt(j.a) > 9 || parseInt(j.b) > 9) continue;
      if (sonda2Amostras.length < 60 && (String(j.casa).match(/[A-Za-zÀ-ÿ]/g) || []).length >= 3) sonda2Amostras.push({ casa: j.casa, fora: j.fora, placar: j.a + "-" + j.b });
      for (const liga of Object.keys(store)) {
        const vistos = (upVistos[liga] || []).concat(((store[liga] || {}).upcomingRaw) || []);
        const u = vistos.find(x => nomesBatem(x.casa, j.casa) && nomesBatem(x.fora, j.fora));
        if (u) {
          const a = parseInt(j.a), b = parseInt(j.b);
          const g = { casa: j.casa, fora: j.fora, a, b, total: a + b, placar: a + "-" + b, horario: u.horario || j.horario || "", odds: u.odds || null, _rapido: true };
          (rapidos[liga] = rapidos[liga] || {})[g.horario + "|" + g.casa] = g;
          casados++; break;
        }
      }
    }
    sonda2Stats.casados += casados;
    // poda: overlay que ja apareceu no oficial se dissolve
    for (const liga of Object.keys(rapidos)) {
      const d = store[liga]; if (!d || !d.gamesAll) continue;
      const cauda = d.gamesAll.slice(-40);
      for (const k of Object.keys(rapidos[liga])) {
        const g = rapidos[liga][k];
        if (cauda.some(x => x.horario === g.horario && x.casa === g.casa)) delete rapidos[liga][k];
      }
    }
    if (casados) {
      atualizaRoboLedger();
      // A sonda 2 existe para antecipar o feed oficial. Passe o store e force o
      // radar a recalcular com o overlay rapido assim que um resultado casar.
      for (const liga of Object.keys(store)) atualizaRadar(liga, store[liga]);
    }
    res.json({ ok: true, recebidos: jogos.length, casados });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
// serve o script da sonda 2 (colar no console vira uma linha so)
app.get("/api/wsstatus", (req, res) => {
  res.json({ wsReady: typeof wsReady !== "undefined" ? wsReady : null, wsServerEnabled: typeof WS_SERVER_ENABLED !== "undefined" ? WS_SERVER_ENABLED : null, temReconnectTimer: typeof wsReconnectTimer !== "undefined" ? !!wsReconnectTimer : null, wsUrl: typeof WS_URL !== "undefined" ? WS_URL : null });
});
app.get("/sonda.js", (req, res) => {
  try { const fs = require("fs"); res.type("application/javascript").send(fs.readFileSync(__dirname + "/captura-completa.js", "utf8")); }
  catch (e) { res.status(500).send("// erro: " + e.message); }
});
app.get("/sonda2.js", (req, res) => {
  try {
    const fs = require("fs");
    res.type("application/javascript").send(fs.readFileSync(__dirname + "/captura-bet365.js", "utf8"));
  } catch (e) { res.status(500).send("// erro: " + e.message); }
});

app.get("/api/sonda2", (req, res) => {
  const porLiga = {}; for (const l of Object.keys(rapidos)) porLiga[l] = Object.keys(rapidos[l]).length;
  const out = { ...sonda2Stats, overlayAtivo: porLiga };
  if (req.query.debug) {
    out.amostrasRecebidas = sonda2Amostras.slice(-15);
    out.upcomingPorLiga = {};
    for (const l of Object.keys(store)) out.upcomingPorLiga[l] = ((store[l] || {}).upcomingRaw || []).slice(0, 4).map(u => u.casa + " x " + u.fora);
  }
  res.json(out);
});

// ===== MEMORIA PERSISTENTE DE JOGOS: a linha dos 100 jogos sobrevive a deploy/restart =====
const JOGOS_FILE = "jogos.json";
let jogosSha = null;
let jogosSemente = {}; // liga -> gamesAll persistido (semeado no 1o snapshot pos-boot)
let jogosDirty = false;
async function salvaJogos() {
  if (!GH_T) { if (!salvaJogos.avisou) { salvaJogos.avisou = true; console.log("[github] GH_TOKEN ausente: jogos nao sao salvos fora do servidor"); } return; }
  if (!jogosDirty) return;
  jogosDirty = false;
  try {
    const dump = {};
    for (const l of Object.keys(store)) { const ga = (store[l] || {}).gamesAll; if (ga && ga.length) dump[l] = ga.slice(-800); }
    if (!Object.keys(dump).length) return;
    const body = { message: "jogos", content: Buffer.from(JSON.stringify(dump)).toString("base64"), branch: GH_BRANCH };
    if (jogosSha) body.sha = jogosSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${JOGOS_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) console.warn("[github] falha ao salvar jogos: HTTP " + r.status + " " + (await r.clone().text().catch(() => "")).slice(0, 160));
    if (r.ok) { const j = await r.json(); jogosSha = j.content.sha; if (!salvaJogos.ok) console.log("[github] jogos salvos no branch " + GH_BRANCH); salvaJogos.ok = true; }
    else if (r.status === 409 || r.status === 422) { // sha defasado: rebusca
      const g = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${JOGOS_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
      if (g.ok) { const j2 = await g.json(); jogosSha = j2.sha; }
    }
  } catch (e) {}
}
async function carregaJogos() {
  if (!GH_T) return;
  try {
    const url = `https://api.github.com/repos/${GH_REPO}/contents/${JOGOS_FILE}?ref=${GH_BRANCH}`;
    const meta = await fetch(url, { headers: ghHead() });
    if (meta.ok) { try { jogosSha = (await meta.json()).sha; } catch (e) {} }
    // arquivo passa de 1 MB: o conteudo vem pelo formato "raw"
    const r = await fetch(url, { headers: { ...ghHead(), Accept: "application/vnd.github.raw" } });
    if (r.ok) {
      const dados = JSON.parse(await r.text());
      if (dados && typeof dados === "object") {
        jogosSemente = dados;
        // O dashboard classico consulta /api/grade assim que abre. Antes, o
        // historico persistido ficava parado em jogosSemente ate a extensao
        // enviar o primeiro snapshot depois de cada deploy; nesse intervalo a
        // grade, o grafico e o backtest apareciam vazios. Hidratamos o store
        // imediatamente e ainda preservamos a semente para a emenda do proximo
        // snapshot ao vivo.
        for (const [liga, gamesSalvos] of Object.entries(dados)) {
          if (!LIGAS_PERMITIDAS.has(liga)) continue;
          if (!Array.isArray(gamesSalvos) || !gamesSalvos.length) continue;
          const atual = store[liga] || {};
          const chave = g => String(g.id || `${g.horario || ""}|${g.casa || ""}|${g.fora || ""}`);
          const mapa = new Map(gamesSalvos.filter(g => g && g.inicio).map(g => [chave(g), g]));
          for (const g of (atual.gamesAll || [])) if (g && g.inicio) mapa.set(chave(g), g);
          const tIni = g => { const t = Date.parse(g.inicio || ""); return Number.isFinite(t) ? t : 0; };
          const todos = [...mapa.values()].sort((x, y) => tIni(x) - tIni(y)).slice(-1200);
          if (!todos.length) continue;
          const st = buildStore(liga, todos, atual.upcomingRaw || [], new Date().toISOString());
          st.gamesAll = todos;
          st.fonte = "memoria";
          store[liga] = st;
          registraLiga(liga);
          atualizaRadar(liga, st);
        }
        console.log("memoria de jogos carregada:", Object.keys(dados).map(l => l + ":" + dados[l].length).join(" "));
      }
    }
  } catch (e) {}
}
carregaJogos();
// ===== MEMORIA PERSISTENTE (Render Key Value / Redis) =====
// Guarda historico de jogos e codigos de acesso fora do processo: um deploy ou
// reinicio nao apaga mais a grade nem o backtest.
let kv = null, kvOk = false;
async function kvConecta() {
  if (!process.env.REDIS_URL) { console.log("[memoria] REDIS_URL ausente: sem persistencia"); return; }
  try {
    const { createClient } = await import("redis");
    kv = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: n => Math.min(n * 500, 5000) } });
    kv.on("error", e => { if (kvOk) console.warn("[memoria] erro:", e.message); kvOk = false; });
    kv.on("ready", () => { kvOk = true; });
    await kv.connect();
    kvOk = true;
    await kvCarrega();
  } catch (e) { console.warn("[memoria] falha ao conectar:", e.message); }
}
async function kvCarrega(ler = k => kv.get(k), origem = "redis") {
  let total = 0;
  for (const liga of LIGAS_PERMITIDAS) {
    try {
      const bruto = await ler("amd:jogos:" + liga);
      if (!bruto) continue;
      let salvos = JSON.parse(bruto);
      if (!Array.isArray(salvos) || !salvos.length) continue;
      if (LIGAS_INSPIRED.has(liga)) salvos = salvos.slice(-480);
      // Jogos sem data real nao tem dia confiavel (vinham de coletores antigos).
      if (fonteDiretaAtiva(liga)) salvos = salvos.filter(g => g && g.inicio);
      if (!salvos.length) continue;
      const atual = store[liga] || {};
      const chave = g => String(g.id || `${g.horario || ""}|${g.casa || ""}|${g.fora || ""}`);
      const mapa = new Map(salvos.map(g => [chave(g), g]));
      for (const g of (Array.isArray(atual.gamesAll) ? atual.gamesAll : [])) if (!fonteDiretaAtiva(liga) || g.inicio) mapa.set(chave(g), g);
      const tIni = g => { const t = Date.parse(g.inicio || ""); return Number.isFinite(t) ? t : 0; };
      const gamesAll = [...mapa.values()].sort((x, y) => tIni(x) - tIni(y)).slice(-2000);
      const st = buildStore(liga, gamesAll, atual.upcomingRaw || [], new Date().toISOString());
      st.gamesAll = gamesAll;
      st.fonte = atual.fonte || "memoria";
      if (atual.vavadaTs) st.vavadaTs = atual.vavadaTs;
      store[liga] = st;
      registraLiga(liga);
      atualizaRadar(liga, st);
      total += salvos.length;
    } catch (e) { console.warn("[memoria] liga", liga, e.message); }
  }
  try {
    const pz = await ler("amd:push");
    if (pz) {
      const d = JSON.parse(pz);
      if (d && d.vapid && d.vapid.publicKey) {
        pushData.vapid = d.vapid;
        const conhecidos = new Set(pushData.subs.map(x => x.endpoint));
        pushData.subs = (d.subs || []).filter(x => !conhecidos.has(x.endpoint)).concat(pushData.subs).slice(-50);
        if (webpush) try { webpush.setVapidDetails("mailto:amd@live.local", pushData.vapid.publicKey, pushData.vapid.privateKey); } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    const c = await ler("amd:codigos");
    if (c) { const salvos = JSON.parse(c); for (const [k, v] of Object.entries(salvos)) if (!codigos[k]) codigos[k] = v; }
    const r = await ler("amd:revogados");
    if (r) for (const k of JSON.parse(r)) revogados.add(k);
  } catch (e) {}
  console.log(`[memoria] carregada (${origem}): ${total} jogos, ${Object.keys(codigos).length} codigos`);
}
async function kvSalva() {
  if (!kv || !kvOk) return;
  try {
    for (const liga of LIGAS_PERMITIDAS) {
      const ga = (store[liga] || {}).gamesAll;
      if (Array.isArray(ga) && ga.length) await kv.set("amd:jogos:" + liga, JSON.stringify(ga.slice(-2000)));
    }
    await kv.set("amd:codigos", JSON.stringify(codigos));
    await kv.set("amd:revogados", JSON.stringify([...revogados]));
    if (pushData && pushData.vapid) await kv.set("amd:push", JSON.stringify(pushData));
  } catch (e) { console.warn("[memoria] falha ao salvar:", e.message); }
}
// Copia em arquivo local: sobrevive quando o Render reinicia o processo no
// mesmo container (queda por health check), mesmo sem o Redis.
const ARQ_MEMORIA = process.env.DADOS_ARQUIVO || join(__dirname, ".memoria-amd.json");
function arquivoMonta() {
  const d = {};
  for (const liga of LIGAS_PERMITIDAS) {
    const ga = (store[liga] || {}).gamesAll;
    if (Array.isArray(ga) && ga.length) d["amd:jogos:" + liga] = JSON.stringify(ga.slice(-2000));
  }
  d["amd:codigos"] = JSON.stringify(codigos);
  d["amd:revogados"] = JSON.stringify([...revogados]);
  if (pushData && pushData.vapid) d["amd:push"] = JSON.stringify(pushData);
  d.salvoEm = Date.now();
  return d;
}
function arquivoSalva(sync) {
  try {
    const fs = require("fs"), tmp = ARQ_MEMORIA + ".tmp", txt = JSON.stringify(arquivoMonta());
    if (sync) { fs.writeFileSync(tmp, txt); fs.renameSync(tmp, ARQ_MEMORIA); return; }
    fs.promises.writeFile(tmp, txt).then(() => fs.promises.rename(tmp, ARQ_MEMORIA)).catch(() => {});
  } catch (e) {}
}
async function arquivoCarrega() {
  try {
    const fs = require("fs");
    if (!fs.existsSync(ARQ_MEMORIA)) return;
    const d = JSON.parse(fs.readFileSync(ARQ_MEMORIA, "utf8"));
    if (!d || Date.now() - Number(d.salvoEm || 0) > 48 * 3600000) return;
    await kvCarrega(async k => d[k] || null, "arquivo");
  } catch (e) { console.warn("[memoria] arquivo local ilegivel:", e.message); }
}
arquivoCarrega().finally(() => kvConecta());
setInterval(kvSalva, 60000);
setInterval(() => arquivoSalva(false), 5 * 60000);
for (const sinal of ["SIGTERM", "SIGINT"]) process.once(sinal, async () => { arquivoSalva(true); try { await kvSalva(); } catch (e) {} process.exit(0); });
setInterval(salvaJogos, 3 * 60000); // salva a cada 3min (se mudou)
setTimeout(salvaJogos, 60000);

app.post("/api/snapshot", (req, res) => {
  try {
    const { data, mkt, curva, mm1, mm2, topo, fundo } = req.body || {};
    let liga = ligaRecebida(req.body || {});
    if (!liga || !data || !Array.isArray(data.cells)) {
      return res.status(400).json({ ok: false, erro: "snapshot invalido" });
    }
    if (!LIGAS_PERMITIDAS.has(liga)) {
      return res.status(422).json({ ok: false, erro: "liga desativada", liga });
    }
    if (fonteDiretaAtiva(liga)) { registraRecusa("/api/snapshot", liga, req); return res.json({ ok: true, ignorado: "fonte-direta-vavada-ativa" }); }
    ultimoSnapshotCru[liga] = { cells: (data && data.cells) ? data.cells.length : 0, temData: !!data, hora: new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }), amostraCell: (data && data.cells && data.cells[0]) ? JSON.stringify(data.cells[0]).slice(0, 200) : null };
    let { games, upcoming, gamesAll } = decodeSnapshot(data);
    liga = ligaPeloConteudo(liga, games, upcoming);
    if (!games.length) return res.status(400).json({ ok: false, erro: "zero jogos no snapshot", cellsRecebidas: (data && data.cells) ? data.cells.length : 0 });
    // semeadura pos-boot: emenda a memoria persistida ANTES do quadro novo (dedupe horario|casa)
    try {
      if (jogosSemente[liga] && jogosSemente[liga].length) {
        const chavesNovas = new Set(gamesAll.map(g => g.horario + "|" + g.casa));
        const antigos = jogosSemente[liga].filter(g => !chavesNovas.has(g.horario + "|" + g.casa));
        if (antigos.length) {
          gamesAll = antigos.concat(gamesAll);
          const chavesG = new Set(games.map(g => g.horario + "|" + g.casa));
          games = antigos.filter(g => !chavesG.has(g.horario + "|" + g.casa)).concat(games);
        }
        delete jogosSemente[liga];
        console.log(`liga ${liga}: memoria emendada (+${antigos.length} jogos persistidos)`);
      }
    } catch (e) {}
    jogosDirty = true;
    registraUpVistos(liga, upcoming); // memoria dos futuros p/ casamento da sonda 2
    if (!ligaBateComConteudo(liga, games)) {
      snapshotsRejeitados[liga] = (snapshotsRejeitados[liga] || 0) + 1;
      return res.status(422).json({ ok: false, erro: "conteudo nao bate com a liga (rotulo trocado) - snapshot rejeitado", liga });
    }
    const s = buildStore(liga, games, upcoming, new Date(data.atualizadoEm || Date.now()).toISOString());
    s.gamesAll = gamesAll; // ressuscitado: a linha SEM drop (hoje = games, mantido por clareza/futuro)
    s.fonte = "ws";
    s.wsTs = Date.now();
    if (Array.isArray(curva)) liveCurves[liga + "|" + (mkt || "o35")] = { curva, mm1, mm2, topo, fundo, ts: Date.now() };
    store[liga] = s;
    atualizaRadar(liga, s);
    atualizaRoboLedger();
    avisaClientes(liga); // SSE: avisa as telas abertas que essa liga atualizou (nao altera analises)
    res.json({ ok: true, liga, placares: games.length, futuros: upcoming.length, mercados: Object.keys(s.computed) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Recebe dados ao vivo enviados pelo navegador/Tampermonkey.
// O endpoint novo e explicito; /api/dados continua como alias compativel com
// coletores antigos. Nenhum dos dois reativa a fonte BBTips do servidor.
let lastDebug = {};
// Quando a coleta direta da Vavada esta ativa, ela e a unica fonte das seis
// ligas. Envios externos (scripts antigos no navegador) chegavam sem data e
// com posicao fixa de grade, substituindo os dados corretos.
function fonteDiretaAtiva(liga) {
  // Com a coleta direta ligada, ela e a UNICA fonte das seis ligas: o antigo
  // teste por "ultimo envio recente" deixava passar envios externos logo apos
  // cada reinicio, e eles traziam jogos de outros dias sem data.
  return LIGAS_PERMITIDAS.has(String(liga || "")) && process.env.VAVADA_ENABLED !== "0";
}
const recusasExternas = {};
function registraRecusa(rota, liga, req) {
  const k = rota + "|" + liga; const agora = Date.now();
  if (agora - (recusasExternas[k] || 0) < 60000) return;
  recusasExternas[k] = agora;
  console.log(`[fonte-externa] recusado ${rota} liga=${liga} origem=${req.get("origin") || req.get("referer") || "-"} ua=${String(req.get("user-agent") || "").slice(0, 60)}`);
}
function recebeDadosTampermonkey(req, res) {
  try {
    const tokenEsperado = String(process.env.TAMPERMONKEY_TOKEN || "").trim();
    const tokenRecebido = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    // Sem token configurado, envios externos ficam fechados: a coleta e feita pelo proprio servidor.
    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
      return res.status(401).json({ ok: false, erro: "token-tampermonkey-invalido" });
    }
    const { mkt, placares, upcoming, curva, mm1, mm2, topo, fundo, debug } = req.body || {};
    let liga = ligaRecebida(req.body || {});
    const placaresLista = Array.isArray(placares) ? placares : [];
    const futurosLista = Array.isArray(upcoming) ? upcoming : [];
    if (debug) lastDebug[liga || "?"] = { debug, ts: Date.now() };
    if (liga && fonteDiretaAtiva(codigoLiga(liga) || liga)) {
      registraRecusa(req.path, liga, req);
      return res.json({ ok: true, ignorado: "fonte-direta-vavada-ativa" });
    }
    /* Uma liga pode abrir o ciclo apenas com partidas futuras. Rejeitar esse
       lote deixava a BRA vazia ate sair o primeiro FT. */
    if (!liga || (!placaresLista.length && !futurosLista.length)) {
      return res.status(400).json({ ok: false, erro: "sem jogos" });
    }
    if (!LIGAS_PERMITIDAS.has(liga)) {
      return res.status(422).json({ ok: false, erro: "liga desativada", liga });
    }
    // A sonda ja conhece a casa exata da grade. Preserve essas coordenadas;
    // recalcular a coluna pela ordem do array deslocava, por exemplo, a 48 para a 26.
    const coord = p => ({
      linha_visual: p.linha_visual ?? p.linha ?? p.row ?? null,
      coluna_visual: p.coluna_visual ?? p.coluna ?? p.col ?? p.column ?? null
    });
    const horarioFonte = p => {
      // Alguns coletores mandam `hora: 20` e `horario: "20:17"`.
      // A grade precisa sempre do relógio completo; priorizar só `hora`
      // apagava os minutos e deslocava a linha inteira.
      const completo = String(p && p.horario || "");
      return /\d{1,2}:\d{2}/.test(completo) ? completo : (p && (p.hora || p.horario) || "");
    };
    const games = placaresLista.map((p, i) => ({
      nome: p.nome || "Jogo " + (i + 1), a: p.a, b: p.b, total: p.total, odds: p.odds || {}, hora: p.hora || null, horario: horarioFonte(p), inicio: p.inicio || null,
      casa: p.casa || (p.nome && p.nome.includes(" x ") ? p.nome.split(" x ")[0].trim() : null),
      fora: p.fora || (p.nome && p.nome.includes(" x ") ? (p.nome.split(" x ")[1] || "").trim() : null),
      ...coord(p)
    }));
    // jogos futuros vindos da sonda (teams + odds lidos da grade)
    const upc = futurosLista.filter(u => u && u.nome)
      .map(u => ({ ...u, horario: horarioFonte(u), ...coord(u) }));
    liga = ligaPeloConteudo(liga, games, upc);
    // Placares da Vavada chegam com id estavel (vavada:liga:evento). Funde com o
    // historico ja acumulado pela coleta do servidor em vez de substitui-lo.
    let gamesFinal = games;
    if (placaresLista.some(p => String(p.id || "").startsWith("vavada:"))) {
      placaresLista.forEach((p, i) => { if (p.id) games[i].id = p.id; });
      const ant = store[liga] || {};
      const hist = Array.isArray(ant.gamesAll) ? ant.gamesAll : (ant.games || []);
      const chave = g => String(g.id || `${g.horario || ""}|${g.casa || ""}|${g.fora || ""}`);
      const mapa = new Map(hist.map(g => [chave(g), g]));
      for (const g of games) mapa.set(chave(g), g);
      gamesFinal = [...mapa.values()].slice(-1200);
    }
    const s = buildStore(liga, gamesFinal, upc, new Date().toISOString());
    s.gamesAll = gamesFinal;
    // Diagnostico leve do contrato da extensao. Nao muda coleta nem calculos;
    // permite confirmar quais campos de posicao ela esta enviando.
    s.gradeMeta = {
      campos: Object.keys(placaresLista[0] || futurosLista[0] || {}).sort(),
      amostraPosicao: placaresLista.concat(futurosLista).slice(0, 3).map(p => ({
        linha_visual: p.linha_visual ?? p.linha ?? p.row ?? null,
        coluna_visual: p.coluna_visual ?? p.coluna ?? p.col ?? p.column ?? null
      }))
    };
    s.fonte = req.path === "/api/tampermonkey" ? "tampermonkey" : "sonda";
    s.sondaTs = Date.now();
    if (Array.isArray(curva)) {
      liveCurves[liga + "|" + (mkt || "o35")] = { curva, mm1, mm2, topo, fundo, ts: Date.now() };
    }
    store[liga] = s;
    registraLiga(liga);
    atualizaRadar(liga, s);
    atualizaRoboLedger();
    avisaClientes(liga);
    res.json({ ok: true, placares: placaresLista.length, upcoming: upc.length, mercados: Object.keys(s.computed) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
}

app.post("/api/tampermonkey", recebeDadosTampermonkey);
app.post("/api/dados", recebeDadosTampermonkey);

// le o que a sonda achou na tela (pra debug remoto, ja que a aba trava pra automacao)
app.get("/api/debug/:liga", (req, res) => {
  res.json(lastDebug[req.params.liga] || { vazio: true });
});

app.post("/api/curve", (req, res) => {
  try {
    const { liga, mkt, curva, mm1, mm2, topo, fundo, labels, markerColors } = req.body || {};
    if (!liga || !mkt || !Array.isArray(curva)) return res.status(400).json({ ok: false, erro: "dados invalidos" });
    liveCurves[liga + "|" + mkt] = { curva, mm1, mm2, topo, fundo, labels, markerColors, ts: Date.now() };
    res.json({ ok: true, pontos: curva.length });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ===== PAGAMENTO ACUMULADO DO DIA =====
// Zera na virada do relógio do jogo e mostra a taxa real desde o primeiro jogo:
// GREEN aumenta a porcentagem; RED diminui a porcentagem.
function acumuladoDia(liga, mkt, qtd) {
  const d = store[liga]; if (!d) return null;
  const games = listaCheia(d);
  if (games.length < 2) return null;
  // corte na virada do dia pelo RELOGIO DO JOGO (queda de hora), nao pelo nosso horario
  let idxDia = 0;
  for (let i = 1; i < games.length; i++) {
    const h1 = parseInt((games[i].horario || "").split(":")[0]);
    const h0 = parseInt((games[i - 1].horario || "").split(":")[0]);
    if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idxDia = i;
  }
  const dia = games.slice(idxDia);
  const JAN = Math.max(2, parseInt(qtd) || 20);
  // Taxa de pagamento acumulada: GREEN sobe e RED desce. A precisão interna
  // evita patamares falsos criados apenas pelo arredondamento da porcentagem.
  let greens = 0;
  const serieDia = [], horasDia = [];
  for (let k = 0; k < dia.length; k++) {
    if (pays(dia[k], mkt)) greens++;
    // Jeffreys (0,5 GREEN / 0,5 RED) evita 0%/100% travados na abertura.
    // Depois de cada jogo, GREEN sempre sobe e RED sempre desce.
    serieDia.push(Math.round(((greens + 0.5) / (k + 2)) * 100000) / 1000);
    horasDia.push(dia[k].horario || "");
  }
  const monta = n => {
    const ini = Math.max(0, serieDia.length - n);
    const serie = serieDia.slice(ini), hrs = horasDia.slice(ini);
    if (serie.length < 2) return null;
    return {
      serie,
      horas: hrs,
      macd: serie.length > 3 ? (macdData(serie).hist || []) : [],
      pctAtual: Math.round((greens / dia.length) * 1000) / 10,
      jogos: serie.length
    };
  };
  const JOGOS_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  for (const h of [3, 6, 12, 18, 24]) {
    const n = h * JOGOS_HORA;
    const f = monta(n); // apenas recorta a mesma curva; não reinicia o pagamento
    if (f) faixasAcum["h" + h] = f;
  }
  const fDia = monta(dia.length);
  if (fDia) faixasAcum.dia = fDia;
  if (!Object.keys(faixasAcum).length) return null;
  const base = Math.round(dia.filter(g => pays(g, mkt)).length / dia.length * 1000) / 10;
  return { faixas: faixasAcum, janela: JAN, jogos: dia.length, desde: (dia[0] || {}).horario || "", base };
}

app.get("/api/liga/:liga", (req, res) => {
  const liga = req.params.liga;
  if (!LIGAS.includes(liga) && !store[liga]) return res.status(404).json({ erro: "liga invalida" });
  const d = store[liga];
  if (!d || d.erro) return res.json({ erro: (d && d.erro) || "carregando...", liga });
  const mkt = req.query.mkt || "o35";
  const qtd = Math.min(240, Math.max(20, parseInt(req.query.qtd) || 20));

  // analise base (pre-calculada com qtd=20)
  let analise = d.computed[mkt] || d.computed.o35;
  // se o usuario pediu outra Qtd. Jogos, recalcula a serie/sinal/macd/alertas pra essa janela
  if (qtd !== 20 && d.games) {
    // CORRIGIDO (bug apontado pelo usuario): antes a JANELA travava em 20 e o seletor so dava
    // ZOOM - por isso o grafico de 100 era identico ao de 20 (mesma linha, mais pontos).
    // Agora "Qtd. Jogos" e o PERIODO REAL da media movel, como MM20 x MM100 no trader:
    // janela maior = curva mais lenta e suave, com atraso maior. Matematica diferente de verdade.
    const JANELA = Math.max(2, Math.min(qtd, Math.floor(d.games.length / 2)));
    const serieFull = chartSeries(d.games, mkt, JANELA);
    const serie = serieFull.slice(-Math.min(120, serieFull.length)); // janela de exibicao fixa
    const sinal = zoneSignal(serie);
    const { hist } = macdData(serie);
    const alertas = buildAlerts(d.games, serie, sinal, mkt, analise.base);
    analise = { ...analise, serie, macdHist: hist.slice(-serie.length), sinal, alertas, qtdJogos: qtd, janelaMM: JANELA };
  }

  // se a extensao mandou a curva REAL do caramelo, usa ela (identica)
  const curveKey = liga + "|" + mkt;
  const live = liveCurves[curveKey];
  // A curva REAL vem pronta da fonte com o periodo DELA - da para dar zoom, mas nao da para
  // mudar a janela. Entao ela vale so no padrao (20). Se o usuario escolher outra Qtd. Jogos,
  // usamos a serie calculada aqui, que tem a media movel de verdade (MM40, MM100...).
  const curvaReal = (qtd === 20) && live && (Date.now() - live.ts < 120000) ? live : null;
  if (curvaReal) {
    const serie = curvaReal.curva.slice(-qtd);
    const sinal = zoneSignal(serie);
    // histograma vem do MM1-MM2 real do caramelo, se veio
    let macdHist = [];
    if (Array.isArray(curvaReal.mm1) && Array.isArray(curvaReal.mm2)) {
      macdHist = curvaReal.mm1.map((v, i) => +((v - (curvaReal.mm2[i] ?? v))).toFixed(2));
    } else {
      macdHist = macdData(serie).hist;
    }
    const alertas = buildAlerts(d.games || [], serie, sinal, mkt, analise.base);
    analise = { ...analise, serie, macdHist: macdHist.slice(-qtd), sinal, alertas, qtdJogos: qtd, curvaReal: true, topo: curvaReal.topo, fundo: curvaReal.fundo };
  }

  // LINHAS DE TENDENCIA (LTA/LTB) + gatilho de rompimento, sobre a serie atual
  // pagando em TEMPO REAL (sem o atraso de 2 jogos): o selo/zona operam com este;
  // o grafico continua com drop-2, fiel ao caramelo
  try {
    const gAllTR = listaCheia(d);
    if (gAllTR.length >= 2 && !analise.ehTotalGols) {
      const sfTR = chartSeries(gAllTR, mkt, Math.max(2, Math.min(20, gAllTR.length)));
      if (sfTR.length) analise.pagandoTempoReal = sfTR[sfTR.length - 1];
    }
  } catch (e) {}
  const tend = trendLines(analise.serie || []);
  analise = { ...analise, trend: tend };
  // horarios dos jogos por tras de cada ponto da serie (eixo do tempo no grafico)
  try {
    const Lh = (analise.serie || []).length;
    analise.serieHoras = (d.games || []).slice(-Lh).map(g => g.horario || "");
  } catch (e) {}
  const _gM = listaCheia(d);
  const _trioOdds = o => ({ ambs: o && o.ambs != null ? o.ambs : null, o25: o && o.o25 != null ? o.o25 : null, o35: o && o.o35 != null ? o.o35 : null });
  const mosaico = {
    passados: _gM.slice(-66).map(g => ({ h: g.horario || "", casa: g.casa, fora: g.fora, placar: g.a + "-" + g.b, total: g.total, odds: _trioOdds(g.odds) })),
    futuros: (d.upcomingRaw || []).map(u => ({ h: u.horario || "", casa: u.casa, fora: u.fora, odds: _trioOdds(u.odds) }))
  };
  const maximas = {};
  for (const _mm of ["o25", "o35", "ambas", "ge5"]) maximas[_mm] = maximasReds(_gM, _mm);

  // se os dados vieram da SONDA (placares reais ao vivo), a curva calculada e EXATA
  // pra qualquer mercado — marca como real mesmo sem curva capturada desse mercado
  const fonteSonda = d.fonte === "sonda" || d.fonte === "ws";
  const ehReal = !!curvaReal || fonteSonda;

  // anexa a ancora (placares-gatilho) a cada proximo jogo, pelo nome. ADITIVO.
  const ancoras = d.ancoras || {};
  // === RANK ===
  // combo = score + EV (criterio escolhido). Indexa cada mercado por nome de jogo.
  const MKTS_RANK = ["o25", "o35", "ge5", "ambas"];
  const comboDe = e => e && e.score != null ? Math.round((e.score || 0) + (e.ev || 0)) : null;
  const upByMkt = {};
  for (const m of MKTS_RANK) {
    upByMkt[m] = {};
    for (const e of (d.upcoming && d.upcoming[m]) || []) upByMkt[m][e.nome] = e;
  }
  // posicao REAL de cada time no rank do mercado escolhido (ULTIMAS 3 HORAS ~60 jogos,
  // ranking completo - retrato do agora, a pedido do usuario; minimo 2 jogos por time)
  let posTimes = null, posTotal = 0;
  if (mkt !== "totft") {
    try {
      const rkFull = teamRanking(d.games || [], mkt, 60, 2, 999);
      posTimes = {}; posTotal = rkFull.length;
      rkFull.forEach((t, i) => posTimes[t.time] = i + 1);
    } catch (e) {}
  }
  // Expõe na grade os cálculos que já existem: rank atual dos times e
  // acerto da coluna/minuto para o mercado selecionado. Não recalcula sinal.
  if (mkt !== "totft") {
    for (const g of [...mosaico.passados, ...mosaico.futuros]) {
      g.posCasa = posTimes ? (posTimes[g.casa] || null) : null;
      g.posFora = posTimes ? (posTimes[g.fora] || null) : null;
      g.posTotal = posTotal;
      g.coluna = colunaPct(_gM, g.h, mkt);
    }
  }

  const proximos = ((d.upcoming && d.upcoming[mkt]) || []).map(p => {
    const anc = ancoras[p.nome];
    const base = anc ? { ...p, ancora: anc } : { ...p };
    base.placarProvavel = placarProvavel(d.games || [], p.casa, p.fora, p.nome);
    if (mkt !== "totft") base.coluna = colunaPct(listaCheia(d), p.horario, mkt);
    if (mkt !== "totft" && posTimes) { base.posCasa = posTimes[p.casa] || null; base.posFora = posTimes[p.fora] || null; base.posTotal = posTotal; }
    if (mkt !== "totft") {
      base.combo = comboDe(p);
      // rank dos MERCADOS pra ESSE jogo (qual mercado paga melhor nele)
      base.rankMercados = MKTS_RANK
        .map(m => { const e = upByMkt[m][p.nome]; return e ? { mkt: m, combo: comboDe(e), score: e.score, ev: e.ev } : null; })
        .filter(x => x && x.combo != null)
        .sort((a, b) => b.combo - a.combo);
    }
    return base;
  });
  // rank dos JOGOS no mercado aberto (melhor -> pior por combo)
  if (mkt !== "totft") {
    const ord = proximos.filter(p => p.combo != null).sort((a, b) => b.combo - a.combo);
    ord.forEach((p, i) => { p.rankJogo = i + 1; p.rankTotal = ord.length; });
  }

  // RANK DE TIMES por janela de tempo (3h/6h/12h/24h) p/ o mercado aberto + Over 2.5 + Ambas
  const mktsRankTimes = [...new Set([mkt === "totft" ? "o25" : mkt, "o25", "ambas"])];
  const rankTimes = {};
  for (const m of mktsRankTimes) rankTimes[m] = rankTimesPorJanela(d.games || [], m);

  res.json({
    liga,
    mercado: mkt,
    qtd,
    lastUpdated: d.lastUpdated,
    fetchedAt: d.fetchedAt,
    analise,
    maximas,
    mosaico,
    proximos,
    rankTimes,
    ultimos: d.ultimos,
    acum: acumuladoDia(liga, mkt, qtd),
    curvaReal: ehReal,
    fonte: d.fonte || "json"
  });
});

app.post("/api/bbtips/token", async (req, res) => {
  const t = limpaToken((req.body && req.body.token) || "");
  if (!t || t.length < 40) return res.status(400).json({ ok: false, erro: "token invalido" });
  // A rota e aberta (o userscript manda de fora): so aceita token que o BBTips aceita.
  if (t !== BB_TOKEN && inspiredBB && !(await inspiredBB.tokenFunciona(t))) {
    return res.status(401).json({ ok: false, erro: "token recusado pelo BBTips" });
  }
  const novo = t !== BB_TOKEN; BB_TOKEN = t;
  if (inspiredBB) inspiredBB.definirToken(t);
  if (!BBTIPS_ENABLED) return res.json({ ok: true, novo, inspired: true });
  res.json({ ok: true, novo });
  // O JWT pode ter sido renovado pela sessao mantendo o mesmo valor visivel
  // no armazenamento do navegador. Se a ultima tentativa falhou por token ou
  // ja esta velha, um novo ping do userscript deve tentar imediatamente.
  if (novo || bbUltima.erro === "token" || Date.now() - Number(bbUltima.ts || 0) > BB_INTERVALO) {
    rodaAutoColeta();
  }
});

app.get("/api/bbtips/estado", (req, res) => res.json({ ativo: BBTIPS_ENABLED, temToken: !!BB_TOKEN, tamToken: BB_TOKEN.length, fim: BB_TOKEN.slice(-4), ...bbUltima }));

// A coleta do servidor e o backup da extensao. As ligas sao consultadas em
// paralelo e sem cache, entao cinco segundos mantem o resultado proximo da casa.
const BB_INTERVALO = Number(process.env.BBTIPS_INTERVALO || 5000);

async function rodaAutoColeta() {
  if (!BBTIPS_ENABLED || !bbtipsAuto || !BB_TOKEN || bbUltima.rodando) return;
  bbUltima.rodando = true;
  try {
    const r = await bbtipsAuto.coletaTudo(BB_TOKEN, async (liga, placares, upcoming) => {
      const games = placares.map((p, i) => ({
        nome: p.nome || "Jogo " + (i + 1), a: p.a, b: p.b, total: p.total,
        odds: p.odds || {}, hora: p.hora || null, horario: p.hora || p.horario || "",
        casa: p.nome && p.nome.includes(" x ") ? p.nome.split(" x ")[0].trim() : null,
        fora: p.nome && p.nome.includes(" x ") ? (p.nome.split(" x ")[1] || "").trim() : null
      }));
      const st = buildStore(liga, games, upcoming || [], new Date().toISOString());
      st.sondaTs = Date.now();
      store[liga] = st; registraLiga(liga); atualizaRadar(liga, st); avisaClientes(liga);
    }, console.log);
    try { atualizaRoboLedger(); } catch (e) {}
    bbUltima = {
      ts: Date.now(), ligas: r.ligas || 0, nomes: r.nomes || 0, porCasa: r.porCasa || {},
      erro: r.ok ? null : r.erro, rodando: false
    };
  } catch (e) {
    bbUltima = { ts: Date.now(), ligas: 0, nomes: 0, porCasa: {}, erro: String(e.message || e), rodando: false };
  }
}

setInterval(rodaAutoColeta, BB_INTERVALO);
setTimeout(rodaAutoColeta, 4000);

// ===== FONTE DIRETA VAVADA / KIRON =====
// Mantém o histórico já existente e acrescenta somente eventos novos. Assim a
// fonte direta reduz o atraso sem apagar a memória nem alterar a matemática.
function iniciaVavadaKiron() {
  if (!vavadaKiron || process.env.VAVADA_ENABLED === "0") return;
  const aoReceber = async (liga, novos, futuros, opc = {}) => {
    if (!LIGAS_PERMITIDAS.has(liga) || LIGAS_INSPIRED.has(liga)) return;
    const anterior = store[liga] || {};
    const historico = Array.isArray(anterior.gamesAll) ? anterior.gamesAll : (anterior.games || []);
    const mapa = new Map();
    const chave = g => String(g.id || `${g.horario || ""}|${g.casa || ""}|${g.fora || ""}`);
    for (const g of historico) if (g && g.inicio) mapa.set(chave(g), g);
    let mudou = 0;
    for (const g of novos || []) {
      const k = chave(g), velho = mapa.get(k);
      if (!velho || velho.placar !== g.placar) mudou++;
      mapa.set(k, g);
    }
    // Não substitui futuros bons por uma resposta temporariamente vazia.
    const upcoming = (futuros && futuros.length) ? futuros : (anterior.upcomingRaw || []);
    // Nada novo (o coletor roda a cada 8s): nao reconstroi a liga nem faz
    // todos os clientes baixarem a grade de novo. Era isso que travava a CPU.
    const assinaturaUp = upcoming.map(u => (u.id || u.inicio || u.horario || "") + ":" + JSON.stringify((u.odds && u.odds.o25) || "")).join("|");
    if (!mudou && anterior.gamesAll && anterior.assinaturaUp === assinaturaUp) { anterior.vavadaTs = Date.now(); return; }
    const tIni = g => { const t = Date.parse(g.inicio || ""); return Number.isFinite(t) ? t : 0; };
    const gamesAll = [...mapa.values()].sort((x, y) => tIni(x) - tIni(y)).slice(-1200);
    if (!gamesAll.length && !upcoming.length) return;
    const st = buildStore(liga, gamesAll, upcoming, new Date().toISOString());
    st.gamesAll = gamesAll;
    st.fonte = "vavada-kiron";
    st.vavadaTs = Date.now();
    st.assinaturaUp = assinaturaUp;
    store[liga] = st;
    jogosDirty = true;
    registraLiga(liga);
    if (!opc.historico) { try { avaliaPushGrafico(liga); } catch (e) {} }
    registraUpVistos(liga, upcoming);
    if (!opc.historico) { atualizaRadar(liga, st); atualizaRoboLedger(); }
    avisaClientes(liga);
  };
  vavadaKiron.iniciar(aoReceber);
  // Com a memoria do GitHub carregada (>=200 jogos em cada liga) nao precisa varrer a API.
  const memoriaCheia = () => ["eng", "ita", "spa", "mnd", "bra", "lat"].every(l => ((store[l] || {}).gamesAll || []).length >= 200);
  if (process.env.VAVADA_HISTORICO !== "0" && typeof vavadaKiron.recuperarHistorico === "function")
    setTimeout(() => memoriaCheia() ? console.log("[vavada-hist] memoria do GitHub ja tem o historico: sem varredura") : vavadaKiron.recuperarHistorico(aoReceber, Number(process.env.VAVADA_HISTORICO_HORAS || 24), (liga, id) => ((store[liga] || {}).gamesAll || []).some(g => g && g.id === `vavada:${liga}:${id}`)), 20000);
}
const esperaVavada = setInterval(() => {
  if (!vavadaKiron) return;
  clearInterval(esperaVavada);
  iniciaVavadaKiron();
}, 250);

// ===== FONTE INSPIRED (CAM / COP / AME) VIA BBTIPS =====
// Fonte principal: girocerto.fun (publico). BBTips fica como reserva (userscript),
// porque o Cloudflare do BBTips barra o servidor.
let inspiredBB = null, girocerto = null;
// 480 jogos = 24h de liga de 3 em 3 min (o servidor gratuito nao aguenta recalcular 1200).
const INSPIRED_MAX = Number(process.env.INSPIRED_MAX || 480);
async function aplicaInspired(liga, novos, futuros) {
    if (!LIGAS_INSPIRED.has(liga)) return;
    const anterior = store[liga] || {};
    const historico = Array.isArray(anterior.gamesAll) ? anterior.gamesAll : (anterior.games || []);
    const chave = g => String(g.id || `${g.horario || ""}|${g.casa || ""}|${g.fora || ""}`);
    const mapa = new Map();
    for (const g of historico) if (g && g.inicio) mapa.set(chave(g), g);
    for (const g of novos || []) mapa.set(chave(g), g);
    const gamesAll = [...mapa.values()]
      .sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio))
      .slice(-INSPIRED_MAX);
    const agoraMs = Date.now();
    const upcoming = (futuros && futuros.length) ? futuros
      : (anterior.upcomingRaw || []).filter(u => !u.inicio || Date.parse(u.inicio) > agoraMs - 60000);
    if (!gamesAll.length && !upcoming.length) return;
    const st = buildStore(liga, gamesAll, upcoming, new Date().toISOString());
    st.gamesAll = gamesAll;
    st.fonte = (novos && novos[0] && novos[0].fonte) || "inspired";
    st.inspiredTs = Date.now();
    store[liga] = st;
    jogosDirty = true;
    registraLiga(liga);
    try { avaliaPushGrafico(liga); } catch (e) {}
    registraUpVistos(liga, upcoming);
    atualizaRadar(liga, st);
    atualizaRoboLedger();
    avisaClientes(liga);
}
// TipsClan = fonte principal (historico 72h + HT). Girocerto = odds dos proximos
// jogos e reserva quando a TipsClan cair ou nao estiver configurada.
let tipsclan = null;
const oddsGiro = {};
import("./tipsclan-inspired.mjs").then(m => {
  tipsclan = m;
  m.iniciar(async (liga, novos, futuros) => {
    const mapa = oddsGiro[liga] || {};
    for (const f of futuros || []) if (!(f.odds && f.odds.o25) && mapa[f.inicio]) f.odds = mapa[f.inicio];
    await aplicaInspired(liga, novos, futuros);
  });
}).catch(e => console.log("[tipsclan] modulo nao carregado:", e.message));
import("./girocerto-inspired.mjs").then(m => {
  girocerto = m;
  console.log("[girocerto] coletor Inspired carregado");
  m.iniciar(async (liga, novos, futuros) => {
    if (futuros) {
      const mapa = oddsGiro[liga] = {};
      for (const f of futuros) if (f.odds) mapa[f.inicio] = f.odds;
    }
    if (tipsclan && tipsclan.ativaLiga(liga)) return;
    await aplicaInspired(liga, novos, futuros);
  });
}).catch(e => console.log("[girocerto] modulo nao carregado:", e.message));
(process.env.INSPIRED_ENABLED === "1" ? import("./inspired-bbtips.mjs") : Promise.reject(new Error("desligado (INSPIRED_ENABLED)"))).then(m => {
  inspiredBB = m;
  m.iniciar(BB_TOKEN, aplicaInspired);
}).catch(e => console.log("[inspired] modulo nao carregado:", e.message));
// Grades CAM/COP/AME enviadas pelo navegador (userscript amd-inspired.user.js).
app.post("/api/inspired/grade", async (req, res) => {
  const esperado = String(process.env.TAMPERMONKEY_TOKEN || "").trim();
  const recebido = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!esperado || recebido !== esperado) return res.status(401).json({ ok: false, erro: "chave invalida" });
  if (!inspiredBB) return res.status(503).json({ ok: false, erro: "carregando" });
  const grades = (req.body && req.body.grades) || {};
  const ligas = {};
  for (const [liga, json] of Object.entries(grades)) {
    if (!LIGAS_INSPIRED.has(liga) || !json || !Array.isArray(json.Linhas)) continue;
    try { ligas[liga] = await inspiredBB.recebeGrade(liga, json); } catch (e) { ligas[liga] = 0; }
  }
  console.log("[inspired] navegador: " + Object.entries(ligas).map(([l, n]) => l + " " + n).join(", "));
  res.json({ ok: true, ligas });
});
app.get("/api/inspired/estado", (req, res) => {
  res.json({
    tipsclan: tipsclan ? tipsclan.obterEstado() : { erro: "módulo carregando" },
    girocerto: girocerto ? girocerto.obterEstado() : { erro: "módulo carregando" },
    bbtips: inspiredBB ? inspiredBB.obterEstado() : { erro: "módulo carregando" }
  });
});

app.get(["/api/vavada/estado", "/api/bbtips/vavada-estado"], (req, res) => {
  res.json(vavadaKiron ? vavadaKiron.obterEstado() : { ts: 0, erro: "módulo carregando", rodando: false, ligas: {} });
});

// Diagnostico executado pelo proprio Render. Serve para distinguir erro de
// configuracao de bloqueio da origem sem expor cookies, tokens ou credenciais.
app.get("/debug-vavada", async (req, res) => {
  const url = "https://sb2virtuals-altenar2.biahosted.com/api/Virtuals/GetEventList?culture=pt-PT&timezoneOffset=180&integration=vavada&deviceType=1&numFormat=en-GB&countryCode=BR&id=92&dbId=12";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": process.env.VAVADA_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
        "Origin": process.env.VAVADA_ORIGIN || "https://vavada.com",
        "Referer": process.env.VAVADA_REFERER || "https://vavada.com/"
      },
      signal: AbortSignal.timeout(10000)
    });
    const corpo = await r.text();
    res.status(200).json({
      status: r.status,
      cfRay: r.headers.get("cf-ray"),
      tipo: r.headers.get("content-type"),
      inicio: corpo.slice(0, 300)
    });
  } catch (e) {
    res.status(500).json({ erro: String(e) });
  }
});

app.get("/api/status", (req, res) => {
  res.json(LIGAS.map(l => ({
    liga: l,
    jogos: store[l]?.games?.length || 0,
    lastUpdated: store[l]?.lastUpdated || null,
    fetchedAt: store[l]?.fetchedAt || null,
    snapshotsRejeitados: snapshotsRejeitados[l] || 0,
    erro: store[l]?.erro || null
  })));
});

// Compatibilidade com o frontend classico do AMD. A extensao continua
// alimentando o store atual; esta rota apenas traduz o mesmo dado para o
// contrato antigo usado pela grade, backtest e cacadores do backup.
// Cache da grade: varias abas/clientes pedem a mesma liga a cada poucos
// segundos; so recalcula quando a liga recebe jogo novo (store[liga] troca).
const gradeCache = new Map();
let gradeCacheBytes = 0;
app.get("/api/grade", (req, res, next) => {
  const liga = String(req.query.liga || "ita").toLowerCase();
  const q = req.query || {};
  // chave sem o "_=" anti-cache dos clientes (cada pedido virava uma entrada nova e estourava a memoria)
  const st = store[liga], k = [liga, q.horas, q.mkt, q.n, q.compacto, q.dia].join("|");
  const c = gradeCache.get(k);
  if (c && c.st === st && Date.now() - c.ts < 20000) { res.type("application/json"); return res.send(c.body); }
  const orig = res.json.bind(res);
  res.json = b => {
    try {
      const body = JSON.stringify(b);
      if ((res.statusCode || 200) === 200) {
        const velho = gradeCache.get(k);
        if (velho) { gradeCacheBytes -= velho.body.length; gradeCache.delete(k); }
        gradeCache.set(k, { st, ts: Date.now(), body });
        gradeCacheBytes += body.length;
        while (gradeCache.size && (gradeCache.size > 60 || gradeCacheBytes > 30e6)) {
          const [k0, e0] = gradeCache.entries().next().value; gradeCache.delete(k0); gradeCacheBytes -= e0.body.length;
        }
      }
      res.type("application/json");
      return res.send(body);
    } catch (e) { return orig(b); }
  };
  next();
});
app.get("/api/grade", (req, res) => {
  // Corrige, uma unica vez, eventual lote ENG/SPA recebido antes da
  // identificacao por times. Nao altera resultados, odds ou matematica.
  reclassificaEngSpaEmMemoria();
  const liga = String(req.query.liga || "ita").toLowerCase();
  // Relógio real de cada liga virtual: não misturar grades de 30 e 20 jogos.
  const cadenciaDaLiga = chave => ({
    // 1Win usa vinte jogos, de tres em tres minutos, para ENG/SPA/ITA.
    ita: { cols: 30, passo: 2, ini: 1 }, eng: { cols: 30, passo: 2, ini: 0 },
    spa: { cols: 30, passo: 2, ini: 1 }, mnd: { cols: 30, passo: 2, ini: 0 },
    split: { cols: 30, passo: 2, ini: 0 },
    lat: { cols: 20, passo: 3, ini: 2 },
    bra: { cols: 20, passo: 3, ini: 2 }, cam: { cols: 20, passo: 3, ini: 0 },
    cop: { cols: 20, passo: 3, ini: 0 }, ame: { cols: 20, passo: 3, ini: 1 }
  }[String(chave || '').toLowerCase()] || { cols: 30, passo: 2, ini: 0 });
  const gradeCfg = cadenciaDaLiga(liga);
  const aliases = {
    ita:['ita'], eng:['eng'], spa:['spa'],
    // A extensão chama Mundo de MUN (playpix-mun), enquanto a interface usa MND.
    mnd:['mnd'], bra:['bra'],
    lat:['lat'], cam:['cam'], cop:['cop'], ame:['ame'], split:['split']
  };
  const ligasReais = Object.keys(aliases).filter(k => k !== 'split');
  // A extensao atual usa identificadores dinamicos (ex.: spa, eng, ita),
  // enquanto o backup classico possui abas fixas (copa/euro/super/premier).
  // Se a aba antiga ainda nao tiver um store homonimo, usa a liga real mais
  // recentemente recebida para a grade nao ficar artificialmente vazia.
  const temJogosNaLiga = chave => !!(store[chave] &&
    (gamesFundidos(chave).length || (store[chave].upcomingRaw || []).length));
  const chavePorAlias = id => {
    const codigo = codigoLiga(id) || String(id || '').toLowerCase();
    // Correspondencia exata: ENG jamais pode receber SPA por semelhanca de
    // texto, pela ordem de chegada ou pelo ultimo lote disponivel.
    return Object.keys(store).find(k => codigoLiga(k) === codigo && temJogosNaLiga(k));
  };
  const encontradaPorAlias = aliases[liga] && chavePorAlias(liga);
  // Para uma liga real escolhida pelo usuário, nunca devolvemos os jogos de
  // outra liga como "substituto". Isso fazia, por exemplo, MND/Split exibirem
  // a grade da Itália enquanto a extensão ainda estava varrendo essas abas.
  // As abas clássicas continuam com o fallback abaixo para compatibilidade.
  // Cada aba usa apenas o lote recebido para a propria liga.
  const ligaReal = temJogosNaLiga(liga) ? liga : encontradaPorAlias;
  /* Split e a visao consolidada: junta somente as nove ligas que a extensao
     envia. Nao pode cair no fallback da ITA, pois isso faz a grade parecer
     picotada e repete uma liga como se fosse o conjunto todo. */
  if (liga === 'split') {
    const fontes = ligasReais.map(id => {
      const chave = temJogosNaLiga(id) ? id : chavePorAlias(id);
      return chave ? { chave, dado: store[chave] } : null;
    }).filter(Boolean);
    const minutoDoJogo = g => {
      const m = String(g.horario || '').match(/(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    };
    // Ordena o lote pelo relógio que veio da extensão antes de encaixá-lo na
    // grade única. Cada liga pode ter um jogo no mesmo minuto; nesse caso a
    // grade antiga sobrescrevia um pelo outro e deixava faixas azuis vazias.
    const resolvidos = fontes.flatMap(({ chave }) => gamesFundidos(chave))
      .sort((a, b) => minutoDoJogo(a) - minutoDoJogo(b));
    const futuros = fontes.flatMap(({ dado }) => (dado.upcomingRaw || []).slice(0, 20));
    const atualizado = fontes.map(x => x.dado.lastUpdated).filter(Boolean)
      .sort().slice(-1)[0] || null;
    const todos = resolvidos.concat(futuros).slice(-(Math.max(1, Math.min(168,
      parseInt(req.query.horas || '48', 10) || 48)) * gradeCfg.cols + gradeCfg.cols));
    const passoGradeMs = gradeCfg.passo * 60000;
    const agora = Date.now() - (Date.now() % passoGradeMs);
    const partidas = todos.map((g, i) => {
      const resolvido = Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b));
      const ts = new Date(agora - (todos.length - 1 - i) * passoGradeMs).toISOString();
      const encaixe = new Date(ts);
      return { id: `split-${i}-${g.horario || ''}-${g.casa || ''}`, liga: 'split',
        time_a: g.casa || String(g.nome || '').split(' x ')[0] || '',
        time_b: g.fora || String(g.nome || '').split(' x ')[1] || '',
        gols_a: resolvido ? Number(g.a) : null, gols_b: resolvido ? Number(g.b) : null,
        resultado_ft: resolvido ? `${g.a}-${g.b}` : null, resultado_ht: g.ht || null,
        // A grade Split é uma fila única: usa uma coluna a cada 3 minutos para
        // caber todos os jogos, sem colisão entre ligas no mesmo horário.
        hora: encaixe.getUTCHours(), minuto: encaixe.getUTCMinutes(),
        horario_real: g.horario || null,
        slot_em: ts, criado_em: ts, odds: g.odds || {} };
    });
    return res.json({ liga: 'split', liga_solicitada: liga, partidas,
      cursor: String(atualizado || Date.now()), atualizado_em: atualizado });
  }
  const d = ligaReal ? store[ligaReal] : null;
  if (!d) return res.json({ liga, partidas: [], cursor: null, atualizado_em: null });

  // Sem limite de 20/h: a extensao e a fonte da contagem de cada liga.
  const resolvidos = gamesFundidos(ligaReal);
  const futuros = d.upcomingRaw || [];
  const todos = resolvidos.concat(futuros);
  // A âncora fixa impede que os resultados mudem de coluna no poll.
  const passoGradeMs = gradeCfg.passo * 60000;
  // O relogio exibido pela fonte segue Brasilia. Representamos esse relogio
  // como UTC apenas para fazer contas sem o navegador aplicar outro fuso.
  const agoraGrade = (() => {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = Number(p.value);
      return acc;
    }, {});
    return Date.UTC(partes.year, partes.month - 1, partes.day,
      partes.hour, partes.minute, partes.second, 0);
  })();
  const dAgora = new Date(agoraGrade);
  const minutoAgora = dAgora.getUTCMinutes();
  const recuoMin = ((minutoAgora - gradeCfg.ini) % gradeCfg.passo + gradeCfg.passo) % gradeCfg.passo;
  const agora = agoraGrade - recuoMin * 60000 - dAgora.getUTCSeconds() * 1000 - dAgora.getUTCMilliseconds();

  const oddsAntigas = odds => {
    const o = odds || {};
    return {
      ...o,
      "odd_over_1.5": o.o15 ?? null,
      "odd_over_2.5": o.o25 ?? null,
      "odd_over_3.5": o.o35 ?? null,
      "odd_total_gols_extatos_5": o.ge5 ?? null,
      "odd_ambas_sim": o.ambs ?? null,
      "odd_ambas_nao": o.ambn ?? null,
      "odd_under_0.5": o.u05 ?? null,
      "odd_under_1.5": o.u15 ?? null,
      "odd_under_2.5": o.u25 ?? null,
      "odd_under_3.5": o.u35 ?? null
    };
  };

  // O coletor manda o relogio virtual original (ex.: 04:01, 04:03). Ele e a
  // referencia de coluna: 04:01 ocupa a primeira casa da hora, 04:03 a
  // segunda, e assim por diante. Nunca reencaixe pelo indice do array, pois
  // uma casa vazia deslocaria todos os jogos seguintes.
  // Instante real (ISO/UTC vindo da API) convertido para o relogio da grade
  // (Brasilia representado como UTC). Sem isto, um jogo de ontem com o mesmo
  // HH:MM ocupava a casa de hoje e apagava os futuros seguintes.
  const relogioGrade = iso => {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return null;
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))
      .reduce((acc, x) => { if (x.type !== "literal") acc[x.type] = Number(x.value); return acc; }, {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  };
  // Jogos sem data real (coletados antes da correcao): o numero do evento da
  // Vavada so cresce, entao no mesmo HH:MM o de id maior e o mais recente e os
  // demais recuam um dia cada. Calculado sob demanda, apos instanteDaGrade.
  const numeroEvento = g => { const m = String(g && g.id || "").match(/(\d+)$/); return m ? Number(m[1]) : NaN; };
  let recuoDias = null;
  const calculaRecuo = () => {
    recuoDias = new Map();
    const grupos = new Map();
    for (const g of todos) {
      if (!(Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b)))) continue;
      const n = numeroEvento(g); if (!Number.isFinite(n)) continue;
      const k = String(g.horario || "");
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(g);
    }
    for (const lista of grupos.values()) {
      lista.sort((x, y) => numeroEvento(y) - numeroEvento(x));
      const topo = lista[0];
      const base = relogioGrade(topo.inicio) ?? instanteDaGrade(topo.horario, false);
      lista.forEach((g, k) => { if (!g.inicio && base != null) recuoDias.set(g, base - k * 24 * 60 * 60 * 1000); });
    }
    // Um evento com numero menor que o do datado mais antigo e anterior a ele.
    let refN = Infinity, refT = null;
    for (const g of todos) { if (!(Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b)))) continue; const t = relogioGrade(g.inicio), n = numeroEvento(g); if (t != null && Number.isFinite(n) && n < refN) { refN = n; refT = t; } }
    if (refT != null) for (const [g, t] of recuoDias) {
      let x = t; while (numeroEvento(g) < refN && x >= refT) x -= 24 * 60 * 60 * 1000;
      recuoDias.set(g, x);
    }
  };
  const instanteDoJogo = (g, futuro) => {
    const real = relogioGrade(g && g.inicio);
    if (real != null) return real;
    if (!futuro && g && Number.isFinite(numeroEvento(g))) {
      if (!recuoDias) calculaRecuo();
      if (recuoDias.has(g)) return recuoDias.get(g);
    }
    return instanteDaGrade(g && g.horario, futuro);
  };
  const instanteDaGrade = (horario, futuro = false) => {
    const m = String(horario || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let h = Number(m[1]), min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    // CAM e COP usam 00,03,06...; AME usa 01,04,07... no relogio original.
    // Nessas tres ligas o minuto recebido ja e a referencia exata da coluna.
    // Subtrair 1 da CAM transformava 17:00 em 16:59, removia a primeira casa
    // da linha e fazia o cabecalho aparecer incorretamente como 02,05,08....
    // As demais ligas mantem o contrato legado da extensao, que nomeia a
    // O minuto recebido da API é a fonte de verdade. Não deslocar entre ligas:
    // ENG/MND começam em 00, ITA/SPA em 01 e BRA/LAT em 02.
    const agoraReal = new Date(agoraGrade);
    let ts = Date.UTC(agoraReal.getUTCFullYear(), agoraReal.getUTCMonth(), agoraReal.getUTCDate(), h, min, 0, 0);
    const dia = 24 * 60 * 60 * 1000;
    const agoraMs = agoraGrade;
    // Com 24h de historico existem resultados das 16h..23h de ontem e das
    // 00h..15h de hoje. A regra antiga de "dia mais proximo" transformava a
    // madrugada ja encerrada em amanha; em seguida os futuros das 15h eram
    // empurrados para 07h. Resultado encerrado nunca pode ficar adiante do
    // relogio atual (salvo a pequena folga de atualizacao da fonte).
    if (!futuro && ts > agoraMs + passoGradeMs * 3) ts -= dia;
    // Na virada de 23h para 00h, o futuro pertence ao dia seguinte. O ajuste
    // fino pela sequencia abaixo preserva os minutos e evita novo salto.
    if (futuro && ts < agoraMs - 12 * 60 * 60 * 1000) ts += dia;
    return ts;
  };

  const ultimoDatadoEm = todos.reduce((maior, g) => {
    if (!(Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b)))) return maior;
    const t = relogioGrade(g.inicio);
    return t != null ? Math.max(maior, t) : maior;
  }, Number.NEGATIVE_INFINITY);
  const ultimoResolvidoEm = todos.reduce((maior, g) => {
    const resolvido = Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b));
    if (!resolvido) return maior;
    const instante = instanteDoJogo(g, false);
    if (!g.inicio && Number.isFinite(ultimoDatadoEm) && instante > ultimoDatadoEm) return maior;
    return Number.isFinite(instante) ? Math.max(maior, instante) : maior;
  }, Number.NEGATIVE_INFINITY);
  const partidas = todos.map((g, i) => {
    const resolvido = Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b));
    const tsDireto = instanteDoJogo(g, !resolvido);
    // Resultado antigo sem data real (coletado antes desta versao) que cairia
    // depois do ultimo resultado datado e de ontem no mesmo HH:MM: descarta.
    if (resolvido && !g.inicio && Number.isFinite(ultimoDatadoEm) &&
        Number.isFinite(tsDireto) && tsDireto > ultimoDatadoEm) return null;
    // Um pendente antigo pode continuar no HTML da fonte mesmo depois que a
    // grade ja recebeu resultados mais recentes. A regra anterior empurrava
    // esse pendente para o proximo slot livre, fazendo um jogo da linha 17
    // aparecer na linha 18. A hora original e a fonte de verdade: pendente
    // anterior ao ultimo resultado e obsoleto e deve ser ignorado, nunca
    // deslocado. Assim cada linha conserva exatamente suas 20 colunas.
    if (!resolvido && Number.isFinite(ultimoResolvidoEm) &&
        Number.isFinite(tsDireto) && tsDireto <= ultimoResolvidoEm) return null;
    const ts = new Date(tsDireto == null
      ? agora - (todos.length - 1 - i) * passoGradeMs
      : tsDireto).toISOString();
    const encaixe = new Date(ts);
    return {
      id: `${ligaReal}-${i}-${g.horario || ""}-${g.casa || ""}`,
      liga: ligaReal,
      time_a: g.casa || String(g.nome || "").split(" x ")[0] || "",
      time_b: g.fora || String(g.nome || "").split(" x ")[1] || "",
      gols_a: resolvido ? Number(g.a) : null,
      gols_b: resolvido ? Number(g.b) : null,
      resultado_ft: resolvido ? `${g.a}-${g.b}` : null,
      resultado_ht: g.ht || null,
      // Coordenada original da extensao: e a fonte de verdade da grade.
      // `slot_em` fica apenas como compatibilidade com os modulos antigos.
      linha_visual: g.linha_visual ?? null,
      coluna_visual: g.coluna_visual ?? null,
      // hora/minuto e slot_em precisam apontar para a mesma coluna. A fonte
      // pode vir em 2 minutos, mas a grade usa uma celula a cada 3 minutos;
      // misturar os dois ritmos deixava lacunas azuis entre jogos reais.
      hora: encaixe.getUTCHours(),
      minuto: encaixe.getUTCMinutes(),
      slot_em: ts,
      criado_em: ts,
      odds: oddsAntigas(g.odds)
    };
  }).filter(Boolean);
  // O coletor pode enviar 24h ordenadas apenas pelo relogio (00..23). Nesse
  // formato, 23h de ontem fica depois de 16h de hoje e o backtest interpreta
  // ontem como o trecho mais recente. `slot_em` ja contem o dia correto; por
  // isso a resposta deve seguir essa cronologia real. IDs e coordenadas da
  // grade continuam intactos, logo esta ordenacao nao altera a matematica.
  partidas.sort((a, b) => Date.parse(a.slot_em) - Date.parse(b.slot_em));
  const colunasVisuais = partidas.filter(p => p.coluna_visual != null)
    .map(p => Number(p.coluna_visual)).filter(Number.isFinite);
  res.json({ liga: ligaReal, liga_solicitada: liga, partidas,
    colunas_grade: colunasVisuais.length ? Math.max.apply(null, colunasVisuais) : gradeCfg.cols,
    coleta_campos: d.gradeMeta || null,
    cursor: String(d.lastUpdated || Date.now()), atualizado_em: d.lastUpdated || null });
});

// ===== BACKTEST (somente leitura, nao altera nenhuma analise) =====
// Reconstroi, jogo a jogo, o que a avaliacao teria indicado usando SO os jogos
// anteriores (sem olhar o futuro), e confere GREEN/RED contra o placar real.
const btCache = {};
function calculaBacktest(liga, mkt, n) {
    const key = liga + "|" + mkt + "|" + n;
    const d = store[liga];
    if (!d || !d.games || d.games.length < 150) return { erro: "historico insuficiente" };
    if (btCache[key] && Date.now() - btCache[key].ts < 60000 && btCache[key].lu === d.lastUpdated) {
      return btCache[key].out;
    }
    const games = d.games;
    const jph = jogosPorHora(liga);
    const ini = Math.max(6 * jph, games.length - n); // aquecimento de 6h da liga
    const resultados = [];
    for (let i = ini; i < games.length; i++) {
      const g = games[i];
      if (!g.odds || !g.odds[oddKey(mkt)]) continue;
      const hist = games.slice(0, i).slice(-20 * jph); // 20h anteriores da liga
      const ev = fullEvalUpcoming([{ nome: g.nome, horario: "", casa: g.casa, fora: g.fora, odds: g.odds }], hist, mkt, { jogosHora: jph })[0] || {};
      resultados.push({
        nome: g.nome, horario: g.horario || "", odd: g.odds[oddKey(mkt)],
        score: ev.score ?? null, ev: ev.ev ?? null, motivo: ev.motivo || "",
        green: pays(g, mkt), placar: (g.a != null && g.b != null) ? g.a + "-" + g.b : null
      });
    }
    // agregados por faixa
    const faixa = (min, max) => {
      const f = resultados.filter(r => r.score != null && r.score >= min && r.score < max);
      return { n: f.length, green: f.filter(r => r.green).length, pct: f.length ? Math.round(f.filter(r => r.green).length / f.length * 100) : null };
    };
    const evPos = resultados.filter(r => r.ev != null && r.ev > 0);
    const baseGeral = Math.round(resultados.filter(r => r.green).length / (resultados.length || 1) * 100);
    // Mesma regra do painel: registra so quando o sinal NASCE e rearma depois
    // de 6 jogos seguidos sem sinal (antes contava o mesmo sinal em todo jogo).
    const indicados = [];
    let armado = true, inativosSeguidos = 6;
    for (const r of resultados) {
      if (r.score != null && r.score >= 30 && r.ev > 0) {
        if (armado) indicados.push(r);
        armado = false; inativosSeguidos = 0;
      } else if (++inativosSeguidos >= 6) armado = true;
    }
    const out = {
      liga, mkt, jogosAvaliados: resultados.length, baseGeral,
      _seqIndicados: indicados.map(r => !!r.green),
      faixas: { forte_60mais: faixa(60, 999), media_30a59: faixa(30, 60), fraca_0a29: faixa(0, 30), negativa: faixa(-999, 0) },
      evPositivo: { n: evPos.length, green: evPos.filter(r => r.green).length, pct: evPos.length ? Math.round(evPos.filter(r => r.green).length / evPos.length * 100) : null },
      indicados: { n: indicados.length, green: indicados.filter(r => r.green).length, pct: indicados.length ? Math.round(indicados.filter(r => r.green).length / indicados.length * 100) : null },
      ultimos10indicados: (() => {
        // JANELA DE 6 HORAS do relogio do jogo (pedido do usuario: os indicados sumiam com o corte de 10)
        const hm = h => { const m = /^(\d{1,2}):(\d{1,2})/.exec(h || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
        const agoraJogo = (() => { for (let k = resultados.length - 1; k >= 0; k--) { const v = hm(resultados[k].horario); if (v != null) return v; } return null; })();
        const dentro6h = r => { const v = hm(r.horario); if (v == null || agoraJogo == null) return true; const diff = (agoraJogo - v + 1440) % 1440; return diff <= 360; };
        const janela = indicados.filter(dentro6h);
        // ⚠️ TRIANGULO: o MAIOR EV+ que deu RED na janela (aviso: EV alto nao e garantia)
        let idxAlerta = -1, maiorEv = -1;
        janela.forEach((r, ix) => { if (!r.green && r.ev != null && r.ev > 0 && r.ev > maiorEv) { maiorEv = r.ev; idxAlerta = ix; } });
        return janela.map((r, ix) => ({ nome: r.nome, horario: r.horario, odd: r.odd, score: r.score, ev: r.ev, placar: r.placar, resultado: r.green ? "GREEN" : "RED", alerta: ix === idxAlerta }));
      })()
    };
    btCache[key] = { ts: Date.now(), lu: d.lastUpdated, out };
    return out;
}
app.get("/api/backtest/:liga", (req, res) => {
  try { res.json(calculaBacktest(req.params.liga, req.query.mkt || "o35", Math.min(parseInt(req.query.n || "80", 10) || 80, 150))); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO: recuperacao pos-red dos indicados (hipotese do usuario: "falhado paga quando volta") =====
// ===== AUDITORIA COMPLETA: varre todo o historico (over E under), simula o CICLO REAL
// de 3 tiros com gale 1-2-4 usando as odds verdadeiras, e valida cada achado em DUAS
// metades independentes (edge real sobrevive nas duas; sorte nao). =====
// ===== AUDITORIA DO TEMPO E DA TROLLAGEM (hipoteses do usuario) =====
// 1) LAG: quando a curva sobe, o pagamento vem AGORA ou daqui a quantos jogos?
//    Mede a taxa de pagamento em cada atraso k=1..20 apos o sinal, contra a base.
// 2) TROLL: o padrao que chega a 100% falha logo depois? Pega todo padrao que atingiu
//    100% (n>=5) ao vivo e mede o que ele fez DEPOIS (fora da amostra que o consagrou).
// ===== AUDITORIA DA MAQUINA: o gerador se repete? as odds sao mal precificadas? =====
// A) AUTOCORRELACAO: o resultado de agora depende do resultado de k jogos atras? (k=1..120)
// B) REPETICAO EXATA: o roteiro de placares se repete em algum ciclo? (busca blocos identicos)
// C) CALIBRACAO DAS ODDS: cada valor de odd entrega o que promete? (validado fora da amostra)
// D) COLUNA DA HORA: o minuto do relogio (:00 :03 :06...) tem viés? (repete ~25x no historico)
// ===== INVENTARIO DE ODDS: o que a fonte manda que a gente nem olha? =====
// + MARGEM (overround) por mercado: onde a casa cobra menos, o jogo e mais justo.
// + CALIBRACAO: o que cada mercado PROMETE (1/odd) contra o que ENTREGOU de verdade.
app.get("/api/odds-inventario", (req, res) => {
  try {
    const inv = {}, porLiga = {};
    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games) continue;
      porLiga[liga] = { jogos: d.games.length, chaves: {} };
      for (const g of d.games) {
        for (const [k, v] of Object.entries(g.odds || {})) {
          if (typeof v !== "number" || v <= 1.01) continue;
          const s = inv[k] || (inv[k] = { n: 0, soma: 0, min: 99, max: 0, vals: [] });
          s.n++; s.soma += v; if (v < s.min) s.min = v; if (v > s.max) s.max = v;
          if (s.vals.length < 4000) s.vals.push(v);
          porLiga[liga].chaves[k] = (porLiga[liga].chaves[k] || 0) + 1;
        }
      }
    }
    const chaves = Object.entries(inv).map(([k, s]) => {
      s.vals.sort((a, b) => a - b);
      return { chave: k, aparicoes: s.n, media: Math.round(s.soma / s.n * 100) / 100, min: s.min, max: s.max, mediana: s.vals[Math.floor(s.vals.length / 2)] };
    }).sort((a, b) => b.aparicoes - a.aparicoes);

    // MARGEM (overround) dos pares complementares + CALIBRACAO empirica
    const pares = [["o25", "u25"], ["o35", "u35"], ["o15", "u15"], ["ambs", "ambn"]];
    const margens = [], calib = [];
    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games || d.games.length < 200) continue;
      const games = d.games;
      for (const [A, B] of pares) {
        const comAmbos = games.filter(g => g.odds && g.odds[A] > 1.01 && g.odds[B] > 1.01);
        if (comAmbos.length < 40) continue;
        const over = comAmbos.reduce((a, g) => a + (1 / g.odds[A] + 1 / g.odds[B]), 0) / comAmbos.length;
        margens.push({ liga, par: A + "/" + B, margem: Math.round((over - 1) * 1000) / 10 + "%", n: comAmbos.length });
      }
      // calibracao: o que a odd promete x o que saiu
      for (const mkt of ["o25", "o35", "ge5", "ambas", "u25", "u15"]) {
        const k = mkt === "ambas" ? "ambs" : mkt;
        const comOdd = games.filter(g => g.odds && g.odds[k] > 1.01);
        if (comOdd.length < 100) continue;
        const prometido = comOdd.reduce((a, g) => a + 1 / g.odds[k], 0) / comOdd.length * 100;
        const entregue = comOdd.filter(g => pays(g, mkt)).length / comOdd.length * 100;
        const evMedio = comOdd.reduce((a, g) => a + ((pays(g, mkt) ? g.odds[k] : 0) - 1), 0) / comOdd.length * 100;
        calib.push({ liga, mkt, n: comOdd.length, prometido: Math.round(prometido * 10) / 10, entregue: Math.round(entregue * 10) / 10, diferenca: Math.round((entregue - prometido) * 10) / 10, evReal: Math.round(evMedio * 10) / 10 });
      }
    }
    calib.sort((a, b) => b.evReal - a.evReal);
    res.json({
      LEITURA: "aparicoes = quantos jogos trazem essa odd. Se um mercado que voce ve na tela do jogo NAO esta aqui, a sonda nao esta capturando ele.",
      chavesCapturadas: chaves,
      margemDaCasa: margens.sort((a, b) => parseFloat(a.margem) - parseFloat(b.margem)),
      calibracaoPorMercado: calib,
      porLiga
    });
  } catch (e) { res.status(500).json({ erro: e.message, linha: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/auditoria-maquina", (req, res) => {
  try {
    const MKTS = ["o25", "o35", "ambas"];
    const saida = { A_autocorrelacao: {}, B_repeticaoExata: {}, C_calibracaoOdds: {}, D_colunaHora: {} };

    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games || d.games.length < 300) continue;
      const games = listaCheia(d);
      const N = games.length;

      // ===== A) AUTOCORRELACAO =====
      for (const mkt of MKTS) {
        const x = games.map(g => (pays(g, mkt) ? 1 : 0));
        const mu = x.reduce((a, b) => a + b, 0) / N;
        const varr = x.reduce((a, v) => a + (v - mu) ** 2, 0) / N;
        if (!varr) continue;
        const picos = [];
        for (let k = 1; k <= 120; k++) {
          let s = 0, c = 0;
          for (let i = k; i < N; i++) { s += (x[i] - mu) * (x[i - k] - mu); c++; }
          const r = c ? (s / c) / varr : 0;
          picos.push({ k, r: Math.round(r * 1000) / 1000 });
        }
        const limiar = Math.round(2 / Math.sqrt(N) * 1000) / 1000; // ruido esperado
        const fortes = picos.filter(p => Math.abs(p.r) > limiar).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5);
        saida.A_autocorrelacao[liga + "|" + mkt] = {
          limiarRuido: limiar,
          maiores: fortes.map(f => `lag ${f.k}: r=${f.r}`),
          acimaDoRuido: fortes.length,
          esperadoPorAcaso: Math.round(120 * 0.05)
        };
      }

      // ===== B) REPETICAO EXATA DO ROTEIRO =====
      const roteiro = games.map(g => (g.a != null ? g.a + "" + g.b : "??")).join("|");
      const arr = roteiro.split("|");
      let maiorRepeticao = 0, ondeA = -1, ondeB = -1;
      const idxPor = {};
      for (let i = 0; i < arr.length; i++) (idxPor[arr[i]] = idxPor[arr[i]] || []).push(i);
      // procura o maior bloco identico em duas posicoes diferentes (busca a partir de placares iguais)
      for (const lista of Object.values(idxPor)) {
        if (lista.length < 2 || lista.length > 200) continue;
        for (let a = 0; a < lista.length - 1; a++) {
          for (let b = a + 1; b < lista.length; b++) {
            let L = 0;
            while (lista[a] + L < arr.length && lista[b] + L < arr.length && arr[lista[a] + L] === arr[lista[b] + L]) L++;
            if (L > maiorRepeticao) { maiorRepeticao = L; ondeA = lista[a]; ondeB = lista[b]; }
          }
        }
      }
      // quanto se espera por acaso? ~log(N^2)/log(numPlacaresDistintos)
      const distintos = Object.keys(idxPor).length;
      // TESTE DE EMBARALHAMENTO (correto): a formula log assume placares uniformes, o que e FALSO
      // (1-0 e 1-1 dominam). Embaralha o roteiro 300x e mede o maior bloco repetido em cada -
      // se o valor real cai dentro dessa nuvem, e acaso puro.
      const maiorBlocoDe = a => {
        const ix = {}; for (let i = 0; i < a.length; i++) (ix[a[i]] = ix[a[i]] || []).push(i);
        let mx = 0;
        for (const lst of Object.values(ix)) {
          if (lst.length < 2 || lst.length > 200) continue;
          for (let p = 0; p < lst.length - 1; p++) for (let q = p + 1; q < lst.length; q++) {
            let L = 0; while (lst[p] + L < a.length && lst[q] + L < a.length && a[lst[p] + L] === a[lst[q] + L]) L++;
            if (L > mx) mx = L;
          }
        }
        return mx;
      };
      const nulos = [];
      for (let s = 0; s < 300; s++) {
        const c = arr.slice();
        for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = c[i]; c[i] = c[j]; c[j] = t; }
        nulos.push(maiorBlocoDe(c));
      }
      nulos.sort((a, b) => a - b);
      const p95 = nulos[Math.floor(nulos.length * 0.95)];
      const mediaNulo = Math.round(nulos.reduce((a, b) => a + b, 0) / nulos.length * 10) / 10;
      const esperado = mediaNulo;
      // ===== PERIODICIDADE: se o gerador tem CICLO de tamanho p, entao arr[i] == arr[i+p]
      // acontece muito mais que o acaso em TODO o roteiro (nao so num bloco isolado).
      const freq = {}; for (const v of arr) freq[v] = (freq[v] || 0) + 1;
      const pAcaso = Object.values(freq).reduce((a, c) => a + (c / arr.length) ** 2, 0); // chance de 2 sorteios baterem
      let melhorP = null, melhorTaxa = 0;
      for (let p = 2; p <= Math.min(300, arr.length - 60); p++) {
        let ok = 0, tot = 0;
        for (let i = 0; i + p < arr.length; i++) { tot++; if (arr[i] === arr[i + p]) ok++; }
        const taxa = tot ? ok / tot : 0;
        if (taxa > melhorTaxa) { melhorTaxa = taxa; melhorP = p; }
      }
      const z = Math.round((melhorTaxa - pAcaso) / Math.sqrt(pAcaso * (1 - pAcaso) / arr.length) * 10) / 10;
      saida.B_repeticaoExata[liga] = {
        periodicidade: `melhor periodo ${melhorP}: ${Math.round(melhorTaxa * 1000) / 10}% de coincidencia (acaso ${Math.round(pAcaso * 1000) / 10}%, z=${z})`,
        cicloDetectado: melhorTaxa > pAcaso + 0.15 ? "SIM - gerador com ciclo!" : "nao (coincidencia = acaso)",

        jogos: N, placaresDistintos: distintos,
        maiorBlocoIdentico: maiorRepeticao,
        posicoes: maiorRepeticao > 1 ? `${ondeA} e ${ondeB} (distancia ${Math.abs(ondeB - ondeA)})` : "-",
        esperadoPorAcaso: esperado,
        p95Embaralhado: p95,
        veredito: maiorRepeticao > p95 ? "ACIMA DO ACASO (p<0.05) - investigar" : "dentro do acaso (embaralhamento produz o mesmo)"
      };

      // ===== C) CALIBRACAO DAS ODDS (fora da amostra) =====
      const meio = Math.floor(N / 2);
      for (const mkt of MKTS) {
        const k = mkt === "ambas" ? "ambs" : mkt;
        const porOdd = {};
        games.forEach((g, i) => {
          const o = g.odds && g.odds[k]; if (!o || o <= 1.01) return;
          const key = o.toFixed(2);
          const s = porOdd[key] || (porOdd[key] = { n1: 0, h1: 0, n2: 0, h2: 0 });
          if (i < meio) { s.n1++; if (pays(g, mkt)) s.h1++; } else { s.n2++; if (pays(g, mkt)) s.h2++; }
        });
        const linhas = [];
        for (const [odd, s] of Object.entries(porOdd)) {
          if (s.n1 < 25 || s.n2 < 25) continue;
          const implicita = 1 / parseFloat(odd) * 100;
          const t1 = s.h1 / s.n1 * 100, t2 = s.h2 / s.n2 * 100;
          const ev1 = (t1 / 100 * parseFloat(odd) - 1) * 100, ev2 = (t2 / 100 * parseFloat(odd) - 1) * 100;
          linhas.push({ odd, implicita: Math.round(implicita * 10) / 10, era1: Math.round(t1 * 10) / 10, era2: Math.round(t2 * 10) / 10, ev1: Math.round(ev1), ev2: Math.round(ev2), n: s.n1 + s.n2, replicou: (ev1 > 5 && ev2 > 5) || (ev1 < -5 && ev2 < -5) });
        }
        if (linhas.length) saida.C_calibracaoOdds[liga + "|" + mkt] = linhas.sort((a, b) => b.ev2 - a.ev2).slice(0, 6);
      }

      // ===== D) COLUNA DA HORA (minuto) =====
      for (const mkt of MKTS) {
        const porMin = {};
        games.forEach((g, i) => {
          const mm = (g.horario || "").split(":")[1]; if (!mm) return;
          const s = porMin[mm] || (porMin[mm] = { n1: 0, h1: 0, n2: 0, h2: 0 });
          if (i < meio) { s.n1++; if (pays(g, mkt)) s.h1++; } else { s.n2++; if (pays(g, mkt)) s.h2++; }
        });
        const base = games.filter(g => pays(g, mkt)).length / N * 100;
        const linhas = [];
        for (const [mm, s] of Object.entries(porMin)) {
          if (s.n1 < 8 || s.n2 < 8) continue;
          const t1 = s.h1 / s.n1 * 100, t2 = s.h2 / s.n2 * 100;
          const d1 = t1 - base, d2 = t2 - base;
          if ((d1 > 8 && d2 > 8) || (d1 < -8 && d2 < -8)) linhas.push({ min: ":" + mm, era1: Math.round(t1), era2: Math.round(t2), base: Math.round(base), n: s.n1 + s.n2, replicou: true });
        }
        if (linhas.length) saida.D_colunaHora[liga + "|" + mkt] = linhas;
      }
    }
    res.json(saida);
  } catch (e) { res.status(500).json({ erro: e.message, linha: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/auditoria-tempo", (req, res) => {
  try {
    const MKTS = ["o25", "o35", "ambas", "u25"];
    const LAGS = 20;
    const lagAgreg = {};   // por mkt: soma de hits por lag
    const trollAgreg = { casos: 0, depoisG: 0, depoisN: 0, baseG: 0, baseN: 0, porFamilia: {} };

    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games || d.games.length < 300) continue;
      const games = listaCheia(d);
      for (const mkt of MKTS) {
        const base = games.filter(g => pays(g, mkt)).length / games.length;
        const serie = chartSeries(games, mkt, 20);   // ponto k <-> jogo k+19
        const { hist } = macdData(serie);
        lagAgreg[mkt] = lagAgreg[mkt] || { subindo: Array(LAGS + 1).fill(0), subindoN: Array(LAGS + 1).fill(0), fundo: Array(LAGS + 1).fill(0), fundoN: Array(LAGS + 1).fill(0), base: 0, baseN: 0 };
        const A = lagAgreg[mkt];
        A.base += games.filter(g => pays(g, mkt)).length; A.baseN += games.length;

        for (let k = 3; k < serie.length; k++) {
          const idxJogo = k + 19; // jogo correspondente ao ponto k
          if (idxJogo + LAGS >= games.length) break;
          const subindoAgora = hist[k] > 0.2 && hist[k] >= hist[k - 3] && serie[k] > serie[k - 1];
          const jan = serie.slice(Math.max(0, k - 60), k + 1);
          const mn = Math.min(...jan), mx = Math.max(...jan);
          const zp = mx > mn ? (serie[k] - mn) / (mx - mn) * 100 : 50;
          const noFundo = zp <= 25;
          for (let lag = 1; lag <= LAGS; lag++) {
            const g = games[idxJogo + lag]; if (!g) break;
            const p = pays(g, mkt) ? 1 : 0;
            if (subindoAgora) { A.subindo[lag] += p; A.subindoN[lag]++; }
            if (noFundo) { A.fundo[lag] += p; A.fundoN[lag]++; }
          }
        }

        // ===== TROLL TEST: padroes que atingiram 100% ao vivo =====
        const seq = games.map(g => (pays(g, mkt) ? "G" : "R"));
        const ciclo3Dep = i => seq.slice(i + 1, i + 4).includes("G");
        // regua DESTE mercado (comparacao justa: cada mercado com a sua)
        let rn = 0, rh = 0;
        for (let i = 0; i + 3 < seq.length; i++) { rn++; if (seq.slice(i + 1, i + 4).includes("G")) rh++; }
        const reguaMkt = rn ? rh / rn : 0;
        // TESTE SEM VIES: cada CONSAGRACAO gera UMA unica observacao (a proxima aparicao).
        // (antes: vencedor era contado varias vezes e perdedor uma so -> inflava o resultado)
        for (const L of [4, 5]) {
          const stat = {};
          for (let i = 0; i + L + 3 < seq.length; i++) {
            const chave = seq.slice(i, i + L).join("");
            const pagou = ciclo3Dep(i + L - 1);
            const s = stat[chave] || (stat[chave] = { n: 0, h: 0, aguardando: false });
            if (s.aguardando) {
              s.aguardando = false;           // consome a observacao (uma por consagracao)
              trollAgreg.depoisN++; if (pagou) trollAgreg.depoisG++;
              trollAgreg.baseG += reguaMkt; trollAgreg.baseN += 1;   // regua pareada do mesmo mercado
              const fam = "seq" + L;
              const f = trollAgreg.porFamilia[fam] || (trollAgreg.porFamilia[fam] = { n: 0, h: 0 });
              f.n++; if (pagou) f.h++;
            }
            s.n++; if (pagou) s.h++;
            if (s.n >= 5 && s.h === s.n) s.aguardando = true;   // acabou de bater 100%: proxima aparicao sera testada
          }
        }
      }
    }

    const pctA = (h, n) => n ? Math.round(h / n * 1000) / 10 : null;
    const respostaLag = {};
    for (const [mkt, A] of Object.entries(lagAgreg)) {
      const b = pctA(A.base, A.baseN);
      const linha = [];
      for (let lag = 1; lag <= LAGS; lag++) {
        linha.push({ lag, subindo: pctA(A.subindo[lag], A.subindoN[lag]), fundo: pctA(A.fundo[lag], A.fundoN[lag]), n: A.subindoN[lag] });
      }
      const melhorSub = linha.filter(l => l.subindo != null).sort((a, b2) => b2.subindo - a.subindo)[0];
      const melhorFun = linha.filter(l => l.fundo != null).sort((a, b2) => b2.fundo - a.fundo)[0];
      respostaLag[mkt] = {
        base: b,
        curvaSubindo: linha.map(l => l.subindo),
        curvaFundo: linha.map(l => l.fundo),
        melhorLagSubindo: melhorSub ? `lag ${melhorSub.lag}: ${melhorSub.subindo}% (base ${b}%, ganho ${Math.round((melhorSub.subindo - b) * 10) / 10})` : null,
        melhorLagFundo: melhorFun ? `lag ${melhorFun.lag}: ${melhorFun.fundo}% (base ${b}%, ganho ${Math.round((melhorFun.fundo - b) * 10) / 10})` : null,
        amplitudeSubindo: (() => { const v = linha.map(l => l.subindo).filter(x => x != null); return v.length ? Math.round((Math.max(...v) - Math.min(...v)) * 10) / 10 : null; })()
      };
    }

    res.json({
      TESTE_1_TEMPO: { explicacao: "taxa de pagamento em cada atraso (1..20 jogos) apos o sinal, vs base do mercado", respostaLag },
      TESTE_2_TROLL: {
        explicacao: "padroes que atingiram 100% ao vivo: o que fizeram DEPOIS (fora da amostra)",
        casosForaDaAmostra: trollAgreg.depoisN,
        pagouDepois: pctA(trollAgreg.depoisG, trollAgreg.depoisN),
        reguaDoCiclo: trollAgreg.baseN ? Math.round(trollAgreg.baseG / trollAgreg.baseN * 1000) / 10 : null,
        diferenca: (trollAgreg.depoisN && trollAgreg.baseN) ? Math.round((trollAgreg.depoisG / trollAgreg.depoisN - trollAgreg.baseG / trollAgreg.baseN) * 1000) / 10 : null,
        porFamilia: Object.fromEntries(Object.entries(trollAgreg.porFamilia).map(([k, v]) => [k, `${pctA(v.h, v.n)}% em ${v.n} casos`]))
      }
    });
  } catch (e) { res.status(500).json({ erro: e.message, linha: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/auditoria", (req, res) => {
  try {
    const MKTS = ["o25", "o35", "ge5", "ambas", "u05", "u15", "u25"];
    const oddDe = (g, mkt) => { const k = mkt === "ambas" ? "ambs" : mkt; const o = g.odds && g.odds[k]; return (o && o > 1.01) ? o : null; };

    // simula UM ciclo comecando no jogo idx+1 (3 tiros, 1-2-4). Retorna unidades liquidas ou null se faltar odd.
    const simulaCiclo = (games, idx, mkt) => {
      const stakes = [1, 2, 4]; let gasto = 0;
      for (let k = 0; k < 3; k++) {
        const g = games[idx + 1 + k]; if (!g) return null;
        const od = oddDe(g, mkt); if (!od) return null;
        const st = stakes[k];
        if (pays(g, mkt)) return Math.round((st * od - gasto - st) * 100) / 100;
        gasto += st;
      }
      return -7;
    };

    // avalia uma REGRA (funcao que diz se o ciclo comeca no indice i) sobre uma liga|mkt
    // RIGOR: (1) ciclos NAO SOBREPOSTOS (um ciclo consome 3 jogos; o proximo so depois),
    // senao 20 "amostras" sao a mesma janela contada 20x. (2) validacao pela LINHA DO TEMPO
    // (1a metade do historico x 2a metade), nao pela ordem das amostras da propria regra -
    // uma regra que so acontece num bloco contiguo (ex: "hora 22h" = UMA hora do dia) tinha
    // as duas metades vindo do MESMO bloco: validacao falsa.
    const avalia = (games, mkt, regra) => {
      const meioTempo = Math.floor(games.length / 2);
      const res = [];
      let prox = 0;
      for (let i = 0; i + 4 < games.length; i++) {
        if (i < prox) continue;                 // sem sobreposicao
        if (!regra(games, i)) continue;
        const u = simulaCiclo(games, i, mkt);
        if (u == null) continue;
        res.push({ i, u });
        prox = i + 4;
      }
      const h1 = res.filter(r => r.i < meioTempo).map(r => r.u);
      const h2 = res.filter(r => r.i >= meioTempo).map(r => r.u);
      if (res.length < 20 || h1.length < 8 || h2.length < 8) return null; // precisa existir nas DUAS eras
      const soma = a => a.reduce((x, y) => x + y, 0);
      const total = soma(res.map(r => r.u));
      const greens = res.filter(r => r.u > 0).length;
      const s1 = soma(h1), s2 = soma(h2);
      return {
        n: res.length, greens, taxa: Math.round(greens / res.length * 100),
        unidades: Math.round(total * 10) / 10,
        porCiclo: Math.round(total / res.length * 100) / 100,
        metade1: Math.round(s1 * 10) / 10, n1: h1.length,
        metade2: Math.round(s2 * 10) / 10, n2: h2.length,
        robusto: s1 > 0 && s2 > 0
      };
    };

    // ===== biblioteca de REGRAS testadas =====
    const secaDe = (games, i, mkt) => { let s = 0; for (let k = i; k >= 0; k--) { if (!pays(games[k], mkt)) s++; else break; } return s; };
    const catPl = g => { const a = g.a || 0, b = g.b || 0, t = a + b, m = Math.max(a, b); return t === 0 ? "0-0" : t === 1 ? "1gol" : m >= 3 ? "goleada" : a === b ? "empate" : "2-1"; };

    const achados = [];
    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games || d.games.length < 200) continue;
      const games = listaCheia(d);
      for (const mkt of MKTS) {
        // R0: aposta CEGA (todo jogo abre ciclo) - a referencia
        const cego = avalia(games, mkt, () => true);
        if (cego) achados.push({ regra: "CEGO (todo jogo)", liga, mkt, ...cego });
        // R1: apos N reds seguidos
        for (const N of [1, 2, 3, 4, 5, 6]) {
          const r = avalia(games, mkt, (gs, i) => secaDe(gs, i, mkt) === N);
          if (r) achados.push({ regra: "apos " + N + " reds seguidos", liga, mkt, ...r });
        }
        // R2: apos green (momentum)
        const rG = avalia(games, mkt, (gs, i) => pays(gs[i], mkt));
        if (rG) achados.push({ regra: "apos GREEN", liga, mkt, ...rG });
        // R3: por categoria de placar do jogo-gatilho
        for (const cat of ["0-0", "1gol", "2-1", "goleada", "empate"]) {
          const r = avalia(games, mkt, (gs, i) => catPl(gs[i]) === cat);
          if (r) achados.push({ regra: "apos placar " + cat, liga, mkt, ...r });
        }
        // R4: por hora do relogio do jogo
        for (let h = 0; h < 24; h += 1) {
          const r = avalia(games, mkt, (gs, i) => parseInt((gs[i].horario || "").split(":")[0]) === h);
          if (r) achados.push({ regra: "hora " + String(h).padStart(2, "0") + "h", liga, mkt, ...r });
        }
        // R5: por faixa de odd do 1o tiro
        for (const [lo, hi] of [[1.0, 1.6], [1.6, 2.0], [2.0, 2.6], [2.6, 3.4], [3.4, 4.5], [4.5, 99]]) {
          const r = avalia(games, mkt, (gs, i) => { const o = oddDe(gs[i + 1], mkt); return o != null && o >= lo && o < hi; });
          if (r) achados.push({ regra: "1o tiro odd " + lo + "-" + hi, liga, mkt, ...r });
        }
        // R6: zona da curva (fundo/meio/topo) no momento do gatilho
        const serieZ = chartSeries(games, mkt, 20);
        const zonaNo = i => { const k = i - 19; if (k < 1 || k >= serieZ.length) return null; const jan = serieZ.slice(Math.max(0, k - 60), k + 1); if (jan.length < 20) return null; const mn = Math.min(...jan), mx = Math.max(...jan); if (mx === mn) return "meio"; const p = (serieZ[k] - mn) / (mx - mn) * 100; return p <= 30 ? "fundo" : p >= 70 ? "topo" : "meio"; };
        for (const z of ["fundo", "meio", "topo"]) {
          const r = avalia(games, mkt, (gs, i) => zonaNo(i) === z);
          if (r) achados.push({ regra: "curva no " + z, liga, mkt, ...r });
        }
        // R7: combo seca + zona (o classico "fundo descarregado")
        for (const N of [2, 3, 4]) for (const z of ["fundo", "topo"]) {
          const r = avalia(games, mkt, (gs, i) => secaDe(gs, i, mkt) >= N && zonaNo(i) === z);
          if (r) achados.push({ regra: N + "+ reds & curva " + z, liga, mkt, ...r });
        }
      }
    }

    // ===== TESTE FOCADO: uma hipotese unica em TODAS as combinacoes (mostra onde falha tambem) =====
    if (req.query.foco) {
      const alvo = String(req.query.foco);
      const linhas = [];
      for (const liga of LIGAS) {
        const d = store[liga]; if (!d || !d.games || d.games.length < 200) continue;
        const games = listaCheia(d);
        for (const mkt of MKTS) {
          const base = avalia(games, mkt, () => true);
          let r = null;
          if (alvo === "zero") r = avalia(games, mkt, (gs, i) => catPl(gs[i]) === "0-0");
          else if (alvo === "goleada") r = avalia(games, mkt, (gs, i) => catPl(gs[i]) === "goleada");
          else if (alvo === "green") r = avalia(games, mkt, (gs, i) => pays(gs[i], mkt));
          if (!r) continue;
          linhas.push({ liga, mkt, n: r.n, uCiclo: r.porCiclo, era1: r.metade1, era2: r.metade2, cegoUCiclo: base ? base.porCiclo : null, ganhoVsCego: base ? Math.round((r.porCiclo - base.porCiclo) * 100) / 100 : null });
        }
      }
      const pos = linhas.filter(l => l.uCiclo > 0).length;
      const somaGanho = Math.round(linhas.reduce((a, l) => a + (l.ganhoVsCego || 0), 0) / (linhas.length || 1) * 100) / 100;
      return res.json({ hipotese: alvo, combosTestados: linhas.length, positivos: pos, negativos: linhas.length - pos, ganhoMedioVsCego: somaGanho, veredito: pos > linhas.length * 0.7 && somaGanho > 0.15 ? "CONSISTENTE" : "NAO SE SUSTENTA (ruido)", linhas: linhas.sort((a, b) => b.uCiclo - a.uCiclo) });
    }
    // ranking: so o que e LUCRATIVO e ROBUSTO (positivo nas duas metades)
    const lucrativos = achados.filter(a => a.unidades > 0).sort((a, b) => b.porCiclo - a.porCiclo);
    const robustos = lucrativos.filter(a => a.robusto && a.n >= 20).sort((a, b) => b.porCiclo - a.porCiclo);
    const sangrias = achados.filter(a => a.unidades < 0).sort((a, b) => a.porCiclo - b.porCiclo);
    const cegos = achados.filter(a => a.regra.startsWith("CEGO")).sort((a, b) => b.porCiclo - a.porCiclo);

    // ledger do robo
    const ledger = {};
    for (const m of ROBO_MKTS) { const L = roboState[m]; ledger[m] = { saldo: L.saldo, ciclos: L.ciclos, greens: L.greens, redsCiclo: L.redsCiclo, descartes: L.descartes, dias: L.dias || {} }; }

    res.json({
      totalRegrasTestadas: achados.length,
      ROBUSTOS: robustos.slice(0, 25),
      lucrativosFragilidade: lucrativos.filter(a => !a.robusto).slice(0, 10),
      cegoPorMercado: cegos.slice(0, 12),
      pioresSangrias: sangrias.slice(0, 10),
      ledgerRobo: ledger
    });
  } catch (e) { res.status(500).json({ erro: e.message, stack: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/estudo-recuperacao", (req, res) => {
  try {
    const agreg = { aposRed: [0, 0], aposGreen: [0, 0], geral: [0, 0], porCombo: {} };
    for (const liga of LIGAS) for (const mkt of ["o35", "o25", "ambas"]) {
      const bt = calculaBacktest(liga, mkt, 150);
      if (!bt || bt.erro) continue;
      // precisamos da SEQUENCIA cronologica de TODOS os indicados: recalcular leve aqui a partir do out nao da; usar ultimos (6h) + guardar por combo
      const seqI = (bt._seqIndicados || []);
      for (let i = 0; i < seqI.length; i++) {
        agreg.geral[0]++; if (seqI[i]) agreg.geral[1]++;
        if (i > 0) {
          const balde = seqI[i - 1] ? agreg.aposGreen : agreg.aposRed;
          balde[0]++; if (seqI[i]) balde[1]++;
        }
      }
      agreg.porCombo[liga + "|" + mkt] = { n: seqI.length, seq: seqI.map(v => v ? "G" : "R").join("") };
    }
    const pct = ([n, h]) => n ? Math.round(h / n * 100) : null;
    res.json({
      hipotese: "apos um indicado RED, o proximo indicado paga mais?",
      geral: { n: agreg.geral[0], pctGreen: pct(agreg.geral) },
      aposRED: { n: agreg.aposRed[0], pctGreen: pct(agreg.aposRed) },
      aposGREEN: { n: agreg.aposGreen[0], pctGreen: pct(agreg.aposGreen) },
      leitura: "se aposRED >> geral, ha recuperacao explorav el; se igual, e miragem",
      combos: agreg.porCombo
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== RELATORIO POR DATA (diagnostico do regime diario; nao altera analises) =====
// Datas inferidas: os jogos vem em ordem cronologica so com hora; quando a hora "volta"
// (23:57 -> 00:01), e a virada do dia. Ancora: ultimo jogo = hoje (fuso de Sao Paulo).
// Acumula resumos por dia em memoria (zera em restart do Render).
const relAcum = {};
function horaMin(h) { const m = /^(\d{1,2}):(\d{1,2})/.exec(h || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function dataBR(diasAtras) { const d = new Date(Date.now() - diasAtras * 86400000); return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); }
app.get("/api/relatorio/:liga", (req, res) => {
  try {
    const liga = req.params.liga; const d = store[liga];
    if (!d || !d.games || !d.games.length) return res.json({ erro: "sem dados" });
    // separa os jogos em dias pela virada de horario (queda > 60min = novo dia)
    const dias = [[]];
    let prev = null;
    for (const g of d.games) {
      const t = horaMin(g.horario);
      if (prev != null && t != null && t < prev - 60 && dias[dias.length - 1].length) dias.push([]);
      if (t != null) prev = t;
      dias[dias.length - 1].push(g);
    }
    const resumo = (gs) => {
      const n = gs.length;
      const p = (mk) => Math.round(gs.filter(g => pays(g, mk)).length / n * 100);
      const per = (a, b) => {
        const s = gs.filter(g => { const t = horaMin(g.horario); return t != null && t >= a * 60 && t < b * 60; });
        return s.length ? { n: s.length, o35: Math.round(s.filter(g => pays(g, "o35")).length / s.length * 100) } : null;
      };
      return {
        jogos: n, o25: p("o25"), o35: p("o35"), ge5: p("ge5"), ambas: p("ambas"),
        mediaGols: +(gs.reduce((s, g) => s + (g.total || 0), 0) / n).toFixed(2),
        periodos: { madrugada: per(0, 6), manha: per(6, 12), tarde: per(12, 18), noite: per(18, 24) }
      };
    };
    relAcum[liga] = relAcum[liga] || {};
    const nDias = dias.length;
    dias.forEach((gs, i) => { if (gs.length) relAcum[liga][dataBR(nDias - 1 - i)] = resumo(gs); });
    // lista ordenada (mais recente primeiro) com delta vs dia anterior
    const ord = Object.keys(relAcum[liga]).sort((a, b) => {
      const pa = a.split("/").reverse().join(""), pb = b.split("/").reverse().join("");
      return pb.localeCompare(pa);
    });
    const lista = ord.map((data, i) => {
      const r = relAcum[liga][data]; const ant = relAcum[liga][ord[i + 1]];
      let delta = null;
      if (ant) { delta = {}; for (const k of ["o25", "o35", "ge5", "ambas"]) delta[k] = r[k] - ant[k]; }
      return { data, ...r, delta };
    });
    res.json({ liga, dias: lista, aviso: "datas inferidas pela virada de horário; acumulado zera quando o servidor reinicia" });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});


// ===== CADERNO DOS ROBOS (O3.5 + O2.5): dois robos fixos, cada um com saldo persistente =====
const ROBO_FILE = "robo.json";
let roboSha = null;
const ROBO_MKTS = ["o35", "o25", "o25b", "ambas"];

function minutosAgoraSP() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return d.getHours() * 60 + d.getMinutes();
}
function jaPassou(horario, margemMin = 1) {
  const m = String(horario || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const t = Number(m[1]) * 60 + Number(m[2]);
  const agora = minutosAgoraSP();
  if (agora - t > 720) return false;
  if (t - agora > 720) return true;
  return t < agora - margemMin;
}
const ROBO_PISO = { o35: 3.6, o25: 2.0, o25b: 2.3, ambas: 2.0 };
function roboVazio() { return { saldo: 0, ciclos: 0, greens: 0, redsCiclo: 0, aborts: 0, descartes: 0, historico: [], consumidas: {}, ciclo: null }; }
let roboState = { o35: roboVazio(), o25: roboVazio(), o25b: roboVazio(), ambas: roboVazio() };
const fibPrev = {}; // (legado)
let roboTrace = {}; // caixa-preta: por que cada liga entrou/nao entrou (debug)
let entradasLog = []; // foto de cada entrada real (auditoria: subindo ou caindo?)
let ultimoSnapshotCru = {}; // diagnostico: o que a sonda mandou por liga
async function salvaRoboLedger() {
  if (!GH_T) return;
  try {
    const body = { message: "robo", content: Buffer.from(JSON.stringify(roboState, null, 1)).toString("base64"), branch: GH_BRANCH };
    if (roboSha) body.sha = roboSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBO_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); roboSha = j.content.sha; }
  } catch (e) {}
}
function diaHoje() { try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
// TAXA QUE EMPATA: com o gale 1-2-4, cada green rende (odd-1)*1u no 1o tiro (e o mesmo
// liquido nos seguintes) e um ciclo perdido custa 7u. A taxa minima de acerto para empatar
// depende SO da odd media do mercado. E o numero que diz se o robo tem chance matematica.
function empateNecessario(mkt) {
  try {
    const k = mkt === "ambas" ? "ambs" : mkt;
    let soma = 0, n = 0;
    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games) continue;
      for (const g of d.games.slice(-200)) { const o = g.odds && g.odds[k]; if (o > 1.01) { soma += o; n++; } }
    }
    if (!n) return null;
    const odd = soma / n;
    const ganho = odd - 1;              // lucro liquido de um ciclo vencedor (1u no 1o tiro)
    return Math.round(7 / (7 + ganho) * 1000) / 10;
  } catch (e) { return null; }
}

function registraCiclo(mkt, resultado, unidades, detalhe) {
  const L = roboState[mkt];
  L.ciclos++;
  L.dias = L.dias || {};
  const dh = diaHoje();
  L.dias[dh] = Math.round(((L.dias[dh] || 0) + unidades) * 10) / 10;
  const chaves = Object.keys(L.dias).sort();
  if (chaves.length > 60) for (const c of chaves.slice(0, chaves.length - 60)) delete L.dias[c];
  if (resultado === "GREEN") L.greens++; else if (resultado === "RED_CICLO") L.redsCiclo++; else if (resultado === "ABORT") L.aborts++; else L.descartes++;
  L.saldo = Math.round((L.saldo + unidades) * 10) / 10;
  L.historico.unshift({ quando: new Date().toISOString(), resultado, unidades, detalhe });
  L.historico = L.historico.slice(0, 600); // guarda o suficiente para auditar acertos e erros
  salvaRoboLedger();
}
async function carregaRobo() {
  if (GH_T) {
    try {
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${ROBO_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
      if (r.ok) {
        const j = await r.json(); roboSha = j.sha;
        const dados = JSON.parse(Buffer.from(j.content, "base64").toString());
        if (dados && dados.o35 && dados.o35.historico) { for (const m of ROBO_MKTS) if (dados[m]) roboState[m] = { ...roboVazio(), ...dados[m] }; }
        else if (dados && typeof dados.saldo === "number") { // migra formato antigo (robo unico o35)
          roboState.o35 = { ...roboVazio(), saldo: dados.saldo, ciclos: dados.ciclos || 0, greens: dados.greens || 0, redsCiclo: dados.redsCiclo || 0, aborts: dados.aborts || 0, descartes: dados.descartes || 0, historico: dados.historico || [], consumidas: dados.consumidas || {}, ciclo: dados.cicloAberto || null };
        }
      }
    } catch (e) {}
  }
  for (const m of ROBO_MKTS) {
    const c = roboState[m].ciclo;
    if (c && c.alvo && !c.alvo.desde) { registraCiclo(m, "DESCARTADO", 0, `${c.liga} · ciclo antigo sem carimbo anulado no boot`); roboState[m].ciclo = null; }
    const c2 = roboState[m].ciclo;
    if (c2 && c2.degrau >= 3) { roboState[m].ciclo = null; registraCiclo(m, "RED_CICLO", -(c2.apostado || 7), `${c2.liga} · ciclo de 3 tiros fechado no boot (restart no meio do fechamento)`); }
  }
}
carregaRobo();

// ===== ROBO 2-GALE (por mercado): zona azul + piso de odd + maior EV- + 1 ciclo por janela =====
function montaRobo(mkt, rotulo) {
  const piso = ROBO_PISO[rotulo || mkt] || ROBO_PISO[mkt];
  const L = roboState[rotulo || mkt];
  let melhor = null;
  for (const liga of Object.keys(store)) {
    const d = store[liga];
    if (!d || !d.games || d.games.length < 60) continue;
    const games = gamesFundidos(liga); // linha com os resultados rapidos da sonda 2
    const base = games.filter(g => pays(g, mkt)).length / games.length * 100;
    if (!base) continue;
    const JR = Math.max(2, Math.min(20, games.length));
    const sf = chartSeries(games, mkt, JR);
    const cur = sf.length ? sf[sf.length - 1] : null;
    if (cur == null) continue;
    const rel = Math.round(cur / base * 100);
    L.consumidas = L.consumidas || {};
    L.cooldown = L.cooldown || {};
    // ===== v6 MODO CACADOR 100% (ordem do usuario): a Fibonacci chegava atrasada pela
    // cortina de dados -> entradas em queda. Agora o robo SO entra quando um PADRAO 100%
    // do cacador do dia esta disparando NESTE momento (evento nao sofre do atraso da curva).
    let fibInfo = null; // mantido por compatibilidade de payload
    if (L.consumidas[liga]) {
      const idade = Date.now() - (typeof L.consumidas[liga] === "number" ? L.consumidas[liga] : 0);
      if (idade > 60 * 60000) { delete L.consumidas[liga]; salvaRoboLedger(); }
      else continue;
    }
    if (L.cooldown[liga] && Date.now() - L.cooldown[liga] < 30 * 60000) continue;
    let gatilho = null;
    try {
      const pad = calculaPadroes(liga, mkt) || {};
      const cem = arr => (arr || []).filter(p => p.prox === "G" && p.taxa === 100 && p.n >= 8); // robo atira so com 8+ provas (6/6 por sorte e comum demais)
      const evsF = (d.upcoming && d.upcoming[mkt]) || [];
      const fila = evsF.map((p, i) => ({ ...p, _i: i })).filter(p => p.odd != null);
      const porIdx = {}; for (const p of fila) porIdx[p._i] = p;
      const trioExiste = s => porIdx[s] && porIdx[s + 1] && porIdx[s + 2];
      const tk = mkt + "|" + liga;
      roboTrace[tk] = { modo: "cacador100" };
      // dia atual (mesmo corte do cacador) para a cauda das sequencias
      const ga = listaCheia(d);
      let idxDia = 0;
      for (let i2 = 1; i2 < ga.length; i2++) {
        const h1 = parseInt((ga[i2].horario || "").split(":")[0]);
        const h0 = parseInt((ga[i2 - 1].horario || "").split(":")[0]);
        if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idxDia = i2;
      }
      const diaG = ga.slice(idxDia);
      const seqDia = diaG.map(g => (pays(g, mkt) ? "G" : "R")).join("");
      // 1) SEQUENCIA 100%: a fita do dia termina exatamente na sequencia -> proximo trio
      for (const p of cem(pad.padroes)) {
        const s = (p.seq || "").replace(/[^GR]/g, "");
        if (s && seqDia.endsWith(s) && trioExiste(1)) { gatilho = { tipo: "seq", chave: s, n: p.n, start: 1 }; break; }
      }
      // 2) PLACAR 100%: ultimo jogo do dia caiu na categoria -> proximo trio
      if (!gatilho) {
        const gU = diaG[diaG.length - 1];
        if (gU && gU.a != null) {
          const a = gU.a, b = gU.b, tot = a + b, mxx = Math.max(a, b);
          const cat = tot === 0 ? "0-0" : tot === 1 ? "1-0 / 0-1" : mxx >= 3 ? "goleada (3+)" : a === b ? ("empate " + a + "-" + b) : ("acima de 1-0 (" + Math.max(a, b) + "-" + Math.min(a, b) + ")");
          const hit = cem(pad.porPlacar).find(p => p.chave === cat);
          if (hit && trioExiste(1)) gatilho = { tipo: "placar", chave: cat, n: hit.n, start: 1 };
        }
      }
      // 3) TIME 100% na fila -> trio CENTRADO nele (1 antes + NELE + 1 depois, como foi medido)
      if (!gatilho) {
        for (const p of cem(pad.porTime)) {
          const alvo = fila.find(f => f._i >= 1 && ((f.nome || "").split(" x ").some(t => t.trim() === p.chave)));
          if (alvo) { const s = alvo._i >= 2 && trioExiste(alvo._i - 1) ? alvo._i - 1 : (trioExiste(alvo._i) ? alvo._i : null); if (s != null) { gatilho = { tipo: "time", chave: p.chave, n: p.n, start: s }; break; } }
        }
      }
      // 4) ODD 100% na fila -> trio centrado
      if (!gatilho) {
        for (const p of cem(pad.porOdd)) {
          const alvo = fila.find(f => f._i >= 1 && String(f.odd) === String(p.chave));
          if (alvo) { const s = alvo._i >= 2 && trioExiste(alvo._i - 1) ? alvo._i - 1 : (trioExiste(alvo._i) ? alvo._i : null); if (s != null) { gatilho = { tipo: "odd", chave: p.chave, n: p.n, start: s }; break; } }
        }
      }
      // 5) COLUNA (minuto) 100% na fila -> trio centrado
      if (!gatilho) {
        for (const p of cem(pad.porColuna)) {
          const alvo = fila.find(f => f._i >= 1 && (":" + ((f.horario || "").split(":")[1] || "")) === p.chave);
          if (alvo) { const s = alvo._i >= 2 && trioExiste(alvo._i - 1) ? alvo._i - 1 : (trioExiste(alvo._i) ? alvo._i : null); if (s != null) { gatilho = { tipo: "coluna", chave: p.chave, n: p.n, start: s }; break; } }
        }
      }
      roboTrace[tk].gatilho = gatilho ? (gatilho.tipo + " " + gatilho.chave + " (" + gatilho.n + "x)") : null;
    } catch (e) { roboTrace[mkt + "|" + liga] = { erro: e.message }; }
    if (!gatilho) continue;
    // ===== PORTAO DE MOMENTUM (estudo 224 casos: apos GREEN 48% x apos RED 33%) =====
    // o quente continua quente: so atira se o ultimo ciclo FECHADO desta liga neste mercado foi GREEN.
    // Liga fria fica em observacao: gatilhos dela rodam NO PAPEL (0u) e um green observado rearma.
    const ultimoDaLiga = (L.historico || []).find(h => (h.detalhe || "").startsWith(liga + " ") || (h.detalhe || "").startsWith(liga + " ·"));
    const ligaFria = ultimoDaLiga && ultimoDaLiga.resultado !== "GREEN" && ultimoDaLiga.resultado !== "GREEN_OBS";
    if (ligaFria) {
      // observacao de graca: o trio do gatilho teria pago? conferimos nos jogos ja fechados depois
      L._obs = L._obs || {};
      const obsKey = liga;
      if (!L._obs[obsKey] || Date.now() - L._obs[obsKey].desde > 40 * 60000) {
        L._obs[obsKey] = { desde: Date.now(), gatilho: gatilho.tipo + " " + gatilho.chave };
      }
      // confere se desde o inicio da observacao saiu um green no mercado (basta 1 nos fechados recentes)
      const gaObs = listaCheia(d).slice(-3);
      if (gaObs.some(g => pays(g, mkt))) {
        registraCiclo(mkt, "GREEN_OBS", 0, `${liga} · green OBSERVADO no papel (gatilho ${L._obs[obsKey].gatilho}) — liga REARMADA`);
        delete L._obs[obsKey];
      }
      roboTrace[mkt + "|" + liga].momentum = "FRIA (ultimo ciclo red) — observando no papel";
      continue;
    }
    roboTrace[mkt + "|" + liga].momentum = ultimoDaLiga ? "QUENTE (ultimo green)" : "NOVA (liberada)";
    const noBolsao = true; L._gatilhoAtual = gatilho;
    const evs = (d.upcoming && d.upcoming[mkt]) || [];
    const degraus = [], pulados = [];
    const papeis = ["ENTRADA", "GALE 1", "GALE 2"];
    // v4.2 (ordem do usuario): SEM PULAR JOGO NENHUM - degraus sao os 3 PROXIMOS jogos
    // consecutivos da fila (pulando so o iminente, para dar tempo de acompanhar).
    // EV/odd viram referencia exibida; nenhum filtro descarta jogo do meio do ciclo.
    const cands = evs.map((p, i) => ({ ...p, _i: i })).filter(p => p.odd != null);
    // ⚓ tabela de ancoras do DIA (zerada na virada 23h->00h do relogio do jogo)
    let scoreT = () => null;
    try {
      const ga = listaCheia(d, games);
      let idxDia = 0;
      for (let i2 = 1; i2 < ga.length; i2++) {
        const h1 = parseInt((ga[i2].horario || "").split(":")[0]);
        const h0 = parseInt((ga[i2 - 1].horario || "").split(":")[0]);
        if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idxDia = i2;
      }
      const st = {};
      for (const g2 of ga.slice(idxDia)) for (const t2 of [g2.casa, g2.fora]) { if (!t2) continue; (st[t2] = st[t2] || [0, 0])[0]++; if (pays(g2, mkt)) st[t2][1]++; }
      scoreT = t2 => { const s2 = st[t2]; return s2 && s2[0] >= 2 ? s2[1] / s2[0] * 100 : null; };
    } catch (e) {}
    const ancDoJogo = p => { const c1 = scoreT((p.nome || "").split(" x ")[0]), c2 = scoreT((p.nome || "").split(" x ")[1]); const m2 = Math.max(c1 == null ? -1 : c1, c2 == null ? -1 : c2); return m2 >= 0 ? m2 : null; };
    // LARGADA definida pelo GATILHO do padrao (start ja calculado); trio consecutivo obrigatorio
    const porIdx = {}; for (const p of cands) porIdx[p._i] = p;
    let melhorStart = (L._gatilhoAtual && L._gatilhoAtual.start != null) ? L._gatilhoAtual.start : 1;
    if (!(porIdx[melhorStart] && porIdx[melhorStart + 1] && porIdx[melhorStart + 2])) { roboTrace[mkt + "|" + liga].semTrio = true; continue; }
    for (let dgi = 0; dgi < 3; dgi++) {
      const p = porIdx[melhorStart + dgi];
      degraus.push({ papel: papeis[dgi], unidades: [1, 2, 4][dgi], h: p.horario || "", jogo: p.nome, odd: p.odd, justa: p.justa, ev: p.ev, evAlto: p.ev > 10, ancora: ancDoJogo(p) != null ? Math.round(ancDoJogo(p)) : null, col: colunaPct(listaCheia(d, games), p.horario, mkt) });
    }
    let ancoraDia = 0;
    try { let soma = 0, nA = 0; for (const dg of degraus) { if (dg.ancora != null) { soma += dg.ancora; nA++; } } ancoraDia = nA ? Math.round(soma / nA) : 0; } catch (e) {}
    const forcaGatilho = (L._gatilhoAtual && L._gatilhoAtual.n) || 0;
    if (melhor && forcaGatilho <= (melhor.forcaGatilho || 0)) continue; // entre gatilhos 100%, o mais PROVADO (maior n)
    melhor = { mkt, piso, liga, rel, pagando: cur, base: Math.round(base * 10) / 10, degraus, pulados, fib: fibInfo, ancoraDia, forcaGatilho, gatilhoDbg: L._gatilhoAtual ? L._gatilhoAtual.tipo + " " + L._gatilhoAtual.chave : null, teste: false, taxas: taxaJanelas(listaCheia(d, games), mkt) };
  }
  return melhor;
}
const NMR = { o35: "O3.5", o25: "O2.5 A", o25b: "O2.5 B", ambas: "AMBAS" };
function mktReal(m) { return m === "o25b" ? "o25" : m; }

function atualizaRoboMkt(mkt) {
  try {
    const L = roboState[mkt];
    const MK = mktReal(mkt);
    const melhor = montaRobo(MK, mkt);
    const pertenceALiga = (liga, jogo) => {
      const d2 = store[liga]; const g2 = listaCheia(d2);
      const casa = (jogo || "").split(" x ")[0];
      return !!casa && g2.slice(-480).some(x => x.casa === casa);
    };
    if (!L.ciclo) {
      const planoValido = melhor && melhor.degraus && melhor.degraus.length === 3 && !melhor.degraus.some(dg => jaPassou(dg.h));
      if (planoValido && pertenceALiga(melhor.liga, melhor.degraus[0].jogo)) {
        // PLANO SELADO (regra do usuario): os 3 tiros sao travados JUNTOS na abertura - ex copa :10 :13 :16
        const plano = melhor.degraus.map(dg => ({ h: dg.h, jogo: dg.jogo, odd: dg.odd }));
        const d0 = plano[0];
        L.ciclo = { liga: melhor.liga, degrau: 0, apostado: 0, plano, gatilho: melhor.gatilhoDbg || null, alvo: { h: d0.h, jogo: d0.jogo, odd: d0.odd, unidades: 1, desde: Date.now() }, iniciadoEm: Date.now() };
        // FOTO DA ENTRADA (auditoria): a serie estava subindo ou caindo no disparo?
        try {
          const dd = store[melhor.liga];
          const sfx = chartSeries(listaCheia(dd), mkt, Math.max(2, Math.min(20, listaCheia(dd).length))).slice(-100);
          const n7 = sfx.length;
          const ult7 = sfx.slice(-7);
          const kE = 2 / 6; let eAc = sfx[0]; const ema = sfx.map(v => (eAc = v * kE + eAc * (1 - kE)));
          entradasLog.unshift({ hora: new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }), mkt, liga: melhor.liga, jogoT1: d0.jogo + " @" + d0.odd, fib: melhor.fib || null, ancora: melhor.ancoraDia, ult7pontos: ult7, subiuNoUltimo: n7 >= 2 ? sfx[n7 - 1] >= sfx[n7 - 2] : null, emaSubindo: n7 >= 2 ? ema[n7 - 1] > ema[n7 - 2] : null });
          entradasLog = entradasLog.slice(0, 25);
        } catch (e) {}
        salvaRoboLedger();
        try { enviaPushRobo(`🤖 ROBÔ ${NMR[mkt]} ENTROU — ${melhor.liga.toUpperCase()}`, `PLANO: T1 ${plano[0].h} @${plano[0].odd} → T2 ${plano[1].h} @${plano[1].odd} → T3 ${plano[2].h} @${plano[2].odd} · ${plano[0].jogo}`, "robo-" + mkt); } catch (e) {}
      }
      return;
    }
    const d = store[L.ciclo.liga];
    if (!d) return;
    const gAll = gamesFundidos(L.ciclo.liga); // resolucao ~6min mais cedo com a sonda 2
    if (L.ciclo.alvo) {
      if (!L.ciclo.alvo.desde || Date.now() - L.ciclo.alvo.desde > 15 * 60000) {
        if (L.ciclo.apostado === 0) {
          // abortar ANTES da 1a aposta pode (maos vazias)
          registraCiclo(mkt, "DESCARTADO", 0, `${L.ciclo.liga} · alvo sem fechamento em 15min antes da 1a aposta`);
          L.ciclo = null;
        } else {
          const plA = (L.ciclo.plano || [])[L.ciclo.degrau];
          L.ciclo.alvo = (plA && !jaPassou(plA.h)) ? { h: plA.h, jogo: plA.jogo, odd: plA.odd, unidades: [1,2,4][L.ciclo.degrau] || 4, desde: Date.now() } : null;
          salvaRoboLedger();
        }
        return;
      }
      const cauda = gAll.slice(-60);
      let g = cauda.find(x => x.nome === L.ciclo.alvo.jogo && L.ciclo.alvo.h && x.horario === L.ciclo.alvo.h);
      if (!g) { const soNome = cauda.filter(x => x.nome === L.ciclo.alvo.jogo); if (soNome.length === 1) g = soNome[0]; }
      if (g) {
        if (pays(g, MK)) {
          const lucro = Math.round((L.ciclo.alvo.unidades * L.ciclo.alvo.odd - (L.ciclo.apostado + L.ciclo.alvo.unidades)) * 10) / 10;
          L.consumidas = L.consumidas || {}; L.consumidas[L.ciclo.liga] = Date.now();
          L.cooldown = L.cooldown || {}; L.cooldown[L.ciclo.liga] = Date.now();
          const cG = L.ciclo; L.ciclo = null; // anula ANTES: nenhum save intermediario persiste ciclo fechado
          try { enviaPushRobo(`🟢 ${NMR[mkt]} GREEN +${lucro}u — ${cG.liga.toUpperCase()}`, `${cG.alvo.jogo} @${cG.alvo.odd} (tiro ${cG.degrau + 1}) · ciclo encerrado`, "robo-" + mkt); } catch (e) {}
          registraCiclo(mkt, "GREEN", lucro, `${cG.liga} · ${cG.alvo.jogo} @${cG.alvo.odd} (tiro ${cG.degrau + 1})${cG.gatilho ? " · gatilho: " + cG.gatilho : ""}`);
          return;
        }
        L.ciclo.tiros = L.ciclo.tiros || [];
        L.ciclo.tiros.push({ h: L.ciclo.alvo.h, jogo: L.ciclo.alvo.jogo, odd: L.ciclo.alvo.odd, unidades: L.ciclo.alvo.unidades });
        L.ciclo.apostado += L.ciclo.alvo.unidades;
        L.ciclo.degrau++;
        L.ciclo.alvo = null;
        if (L.ciclo.degrau >= 3) {
          const cR = L.ciclo; L.ciclo = null; // anula ANTES do registro (blindagem contra restart no meio)
          L.consumidas = L.consumidas || {}; L.consumidas[cR.liga] = Date.now();
          L.cooldown = L.cooldown || {}; L.cooldown[cR.liga] = Date.now();
          try { enviaPushRobo(`🔴 ${NMR[mkt]} ciclo perdido −${cR.apostado}u — ${cR.liga.toUpperCase()}`, `3 tiros sem green · descanso de 30min na liga`, "robo-" + mkt); } catch (e) {}
          registraCiclo(mkt, "RED_CICLO", -cR.apostado, `${cR.liga} · ciclo perdido (3 tiros)${cR.gatilho ? " · gatilho: " + cR.gatilho : ""}`);
          return;
        }
        const pl = (L.ciclo.plano || [])[L.ciclo.degrau];
        if (pl) L.ciclo.alvo = { h: pl.h, jogo: pl.jogo, odd: pl.odd, unidades: [1, 2, 4][L.ciclo.degrau] || 4, desde: Date.now() };
        salvaRoboLedger();
        try { if (L.ciclo.alvo) enviaPushRobo(`🤖 ${NMR[mkt]} GALE ${L.ciclo.degrau} — ${L.ciclo.liga.toUpperCase()}`, `TIRO ${L.ciclo.degrau + 1} · ${L.ciclo.alvo.unidades}u · ${L.ciclo.alvo.h} · ${L.ciclo.alvo.jogo} @${L.ciclo.alvo.odd} (do plano)`, "robo-" + mkt); } catch (e) {}
      }
    }
    if (!L.ciclo.alvo) {
      if (L.ciclo.degrau >= 3) { // zumbi de degrau 3 (restart no meio do fechamento): fecha como ciclo perdido
        const cZ = L.ciclo; L.ciclo = null;
        L.consumidas = L.consumidas || {}; L.consumidas[cZ.liga] = Date.now();
        L.cooldown = L.cooldown || {}; L.cooldown[cZ.liga] = Date.now();
        registraCiclo(mkt, "RED_CICLO", -(cZ.apostado || 7), `${cZ.liga} · ciclo perdido (3 tiros, fechado pos-reinicio)`);
        return;
      }
      // COMECOU, TERMINA (regra do usuario): o ciclo cumpre os 3 tiros mesmo se a janela fechar.
      // O proximo degrau vem da PROPRIA liga do ciclo: primeiro jogo futuro com odd no piso.
      const evs2 = (d.upcoming && d.upcoming[MK]) || [];
      // pula o jogo iminente (indice 0): alvo novo sempre com folga de ~3min para dar tempo de acompanhar
      const doPlano = (L.ciclo.plano || [])[L.ciclo.degrau];
      const cand = (doPlano && !jaPassou(doPlano.h)) ? { horario: doPlano.h, nome: doPlano.jogo, odd: doPlano.odd } : evs2.find((p, i2) => i2 >= 1 && p.odd != null && !jaPassou(p.horario) && pertenceALiga(L.ciclo.liga, p.nome));
      if (cand) {
        L.ciclo.alvo = { h: cand.horario || "", jogo: cand.nome, odd: cand.odd, unidades: [1, 2, 4][L.ciclo.degrau] || 4, desde: Date.now() };
        // PLANO SELADO: nao reescreve tiro planejado
        L.ciclo.semAlvoDesde = null;
        salvaRoboLedger();
        if (L.ciclo.degrau > 0) try { enviaPushRobo(`🤖 ${NMR[mkt]} GALE ${L.ciclo.degrau} — ${L.ciclo.liga.toUpperCase()}`, `TIRO ${L.ciclo.degrau + 1} · ${[1, 2, 4][L.ciclo.degrau]}u · ${cand.horario ? cand.horario + " · " : ""}${cand.nome} @${cand.odd}`, "robo-" + mkt); } catch (e) {}
      } else {
        // seguranca: sem candidato no piso por 20min (liga parada/sem odds) -> encerra com o apostado
        if (!L.ciclo.semAlvoDesde) { L.ciclo.semAlvoDesde = Date.now(); salvaRoboLedger(); }
        else if (Date.now() - L.ciclo.semAlvoDesde > 20 * 60000 && L.ciclo.apostado === 0) {
          // so encerra de MAOS VAZIAS; com aposta na mesa o ciclo espera o tempo que for (regra do usuario)
          L.consumidas = L.consumidas || {}; L.consumidas[L.ciclo.liga] = Date.now();
          L.cooldown = L.cooldown || {}; L.cooldown[L.ciclo.liga] = Date.now();
          registraCiclo(mkt, "DESCARTADO", 0, `${L.ciclo.liga} · 20min sem jogo na fila`);
          L.ciclo = null;
        }
      }
    }
  } catch (e) { roboTrace["ERRO|" + mkt] = e.message + " @" + String(e.stack||"").split("\n")[1]; console.error("atualizaRoboMkt " + mkt + ":", e.message);}
}
let roboRuns = 0;
function atualizaRoboLedger() { roboRuns++; for (const m of ROBO_MKTS) atualizaRoboMkt(m); }
app.get("/api/robo/exportar", (req, res) => {
  try {
    const linhas = [["data", "hora", "mercado", "resultado", "unidades", "liga", "gatilho", "detalhe"].join(";")];
    const tudo = [];
    for (const m of ROBO_MKTS) for (const h of (roboState[m].historico || [])) tudo.push({ m, ...h });
    tudo.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
    for (const h of tudo) {
      const dt = new Date(h.quando);
      const data = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const hora = dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const det = String(h.detalhe || "");
      const liga = (det.split(" ")[0] || "").replace(/[^a-z]/gi, "");
      const g = det.match(/gatilho:\s*([^·]+)/i);
      linhas.push([data, hora, h.m, h.resultado, h.unidades, liga, g ? g[1].trim() : "", det.replace(/;/g, ",")].join(";"));
    }
    // resumo por mercado no fim
    linhas.push("");
    linhas.push(["RESUMO", "ciclos", "greens", "reds", "descartes", "saldo", "precisa%", "esta%"].join(";"));
    for (const m of ROBO_MKTS) {
      const L = roboState[m], dec = L.greens + L.redsCiclo;
      const e = empateNecessario(m);
      linhas.push(["", L.ciclos, L.greens, L.redsCiclo, L.descartes, L.saldo, e != null ? e + "%" : "-", dec ? Math.round(L.greens / dec * 1000) / 10 + "%" : "-"].join(";"));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="amd-robo-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send("\uFEFF" + linhas.join("\n"));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get("/api/robo/rodar", (req, res) => {
  let err = null;
  try { atualizaRoboLedger(); } catch (e) { err = e.message + " | " + String(e.stack || "").split("\n")[1]; }
  const storeShape = Object.keys(store).map(l => { const d = store[l] || {}; return { liga: l, games: (d.games || []).length, gamesAll: (d.gamesAll || []).length, upcoming: (d.upcomingRaw || []).length, fundidos: gamesFundidos(l).length }; });
  res.json({ err, roboRuns, traceKeys: Object.keys(roboTrace).length, storeShape, roboTrace, estados: Object.fromEntries(ROBO_MKTS.map(m => [m, roboState[m].ciclo ? "CICLO " + roboState[m].ciclo.liga : "vigilia"])) });
});
app.get("/api/snapdiag", (req, res) => { res.json(ultimoSnapshotCru); });
app.get("/api/entradas", (req, res) => { res.json({ total: entradasLog.length, entradas: entradasLog }); });
app.get("/api/robo", (req, res) => {
  try {
    const out = {};
    for (const mkt of ROBO_MKTS) {
      try {
      const L = roboState[mkt];
      let melhor;
      if (L.ciclo) {
        // CICLO ABERTO: a caixa mostra o ciclo REAL (tiros dados + alvo vigiado), nao a previa
        let rel = null;
        try {
          const d2 = store[L.ciclo.liga];
          if (d2 && d2.games && d2.games.length >= 60) {
            const b2 = d2.games.filter(g => pays(g, mkt)).length / d2.games.length * 100;
            const sf2 = chartSeries(d2.games, mkt, Math.max(2, Math.min(20, d2.games.length)));
            const c2 = sf2.length ? sf2[sf2.length - 1] : null;
            if (b2 && c2 != null) rel = Math.round(c2 / b2 * 100);
          }
        } catch (e) {}
        melhor = { cicloView: { liga: L.ciclo.liga, rel, degrau: L.ciclo.degrau, apostado: L.ciclo.apostado, plano: L.ciclo.plano || null, tiros: L.ciclo.tiros || [], alvo: L.ciclo.alvo ? { h: L.ciclo.alvo.h, jogo: L.ciclo.alvo.jogo, odd: L.ciclo.alvo.odd, unidades: L.ciclo.alvo.unidades } : null } };
      } else {
        melhor = montaRobo(mkt) || {};
        if (melhor.liga) melhor.previa = true;
      }
      const dias = L.dias || {};
      const dh2 = diaHoje();
      const somaDias = n => { let s = 0; for (let i = 0; i < n; i++) { const d3 = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); s += dias[d3] || 0; } return Math.round(s * 10) / 10; };
      if (req.query.debug) melhor.trace = Object.fromEntries(Object.entries(roboTrace).filter(([k]) => k.startsWith(mkt + "|") || k.startsWith("ERRO|" + mkt)));
      melhor.travas = { consumidas: Object.fromEntries(Object.entries(L.consumidas || {}).map(([k, v]) => [k, typeof v === "number" ? Math.round((Date.now() - v) / 60000) + "min" : String(v)])), cooldown: Object.fromEntries(Object.entries(L.cooldown || {}).filter(([k, v]) => Date.now() - v < 30 * 60000).map(([k, v]) => [k, Math.round((30 * 60000 - (Date.now() - v)) / 60000) + "min restantes"])) };
      const _dec = L.greens + L.redsCiclo;
      melhor.empate = { precisa: empateNecessario(mkt), esta: _dec ? Math.round(L.greens / _dec * 1000) / 10 : null };
      melhor.registro = { saldo: L.saldo, hoje: Math.round((dias[dh2] || 0) * 10) / 10, semana7: somaDias(7), mes30: somaDias(30), ciclos: L.ciclos, greens: L.greens, redsCiclo: L.redsCiclo, aborts: L.aborts, descartes: L.descartes || 0 };
      if (req.query.view === "panel") {
        melhor.nome = NMR[mkt] || mkt.toUpperCase();
        melhor.historico = (L.historico || []).slice(0, 80).map(h => ({
          quando: h.quando, resultado: h.resultado, unidades: h.unidades, detalhe: h.detalhe
        }));
      }
      if (!melhor.liga && !melhor.cicloView && L.consumidas) {
        for (const liga of Object.keys(L.consumidas)) {
          const d = store[liga]; if (!d || !d.games || d.games.length < 60) continue;
          const base = d.games.filter(g => pays(g, mkt)).length / d.games.length * 100; if (!base) continue;
          const sf = chartSeries(d.games, mkt, Math.max(2, Math.min(20, d.games.length)));
          const cur = sf.length ? sf[sf.length - 1] : null; if (cur == null) continue;
          const rel = Math.round(cur / base * 100);
          if (rel >= 110) { melhor.consumida = { liga, rel }; break; }
        }
      }
      if (req.query.debug) { melhor.dbgCiclo = L.ciclo; melhor.dbgHistorico = L.historico.slice(0, 6); melhor.dbgDias = L.dias || {}; melhor.dbgDiaHoje = diaHoje(); }
      out[mkt] = melhor;
      } catch (eMkt) { out[mkt] = { erro: eMkt.message }; } // um robo quebrado nao derruba os outros
    }
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== CACADOR DE PADROES: sequencias G/R que se repetiram no dia com o mesmo desfecho =====
const padroesCache = {};
function calculaPadroes(liga, mkt) {
    const ck = liga + "|" + mkt, now = Date.now();
    if (padroesCache[ck] && now - padroesCache[ck].ts < 30000) return padroesCache[ck].out;
    const d = store[liga];
    if (!d || !d.games || d.games.length < 200) return { padroes: [], porOdd: [], porTime: [], porPlacar: [], porColuna: [], pulosPorPlacar: [] };
    let games = listaCheia(d);
    // ZERA AS 00 DO JOGO (regra do usuario): o cacador conta SO o dia atual do relogio do jogo
    try {
      let idxDia = 0;
      for (let i2 = 1; i2 < games.length; i2++) {
        const h1 = parseInt((games[i2].horario || "").split(":")[0]);
        const h0 = parseInt((games[i2 - 1].horario || "").split(":")[0]);
        if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idxDia = i2; // virada 23:xx -> 00:xx
      }
      games = games.slice(idxDia);
    } catch (e) {}
    if (games.length < 30) { const outV = { liga, mkt, padroes: [], porOdd: [], porTime: [], dia: true, jogosNoDia: games.length }; padroesCache[ck] = { ts: now, out: outV }; return outV; }
    const seq = games.map(g => (pays(g, mkt) ? "G" : "R"));
    const horas = games.map(g => (g.horario || "").split(":")[0]);
    // DESFECHO NO CICLO DE 3 TIROS (como o usuario opera): apos a sequencia, veio green em ate 3 jogos?
    const grupos = {};
    for (const L of [4, 5]) {
      for (let i = 0; i + L + 2 < seq.length; i++) {
        const chave = seq.slice(i, i + L).join("");
        const tres = seq.slice(i + L, i + L + 3);
        const pagouCiclo = tres.includes("G");
        const g = grupos[chave] || (grupos[chave] = { n: 0, G3: 0, horas: new Set() });
        g.n++; if (pagouCiclo) g.G3++; if (horas[i + L]) g.horas.add(horas[i + L]);
      }
    }
    // regua do CICLO: em qualquer trecho de 3 jogos, quantos % tem pelo menos 1 green?
    let regN = 0, regH = 0;
    for (let i = 0; i + 2 < seq.length; i++) { regN++; if (seq.slice(i, i + 3).includes("G")) regH++; }
    const regua3 = regN ? Math.round(regH / regN * 100) : 0;
    const out = [];
    for (const [chave, g] of Object.entries(grupos)) {
      if (g.n < 5) continue;
      if (g.horas.size < 2) continue; // precisa repetir em horas DIFERENTES
      const taxa3 = Math.round(g.G3 / g.n * 100);
      const edgeG = taxa3 - regua3;          // ciclo paga MAIS que a regua apos essa sequencia
      const edgeR = regua3 - taxa3;          // ciclo MORRE mais que o normal (fuja)
      let prox, taxa, edge;
      if (edgeG >= 15) { prox = "G"; taxa = taxa3; edge = edgeG; }
      else if (edgeR >= 15) { prox = "R"; taxa = 100 - taxa3; edge = edgeR; }
      else continue;
      out.push({ seq: chave, prox, taxa, regua: prox === "G" ? regua3 : 100 - regua3, edge, n: g.n, acertos: prox === "G" ? g.G3 : g.n - g.G3, horas: [...g.horas].sort().slice(0, 6) });
    }
    out.sort((a, b) => b.edge - a.edge || b.n - a.n);
    // ===== CACA PADRAO DE ODD E TIMES (desfecho no ciclo de 3 tiros, vs regua do ciclo) =====
    const okey = mkt === "ambas" ? "ambs" : mkt;
    // janela CENTRADA no jogo do gatilho: 1 antes + NELE + 1 depois (spec do usuario)
    const ciclo3 = i => seq.slice(Math.max(0, i - 1), i + 2).includes("G"); // janela CENTRADA (odd/time: 1 antes · nele · 1 depois)
    const ciclo3Depois = i => seq.slice(i + 1, i + 4).includes("G"); // SO os 3 SEGUINTES (placar/coluna: o que o robo aposta; sem contar o proprio gatilho)
    const porOdd = {}, porTime = {};
    for (let i = 1; i + 1 < games.length; i++) {
      const g = games[i]; const pago = ciclo3(i);
      const ov = g.odds && g.odds[okey] != null ? String(g.odds[okey]) : null;
      if (ov) { (porOdd[ov] = porOdd[ov] || [0, 0])[0]++; if (pago) porOdd[ov][1]++; }
      for (const t of [g.casa, g.fora]) { if (!t) continue; (porTime[t] = porTime[t] || [0, 0])[0]++; if (pago) porTime[t][1]++; }
    }
    const garimpa = (obj, minN) => {
      const arr = [];
      for (const [k, [n, h]] of Object.entries(obj)) {
        if (n < minN) continue;
        const taxaG = Math.round(h / n * 100);
        const eG = taxaG - regua3, eR = regua3 - taxaG;
        if (eG >= 12) arr.push({ chave: k, prox: "G", taxa: taxaG, regua: regua3, edge: eG, n, acertos: h });
        else if (eR >= 12) arr.push({ chave: k, prox: "R", taxa: 100 - taxaG, regua: 100 - regua3, edge: eR, n, acertos: n - h });
      }
      arr.sort((a, b) => b.edge - a.edge || b.n - a.n);
      return arr.slice(0, 8);
    };
    // ===== FAMILIA 1: GATILHO POR PLACAR (linha de baixo / jogos em cima de 1-0) =====
    // o ciclo iniciado num jogo com esse PLACAR paga green em ate 3 tiros?
    const catPlacar = g => {
      const a = g.a, b = g.b, tot = (a || 0) + (b || 0), mx = Math.max(a || 0, b || 0);
      if (tot === 0) return "0-0";
      if (tot === 1) return "1-0 / 0-1";
      if (mx >= 3) return "goleada (3+)";
      if (a === b) return "empate " + a + "-" + b;
      return "acima de 1-0 (" + Math.max(a, b) + "-" + Math.min(a, b) + ")";
    };
    const porPlacar = {};
    for (let i = 0; i + 1 < games.length; i++) {
      const cat = catPlacar(games[i]); const pago = ciclo3Depois(i);
      (porPlacar[cat] = porPlacar[cat] || [0, 0])[0]++; if (pago) porPlacar[cat][1]++;
    }
    // ===== FAMILIA 2: PADRAO DE COLUNA (minuto do relogio) =====
    const porColuna = {};
    for (let i = 1; i + 1 < games.length; i++) {
      const min = (games[i].horario || "").split(":")[1]; if (!min) continue;
      const pago = ciclo3Depois(i);
      (porColuna[":" + min] = porColuna[":" + min] || [0, 0])[0]++; if (pago) porColuna[":" + min][1]++;
    }
    // ===== FAMILIA 3: PADRAO DE PULO (distancia entre greens: 5, 6, 10 casas...) =====
    // ===== CACA-PADROES AUTOMATICO: varre DEZENAS de eventos e acha sozinho os que se repetem como metronomo =====
    const soma2 = (a, b) => a + b;
    const totGols = g => (g.a || 0) + (g.b || 0);
    const mx = g => Math.max(g.a || 0, g.b || 0);
    // biblioteca de eventos testados (cada um: nome + funcao que diz se o jogo i "e" esse evento)
    const eventos = [];
    // A) cada placar exato que apareceu >=3x
    const contaPl = {}; for (const g of games) if (g.a != null) contaPl[g.a + "-" + g.b] = (contaPl[g.a + "-" + g.b] || 0) + 1;
    for (const pl of Object.keys(contaPl)) if (contaPl[pl] >= 3) eventos.push({ nome: "placar " + pl, fn: g => (g.a + "-" + g.b) === pl });
    // B) mercados e faixas de gols
    eventos.push({ nome: "Over 2.5", fn: g => totGols(g) >= 3 });
    eventos.push({ nome: "Under 2.5", fn: g => totGols(g) < 3 });
    eventos.push({ nome: "Over 3.5", fn: g => totGols(g) >= 4 });
    eventos.push({ nome: "Ambas marcam", fn: g => (g.a || 0) > 0 && (g.b || 0) > 0 });
    eventos.push({ nome: "0-0 seco", fn: g => totGols(g) === 0 });
    eventos.push({ nome: "goleada (3+ de um)", fn: g => mx(g) >= 3 });
    eventos.push({ nome: "jogo de 1 gol só", fn: g => totGols(g) === 1 });
    eventos.push({ nome: "acima de 1-0 (2+ gols)", fn: g => totGols(g) >= 2 });
    eventos.push({ nome: "empate", fn: g => (g.a || 0) === (g.b || 0) });
    // C) o proprio mercado selecionado (green/red) como evento
    eventos.push({ nome: "GREEN do mercado", fn: g => pays(g, mkt) });

    const stdev = arr => { const m = arr.reduce(soma2, 0) / arr.length; return Math.sqrt(arr.map(x => (x - m) ** 2).reduce(soma2, 0) / arr.length); };
    const achados = [];
    for (const ev of eventos) {
      const pos = []; for (let i = 0; i < games.length; i++) if (ev.fn(games[i])) pos.push(i);
      if (pos.length < 4) continue; // precisa de pelo menos 3 pulos
      const gaps = []; for (let i = 1; i < pos.length; i++) gaps.push(pos[i] - pos[i - 1]);
      const media = gaps.reduce(soma2, 0) / gaps.length;
      if (media < 1.5) continue; // evento quase todo jogo nao tem "pulo" util
      const cv = media ? stdev(gaps) / media : 9; // coef de variacao
      const regular = Math.max(0, Math.round((1 - cv) * 100)); // 100 = metronomo perfeito
      if (regular < 45) continue; // so entra o que realmente se repete
      const cont = {}; for (const gp of gaps) cont[gp] = (cont[gp] || 0) + 1;
      const comum = +Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
      const desde = games.length - 1 - pos[pos.length - 1];
      achados.push({ nome: ev.nome, regular, puloMedio: Math.round(media * 10) / 10, puloComum: comum, vezes: pos.length, ultimos: gaps.slice(-6), desde, prontoAgora: desde === comum, quaseProximo: comum - desde });
    }
    achados.sort((a, b) => b.regular - a.regular || b.vezes - a.vezes);
    const pulosPorPlacar = achados.slice(0, 14);

    const resp = { liga, mkt, jogosNoDia: games.length, regua3, padroes: out.slice(0, 10), porOdd: garimpa(porOdd, 6), porTime: garimpa(porTime, 6),
      porPlacar: garimpa(porPlacar, 6), porColuna: garimpa(porColuna, 5), pulosPorPlacar };
    padroesCache[ck] = { ts: now, out: resp };
    return resp;
}
// ===== 🔮 LEITOR DE GRAFICO: codifica o desenho da curva e aprende o que vem depois =====
// A curva anda em degraus; os ultimos 6 movimentos viram assinatura (ex "UUFDDU":
// U=subiu D=desceu F=ficou). Para cada assinatura no historico do dia+memoria (ate ~600 jogos),
// mede: green em ate 3 casas depois veio quantas vezes? Compara com a regua. So mostra
// desenho com 8+ aparicoes e 12+ pts de edge. Mede a propria pontaria.
const leitorCache = {};
function leitorGrafico(liga, mkt) {
  const ck = "L|" + liga + "|" + mkt, now = Date.now();
  if (leitorCache[ck] && now - leitorCache[ck].ts < 30000) return leitorCache[ck].out;
  const d = store[liga];
  if (!d || !d.games) return null;
  const games = listaCheia(d);
  if (games.length < 120) return null;
  const JL = 20;
  const serie = chartSeries(games, mkt, JL); // ponto k <-> jogo k+JL-1
  if (!serie || serie.length < 40) return null;
  // movimentos: U/D/F entre pontos consecutivos
  const mov = [];
  for (let i = 1; i < serie.length; i++) mov.push(serie[i] > serie[i - 1] ? "U" : serie[i] < serie[i - 1] ? "D" : "F");
  // pays por jogo alinhado ao ponto: ponto k -> jogo k+JL-1; movimento m (entre k e k+1) -> jogo do ponto k+1
  const pagaDoMov = i => { const gi = (i + 1) + JL - 1; return gi < games.length ? (pays(games[gi], mkt) ? 1 : 0) : null; };
  const TAM = 6, ALVO = 3;
  // FAIXA DO GRAFICO (contexto): o mesmo desenho no FUNDO, MEIO ou TOPO e outro animal.
  // base do dia inteiro como referencia; ponto k da serie e comparado a ela.
  const baseRef = (() => { let h = 0; for (const g of games) if (pays(g, mkt)) h++; return games.length ? h / games.length * 100 : 0; })();
  const faixaDe = v => { if (!baseRef) return "M"; const rl = v / baseRef * 100; return rl < 85 ? "F" : rl > 115 ? "T" : "M"; };
  const memoria = {};
  let reguaH = 0, reguaN = 0;
  for (let i = TAM - 1; i + ALVO < mov.length; i++) {
    const assin = faixaDe(serie[i + 1]) + "·" + mov.slice(i - TAM + 1, i + 1).join("");
    // green em ate 3 casas DEPOIS do desenho fechar
    let veio = 0;
    for (let k = 1; k <= ALVO; k++) { const pg = pagaDoMov(i + k); if (pg === 1) { veio = 1; break; } }
    (memoria[assin] = memoria[assin] || [0, 0])[0]++; if (veio) memoria[assin][1]++;
    reguaN++; if (veio) reguaH++;
  }
  const regua = reguaN ? Math.round(reguaH / reguaN * 100) : 0;
  // desenho ATUAL (ultimos TAM movimentos) + faixa atual
  const atual = faixaDe(serie[serie.length - 1]) + "·" + mov.slice(-TAM).join("");
  const stAtual = memoria[atual] || null;
  const achados = [];
  for (const [assin, [n, h]] of Object.entries(memoria)) {
    if (n < 8) continue;
    const taxa = Math.round(h / n * 100);
    const eG = taxa - regua, eR = regua - taxa;
    if (eG >= 12) achados.push({ desenho: assin, prox: "G", taxa, edge: eG, n });
    else if (eR >= 12) achados.push({ desenho: assin, prox: "R", taxa: 100 - taxa, edge: eR, n });
  }
  achados.sort((a, b) => b.edge - a.edge || b.n - a.n);
  // pontaria do leitor: das vezes que o desenho atual (quando tinha edge) apontou, acertou quanto?
  const out = {
    liga, mkt, regua, jogos: games.length,
    desenhoAtual: atual,
    atualNaMemoria: stAtual ? { n: stAtual[0], taxa: Math.round(stAtual[1] / stAtual[0] * 100) } : null,
    sinalAgora: (() => {
      const hit = achados.find(a => a.desenho === atual);
      return hit ? { prox: hit.prox, taxa: hit.taxa, edge: hit.edge, n: hit.n } : null;
    })(),
    topDesenhos: achados.slice(0, 8)
  };
  leitorCache[ck] = { ts: now, out };
  return out;
}
app.get("/api/leitor/:liga", (req, res) => {
  try { const o = leitorGrafico(req.params.liga, req.query.mkt || "o35"); res.json(o || { erro: "base insuficiente" }); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== CACADOR DE CRUZAMENTOS (spec do usuario): nada e fixo no virtual, entao ele DESCOBRE
// sozinho quais combinacoes estao 100% no dia (00h -> 23:59), cruzando odd x time x placar x
// coluna, e testando ATRASO: o gatilho de agora pode chamar o pagamento em +0/1/2/3/4 horas.
// Regra dura: minimo 8 casos e 100% cravado. Devolve tambem quantos testes rodaram, porque
// milhares de combinacoes produzem 100% por acaso - o numero de testes e parte da leitura.
const cruzaCache = {};
// ===== TESTE DA FUNDACAO: o padrao 100% do cacador acerta o PROXIMO JOGO acima da base?
// Caminha a historia em ordem; quando um padrao atinge 100% com n>=8 (a regra do robo),
// registra o resultado do PROXIMO JOGO (o 1o tiro) - UMA observacao por consagracao.
// Compara com a base do proprio mercado. Se o ganho for ~0, o gatilho nao prediz nada. =====
app.get("/api/teste-fundacao", (req, res) => {
  try {
    const MKTS = ["o25", "o35", "ambas"];
    const linhas = [];
    const agreg = {};
    for (const liga of LIGAS) {
      const d = store[liga]; if (!d || !d.games || d.games.length < 300) continue;
      const games = listaCheia(d);
      for (const mkt of MKTS) {
        const k0 = mkt === "ambas" ? "ambs" : mkt;
        const paga = g => pays(g, mkt);
        const base = games.filter(paga).length / games.length;
        const catPl = g => { const a = g.a || 0, b = g.b || 0, t = a + b, m = Math.max(a, b); return t === 0 ? "0-0" : t === 1 ? "1gol" : m >= 3 ? "goleada" : a === b ? "empate" : "acima1-0"; };
        // chaves-gatilho de cada jogo (as mesmas familias que o robo usa)
        const chavesDe = (g, i, seq) => {
          const L = [];
          const od = g.odds && g.odds[k0]; if (od > 1.01) L.push("odd@" + od.toFixed(2));
          if (g.a != null) L.push("placar:" + catPl(g));
          const mm = (g.horario || "").split(":")[1]; if (mm) L.push("col:" + mm);
          const par = (g.nome || "").split(/\s+x\s+/i);
          if (par[0]) L.push("time:" + par[0].trim());
          if (par[1]) L.push("time:" + par[1].trim());
          if (i >= 4) L.push("seq:" + seq.slice(i - 4, i + 1).join(""));
          return L;
        };
        const seq = games.map(g => (paga(g) ? "G" : "R"));
        // MESMA REGRA DO CACADOR: o desfecho e o CICLO (green em ate 3 jogos depois)
        const cicloPagou = i => { for (let k = i + 1; k <= i + 3 && k < games.length; k++) if (paga(games[k])) return true; return (i + 3 < games.length) ? false : null; };
        // regua do ciclo (para comparar) e base do jogo unico
        let rn = 0, rh = 0;
        for (let i = 0; i + 3 < games.length; i++) { const r = cicloPagou(i); if (r === null) continue; rn++; if (r) rh++; }
        const reguaCiclo = rn ? rh / rn : 0;
        const stat = {};
        let testadas = 0, acertosCiclo = 0, acertosTiro1 = 0;
        for (let i = 0; i + 4 < games.length; i++) {
          const desf = cicloPagou(i); if (desf === null) continue;
          const tiro1 = paga(games[i + 1]);
          for (const ch of chavesDe(games[i], i, seq)) {
            const s = stat[ch] || (stat[ch] = { n: 0, h: 0, aguardando: false });
            if (s.aguardando) {           // JA estava 100%: prova fora da amostra
              s.aguardando = false;
              testadas++; if (desf) acertosCiclo++; if (tiro1) acertosTiro1++;
            }
            s.n++; if (desf) s.h++;
            if (s.n >= 8 && s.h === s.n) s.aguardando = true;
          }
        }
        if (testadas < 15) continue;
        const tC = acertosCiclo / testadas, t1 = acertosTiro1 / testadas;
        linhas.push({ liga, mkt, casos: testadas,
          cicloDepois: Math.round(tC * 1000) / 10, reguaCiclo: Math.round(reguaCiclo * 1000) / 10, ganhoCiclo: Math.round((tC - reguaCiclo) * 1000) / 10,
          tiro1Depois: Math.round(t1 * 1000) / 10, baseTiro1: Math.round(base * 1000) / 10, ganhoTiro1: Math.round((t1 - base) * 1000) / 10 });
        const a = agreg[mkt] || (agreg[mkt] = { n: 0, hC: 0, h1: 0, rn: 0, rs: 0, bs: 0 });
        a.n += testadas; a.hC += acertosCiclo; a.h1 += acertosTiro1; a.rn++; a.rs += reguaCiclo; a.bs += base;
      }
    }
    const resumo = Object.entries(agreg).map(([mkt, a]) => ({
      mkt, casos: a.n,
      cicloDepois: Math.round(a.hC / a.n * 1000) / 10, reguaCiclo: Math.round(a.rs / a.rn * 1000) / 10,
      ganhoCiclo: Math.round((a.hC / a.n - a.rs / a.rn) * 1000) / 10,
      tiro1Depois: Math.round(a.h1 / a.n * 1000) / 10, baseTiro1: Math.round(a.bs / a.rn * 1000) / 10,
      ganhoTiro1: Math.round((a.h1 / a.n - a.bs / a.rn) * 1000) / 10
    }));
    const totN = Object.values(agreg).reduce((s, a) => s + a.n, 0);
    const totC = Object.values(agreg).reduce((s, a) => s + a.hC, 0);
    const tot1 = Object.values(agreg).reduce((s, a) => s + a.h1, 0);
    const reg = Object.values(agreg).reduce((s, a) => s + (a.rs / a.rn) * a.n, 0) / (totN || 1);
    const bas = Object.values(agreg).reduce((s, a) => s + (a.bs / a.rn) * a.n, 0) / (totN || 1);
    res.json({
      pergunta: "o padrao 100% (regra do robo) prediz o que vem depois?",
      GERAL: { casos: totN,
        ciclo: Math.round(totC / totN * 1000) / 10, reguaCiclo: Math.round(reg * 1000) / 10, ganhoCiclo: Math.round((totC / totN - reg) * 1000) / 10,
        tiro1: Math.round(tot1 / totN * 1000) / 10, baseTiro1: Math.round(bas * 1000) / 10, ganhoTiro1: Math.round((tot1 / totN - bas) * 1000) / 10 },
      porMercado: resumo, detalhe: linhas.sort((a, b) => b.ganhoCiclo - a.ganhoCiclo)
    });
  } catch (e) { res.status(500).json({ erro: e.message, linha: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/cruzamentos/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o35";
    const ck = liga + "|" + mkt, now = Date.now();
    if (cruzaCache[ck] && now - cruzaCache[ck].ts < 60000) return res.json(cruzaCache[ck].out);
    const d = store[liga];
    if (!d || !d.games || d.games.length < 60) return res.json({ achados: [], testes: 0, erro: "base insuficiente" });
    const games = listaCheia(d);
    // dia do jogo: 00h -> 23:59 pelo relogio do jogo
    let idxDia = 0;
    for (let i = 1; i < games.length; i++) {
      const h1 = parseInt((games[i].horario || "").split(":")[0]);
      const h0 = parseInt((games[i - 1].horario || "").split(":")[0]);
      if (!isNaN(h1) && !isNaN(h0) && h1 < h0 - 12) idxDia = i;
    }
    const dia = games.slice(idxDia);
    if (dia.length < 60) return res.json({ achados: [], testes: 0, erro: "dia ainda curto" });
    const k0 = mkt === "ambas" ? "ambs" : mkt;
    const paga = g => pays(g, mkt);
    // ciclo de 3 tiros a partir de um ponto
    const cicloPagou = ini => { for (let k = ini; k < Math.min(ini + 3, dia.length); k++) if (paga(dia[k])) return true; return (ini + 3 <= dia.length) ? false : null; };
    // atributos de cada jogo
    const catPl = g => { const a = g.a || 0, b = g.b || 0, t = a + b, m = Math.max(a, b); return t === 0 ? "0-0" : t === 1 ? "1gol" : m >= 3 ? "goleada" : a === b ? ("empate" + a) : ("acima1-0(" + Math.max(a,b) + "-" + Math.min(a,b) + ")"); };
    const atributos = g => {
      const L = [];
      const od = g.odds && g.odds[k0]; if (od > 1.01) L.push("odd@" + od.toFixed(2));
      if (g.a != null) L.push("placar:" + catPl(g));
      const mm = (g.horario || "").split(":")[1]; if (mm) L.push("col::" + mm);
      const nm = (g.nome || ""); const par = nm.split(/\s+x\s+/i);
      if (par[0]) L.push("time:" + par[0].trim());
      if (par[1]) L.push("time:" + par[1].trim());
      return L;
    };
    // indices por chave simples e por CRUZAMENTO (par de atributos no mesmo jogo)
    const ondeAparece = {};
    dia.forEach((g, i) => {
      const A = atributos(g);
      for (let x = 0; x < A.length; x++) {
        (ondeAparece[A[x]] = ondeAparece[A[x]] || []).push(i);
        for (let y = x + 1; y < A.length; y++) {
          if (A[x].split(":")[0] === A[y].split(":")[0]) continue; // nao cruza tipo com ele mesmo
          const key = A[x] + " + " + A[y];
          (ondeAparece[key] = ondeAparece[key] || []).push(i);
        }
      }
    });
    const JOGOS_HORA = 20;
    const ATRASOS = [{ h: "agora", n: 1 }, { h: "+1h", n: JOGOS_HORA }, { h: "+2h", n: 2 * JOGOS_HORA }, { h: "+3h", n: 3 * JOGOS_HORA }, { h: "+4h", n: 4 * JOGOS_HORA }];
    let testes = 0;
    const achados = [];
    for (const [chave, idxs] of Object.entries(ondeAparece)) {
      if (idxs.length < 8) continue;
      for (const at of ATRASOS) {
        let n = 0, h = 0;
        for (const i of idxs) {
          const r = cicloPagou(i + at.n);
          if (r === null) continue;
          n++; if (r) h++;
        }
        testes++;
        if (n >= 8 && h === n) achados.push({ chave, quando: at.h, n, cruzado: chave.includes(" + ") });
      }
    }
    // regua do dia para comparacao honesta
    let rn = 0, rh = 0;
    for (let i = 0; i + 3 <= dia.length; i++) { rn++; if (cicloPagou(i)) rh++; }
    const regua = rn ? Math.round(rh / rn * 1000) / 10 : null;
    achados.sort((a, b) => (b.cruzado - a.cruzado) || (b.n - a.n));
    const out = { liga, mkt, jogosNoDia: dia.length, desde: (dia[0] || {}).horario || "", regua, testes, achados: achados.slice(0, 25) };
    cruzaCache[ck] = { ts: now, out };
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message, linha: String(e.stack || "").split("\n")[1] }); }
});

app.get("/api/padroes/:liga", (req, res) => {
  try { res.json(calculaPadroes(req.params.liga, req.query.mkt || "o35")); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== DICAS: 3 melhores do quadro (todas as ligas) para o mercado, com carimbo honesto =====
const dicasCache = {};
app.get("/api/dicas", (req, res) => {
  try {
    const mkt = req.query.mkt || "o35";
    if (mkt === "totft") return res.json([]);
    const now = Date.now();
    if (dicasCache[mkt] && now - dicasCache[mkt].ts < 15000) return res.json(dicasCache[mkt].out);
    const tudo = [];
    for (const liga of Object.keys(store)) {
      const d = store[liga];
      if (!d || !d.games || d.games.length < 60) continue;
      const games = d.games;
      const base = games.filter(g => pays(g, mkt)).length / games.length * 100;
      if (!base) continue;
      const JR = Math.max(2, Math.min(20, games.length));
      const sf = chartSeries(games, mkt, JR);
      const cur = sf.length ? sf[sf.length - 1] : null;
      if (cur == null) continue;
      const rel = Math.round(cur / base * 100);
      const evs = (d.upcoming && d.upcoming[mkt]) || []; // avaliacoes prontas no store (aninhadas em upcoming)
      if (!Array.isArray(evs) || !evs.length) continue;
      // rank da rodada dentro da liga (1o = maior score)
      const porScore = evs.filter(p => p.score != null).slice().sort((a, b) => b.score - a.score);
      const rankDe = {}; porScore.forEach((p, i) => rankDe[p.nome] = i + 1);
      for (const p of evs) {
        if (p.odd == null || p.ev == null) continue;
        const rank = rankDe[p.nome] || null;
        const anc = d.ancoras && d.ancoras[p.nome] ? (d.ancoras[p.nome].nivel || "SIM") : null;
        const veto = /CONTRA|TOPO/i.test(p.motivo || "");
        // METODO v2: preco = PISO DE ODD da zona (chances reais medidas: O3.5 31% -> odd>=3.60; O2.5 54% -> odd>=2.00)
        const piso = ({ o35: 3.6, o25: 2.0 })[mkt] || null;
        const oddOk = !!(piso && p.odd >= piso);
        const evAlto = p.ev > 10; // historicamente decepciona: a casa costuma estar certa
        const grade = (rel < 60 && oddOk) ? "entrada" : (rel < 60 || (rel < 75 && oddOk)) ? "observar" : "aguardar";
        const nota = (100 - rel) * 2 + (oddOk ? 10 : 0) - (evAlto ? 8 : 0) + (rank === 1 ? 12 : rank === 2 ? 6 : 0) + (anc ? 8 : 0) - (veto ? 10 : 0);
        tudo.push({ liga, rel, pagando: cur, base: Math.round(base * 10) / 10, h: p.horario || "", jogo: p.nome, odd: p.odd, justa: p.justa, ev: p.ev, evAlto, piso, oddOk, rank, anc, veto, grade, nota, col: colunaPct(listaCheia(d, games), p.horario, mkt) });
      }
    }
    tudo.sort((a, b) => b.nota - a.nota);
    const out = tudo.slice(0, 3).map(({ nota, ...r }) => r);
    if (req.query.debug) {
      const dbg = { v: 3, ligasNoStore: Object.keys(store), porLiga: {} };
      // chaves de odds reais (pra descobrir se casa5+/fora5+ chegam no snapshot)
      const dLiga = store[Object.keys(store)[0]];
      if (dLiga) {
        const gU = (dLiga.upcomingRaw || [])[0];
        const gP = (dLiga.games || [])[dLiga.games.length - 1];
        dbg.oddsKeysUpcoming = gU && gU.odds ? Object.keys(gU.odds) : null;
        dbg.oddsKeysPassado = gP && gP.odds ? Object.keys(gP.odds) : null;
      }
      for (const liga of Object.keys(store)) {
        const d = store[liga];
        const evs = (d && d.upcoming && d.upcoming[mkt]) || [];
        dbg.porLiga[liga] = { nGames: d && d.games ? d.games.length : 0, tipoDmkt: typeof (d && d.upcoming && d.upcoming[mkt]), nEvs: Array.isArray(evs) ? evs.length : -1,
          chavesPrimeiro: Array.isArray(evs) && evs[0] ? Object.keys(evs[0]).slice(0, 14) : null };
      }
      return res.json(dbg);
    }
    dicasCache[mkt] = { ts: now, out };
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO DO PULO: P(pagar | seca atual do mercado) + distribuicao dos saltos entre greens =====
app.get("/api/estudopulo/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o35";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 300) return res.json({ erro: "historico insuficiente" });
    const games = listaCheia(d);
    // SERIE IDENTICA A DO GRAFICO NORMAL, so trocando a conta:
  // normal  = % dos ultimos 20 jogos (janela que anda e esquece)
  // acumulado = % do TOTAL desde as 00h (cada pagamento vale o mesmo, soma o dia inteiro)
  // Comeca no 20o jogo pelo mesmo motivo que o normal comeca: antes disso nao ha janela cheia.
  // SERIE = VALOR ACUMULADO: cada jogo soma o que ele vale de verdade.
  //   green -> + (odd - 1)   |   red -> - 1
  // Soma reta das 00h. Diferente da media (que converge e vira reta), aqui o passo de cada
  // jogo continua pesando o dia inteiro: a linha ganha relevo, topo, fundo e retracao.
  // FAIXAS DE TEMPO: a mesma conta (soma reta), mas comecando em pontos diferentes.
  // Faixa curta (3h) sobe/desce facil; faixa longa (18h) precisa de muito mais pagamentos
  // para mexer - exatamente como as medias por faixa de horario.
  const JOGOS_POR_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  const montaFaixa = arr => {
    if (arr.length < 25) return null;
    const s = [], hs = [];
    let pg = 0;
    arr.forEach((g, i) => { if (pays(g, mkt)) pg++; if (i >= 19) { s.push(Math.round(pg / (i + 1) * 1000) / 10); hs.push(g.horario || ""); } });
    return { serie: s, horas: hs, macd: s.length > 3 ? (macdData(s).hist || []) : [] };
  };
  for (const h of [3, 6, 12, 18]) {
    const n = h * JOGOS_POR_HORA;
    if (games.length >= n + 25) faixasAcum["h" + h] = montaFaixa(games.slice(-n));
  }
  faixasAcum.dia = montaFaixa(dia);
  const fDia = faixasAcum.dia || { serie: [], horas: [], macd: [] };
  const serie = fDia.serie;
  const serieHoras = fDia.horas;
  const macdHist = fDia.macd;
  const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 1000) / 10;
    // P(pagar | seca atual = k) e histograma dos pulos realizados
    const porSeca = {}; // k -> [n, pagou]
    const pulos = {};   // tamanho do salto -> vezes
    let seca = null;
    for (const g of games) {
      const pagou = pays(g, mkt);
      if (seca != null) {
        const k = seca >= 10 ? "10+" : String(seca);
        porSeca[k] = porSeca[k] || [0, 0]; porSeca[k][0]++; if (pagou) porSeca[k][1]++;
      }
      if (pagou) { if (seca != null) { const p = seca >= 12 ? "12+" : String(seca); pulos[p] = (pulos[p] || 0) + 1; } seca = 0; }
      else if (seca != null) seca++;
      else seca = pagou ? 0 : null;
      if (seca == null && !pagou) seca = 1;
    }
    const ps = {}; const ordem = ["0","1","2","3","4","5","6","7","8","9","10+"];
    for (const k of ordem) if (porSeca[k]) ps[k] = { jogos: porSeca[k][0], pagou: Math.round(porSeca[k][1] / porSeca[k][0] * 100) };
    res.json({ liga, mkt, base, P_pagar_dado_seca: ps, distribuicao_pulos: pulos });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ACUMULADOR DIARIO POR FAIXA DE HORA (persistente): responde se existe ciclo diario =====
const HORAS_FILE = "horas.json";
let horasSha = null;
let horasData = {};
async function carregaHoras() {
  if (!GH_T) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${HORAS_FILE}?ref=${GH_BRANCH}`, { headers: ghHead() });
    if (r.ok) { const j = await r.json(); horasSha = j.sha; horasData = JSON.parse(Buffer.from(j.content, "base64").toString()) || {}; }
  } catch (e) {}
}
async function salvaHoras() {
  if (!GH_T) return;
  try {
    const body = { message: "horas", content: Buffer.from(JSON.stringify(horasData)).toString("base64"), branch: GH_BRANCH };
    if (horasSha) body.sha = horasSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${HORAS_FILE}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); horasSha = j.content.sha; }
  } catch (e) {}
}
carregaHoras();
function acumulaHoras() {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const agrupa = {};
    for (const liga of Object.keys(store)) {
      const d = store[liga]; const gAll = (d && d.gamesAll) || []; if (!gAll.length) continue;
      // separa os segmentos pela virada do dia (hora despenca: 23:xx -> 00:xx)
      const seg = [[]];
      for (const g of gAll) {
        const h = parseInt((g.horario || "").split(":")[0]); if (isNaN(h)) continue;
        const atual = seg[seg.length - 1];
        if (atual.length) { const hp = parseInt((atual[atual.length - 1].horario || "").split(":")[0]); if (h < hp - 12) seg.push([]); }
        seg[seg.length - 1].push(g);
      }
      const segs = seg.slice(-2);
      const datas = segs.length === 2 ? [ontem, hoje] : [hoje];
      segs.forEach((sg, ix) => {
        const data = datas[ix]; agrupa[data] = agrupa[data] || {};
        for (const mkt of ["o25", "o35", "ambas", "ge5"]) {
          const m = agrupa[data][mkt] = agrupa[data][mkt] || { "00-07": [0, 0], "07-12": [0, 0], "12-18": [0, 0], "18-24": [0, 0] };
          for (const g of sg) {
            const h = parseInt((g.horario || "").split(":")[0]); if (isNaN(h)) continue;
            const f = h < 7 ? "00-07" : h < 12 ? "07-12" : h < 18 ? "12-18" : "18-24";
            m[f][0]++; if (pays(g, mkt)) m[f][1]++;
          }
        }
      });
    }
    for (const [data, v] of Object.entries(agrupa)) horasData[data] = v; // sobrescreve: idempotente, sem dupla contagem
    salvaHoras();
  } catch (e) {}
}
setTimeout(acumulaHoras, 4 * 60000);
setInterval(acumulaHoras, 30 * 60000);
app.get("/api/horas", (req, res) => {
  try {
    const tot = {};
    for (const dia of Object.values(horasData)) for (const [mkt, fx] of Object.entries(dia)) for (const [f, [n, h]] of Object.entries(fx)) { (tot[mkt] = tot[mkt] || {}); (tot[mkt][f] = tot[mkt][f] || [0, 0]); tot[mkt][f][0] += n; tot[mkt][f][1] += h; }
    const fmt = {};
    for (const [mkt, fx] of Object.entries(tot)) { fmt[mkt] = {}; for (const [f, [n, h]] of Object.entries(fx)) fmt[mkt][f] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null }; }
    res.json({ diasAcumulados: Object.keys(horasData).sort(), total: fmt });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO HORA DO DIA: pagamento por faixa de hora (hipotese: madrugada paga mais, manha menos) =====
app.get("/api/estudohora/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o25";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 200) return res.json({ erro: "historico insuficiente" });
    const games = listaCheia(d);
    // SERIE IDENTICA A DO GRAFICO NORMAL, so trocando a conta:
  // normal  = % dos ultimos 20 jogos (janela que anda e esquece)
  // acumulado = % do TOTAL desde as 00h (cada pagamento vale o mesmo, soma o dia inteiro)
  // Comeca no 20o jogo pelo mesmo motivo que o normal comeca: antes disso nao ha janela cheia.
  // SERIE = VALOR ACUMULADO: cada jogo soma o que ele vale de verdade.
  //   green -> + (odd - 1)   |   red -> - 1
  // Soma reta das 00h. Diferente da media (que converge e vira reta), aqui o passo de cada
  // jogo continua pesando o dia inteiro: a linha ganha relevo, topo, fundo e retracao.
  // FAIXAS DE TEMPO: a mesma conta (soma reta), mas comecando em pontos diferentes.
  // Faixa curta (3h) sobe/desce facil; faixa longa (18h) precisa de muito mais pagamentos
  // para mexer - exatamente como as medias por faixa de horario.
  const JOGOS_POR_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  const montaFaixa = arr => {
    if (arr.length < 25) return null;
    const s = [], hs = [];
    let pg = 0;
    arr.forEach((g, i) => { if (pays(g, mkt)) pg++; if (i >= 19) { s.push(Math.round(pg / (i + 1) * 1000) / 10); hs.push(g.horario || ""); } });
    return { serie: s, horas: hs, macd: s.length > 3 ? (macdData(s).hist || []) : [] };
  };
  for (const h of [3, 6, 12, 18]) {
    const n = h * JOGOS_POR_HORA;
    if (games.length >= n + 25) faixasAcum["h" + h] = montaFaixa(games.slice(-n));
  }
  faixasAcum.dia = montaFaixa(dia);
  const fDia = faixasAcum.dia || { serie: [], horas: [], macd: [] };
  const serie = fDia.serie;
  const serieHoras = fDia.horas;
  const macdHist = fDia.macd;
  const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 1000) / 10;
    const faixas = { "00-07": [0, 0], "07-12": [0, 0], "12-18": [0, 0], "18-24": [0, 0] };
    const porHora = {};
    for (const g of games) {
      const h = parseInt((g.horario || "").split(":")[0]);
      if (isNaN(h)) continue;
      const f = h < 7 ? "00-07" : h < 12 ? "07-12" : h < 18 ? "12-18" : "18-24";
      faixas[f][0]++; const pagou = pays(g, mkt); if (pagou) faixas[f][1]++;
      const hh = String(h).padStart(2, "0");
      porHora[hh] = porHora[hh] || [0, 0]; porHora[hh][0]++; if (pagou) porHora[hh][1]++;
    }
    const fmt = o => { const r = {}; for (const [k, [n, h]] of Object.entries(o)) r[k] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null }; return r; };
    res.json({ liga, mkt, base, faixasHora: fmt(faixas), porHora: fmt(porHora) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO ANCORA: jogos com ancora pagam acima da base? (afirmacao do usuario) =====
app.get("/api/estudoancora/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o35";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 300) return res.json({ erro: "historico insuficiente" });
    const games = d.games;
    // SERIE IDENTICA A DO GRAFICO NORMAL, so trocando a conta:
  // normal  = % dos ultimos 20 jogos (janela que anda e esquece)
  // acumulado = % do TOTAL desde as 00h (cada pagamento vale o mesmo, soma o dia inteiro)
  // Comeca no 20o jogo pelo mesmo motivo que o normal comeca: antes disso nao ha janela cheia.
  // SERIE = VALOR ACUMULADO: cada jogo soma o que ele vale de verdade.
  //   green -> + (odd - 1)   |   red -> - 1
  // Soma reta das 00h. Diferente da media (que converge e vira reta), aqui o passo de cada
  // jogo continua pesando o dia inteiro: a linha ganha relevo, topo, fundo e retracao.
  // FAIXAS DE TEMPO: a mesma conta (soma reta), mas comecando em pontos diferentes.
  // Faixa curta (3h) sobe/desce facil; faixa longa (18h) precisa de muito mais pagamentos
  // para mexer - exatamente como as medias por faixa de horario.
  const JOGOS_POR_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  const montaFaixa = arr => {
    if (arr.length < 25) return null;
    const s = [], hs = [];
    let pg = 0;
    arr.forEach((g, i) => { if (pays(g, mkt)) pg++; if (i >= 19) { s.push(Math.round(pg / (i + 1) * 1000) / 10); hs.push(g.horario || ""); } });
    return { serie: s, horas: hs, macd: s.length > 3 ? (macdData(s).hist || []) : [] };
  };
  for (const h of [3, 6, 12, 18]) {
    const n = h * JOGOS_POR_HORA;
    if (games.length >= n + 25) faixasAcum["h" + h] = montaFaixa(games.slice(-n));
  }
  faixasAcum.dia = montaFaixa(dia);
  const fDia = faixasAcum.dia || { serie: [], horas: [], macd: [] };
  const serie = fDia.serie;
  const serieHoras = fDia.horas;
  const macdHist = fDia.macd;
  const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 1000) / 10;
    let comN = 0, comH = 0, forteN = 0, forteH = 0, semN = 0, semH = 0;
    const ini = Math.max(200, games.length - 150);
    for (let i = ini; i < games.length; i++) {
      const g = games[i];
      const hist = games.slice(0, i);
      let anc = null;
      try { anc = avaliaAncora({ nome: g.nome, casa: g.casa, fora: g.fora, odds: g.odds || {} }, anchorStats(hist), bigPlacarStats(hist)); } catch (e) {}
      const pagou = pays(g, mkt);
      if (anc) { comN++; if (pagou) comH++; if (String(anc.nivel || "").includes("FORTE")) { forteN++; if (pagou) forteH++; } }
      else { semN++; if (pagou) semH++; }
    }
    const pc = (h, n) => n ? Math.round(h / n * 100) : null;
    res.json({ liga, mkt, base,
      comAncora: { jogos: comN, pagou: pc(comH, comN) },
      ancoraFORTE: { jogos: forteN, pagou: pc(forteH, forteN) },
      semAncora: { jogos: semN, pagou: pc(semH, semN) } });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO COLUNA + FAIXAS DE EV (hipoteses do usuario) =====
app.get("/api/estudocol/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o25";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 300) return res.json({ erro: "historico insuficiente" });
    const games = d.games;
    // SERIE IDENTICA A DO GRAFICO NORMAL, so trocando a conta:
  // normal  = % dos ultimos 20 jogos (janela que anda e esquece)
  // acumulado = % do TOTAL desde as 00h (cada pagamento vale o mesmo, soma o dia inteiro)
  // Comeca no 20o jogo pelo mesmo motivo que o normal comeca: antes disso nao ha janela cheia.
  // SERIE = VALOR ACUMULADO: cada jogo soma o que ele vale de verdade.
  //   green -> + (odd - 1)   |   red -> - 1
  // Soma reta das 00h. Diferente da media (que converge e vira reta), aqui o passo de cada
  // jogo continua pesando o dia inteiro: a linha ganha relevo, topo, fundo e retracao.
  // FAIXAS DE TEMPO: a mesma conta (soma reta), mas comecando em pontos diferentes.
  // Faixa curta (3h) sobe/desce facil; faixa longa (18h) precisa de muito mais pagamentos
  // para mexer - exatamente como as medias por faixa de horario.
  const JOGOS_POR_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  const montaFaixa = arr => {
    if (arr.length < 25) return null;
    const s = [], hs = [];
    let pg = 0;
    arr.forEach((g, i) => { if (pays(g, mkt)) pg++; if (i >= 19) { s.push(Math.round(pg / (i + 1) * 1000) / 10); hs.push(g.horario || ""); } });
    return { serie: s, horas: hs, macd: s.length > 3 ? (macdData(s).hist || []) : [] };
  };
  for (const h of [3, 6, 12, 18]) {
    const n = h * JOGOS_POR_HORA;
    if (games.length >= n + 25) faixasAcum["h" + h] = montaFaixa(games.slice(-n));
  }
  faixasAcum.dia = montaFaixa(dia);
  const fDia = faixasAcum.dia || { serie: [], horas: [], macd: [] };
  const serie = fDia.serie;
  const serieHoras = fDia.horas;
  const macdHist = fDia.macd;
  const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 1000) / 10;
    // --- taxa da coluna ANTES de cada jogo (12 ocorrencias anteriores do mesmo minuto) ---
    const porMin = {};
    const colAntes = new Array(games.length).fill(null);
    for (let i = 0; i < games.length; i++) {
      const h = games[i].horario || ""; const min = h.includes(":") ? h.split(":")[1] : null;
      if (!min) continue;
      const arr = porMin[min] || (porMin[min] = []);
      if (arr.length >= 4) colAntes[i] = Math.round(arr.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, arr.length) * 100);
      arr.push(pays(games[i], mkt) ? 1 : 0);
    }
    // TESTE 2: green em coluna FRACA (<=33%) -> proximo jogo paga mais?
    let fracaN = 0, fracaH = 0, gAnyN = 0, gAnyH = 0;
    for (let i = 0; i < games.length - 1; i++) {
      if (!pays(games[i], mkt)) continue;
      gAnyN++; if (pays(games[i + 1], mkt)) gAnyH++;
      if (colAntes[i] != null && colAntes[i] <= 33) { fracaN++; if (pays(games[i + 1], mkt)) fracaH++; }
    }
    // e o proximo jogo de coluna FORTE (>=50) em ate 3 apos o green na fraca
    let ffN = 0, ffH = 0;
    for (let i = 0; i < games.length - 3; i++) {
      if (!pays(games[i], mkt) || colAntes[i] == null || colAntes[i] > 33) continue;
      for (let j = i + 1; j <= i + 3 && j < games.length; j++) {
        if (colAntes[j] != null && colAntes[j] >= 50) { ffN++; if (pays(games[j], mkt)) ffH++; break; }
      }
    }
    // TESTE 1: faixas de EV (ultimos 140 jogos com odd) + CRUZADO com o estado da liga
    const JANx = Math.max(10, Math.min(120, parseInt(req.query.jan) || 20)); // janela da zona (20=1h, 60=3h)
    const serieX = chartSeries(games, mkt, JANx); // ponto k <-> jogo k+19
    const relAntes = i => { const k = i - JANx; return (k >= 0 && k < serieX.length && base) ? serieX[k] / base * 100 : null; };
    const faixas = { "EV>+10": [0, 0], "EV_0_a_+10": [0, 0], "EV_-10_a_0": [0, 0], "EV<-10": [0, 0] };
    const cruz = { EVpos_ligaPagante: [0, 0], EVpos_ligaMaxima: [0, 0], EVneg_ligaPagante: [0, 0], EVneg_ligaMaxima: [0, 0] };
    const ini = Math.max(150, games.length - 140);
    for (let i = ini; i < games.length; i++) {
      const g = games[i]; if (!g.odds || g.odds[oddKey(mkt)] == null) continue;
      let ev = null;
      try { ev = (fullEvalUpcoming([{ nome: g.nome, horario: "", casa: g.casa, fora: g.fora, odds: g.odds }], games.slice(0, i).slice(-400), mkt)[0] || {}).ev; } catch (e) {}
      if (ev == null) continue;
      const f = ev > 10 ? "EV>+10" : ev > 0 ? "EV_0_a_+10" : ev > -10 ? "EV_-10_a_0" : "EV<-10";
      faixas[f][0]++; const pagou = pays(g, mkt); if (pagou) faixas[f][1]++;
      const r = relAntes(i);
      if (r != null) {
        const estado = r >= 100 ? "ligaPagante" : r < 70 ? "ligaMaxima" : null; // pagante x abrindo maxima
        if (estado) { const ch = (ev > 0 ? "EVpos_" : "EVneg_") + estado; cruz[ch][0]++; if (pagou) cruz[ch][1]++; }
      }
    }
    const fx = {}; for (const [k, [n, h]] of Object.entries(faixas)) fx[k] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null };
    const cz = {}; for (const [k, [n, h]] of Object.entries(cruz)) cz[k] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null };
    // PROFUNDIDADE DA ZONA: o proximo jogo paga quanto conforme o quao fundo a liga esta?
    const prof = { "<40": [0, 0], "40-60": [0, 0], "60-85": [0, 0], "85-115": [0, 0], ">115": [0, 0] };
    // DENTRO DA ZONA (<60): curva ainda CAINDO vs ja VIRANDO (ultimo ponto subiu)
    const zonaEstado = { zonaCaindo: [0, 0], zonaVirando: [0, 0] };
    for (let i = JANx; i < games.length; i++) {
      const r = relAntes(i); if (r == null) continue;
      const b2 = r < 40 ? "<40" : r < 60 ? "40-60" : r < 85 ? "60-85" : r <= 115 ? "85-115" : ">115";
      prof[b2][0]++; const pagou = pays(games[i], mkt); if (pagou) prof[b2][1]++;
      if (r < 60) {
        const k1 = i - JANx, k0 = k1 - 1;
        if (k0 >= 0 && k1 < serieX.length) {
          const est = serieX[k1] > serieX[k0] ? "zonaVirando" : "zonaCaindo";
          zonaEstado[est][0]++; if (pagou) zonaEstado[est][1]++;
        }
      }
    }
    const pf = {}; for (const [k, [n, h]] of Object.entries(prof)) pf[k] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null };
    const ze = {}; for (const [k, [n, h]] of Object.entries(zonaEstado)) ze[k] = { jogos: n, pagou: n ? Math.round(h / n * 100) : null };
    res.json({ liga, mkt, base,
      teste_EV_por_faixa: fx,
      cruzado_EV_x_estado: cz,
      porProfundidade: pf,
      zona_caindo_vs_virando: ze,
      teste_coluna: {
        aposGreen_qualquer: { n: gAnyN, proximoPagou: gAnyN ? Math.round(gAnyH / gAnyN * 100) : null },
        aposGreen_em_coluna_fraca: { n: fracaN, proximoPagou: fracaN ? Math.round(fracaH / fracaN * 100) : null },
        greenFraca_entao_colunaForte_em3: { n: ffN, pagou: ffN ? Math.round(ffH / ffN * 100) : null }
      } });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO MAXIMAS (metrica do usuario): frequencia de pulo de 3+/4+ REDs por zona =====
app.get("/api/maximas/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o25";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 300) return res.json({ erro: "historico insuficiente" });
    const games = d.games;
    const base = games.filter(g => pays(g, mkt)).length / games.length * 100;
    const JAN = 20;
    const serieF = chartSeries(games, mkt, JAN); // ponto k <-> jogo k+JAN-1
    const zonas = { fria_menor60: [0,0,0], media_60a115: [0,0,0], alta_maior115: [0,0,0] }; // [n, maxima3, maxima4]
    for (let k = 0; k < serieF.length; k++) {
      const gi = k + JAN - 1;
      if (gi + 4 >= games.length) break;
      const rel = serieF[k] / base * 100;
      const z = rel < 60 ? "fria_menor60" : rel <= 115 ? "media_60a115" : "alta_maior115";
      const r1 = !pays(games[gi+1], mkt), r2 = !pays(games[gi+2], mkt), r3 = !pays(games[gi+3], mkt), r4 = !pays(games[gi+4], mkt);
      zonas[z][0]++;
      if (r1 && r2 && r3) zonas[z][1]++;
      if (r1 && r2 && r3 && r4) zonas[z][2]++;
    }
    const out = {};
    for (const [z, [n, m3, m4]] of Object.entries(zonas))
      out[z] = { momentos: n, pulou3casas: n ? Math.round(m3/n*1000)/10 : null, pulou4casas: n ? Math.round(m4/n*1000)/10 : null };
    // frequencia geral de maximas >=3 na liga (pra ranquear "ligas que abrem maxima toda linha")
    let runs3 = 0, i = 0;
    while (i < games.length) {
      if (!pays(games[i], mkt)) { let j = i; while (j < games.length && !pays(games[j], mkt)) j++; if (j - i >= 3) runs3++; i = j; }
      else i++;
    }
    res.json({ liga, mkt, base: Math.round(base*10)/10, porZona: out, maximas3_por100jogos: Math.round(runs3 / games.length * 1000) / 10 });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO 3H (tese do usuario): bloco de 3h bom -> o proximo bloco continua bom? =====
app.get("/api/estudo3h/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o25";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 300) return res.json({ erro: "historico insuficiente" });
    const games = d.games, TAM = 60; // ~3h de liga
    const blocos = [];
    for (let i = 0; i + TAM <= games.length; i += TAM) {
      const b = games.slice(i, i + TAM);
      blocos.push(Math.round(b.filter(g => pays(g, mkt)).length / TAM * 1000) / 10);
    }
    // SERIE IDENTICA A DO GRAFICO NORMAL, so trocando a conta:
  // normal  = % dos ultimos 20 jogos (janela que anda e esquece)
  // acumulado = % do TOTAL desde as 00h (cada pagamento vale o mesmo, soma o dia inteiro)
  // Comeca no 20o jogo pelo mesmo motivo que o normal comeca: antes disso nao ha janela cheia.
  // SERIE = VALOR ACUMULADO: cada jogo soma o que ele vale de verdade.
  //   green -> + (odd - 1)   |   red -> - 1
  // Soma reta das 00h. Diferente da media (que converge e vira reta), aqui o passo de cada
  // jogo continua pesando o dia inteiro: a linha ganha relevo, topo, fundo e retracao.
  // FAIXAS DE TEMPO: a mesma conta (soma reta), mas comecando em pontos diferentes.
  // Faixa curta (3h) sobe/desce facil; faixa longa (18h) precisa de muito mais pagamentos
  // para mexer - exatamente como as medias por faixa de horario.
  const JOGOS_POR_HORA = 20; // 1 jogo a cada 3 min
  const faixasAcum = {};
  const montaFaixa = arr => {
    if (arr.length < 25) return null;
    const s = [], hs = [];
    let pg = 0;
    arr.forEach((g, i) => { if (pays(g, mkt)) pg++; if (i >= 19) { s.push(Math.round(pg / (i + 1) * 1000) / 10); hs.push(g.horario || ""); } });
    return { serie: s, horas: hs, macd: s.length > 3 ? (macdData(s).hist || []) : [] };
  };
  for (const h of [3, 6, 12, 18]) {
    const n = h * JOGOS_POR_HORA;
    if (games.length >= n + 25) faixasAcum["h" + h] = montaFaixa(games.slice(-n));
  }
  faixasAcum.dia = montaFaixa(dia);
  const fDia = faixasAcum.dia || { serie: [], horas: [], macd: [] };
  const serie = fDia.serie;
  const serieHoras = fDia.horas;
  const macdHist = fDia.macd;
  const base = Math.round(games.filter(g => pays(g, mkt)).length / games.length * 1000) / 10;
    // transicoes: bloco ALTO (>= base) -> proximo bloco foi o que?
    let aa = 0, ab = 0, ba = 0, bb = 0; const prox = { altoDepois: [], baixoDepois: [] };
    for (let i = 0; i + 1 < blocos.length; i++) {
      const alto = blocos[i] >= base, proxAlto = blocos[i + 1] >= base;
      if (alto) { prox.altoDepois.push(blocos[i + 1]); proxAlto ? aa++ : ab++; }
      else { prox.baixoDepois.push(blocos[i + 1]); proxAlto ? ba++ : bb++; }
    }
    const med = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
    res.json({ liga, mkt, base, blocos,
      aposBlocoALTO: { n: aa + ab, continuouAlto: aa, caiu: ab, taxaMediaDoProximo: med(prox.altoDepois) },
      aposBlocoBAIXO: { n: ba + bb, subiu: ba, continuouBaixo: bb, taxaMediaDoProximo: med(prox.baixoDepois) } });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== ESTUDO: tempo ate pagar apos cada sinal + temperatura da liga (leitura, nao altera nada) =====
const estudoCache = {};
app.get("/api/estudo/:liga", (req, res) => {
  try {
    const liga = req.params.liga, mkt = req.query.mkt || "o35";
    const d = store[liga];
    if (!d || !d.games || d.games.length < 250) return res.json({ erro: "historico insuficiente" });
    const key = liga + "|" + mkt;
    if (estudoCache[key] && Date.now() - estudoCache[key].ts < 120000 && estudoCache[key].lu === d.lastUpdated) return res.json(estudoCache[key].out);
    const games = d.games;
    const baseG = games.filter(g => pays(g, mkt)).length / games.length;
    const basePct = Math.round(baseG * 1000) / 10;
    const JAN = Math.max(2, Math.min(20, games.length));
    const serieF = chartSeries(games, mkt, JAN); // ponto k <-> jogo k+JAN-1
    // distancia (em jogos) ate o primeiro pagamento a partir de gi+1
    const distPagar = gi => { for (let j = gi + 1; j < games.length; j++) { if (pays(games[j], mkt)) return j - gi; } return null; };
    const mede = idxs => {
      const ds = idxs.map(distPagar).filter(x => x != null);
      if (!ds.length) return { eventos: idxs.length, mediaJogos: null };
      const media = ds.reduce((a, b) => a + b, 0) / ds.length;
      const em3 = ds.filter(x => x <= 3).length / ds.length;
      return { eventos: idxs.length, mediaJogos: +media.toFixed(1), mediaMin: Math.round(media * 3), pagouEm3: Math.round(em3 * 100) };
    };
    // REGUA: a partir de um jogo QUALQUER (todos os pontos com folga de futuro)
    const todos = []; for (let gi = JAN; gi < games.length - 30; gi++) todos.push(gi);
    const regua = mede(todos);
    // eventos por sinal (replay das MESMAS regras do radar, na serie com drop igual analise)
    const evMin = [], evSub = [], evLtb = [];
    let stM = false, stS = false, ultLtb = -99;
    for (let k = 6; k < serieF.length - 1; k++) {
      const gi = k + JAN - 1; if (gi >= games.length - 1) break;
      const cur = serieF[k], antes = serieF[k - 5];
      const fundo = cur <= basePct * 0.7;
      const sobe = (cur - antes) >= 10 && cur <= basePct * 1.2;
      if (fundo && !stM) evMin.push(gi);
      if (sobe && !stS) evSub.push(gi);
      stM = fundo ? (cur < basePct * 0.85) : false;
      stS = sobe;
      if (k >= 25 && k - ultLtb >= 3) {
        try {
          const t = trendLines(serieF.slice(Math.max(0, k - 19), k + 1));
          if (t && t.rompimento && t.rompimento.tipo === "ROMPEU_LTB_CIMA") { evLtb.push(gi); ultLtb = k; }
        } catch (e) {}
      }
    }
    // EV+ (indicados: score>=30 e EV>0) — mede se O PROPRIO jogo pagou e, se nao, ate pagar
    const evPosIdx = []; let evPosGreen = 0;
    const ini = Math.max(150, games.length - 100);
    for (let i = ini; i < games.length - 1; i++) {
      const g = games[i]; if (!g.odds || !g.odds[oddKey(mkt)]) continue;
      const ev = fullEvalUpcoming([{ nome: g.nome, horario: "", casa: g.casa, fora: g.fora, odds: g.odds }], games.slice(0, i).slice(-400), mkt)[0] || {};
      if (ev.score != null && ev.score >= 30 && ev.ev > 0) { evPosIdx.push(i - 1); if (pays(g, mkt)) evPosGreen++; }
    }
    // temperatura: taxa da janela (relativa a base) x pagamento do proximo jogo
    const buckets = { "muito_fria_<60%": [0, 0], "fria_60-85%": [0, 0], "normal_85-115%": [0, 0], "quente_115-140%": [0, 0], "muito_quente_>140%": [0, 0] };
    for (let k = 0; k < serieF.length - 1; k++) {
      const gi = k + JAN - 1; if (gi + 1 >= games.length) break;
      const rel = serieF[k] / basePct;
      const b = rel < 0.6 ? "muito_fria_<60%" : rel < 0.85 ? "fria_60-85%" : rel < 1.15 ? "normal_85-115%" : rel < 1.4 ? "quente_115-140%" : "muito_quente_>140%";
      buckets[b][0]++; if (pays(games[gi + 1], mkt)) buckets[b][1]++;
    }
    const temperatura = {};
    for (const [b, [n, hit]] of Object.entries(buckets)) temperatura[b] = { jogos: n, proximoPagou: n ? Math.round(hit / n * 100) : null };
    // APOS PAGAR: o mercado emenda ou segura? (memoria serial)
    let ppN=0,ppH=0,pnN=0,pnH=0;
    for (let i = 1; i < games.length - 1; i++) {
      const prev = pays(games[i], mkt), nx = pays(games[i + 1], mkt);
      if (prev) { ppN++; if (nx) ppH++; } else { pnN++; if (nx) pnH++; }
    }
    // 1o pagamento que ENCERRA a seca fria (janela <60% do normal): o seguinte emenda?
    let frioN=0,frioH=0,frio2H=0;
    for (let k = 0; k < serieF.length - 2; k++) {
      const gi = k + JAN - 1; if (gi + 2 >= games.length) break;
      if (serieF[k] < basePct * 0.6 && pays(games[gi + 1], mkt)) { // seca fria + veio o 1o green
        frioN++;
        if (pays(games[gi + 2], mkt)) frioH++;
        if (pays(games[gi + 2], mkt) || pays(games[gi + 3], mkt)) frio2H++;
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
  // Com historico de varios dias, o HH:MM sozinho misturava jogos de ontem e de
  // hoje no mesmo ponto da serie. Jogos com data real ficam na ordem exata e so
  // entram as ultimas 30 horas.
  const datados = lista.filter(g => Number.isFinite(Date.parse(g && g.inicio || "")));
  if (datados.length >= lista.length * 0.5) {
    const corte = Date.now() - 30 * 3600000;
    return datados.map(g => ({ g, t: Date.parse(g.inicio) })).filter(x => x.t >= corte)
      .sort((a, b) => a.t - b.t).map(x => x.g);
  }
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
      // RADAR SEM DROP-2: usa gamesAll (inclui os 2 jogos mais recentes) — alerta no
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
      // Desarma no 1o GREEN (o edge cai apos o 1o pagamento — medido) e re-arma so apos
      // novo jogo sem pagar ainda na zona. Histerese de saida: >=85% do normal.
      const ultimoPagou = gAll.length ? pays(gAll[gAll.length - 1], mkt) : false;
      // mercados de base pequena (<15%, ex: 5+ gols) ficam FORA da minima: a janela de 20
      // jogos pula dezenas de pontos com 1 jogo — "<60%" ali e ruido, nao seca
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
      // 💥 QUEBRA DE LTB pra cima (detector oficial do grafico, na serie SEM drop-2)
      let quebrouLTB = false;
      try { const t = trendLines(serie); quebrouLTB = !!(t && t.rompimento && t.rompimento.tipo === "ROMPEU_LTB_CIMA"); } catch (e) {}
      if (quebrouLTB && !prev.ltb) {
        radarAtivos[k + "|ltb"] = { liga, mkt, tipo: "ltb", pagando: cur, base: c.base, fita, ts: Date.now() };
        if (!primeira && podeAvisar(k + "|ltb")) avisaRadar(radarAtivos[k + "|ltb"]);
      } else if (!quebrouLTB) delete radarAtivos[k + "|ltb"];
      // 🧊 MINIMA DE JANELA: a linha pagante tocando o FUNDO das ultimas 3/6/12/24 horas
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
      // 💠 PULLBACK: linha acima do normal, recuou 8-25 pts do topo recente e VOLTOU a subir
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

      // DEATH CROSS: usa o mesmo canal em tempo real do Golden.
      const death = deathCrossData(serie);
      if (death.active) {
        const chaveDeath = k + "|death";
        const deathAnterior = radarAtivos[chaveDeath];
        const jogoCross = death.index == null ? null : gAll[gAll.length - serie.length + death.index];
        const horaCross = horaCurta(jogoCross && (jogoCross.horario || jogoCross.hora));
        const cruzouEm = death.crossedNow ? Date.now() : (deathAnterior && deathAnterior.cruzouEm) || null;
        const hora = death.crossedNow ? horaBR() : (deathAnterior && deathAnterior.hora) || horaBR();
        const horaFonte = horaCross || (deathAnterior && deathAnterior.horaFonte) || hora;
        const atrasoMin = atrasoMinutos(horaFonte, hora);
        radarAtivos[chaveDeath] = { liga, mkt, tipo: "death", pagando: cur, base: c.base, fita, mm10: death.fast, mm20: death.slow, spread: death.spread, barsAgo: death.barsAgo, hora, horaFonte, atrasoMin, cruzouEm, ts: Date.now() };
        const cruzamentoRecente = death.crossedNow || (death.barsAgo != null && death.barsAgo <= 5);
        if (cruzamentoRecente && !prev.death && !primeira && podeAvisar(chaveDeath)) avisaRadar(radarAtivos[chaveDeath]);
      } else delete radarAtivos[k + "|death"];
      radarEstado[k] = { fundo, sobe, ltb: quebrouLTB, nivelMin, pull, golden: golden.active, death: death.active };
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
  try { if (typeof kvSalva === "function") kvSalva(); } catch (e) {}
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
    if (s.prefs && s.prefs.gd) continue; // esse aparelho recebe o push calculado com o grafico dele
    webpush.sendNotification(s, payload).catch(err => {
      if (err && (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403)) {
        pushData.subs = pushData.subs.filter(x => x.endpoint !== s.endpoint);
        salvaPush();
      }
    });
  }
}

function enviaPushRadar(info) {
  if (!webpush || !pushData.vapid || !pushData.subs.length) return;
  // Golden/Death agora saem so pelo push do grafico (avaliaPushGrafico), com o
  // jogo em que o cruzamento aconteceu. O aviso antigo (EMA 9/21) foi desligado.
  return;
  const liga = NOMES_L[info.liga] || info.liga;
  const mercado = NOMES_M[info.mkt] || info.mkt;
  const golden = info.tipo === "golden";
  const titulo = `${golden ? "✨ GOLDEN" : "💀 DEATH"} CROSS AGORA${info.hora ? ` ${info.hora}` : ""} — ${liga} · ${mercado}`;
  const corpo = `Confirmado assim que o resultado chegou${info.horaFonte ? ` · jogo ${info.horaFonte}` : ""} — EMA9 ${info.mm10 ?? "—"} ${golden ? "acima" : "abaixo"} da EMA21 ${info.mm20 ?? "—"}`;
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

// ===== PUSH DO GRAFICO: Golden/Death no MESMO ponto do grafico de cada aparelho =====
// Cada aparelho informa a configuracao do seu grafico (liga, mercado, modo,
// Qtd. Jogos, MM1/MM2). O servidor refaz exatamente a mesma conta do grafico
// (% de pagamento na janela + medias simples do GDCross) e avisa no jogo em
// que o cruzamento aparece no desenho.
const GDCrossModel = (() => { const m = require("./public/gdcross.js"); return (m && typeof m.analisar === "function") ? m : globalThis.GDCross; })();
function pagouRotulo(mkt, g) {
  const a = Number(g.a), b = Number(g.b), t = a + b;
  const casa = a > b, fora = b > a, empate = a === b, ambas = a > 0 && b > 0;
  switch (mkt) {
    case "Over 0.5": return t >= 1; case "Over 1.5": return t >= 2;
    case "Over 2.5": return t >= 3; case "Over 3.5": return t >= 4;
    case "Under 0.5": return t < 1; case "Under 1.5": return t < 2;
    case "Under 2.5": return t < 3; case "Under 3.5": return t < 4;
    case "Total Gols (FT)": return t >= 3;
    case "Gols Casa (FT)": return a >= 2; case "Gols Fora (FT)": return b >= 2;
    case "Ambas Marcam (Sim)": return ambas; case "Ambas Marcam (Não)": return !ambas;
    case "Casa FT": return casa; case "Empate FT": return empate; case "Fora FT": return fora;
    case "Casa/Fora e Sim": return !empate && ambas;
    case "Casa e Sim": return casa && ambas; case "Casa e Não": return casa && !ambas;
    case "Fora e Sim": return fora && ambas; case "Fora e Não": return fora && !ambas;
    case "Empate e Sim": return empate && ambas; case "Empate e Não": return empate && !ambas;
    case "5+ Gols": return t >= 5;
    default: {
      let m = String(mkt).match(/^(\d) Gols?$/); if (m) return t === +m[1];
      m = String(mkt).match(/^Casa (\d) Gols?$/); if (m) return a === +m[1];
      m = String(mkt).match(/^Fora (\d) Gols?$/); if (m) return b === +m[1];
      if (/HT|2º tempo/.test(String(mkt))) return false; // a Vavada nao informa o intervalo
      return t >= 3;
    }
  }
}
function serieDoGrafico(liga, p) {
  const jogos = (gamesFundidos(liga) || [])
    .filter(g => g && g.inicio && Number.isFinite(Number(g.a)) && Number.isFinite(Number(g.b)))
    .map(g => ({ g, t: Date.parse(g.inicio) })).filter(x => Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t);
  const vistos = new Set(); const lista = [];
  for (const x of jogos) { if (vistos.has(x.t)) continue; vistos.add(x.t); lista.push(x); }
  const serie = [], metas = [];
  const arred = v => Math.round(v * 10) / 10;
  if (p.modo === "acum") {
    // dia do relogio do jogo (Brasilia) do ultimo resultado
    const dia = t => new Date(t - 3 * 3600000).toISOString().slice(0, 10);
    const hoje = lista.length ? dia(lista[lista.length - 1].t) : null;
    let pagos = 0, n = 0;
    for (const x of lista) {
      if (dia(x.t) !== hoje) continue;
      n++; if (pagouRotulo(p.mercado, x.g)) pagos++;
      serie.push(arred(pagos / n * 100)); metas.push(x);
    }
  } else {
    const J = Math.min(Math.max(2, Number(p.janela) || 20), Math.max(2, Math.floor(lista.length / 2))); const fila = []; let pagos = 0;
    for (const x of lista) {
      const pg = pagouRotulo(p.mercado, x.g) ? 1 : 0;
      fila.push(pg); pagos += pg;
      if (fila.length > J) pagos -= fila.shift();
      if (fila.length < J) continue;
      serie.push(arred(pagos / J * 100)); metas.push(x);
    }
  }
  return { serie, metas };
}
const pushGraficoEnviado = {}; // endpoint|liga|mercado -> ultimo jogo avisado
function avaliaPushGrafico(liga) {
  if (!webpush || !pushData.vapid || !pushData.subs.length) return;
  const cache = {};
  // Todas as ligas e os mercados principais, com a MESMA configuracao do
  // grafico do aparelho (modo, Qtd. Jogos, MM1/MM2): cada alerta bate com o G/D
  // que aquela liga/mercado mostraria no grafico.
  const MERCADOS_PUSH = ["Over 2.5", "Over 3.5", "Ambas Marcam (Sim)", "5+ Gols"];
  for (const s of pushData.subs) {
    const p0 = s.prefs;
    if (!p0 || !p0.gd) continue;
    // So a liga e o mercado abertos no grafico do aparelho (24 graficos davam
    // alerta demais). Com p0.todas = true volta a monitorar todos.
    if (!p0.todas && p0.liga !== liga) continue;
    const mercados = p0.todas ? [...new Set([p0.mercado, ...MERCADOS_PUSH].filter(Boolean))] : [p0.mercado];
    for (const mercado of mercados) {
    const p = { ...p0, mercado };
    try {
      const ck = [p.modo, p.janela, p.mercado, p.mm1, p.mm2].join("|");
      const r = cache[ck] || (cache[ck] = (() => {
        const { serie, metas } = serieDoGrafico(liga, p);
        return { metas, an: GDCrossModel.analisar(serie, p.mm1, p.mm2), n: serie.length };
      })());
      if (!r.an.valido || !r.n) continue;
      const ultimo = r.an.cruzamentos[r.an.cruzamentos.length - 1];
      if (!ultimo || ultimo.indice !== r.n - 1) continue;      // cruzou no jogo mais recente
      const meta = r.metas[ultimo.indice];
      if (!meta || Date.now() - meta.t > 6 * 60000) continue;  // nao avisa resultado antigo
      const chave = s.endpoint + "|" + liga + "|" + p.mercado;
      const jogoId = String(meta.g.id || meta.t) + "|" + ultimo.tipo;
      if (pushGraficoEnviado[chave] === jogoId) continue;
      // logo apos reiniciar: so registra o cruzamento ja avisado, sem reenviar
      if (!(chave in pushGraficoEnviado) && Date.now() - inicioProcesso < 90000) { pushGraficoEnviado[chave] = jogoId; continue; }
      console.log(`[push-gd] ${liga} ${p.mercado} ${ultimo.tipo.toUpperCase()} no jogo ${meta.g.horario} ${meta.g.casa}x${meta.g.fora} (${p.modo} ${p.janela} MM${r.an.periodoRapido}/${r.an.periodoLento})`);
      pushGraficoEnviado[chave] = jogoId;
      const golden = ultimo.tipo === "golden";
      const horario = meta.g.horario || "";
      const nomeLiga = (NOMES_L[liga] || liga.toUpperCase());
      const jogoTxt = `${meta.g.casa || "?"} x ${meta.g.fora || "?"} ${meta.g.a}-${meta.g.b}`;
      const payload = JSON.stringify({
        t: (golden ? "\ud83c\udfc6 GOLDEN" : "\ud83d\udc80 DEATH") + ` ${horario} \u2014 ${nomeLiga} \u00b7 ${p.mercado}`,
        b: `Bateu no jogo das ${horario}: ${jogoTxt} \u00b7 MM${r.an.periodoRapido} ${golden ? "cruzou acima da" : "cruzou abaixo da"} MM${r.an.periodoLento}`,
        gd: { tipo: ultimo.tipo, liga, mercado: p.mercado, horario },
        // mesma tag do aviso local da pagina: o navegador junta os dois
        tag: "amd-gdcross-" + ultimo.tipo + "-" + liga + "-" + horario
      });
      // Tambem pelo canal em tempo real: a pagina aberta desse aparelho FALA o alerta.
      try {
        const msgVoz = `data: ${JSON.stringify({ tipo: "gd", alerta: { tipo: ultimo.tipo, liga, mercado: p.mercado, horario, ep: s.endpoint } })}\n\n`;
        for (const res of sseClientes) { try { res.write(msgVoz); } catch (e) {} }
      } catch (e) {}
      webpush.sendNotification(s, payload).catch(err => {
        if (err && [403, 404, 410].includes(err.statusCode)) {
          pushData.subs = pushData.subs.filter(x => x.endpoint !== s.endpoint); salvaPush();
        }
      });
    } catch (e) {}
    }
  }
}
const inicioProcesso = Date.now();
app.post("/api/push/prefs", (req, res) => {
  const b = req.body || {};
  const s = pushData.subs.find(x => x.endpoint === b.endpoint);
  if (!s) return res.status(404).json({ ok: false, erro: "inscricao nao encontrada" });
  const mm1 = Math.max(1, Math.round(Number(b.mm1) || 9)), mm2 = Math.max(1, Math.round(Number(b.mm2) || 21));
  s.prefs = {
    gd: !!b.gd, liga: String(b.liga || "").toLowerCase(), mercado: String(b.mercado || "Over 2.5"),
    modo: b.modo === "acum" ? "acum" : "janela", janela: Math.max(2, Math.min(500, Math.round(Number(b.janela) || 20))),
    mm1, mm2, ts: Date.now()
  };
  salvaPush();
  console.log(`[push] config do grafico: ${s.prefs.liga} ${s.prefs.mercado} ${s.prefs.modo} ${s.prefs.janela} jogos MM${s.prefs.mm1}/MM${s.prefs.mm2} GD=${s.prefs.gd}`);
  res.json({ ok: true, prefs: s.prefs });
});
function avisaRadar(info) {
  // Golden/Death do radar antigo (EMA 9/21, sem o jogo) nao sao mais transmitidos:
  // os alertas de cruzamento saem so pelo grafico de cada aparelho, com o jogo.
  if (info && (info.tipo === "golden" || info.tipo === "death")) return;
  const msg = `data: ${JSON.stringify({ tipo: "radar", alerta: info })}\n\n`; // BUGFIX: info.tipo sobrescrevia o rotulo "radar"
  for (const res of sseClientes) { try { res.write(msg); } catch (e) { sseClientes.delete(res); } }
  enviaPushRadar(info); // WEB PUSH: Golden e Death Cross, mesmo com aba congelada/fechada
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
const RADAR_TIPOS = ["golden", "death", "subida", "ltb", "minima", "pull"];
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
// versao do app.js servida no index: abas antigas comparam e recarregam sozinhas
let _versaoApp = null;
function versaoApp() {
  if (_versaoApp) return _versaoApp;
  try {
    const html = require("fs").readFileSync(join(__dirname, "public", "index.html"), "utf8");
    const m = html.match(/app\.js\?v=([^"'\s>]+)/);
    _versaoApp = m ? m[1] : "";
  } catch (e) { _versaoApp = ""; }
  return _versaoApp;
}
// Historico compacto para o Testador de padroes (calculo no navegador).
// ===== AMD ML (Over 3.5): memoria de padroes por liga =====
// Compara cada jogo futuro com jogos passados parecidos (mesma faixa de odd,
// mesma coluna/minuto, mesmos times, momento do grafico) e mede quanto isso
// muda a chance em relacao a odd. Brier e calculado andando para frente
// (cada previsao so usa jogos anteriores), contra a referencia da propria odd.
const mlCache = new Map();
function mlStatus(liga) {
  const st = store[liga] || {};
  const ga = (st.gamesAll || []).filter(g => g && g.inicio && g.a != null && g.b != null);
  const up = (st.upcomingRaw || []).filter(u => u);
  const chave = liga + ":" + ga.length + ":" + (ga.length ? ga[ga.length - 1].inicio : "") + ":" + up.length;
  const c = mlCache.get(liga); if (c && c.chave === chave) return c.dados;
  const MIN = 100, hit = g => (Number(g.a) + Number(g.b)) >= 4;
  const odd = g => Number((g.odds || {}).o35) || 0;
  const minuto = g => { const t = new Date(g.inicio); return Number.isFinite(t.getTime()) ? t.getUTCMinutes() : -1; };
  const norm = v => String(v || "").trim().toLowerCase();
  function prever(hist, alvo, linha) {
    const o = odd(alvo); if (!(o > 1)) return null;
    const imp = Math.min(0.95, 1 / o / 1.06); // tira a margem aproximada da casa
    const viz = hist.filter(g => odd(g) > 1 && Math.abs(odd(g) - o) <= Math.max(0.2, o * 0.08)).slice(-300);
    const vTaxa = viz.length ? viz.filter(hit).length / viz.length : imp;
    const mi = minuto(alvo), col = hist.filter(g => minuto(g) === mi).slice(-60);
    const cTaxa = col.length ? col.filter(hit).length / col.length : imp;
    const ts = [norm(alvo.casa), norm(alvo.fora)].filter(Boolean);
    const tim = ts.length ? hist.filter(g => ts.includes(norm(g.casa)) || ts.includes(norm(g.fora))).slice(-60) : [];
    const tTaxa = tim.length ? tim.filter(hit).length / tim.length : imp;
    const w = (n, k) => n / (n + k);
    let p = imp;
    p += w(viz.length, 120) * (vTaxa - imp) * 0.6;
    p += w(col.length, 80) * (cTaxa - imp) * 0.25;
    p += w(tim.length, 80) * (tTaxa - imp) * 0.15;
    p = Math.max(0.01, Math.min(0.97, p));
    return { p, imp, o, viz, vTaxa, col, cTaxa, tim, tTaxa };
  }
  // linha do grafico: % de Over 3.5 nos ultimos 20
  const linha = []; for (let i = 0; i < ga.length; i++) { const j = ga.slice(Math.max(0, i - 19), i + 1); linha.push(j.filter(hit).length / j.length); }
  const ema = (arr, n) => { const k = 2 / (n + 1); let e = arr[0] || 0; return arr.map((v, i) => (e = i ? v * k + e * (1 - k) : v)); };
  const e6 = ema(linha, 6), e18 = ema(linha, 18), L = linha.length - 1;
  const media = ga.length ? ga.filter(hit).length / ga.length : 0;
  const zona = L < 0 ? "—" : linha[L] > media + 0.05 ? "acima" : linha[L] < media - 0.05 ? "abaixo" : "na média";
  const direcao = L < 5 ? "—" : linha[L] > linha[L - 5] ? "subindo" : linha[L] < linha[L - 5] ? "caindo" : "lateral";
  const macd = L < 0 ? 0 : (e6[L] - e18[L]) * 100;
  // Brier andando para frente nos ultimos 200 jogos
  let bM = 0, bR = 0, nB = 0;
  for (let i = Math.max(MIN, ga.length - 200); i < ga.length; i++) {
    const pr = prever(ga.slice(0, i), ga[i], linha); if (!pr) continue;
    const y = hit(ga[i]) ? 1 : 0; bM += (pr.p - y) ** 2; bR += (pr.imp - y) ** 2; nB++;
  }
  const brier = nB >= 30 ? bM / nB : null, brierRef = nB >= 30 ? bR / nB : null;
  const supera = brier != null && brier < brierRef;
  const pronto = ga.length >= MIN;
  const candidatos = up.slice(0, 8).map(u => {
    const pr = prever(ga, u, linha); if (!pr) return null;
    const margem = pr.p - pr.imp, ev = pr.p * pr.o - 1;
    const qualifica = pronto && supera && margem >= 0.05 && pr.viz.length >= 40 && ev > 0;
    const nivel = qualifica ? "confirmado" : (pronto && margem >= 0.02 && ev > 0 ? "antecipado" : "neutro");
    const h = u.horario || (() => { const t = new Date(u.inicio); return Number.isFinite(t.getTime()) ? t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—"; })();
    return { jogo: `${u.casa || "?"} x ${u.fora || "?"}`, horario: h, probabilidade: pr.p, margem, odd: pr.o, qualifica, nivel,
      contexto: { padroes_amostra: pr.viz.length, padroes_taxa: pr.vTaxa, padroes_similaridade: pr.viz.length ? 1 - Math.min(1, Math.abs(pr.vTaxa - pr.imp)) : 0,
        padroes_limite: pr.imp + 0.05, zona, direcao, macd, score: Math.round(pr.p * 100), coluna_taxa: pr.cTaxa, coluna_amostra: pr.col.length,
        times_taxa: pr.tTaxa, times_amostra: pr.tim.length, site_ev: ev, ml_nivel: nivel } };
  }).filter(Boolean);
  const dados = { liga, pronto, padroes: ga.length, minimo_rotulos: MIN, progresso: Math.min(100, Math.round(ga.length / MIN * 100)),
    brier, brier_referencia: brierRef, supera_referencia: supera, candidatos };
  mlCache.set(liga, { chave, dados });
  return dados;
}
app.get("/api/ml/status", (req, res) => {
  const liga = String(req.query.liga || "eng").toLowerCase();
  try { res.setHeader("Cache-Control", "no-store"); res.json(mlStatus(liga)); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});
app.get("/api/historico", (req, res) => {
  const liga = String(req.query.liga || "eng").toLowerCase();
  const ga = ((store[liga] || {}).gamesAll || []).filter(g => g && g.inicio && g.a != null);
  const o = g => g.odds || {};
  res.json({ liga, jogos: ga.map(g => [g.inicio, g.a, g.b, o(g).o15 || null, o(g).o25 || null, o(g).o35 || null, o(g).ambs || null, o(g).ge5 || null, g.casa || null, g.fora || null]) });
});
app.get("/api/eventos", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  res.write(`data: ${JSON.stringify({ tipo: "oi", ts: Date.now(), v: versaoApp() })}\n\n`);
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

  app.use(express.static(join(__dirname, "public"), { setHeaders: (res, p) => { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));
  // Render deve abrir o painel diretamente na raiz; manter fallback explícito
  // evita 404 quando o middleware está atrás de alguma configuração de rota.
  app.get("/", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));
  app.get("/index.html", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));

  app.listen(PORT, process.env.HOST || undefined, () => console.log("AMD Live rodando na porta " + PORT));

import("./vavada-kiron.mjs").then(m => { vavadaKiron = m; iniciaVavadaKiron(); });
