// COLETOR INSPIRED VIA GIROCERTO (publico, sem login)
// A pagina de futebol virtual do girocerto.fun (Next.js) entrega os eventos em
// JSON dentro do payload RSC. Resultados: ultimos 10 jogos por liga. Proximos:
// 6 jogos com odds (1x2, total 2.5, ambas). Consultando a cada 15s o historico
// vai se acumulando no AMD (e fica salvo no Redis).

const BASE = process.env.GIROCERTO_URL || "https://girocerto.fun";
export const PRODUTOS = { cam: "inspired_champions", cop: "inspired_international", ame: "inspired_soccer3" };
const INTERVALO = Number(process.env.GIROCERTO_INTERVALO || 15000);

const estado = { ts: 0, erro: null, rodando: false, ciclos: 0, ligas: {} };
let onLigaCb = null;
let timer = null;
let ciclosFuturos = 0;

const horaBR = iso => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(11, 16);

async function pega(produto, resultados) {
  const url = `${BASE}/esportes/virtual?produto=${produto}${resultados ? "&aba=resultados" : ""}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { RSC: "1", Accept: "text/x-component" }, cache: "no-store", signal: ctrl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status + " " + txt.slice(0, 100).replace(/\s+/g, " "));
    return txt;
  } finally {
    clearTimeout(t);
  }
}

// Extrai todos os arrays "events":[...] do payload (respeitando strings).
function extraiEventos(txt) {
  const out = [];
  let pos = 0;
  while ((pos = txt.indexOf('"events":[', pos)) >= 0) {
    const ini = pos + 9;
    let d = 0, emStr = false, esc = false, fim = -1;
    for (let i = ini; i < txt.length; i++) {
      const c = txt[i];
      if (emStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') emStr = false; continue; }
      if (c === '"') emStr = true;
      else if (c === "[") d++;
      else if (c === "]") { d--; if (!d) { fim = i; break; } }
    }
    if (fim < 0) break;
    try { const arr = JSON.parse(txt.slice(ini, fim + 1)); if (Array.isArray(arr)) out.push(...arr); } catch (e) {}
    pos = fim;
  }
  return out;
}

function odds(ev) {
  const o = {};
  for (const m of ev.markets || []) {
    const outs = Object.fromEntries((m.outcomes || []).map(x => [x.key, Number(x.odds)]));
    if (m.kind === "total" && String(m.line) === "2.5") { o.o25 = outs.over || null; o.u25 = outs.under || null; }
    if (m.kind === "total" && String(m.line) === "1.5") { o.o15 = outs.over || null; o.u15 = outs.under || null; }
    if (m.kind === "total" && String(m.line) === "3.5") { o.o35 = outs.over || null; o.u35 = outs.under || null; }
    if (m.kind === "btts") { o.ambs = outs.yes || null; o.ambn = outs.no || null; }
  }
  const pj = {};
  const par = (a, b) => { if (o[a] > 1 && o[b] > 1) { const ia = 1 / o[a], ib = 1 / o[b]; pj[a] = +(ia / (ia + ib)).toFixed(4); pj[b] = +(ib / (ia + ib)).toFixed(4); } };
  par("o15", "u15"); par("o25", "u25"); par("o35", "u35"); par("ambs", "ambn");
  o.pj = pj;
  return o;
}

function base(liga, ev) {
  const casa = ev.home && ev.home.name || "Casa", fora = ev.away && ev.away.name || "Fora";
  const horario = horaBR(ev.startsAt);
  return { id: `insp:${liga}:${new Date(ev.startsAt).toISOString()}`, nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario, inicio: new Date(ev.startsAt).toISOString(), fonte: "girocerto" };
}

async function coletaLiga(liga, produto, comFuturos) {
  const slug = "virtual-" + produto.replace(/_/g, "-");
  const doProduto = ev => ev && ev.startsAt && (!ev.league || !ev.league.slug || ev.league.slug === slug);
  const st = estado.ligas[liga] || (estado.ligas[liga] = { ts: 0, erro: null, ultimo: null });

  const res = extraiEventos(await pega(produto, true)).filter(doProduto);
  const finais = [];
  const vistos = new Set();
  for (const ev of res) {
    if (!ev.ended || !ev.final || ev.final.home == null || ev.final.away == null) continue;
    const b = base(liga, ev);
    if (vistos.has(b.id)) continue; vistos.add(b.id);
    const a = Number(ev.final.home), bb = Number(ev.final.away);
    finais.push({ ...b, a, b: bb, total: a + bb, placar: `${a}-${bb}`, odds: {} });
  }
  finais.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));

  let futuros = null;
  if (comFuturos) {
    const prox = extraiEventos(await pega(produto, false)).filter(doProduto);
    const agora = Date.now();
    futuros = [];
    const vf = new Set();
    for (const ev of prox) {
      if (ev.ended || Date.parse(ev.startsAt) < agora - 60000) continue;
      const b = base(liga, ev);
      if (vf.has(b.id)) continue; vf.add(b.id);
      futuros.push({ ...b, odds: odds(ev) });
    }
    futuros.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  }

  const ultimo = finais.length ? finais[finais.length - 1] : null;
  const novoUltimo = ultimo ? ultimo.id + ultimo.placar : null;
  if (novoUltimo && novoUltimo !== st.ultimoId) console.log(`[girocerto] ${liga} ${ultimo.horario} ${ultimo.nome} ${ultimo.placar}`);
  st.ultimoId = novoUltimo;
  st.ultimo = ultimo ? `${ultimo.horario} ${ultimo.nome} ${ultimo.placar}` : null;
  st.ts = Date.now(); st.erro = null; st.resultados = finais.length;
  if (futuros) st.futuros = futuros.length;
  const marcaFut = futuros ? futuros.map(f => f.id).join(",") : st.marcaFut;
  const mudou = novoUltimo !== st.marcaAplicada || marcaFut !== st.marcaFut;
  st.marcaAplicada = novoUltimo; st.marcaFut = marcaFut;
  if (onLigaCb && mudou && (finais.length || (futuros && futuros.length))) await onLigaCb(liga, finais, futuros);
}

async function ciclo() {
  if (estado.rodando) return;
  estado.rodando = true;
  const comFuturos = ciclosFuturos++ % 2 === 0; // proximos jogos a cada 30s
  try {
    const erros = await Promise.all(Object.entries(PRODUTOS).map(([l, p]) =>
      coletaLiga(l, p, comFuturos).then(() => null).catch(e => {
        const msg = String((e && e.message) || e);
        if (estado.ligas[l]) estado.ligas[l].erro = msg;
        return l + ": " + msg;
      })));
    const erro = erros.filter(Boolean).join(" | ") || null;
    if (erro !== estado.erro) console.log("[girocerto] " + (erro ? "erro: " + erro : "coleta ok"));
    estado.erro = erro;
    estado.ts = Date.now();
    estado.ciclos++;
  } finally {
    estado.rodando = false;
  }
}

export function iniciar(onLiga) {
  onLigaCb = onLiga;
  if (timer) clearInterval(timer);
  timer = setInterval(ciclo, INTERVALO);
  setTimeout(ciclo, 2000);
}

export function obterEstado() { return { ...estado, fonte: BASE }; }
export { extraiEventos };
