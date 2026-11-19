// COLETOR INSPIRED VIA TIPSCLAN (fonte principal de CAM / COP / AME)
// Login com TIPSCLAN_EMAIL / TIPSCLAN_SENHA (env). Sessao por cookie; em 401
// faz login de novo. Primeira coleta traz 72h de historico, depois 3h a cada 15s.

const API = (process.env.TIPSCLAN_API || "https://tipsclan.com/api").replace(/\/$/, "");
export const LIGAS_TC = { cam: "Liga dos Campeões", cop: "Copa do Mundo", ame: "América Latina" };
const INTERVALO = Number(process.env.TIPSCLAN_INTERVALO || 15000);

const estado = { ts: 0, erro: null, rodando: false, logado: false, ligas: {} };
let cookie = "";
let onLigaCb = null;
let timer = null;
let loginBloqueadoAte = 0;

const horaBR = ms => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);

function credenciais() {
  return { email: String(process.env.TIPSCLAN_EMAIL || "").trim(), senha: String(process.env.TIPSCLAN_SENHA || "") };
}
export function configurado() { const c = credenciais(); return !!(c.email && c.senha); }

async function login() {
  if (Date.now() < loginBloqueadoAte) throw new Error("login em espera");
  const { email, senha } = credenciais();
  const r = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: senha, rememberMe: true }),
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) {
    // Evita martelar o login (a TipsClan bloqueia muitas tentativas).
    loginBloqueadoAte = Date.now() + (r.status === 429 ? 15 : 5) * 60000;
    const corpo = (await r.text().catch(() => "")).slice(0, 120);
    throw new Error("login HTTP " + r.status + " " + corpo);
  }
  const sets = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  cookie = sets.map(s => String(s).split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("login sem cookie");
  estado.logado = true;
  console.log("[tipsclan] login ok");
}

async function historico(liga, range) {
  const q = new URLSearchParams({ range, transport: "odds-columns-v1", provider: "futvirtual", league: LIGAS_TC[liga] });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!cookie) await login();
    const r = await fetch(`${API}/matrix/history?${q}`, {
      headers: { Cookie: cookie, Accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    if (r.status === 401 && tentativa === 0) { cookie = ""; estado.logado = false; continue; }
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text().catch(() => "")).slice(0, 100));
    const j = await r.json();
    const prov = j && j.data && j.data.snapshot && j.data.snapshot.providers && j.data.snapshot.providers.futvirtual;
    const layouts = (j && j.layouts) || [];
    return prov ? Object.values(prov).map(e => ({ ...e, oddsMap: decodificaOdds(e, layouts) })) : [];
  }
  throw new Error("sessao recusada");
}

// transport odds-columns-v1: layouts[e.oddsLayout][i] e o nome da odd e.odds[i]
// (string, ou [prefixo, indice em e.oddsIds]).
function decodificaOdds(e, layouts) {
  const m = layouts[e.oddsLayout];
  if (!Array.isArray(m) || !Array.isArray(e.odds) || m.length !== e.odds.length) return {};
  const o = {};
  for (let i = 0; i < m.length; i++) {
    const k = typeof m[i] === "string" ? m[i] : null;
    if (k) o[k] = Number(e.odds[i]);
  }
  return o;
}

// Mesmo formato de odds do coletor da Vavada (o motor do AMD usa estas chaves).
function oddsAMD(x) {
  const v = k => (x[k] > 1 ? x[k] : null);
  const o = {
    o15: v("over_1_5"), u15: v("under_1_5"), o25: v("over_2_5"), u25: v("under_2_5"),
    o35: v("over_3_5"), u35: v("under_3_5"), ambs: v("btts_yes"), ambn: v("btts_no"), ge5: null
  };
  const pj = {};
  const par = (a, b) => { if (o[a] > 1 && o[b] > 1) { const ia = 1 / o[a], ib = 1 / o[b]; pj[a] = +(ia / (ia + ib)).toFixed(4); pj[b] = +(ib / (ia + ib)).toFixed(4); } };
  par("o15", "u15"); par("o25", "u25"); par("o35", "u35"); par("ambs", "ambn");
  // 5+ gols a partir do placar exato
  let soma = 0, cinco = 0;
  for (const [k, val] of Object.entries(x)) {
    const mm = k.match(/^cs_(\d+)_(\d+)$/);
    if (!mm || !(val > 1)) continue;
    soma += 1 / val;
    if (Number(mm[1]) + Number(mm[2]) >= 5) cinco += 1 / val;
  }
  if (soma > 0 && cinco > 0) { o.ge5 = +(1 / cinco).toFixed(2); pj.ge5 = +(cinco / soma).toFixed(4); }
  o.pj = pj;
  return o;
}

function converte(liga, eventos) {
  const finais = [], futuros = [];
  const agora = Date.now();
  for (const e of eventos) {
    if (!e || !e.startTime || !e.home || !e.away) continue;
    if (e.league && e.league.name && e.league.name !== LIGAS_TC[liga]) continue;
    const inicio = new Date(Number(e.startTime)).toISOString();
    const horario = horaBR(Number(e.startTime));
    const casa = e.home.name, fora = e.away.name;
    const base = { id: `insp:${liga}:${inicio}`, nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario, inicio, fonte: "tipsclan" };
    if (e.status === "finished" && e.score && e.score.home != null && e.score.away != null) {
      const a = Number(e.score.home), b = Number(e.score.away);
      const jogo = { ...base, a, b, total: a + b, placar: `${a}-${b}`, odds: oddsAMD(e.oddsMap || {}) };
      if (e.htScore && e.htScore.home != null) { jogo.htA = Number(e.htScore.home); jogo.htB = Number(e.htScore.away); }
      finais.push(jogo);
    } else if (e.status === "upcoming" && Number(e.startTime) > agora - 60000) {
      futuros.push({ ...base, odds: oddsAMD(e.oddsMap || {}) });
    }
  }
  finais.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  futuros.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  return { finais, futuros };
}

async function coletaLiga(liga) {
  const st = estado.ligas[liga] || (estado.ligas[liga] = { ts: 0, erro: null, cheio: false });
  const range = st.cheio ? "3h" : (process.env.TIPSCLAN_CARGA || "24h");
  const { finais, futuros } = converte(liga, await historico(liga, range));
  if (!finais.length && !futuros.length) throw new Error("sem jogos");
  const ult = finais[finais.length - 1];
  const marca = ult ? ult.id + ult.placar : null;
  if (marca && marca !== st.marca) console.log(`[tipsclan] ${liga} ${ult.horario} ${ult.nome} ${ult.placar}${st.cheio ? "" : ` (carga inicial ${range}: ${finais.length} jogos)`}`);
  // So recalcula a liga no AMD quando algo mudou (resultado novo ou lista de proximos).
  const marcaFut = futuros.map(f => f.id).join(",");
  const mudou = marca !== st.marca || marcaFut !== st.marcaFut || !st.cheio;
  const primeira = !st.cheio;
  st.marca = marca; st.marcaFut = marcaFut; st.cheio = true; st.ts = Date.now(); st.erro = null;
  st.jogos = finais.length; st.futuros = futuros.length; st.ultimo = ult ? `${ult.horario} ${ult.nome} ${ult.placar}` : null;
  if (onLigaCb && mudou) await onLigaCb(liga, primeira ? finais : finais.slice(-40), futuros);
}

async function ciclo() {
  if (estado.rodando || !configurado()) return;
  estado.rodando = true;
  try {
    const erros = [];
    for (const liga of Object.keys(LIGAS_TC)) {
      // Plano gratuito tem 0,15 CPU: respira entre as ligas para o servidor seguir respondendo.
      await new Promise(r => setTimeout(r, 1500));
      try { await coletaLiga(liga); }
      catch (e) { const m = String((e && e.message) || e); if (estado.ligas[liga]) estado.ligas[liga].erro = m; erros.push(liga + ": " + m); }
    }
    const erro = erros.join(" | ") || null;
    if (erro !== estado.erro) console.log("[tipsclan] " + (erro ? "erro: " + erro : "coleta ok"));
    estado.erro = erro; estado.ts = Date.now();
  } finally {
    estado.rodando = false;
  }
}

// A TipsClan esta no ar e entregando? (o servidor usa isso para decidir a fonte)
export function ativaLiga(liga) {
  const l = estado.ligas[liga];
  return !!(l && l.ts > Date.now() - 90000);
}

export function iniciar(onLiga) {
  onLigaCb = onLiga;
  if (!configurado()) { console.log("[tipsclan] sem TIPSCLAN_EMAIL/TIPSCLAN_SENHA: desligado"); return; }
  if (timer) clearInterval(timer);
  timer = setInterval(ciclo, INTERVALO);
  setTimeout(ciclo, 20000); // deixa o boot (Redis + Vavada) terminar antes
}

export function obterEstado() { return { ...estado, configurado: configurado() }; }
