import { fetch as curlFetch } from 'wreq-js';

const VIRTUALS_URL = process.env.VAVADA_VIRTUALS_URL || "https://sb2virtuals-altenar2.biahosted.com/api/";
const INTERVALO = Math.max(4000, Number(process.env.VAVADA_INTERVALO || 8000));
const DEBUG = process.argv.includes("--debug") || process.env.VAVADA_DEBUG === "1";
const PAUSA_DETALHE = Math.max(0, Number(process.env.VAVADA_PAUSA_DETALHE || 300));

// Jogos Kiron "single match" exibidos pela Vavada.
const LIGAS = {
  bra: 55,
  eng: 57,
  ita: 59,
  lat: 61,
  spa: 63,
  mnd: 92
};

let config = null;
let rodando = false;
let timer = null;
const estado = { ts: 0, erro: null, rodando: false, ligas: {}, integrationId: null, ciclos: 0, duracaoMs: 0, proxima: 0 };
const conhecidos = new Map();
const champPorLiga = {};
const menorIdLiga = {};
const backfillEstado = { rodando: false, feitos: 0, requisicoes: 0, porLiga: {}, erro: null };

async function carregarConfig(force = false) {
  if (config && !force) return config;
  config = {
    integrationId: String(process.env.VAVADA_INTEGRATION_ID || "vavada").trim(),
    token: String(process.env.VAVADA_TOKEN || "")
  };
  estado.integrationId = config.integrationId;
  return config;
}

function paramsComuns(cfg) {
  return {
    culture: "pt-PT",
    timezoneOffset: "180",
    integration: cfg.integrationId,
    deviceType: "1",
    numFormat: "en-GB",
    countryCode: "BR"
  };
}

const espera = ms => new Promise(resolve => setTimeout(resolve, ms));

function jsonDaResposta(texto) {
  const bruto = String(texto || "").trim();
  try { return JSON.parse(bruto); } catch {}
  const pre = bruto.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!pre) throw new Error(`Resposta nao JSON: ${bruto.slice(0, 120)}`);
  const limpo = pre[1]
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return JSON.parse(limpo);
}

async function api(path, params = {}) {
  const cfg = await carregarConfig();
  const url = new URL(path, VIRTUALS_URL);
  
  for (const [k, v] of Object.entries({ ...paramsComuns(cfg), ...params })) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  // Headers padrão de um navegador real
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Origin': process.env.VAVADA_ORIGIN || 'https://vavada.com',
    'Referer': process.env.VAVADA_REFERER || 'https://vavada.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  };

  if (cfg.token) {
    headers['Authorization'] = `Bearer ${cfg.token}`;
  }

  let ultimoErro;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      // MÁGICA DA SCRAPINGANT: Pega a URL da Vavada e passa pelo proxy deles
      const apiKey = process.env.SCRAPINGANT_API_KEY; 
      let urlFinal = url.toString();

      if (apiKey) {
        const proxyUrl = new URL('https://api.scrapingant.com/v2/general');
        proxyUrl.searchParams.set('url', url.toString());
        proxyUrl.searchParams.set('x-api-key', apiKey);
        proxyUrl.searchParams.set('browser', 'true');
        proxyUrl.searchParams.set('return_page_source', 'true');
        proxyUrl.searchParams.set('timeout', '60');
        urlFinal = proxyUrl.toString();
      }

      const limite = apiKey ? 80000 : 20000;
      const r = await Promise.race([
        curlFetch(urlFinal, {
          headers: headers,
          browser: process.env.VAVADA_BROWSER_PROFILE || 'chrome_147',
          timeout: limite - 5000
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${path} timeout ${limite}ms`)), limite))
      ]);

      if (r.status === 403 || r.status === 429) {
        console.warn(`[vavada] ${path} HTTP ${r.status} tentativa ${tentativa}/3`);
      }
      
      if (!r.ok) {
        const errorText = await r.text(); 
        throw new Error(`${path} HTTP ${r.status} - Resposta: ${errorText.substring(0, 100)}`);
      }
      
      return jsonDaResposta(await r.text());

    } catch (e) {
      ultimoErro = e;
      if (tentativa < 3) await espera(500 * (2 ** (tentativa - 1)));
    }
  }
  throw ultimoErro;
}

function lista(x, nomes) {
  for (const n of nomes) if (Array.isArray(x?.[n])) return x[n];
  return Array.isArray(x) ? x : [];
}

function horaBR(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
}

function idsMercado(detail, typeId) {
  const mercado = lista(detail, ["markets", "marketList"]).find(m => Number(m.typeId) === typeId);
  if (!mercado) return new Set();
  return new Set([...(mercado.desktopOddIds || []), ...(mercado.mobileOddIds || [])].flat(Infinity).map(Number));
}

function oddDoMercado(detail, typeId, teste) {
  const ids = idsMercado(detail, typeId);
  return lista(detail, ["odds", "oddList"]).find(o => ids.has(Number(o.id)) && teste(o));
}

function oddsDoMercado(detail, typeId) {
  const ids = idsMercado(detail, typeId);
  return lista(detail, ["odds", "oddList"]).filter(o => ids.has(Number(o.id)));
}

function linhaDaOdd(odd) {
  try {
    const sv = typeof odd?.sv === "string" ? JSON.parse(odd.sv) : odd?.sv;
    return String(sv?.["1"] ?? sv?.[1] ?? "").replace(",", ".");
  } catch { return ""; }
}

// Todas as odds uteis da Kiron + probabilidade JUSTA (sem a margem da casa).
// Total (18): tipo 12 = Mais, 13 = Menos, linha em sv. Ambas (29): 74 Sim, 76 Nao.
// Nº exato de gols (21): o 5+ e o dutching de "5" e "6" (6 = 6 ou mais).
export function oddsKiron(detail) {
  const total = (tipo, linha) => oddDoMercado(detail, 18, o => Number(o.typeId) === tipo && linhaDaOdd(o) === linha)?.price ?? null;
  const o = {
    o15: total(12, "1.5"), u15: total(13, "1.5"),
    o25: total(12, "2.5"), u25: total(13, "2.5"),
    o35: total(12, "3.5"), u35: total(13, "3.5"),
    ambs: oddDoMercado(detail, 29, x => Number(x.typeId) === 74 || /^sim$/i.test(String(x.name || "")))?.price ?? null,
    ambn: oddDoMercado(detail, 29, x => Number(x.typeId) === 76 || /^n[aã]o$/i.test(String(x.name || "")))?.price ?? null,
    ge5: null
  };
  const pj = {};
  const par = (a, b, ka, kb) => { if (o[a] > 1 && o[b] > 1) { const ia = 1 / o[a], ib = 1 / o[b]; pj[ka] = +(ia / (ia + ib)).toFixed(4); pj[kb] = +(ib / (ia + ib)).toFixed(4); } };
  par("o15", "u15", "o15", "u15"); par("o25", "u25", "o25", "u25"); par("o35", "u35", "o35", "u35"); par("ambs", "ambn", "ambs", "ambn");
  const ng = oddsDoMercado(detail, 21).filter(x => Number(x.price) > 1);
  const soma = ng.reduce((s, x) => s + 1 / x.price, 0);
  const cinco = ng.filter(x => ["5", "6"].includes(String(x.name).trim()));
  if (cinco.length === 2 && soma > 0) {
    const inv = cinco.reduce((s, x) => s + 1 / x.price, 0);
    o.ge5 = +(1 / inv).toFixed(2);
    pj.ge5 = +(inv / soma).toFixed(4);
  }
  o.pj = pj;
  return o;
}

function vencedorUnico(detail, typeId) {
  const vencedoras = oddsDoMercado(detail, typeId).filter(o => Number(o.oddStatus) === 1);
  return vencedoras.length === 1 ? vencedoras[0] : null;
}

function debugMercados(detail, evento) {
  if (!DEBUG) return;
  const bruto = {};
  for (const tipo of [1, 18, 29, 199]) {
    bruto[tipo] = oddsDoMercado(detail, tipo).map(o => ({
      id: o.id, typeId: o.typeId, name: o.name, sv: o.sv,
      price: o.price, oddStatus: o.oddStatus
    }));
  }
  console.log(`[vavada:debug] ${evento.id} ${evento.name}`, JSON.stringify(bruto));
}

// Validado contra a API real em 2026-11-18: oddStatus 1 = selecao vencedora,
// 7 = perdedora, nos mercados liquidados. O placar vem do "Resultado exato"
// (199) e so e aceito se bater com os outros mercados liquidados.
export function placarValidado(detail) {
  const exato = vencedorUnico(detail, 199);
  if (!exato) return null;
  const [a, b] = String(exato.name).split(":").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // 1x2: typeId 1 = casa, 2 = empate, 3 = fora
  const v1x2 = vencedorUnico(detail, 1);
  if (!v1x2) return null;
  const esperado = a > b ? 1 : a === b ? 2 : 3;
  if (Number(v1x2.typeId) !== esperado) return null;
  // Nº exato de gols (21), quando liquidado
  const ng = vencedorUnico(detail, 21);
  if (ng) {
    const n = parseInt(String(ng.name), 10);
    if (Number.isFinite(n) && !(n === a + b || (n >= 6 && a + b >= 6))) return null;
  }
  // Ambas marcam (29), quando liquidado
  const ambas = vencedorUnico(detail, 29);
  if (ambas) {
    const sim = /^sim$/i.test(String(ambas.name || "").trim());
    const nao = /^n[aã]o$/i.test(String(ambas.name || "").trim());
    if ((sim || nao) && sim !== (a > 0 && b > 0)) return null;
  }
  return { a, b };
}

function parseDetail(detail, evento, liga) {
  debugMercados(detail, evento);
  const placar = placarValidado(detail);
  if (!placar) return null;
  const { a, b } = placar;
  
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  

  const horario = horaBR(detail?.startDate || evento?.startDate);
  
  return {
    id: `vavada:${liga}:${evento.id}`,
    nome: `${casa} x ${fora}`, casa, fora, a, b, total: a + b,
    placar: `${a}-${b}`, horario, hora: horario,
    inicio: detail?.startDate || evento?.startDate || null,
    odds: oddsKiron(detail),
    fonte: "vavada"
  };
}

function parseUpcoming(detail, evento, liga) {
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  

  const horario = horaBR(detail?.startDate || evento?.startDate);
  
  return { 
    id: `vavada:${liga}:${evento.id}`, 
    nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario,
    inicio: detail?.startDate || evento?.startDate || null,
    odds: oddsKiron(detail), 
    fonte: "vavada" 
  };
}

async function detalhes(game, evento) {
  const dbIdSeguro = game.dbId || evento.dbId || 12; 
  return api("WidgetVirtuals/GetVirtualEventDetails", { 
    eventId: evento.id, 
    id: game.id || evento.id, 
    dbId: dbIdSeguro 
  });
}

async function coletaLiga(games, liga, tipo, onLiga) {
  const game = games.find(g => Number(g.id) === tipo || Number(g.typeId) === tipo || Number(g.gameTypeId) === tipo);
  if (!game) {
    estado.ligas[liga] = { ...(estado.ligas[liga] || {}), ts: Date.now(), erro: `jogo Kiron ${tipo} não encontrado` };
    return;
  }

  try {
    const evJson = await api("Virtuals/GetEventList", { id: game.id, dbId: game.dbId || 12 });
    const eventos = lista(evJson, ["events", "items", "data"]);
    const fechados = [];
    const futuros = [];

    for (const ev of eventos) {
      const chave = `${liga}:${ev.id}:${ev.status}`;
      let salvo = conhecidos.get(chave);
      if (!salvo) {
        await espera(PAUSA_DETALHE);
        const det = await detalhes(game, ev);
        const cid = det?.champ?.id;
        if (cid) champPorLiga[liga] = Number(cid);
        salvo = Number(ev.status) === 2 ? parseDetail(det, ev, liga) : parseUpcoming(det, ev, liga);
        if (salvo && Number(ev.status) === 2) console.log(`[vavada] novo ${liga} ${salvo.horario} ${salvo.casa}-${salvo.fora} ${salvo.placar}`);
        else if (!salvo && Number(ev.status) === 2) console.log(`[vavada] ${liga} ${ev.name} encerrado sem liquidacao completa, tentando de novo`);
        if (salvo) conhecidos.set(chave, salvo);
      }
      if (!salvo) continue;
      if (Number(ev.status) === 2 && salvo.a != null) fechados.push(salvo);
      if (Number(ev.status) === 2 && Number(ev.id) < (menorIdLiga[liga] || Infinity)) menorIdLiga[liga] = Number(ev.id);
      else if (Number(ev.status) === 0) futuros.push(salvo);
    }

    await onLiga(liga, fechados, futuros);
    estado.ligas[liga] = { jogos: fechados.length, futuros: futuros.length, eventos: eventos.length, ts: Date.now(), erro: null };
    console.log(`[vavada] ${liga}: ${fechados.length} fechados, ${futuros.length} futuros, ${eventos.length} eventos`);
  } catch (e) {
    const erro = String(e?.message || e);
    estado.ligas[liga] = { ...(estado.ligas[liga] || {}), ts: Date.now(), erro };
    console.warn(`[vavada] ${liga} falhou: ${erro}`);
  }
}

async function rodada(onLiga) {
  if (rodando) return;
  const inicio = Date.now();
  rodando = true; estado.rodando = true; estado.inicio = inicio; estado.proxima = 0;
  console.log(`[vavada] ciclo ${estado.ciclos + 1} iniciado (proxy ${process.env.SCRAPINGANT_API_KEY ? "scrapingant" : "direto"})`);
  try {
    const gamesJson = await api("Virtuals/GetGames");
    const games = Array.isArray(gamesJson?.sports)
      ? gamesJson.sports.flatMap(sport => Array.isArray(sport?.games) ? sport.games : [])
      : lista(gamesJson, ["games", "items", "data", "events"]);
    estado.diagnostico = { total: games.length, chaves: gamesJson && typeof gamesJson === "object" ? Object.keys(gamesJson) : [] };

    // As seis ligas em paralelo: o ciclo dura o tempo da liga mais lenta.
    await Promise.all(Object.entries(LIGAS).map(([liga, tipo]) => coletaLiga(games, liga, tipo, onLiga)));
    estado.ts = Date.now(); estado.erro = null; estado.ciclos++;
  } catch (e) {
    estado.ts = Date.now(); estado.erro = String(e.message || e);
    console.warn(`[vavada] ciclo falhou: ${estado.erro}`);
  } finally {
    estado.duracaoMs = Date.now() - inicio;
    rodando = false; estado.rodando = false;
    console.log(`[vavada] ciclo concluido em ${estado.duracaoMs}ms; ciclo ${estado.ciclos}`);
  }
}

export function iniciar(onLiga) {
  if (timer) return;
  const tick = async () => {
    await rodada(onLiga).catch(e => { estado.ts = Date.now(); estado.erro = String(e?.message || e); });
    estado.proxima = Date.now() + INTERVALO;
    timer = setTimeout(tick, INTERVALO);
  };
  timer = setTimeout(tick, 0);
}

export function obterEstado() { return JSON.parse(JSON.stringify(estado)); }

// ---------------------------------------------------------------------------
// RECUPERACAO DO HISTORICO: a API so lista os 2 ultimos jogos encerrados, mas
// GetVirtualEventDetails responde qualquer eventId antigo (ja liquidado).
// Os ids sao sequenciais para todos os jogos virtuais; cada liga aparece em
// grupos de ids consecutivos (um grupo por rodada, ~96 ids de distancia).
// Para cada liga: chuta onde fica o grupo anterior, procura em volta e le o
// grupo inteiro. Vai do mais novo para o mais velho, sem pressa (rate limit).
async function detalhePorId(id) {
  backfillEstado.requisicoes++;
  for (let t = 0; t < 4; t++) {
    try {
      return await api("WidgetVirtuals/GetVirtualEventDetails", { eventId: id, dbId: 12 });
    } catch (e) {
      const msg = String(e?.message || e);
      if (/HTTP 4(04|00)/.test(msg)) return null;
      await espera(/429|403/.test(msg) ? 30000 : 3000);
    }
  }
  return null;
}

export async function recuperarHistorico(onLiga, horas = 24, jaTem = null) {
  if (backfillEstado.rodando) return;
  backfillEstado.rodando = true;
  const PAUSA = Math.max(0, Number(process.env.VAVADA_BACKFILL_PAUSA || 200));
  try {
    for (let i = 0; i < 60 && Object.keys(LIGAS).some(l => !champPorLiga[l] || !menorIdLiga[l]); i++) await espera(5000);
    const ligaDoChamp = {};
    for (const [l, c] of Object.entries(champPorLiga)) ligaDoChamp[c] = l;
    const ligas = Object.keys(ligaDoChamp).map(c => ligaDoChamp[c]);
    const limite = Date.now() - horas * 3600000;
    const cache = new Map();
    const PARALELO = Math.max(1, Math.min(8, Number(process.env.VAVADA_BACKFILL_PARALELO || 6)));
    const busca = async id => {
      const det = await detalhePorId(id);
      const v = { champ: Number(det?.champ?.id || 0), det };
      cache.set(id, v);
      return v;
    };
    // le um bloco de ids de uma vez (varias consultas em paralelo)
    const le = async id => {
      if (cache.has(id)) return cache.get(id);
      const ids = [];
      for (let k = id; k > id - PARALELO * 2; k--) if (!cache.has(k)) ids.push(k);
      for (let i = 0; i < ids.length; i += PARALELO) {
        await Promise.all(ids.slice(i, i + PARALELO).map(busca));
        await espera(PAUSA);
      }
      while (cache.size > 4000) cache.delete(cache.keys().next().value);
      return cache.get(id) || busca(id);
    };
    const maisVelho = {}, pend = {}, lido = new Set(), repetidos = {};
    for (const l of ligas) { maisVelho[l] = Infinity; pend[l] = []; backfillEstado.porLiga[l] = { jogos: 0, ate: null }; }
    const despeja = async l => {
      if (!pend[l].length) return;
      const lote = pend[l]; pend[l] = [];
      try { await onLiga(l, lote, null, { historico: true }); } catch (e) {}
      const velho = lote.reduce((m, g) => (g.inicio && g.inicio < m.inicio ? g : m), lote[0]);
      console.log(`[vavada-hist] ${l}: +${lote.length} jogos (ja chegou em ${velho.horario})`);
    };
    const pega = (id, v) => {
      if (lido.has(id)) return;
      lido.add(id);
      const liga = ligaDoChamp[v.champ];
      if (!liga || !v.det) return;
      const t = Date.parse(v.det.startDate || "");
      if (Number.isFinite(t)) maisVelho[liga] = Math.min(maisVelho[liga], t);
      if (!(t >= limite)) return;
      const g = parseDetail(v.det, { id, name: v.det.name, startDate: v.det.startDate }, liga);
      if (!g || g.a == null) return;
      pend[liga].push(g);
      backfillEstado.feitos++; backfillEstado.porLiga[liga].jogos++; backfillEstado.porLiga[liga].ate = g.inicio;
    };
    // Varre os ids para tras de 2 em 2 (todo grupo de uma liga tem 2+ ids
    // seguidos). Ao achar uma liga nossa, le o grupo inteiro.
    let id = Math.min(...ligas.map(l => menorIdLiga[l])) - 1;
    let vazios = 0;
    while (ligas.some(l => maisVelho[l] >= limite) && vazios < 3000) {
      const v = await le(id);
      if (!v.det) vazios++; else vazios = 0;
      if (ligaDoChamp[v.champ]) {
        let a = id, b = id;
        while (ligaDoChamp[(await le(a - 1)).champ] === ligaDoChamp[v.champ]) a--;
        while (ligaDoChamp[(await le(b + 1)).champ] === ligaDoChamp[v.champ]) b++;
        const liga = ligaDoChamp[v.champ];
        let conhecidos = 0;
        for (let k = a; k <= b; k++) {
          if (jaTem && jaTem(liga, k)) { conhecidos++; lido.add(k); continue; }
          pega(k, await le(k));
        }
        // a memoria ja tinha esses jogos: depois de 3 grupos conhecidos seguidos, a liga esta completa
        repetidos[liga] = conhecidos === b - a + 1 ? (repetidos[liga] || 0) + 1 : 0;
        if (repetidos[liga] >= 3) maisVelho[liga] = -Infinity;
        if (pend[liga].length >= 40) await despeja(liga);
        id = a - 2;
      } else id -= 2;
    }
    for (const l of ligas) await despeja(l);
    console.log(`[vavada-hist] concluido: ${backfillEstado.feitos} jogos recuperados em ${backfillEstado.requisicoes} consultas`);
  } catch (e) {
    backfillEstado.erro = String(e?.message || e);
    console.warn(`[vavada-hist] falhou: ${backfillEstado.erro}`);
  } finally {
    backfillEstado.rodando = false;
  }
}
export function estadoHistorico() { return JSON.parse(JSON.stringify(backfillEstado)); }
