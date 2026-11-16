import { fetch as curlFetch } from 'wreq-js';

const VIRTUALS_URL = process.env.VAVADA_VIRTUALS_URL || "https://sb2virtuals-altenar2.biahosted.com/api/";
const INTERVALO = Math.max(10000, Number(process.env.VAVADA_INTERVALO || 60000));
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
const estado = { ts: 0, erro: null, rodando: false, ligas: {}, integrationId: null };
const conhecidos = new Map();

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
        urlFinal = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(url.toString())}&x-api-key=${apiKey}`;
      }

      const r = await curlFetch(urlFinal, {
        headers: headers,
        browser: process.env.VAVADA_BROWSER_PROFILE || 'chrome_147',
        timeout: 15000 
      });

      if (r.status === 403 || r.status === 429) {
        console.warn(`[vavada] ${path} HTTP ${r.status} tentativa ${tentativa}/3`);
      }
      
      if (!r.ok) {
        const errorText = await r.text(); 
        throw new Error(`${path} HTTP ${r.status} - Resposta: ${errorText.substring(0, 100)}`);
      }
      
      const data = await r.json();
      return data;

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

function parseDetail(detail, evento, liga) {
  debugMercados(detail, evento);
  if (!vencedorUnico(detail, 1)) return null;
  const exato = vencedorUnico(detail, 199);
  if (!exato) return null;
  const [a, b] = String(exato.name).split(":").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  
  const o25 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && linhaDaOdd(o) === "2.5");
  const o35 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && linhaDaOdd(o) === "3.5");
  const ambasSim = oddDoMercado(detail, 29, o => Number(o.typeId) === 74 || /^sim$/i.test(String(o.name || "")));
  const ambasNao = oddDoMercado(detail, 29, o => Number(o.typeId) === 76 || /^n[aã]o$/i.test(String(o.name || "")));
  
  const horario = horaBR(detail?.startDate || evento?.startDate);
  
  return {
    id: `vavada:${liga}:${evento.id}`,
    nome: `${casa} x ${fora}`, casa, fora, a, b, total: a + b,
    placar: `${a}-${b}`, horario, hora: horario,
    odds: { o25: o25?.price ?? null, o35: o35?.price ?? null, ambs: ambasSim?.price ?? null, ambn: ambasNao?.price ?? null },
    fonte: "vavada"
  };
}

function parseUpcoming(detail, evento, liga) {
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  
  const o25 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && linhaDaOdd(o) === "2.5");
  const o35 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && linhaDaOdd(o) === "3.5");
  const ambasSim = oddDoMercado(detail, 29, o => Number(o.typeId) === 74 || /^sim$/i.test(String(o.name || "")));
  const ambasNao = oddDoMercado(detail, 29, o => Number(o.typeId) === 76 || /^n[aã]o$/i.test(String(o.name || "")));
  
  const horario = horaBR(detail?.startDate || evento?.startDate);
  
  return { 
    id: `vavada:${liga}:${evento.id}`, 
    nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario,
    odds: { o25: o25?.price ?? null, o35: o35?.price ?? null, ambs: ambasSim?.price ?? null, ambn: ambasNao?.price ?? null }, 
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

async function rodada(onLiga) {
  if (rodando) return;
  rodando = true; estado.rodando = true;
  try {
    const gamesJson = await api("Virtuals/GetGames");
    const games = lista(gamesJson, ["games", "items", "data", "sports", "events"]);
    
    for (const [liga, tipo] of Object.entries(LIGAS)) {
      const game = games.find(g => Number(g.id) === tipo || Number(g.typeId) === tipo || Number(g.gameTypeId) === tipo);
      
      if (!game) { 
        estado.ligas[liga] = { erro: `jogo Kiron ${tipo} não encontrado` }; 
        continue; 
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
            
            salvo = Number(ev.status) === 2 ? parseDetail(det, ev, liga) : parseUpcoming(det, ev, liga);
            if (salvo) conhecidos.set(chave, salvo);
          }
          
          if (!salvo) continue;
          if (Number(ev.status) === 2 && salvo.a != null) fechados.push(salvo);
          else if (Number(ev.status) === 0) futuros.push(salvo);
        }
        
        await onLiga(liga, fechados, futuros);
        estado.ligas[liga] = { jogos: fechados.length, futuros: futuros.length, ts: Date.now(), erro: null };
        
      } catch (e) {
        estado.ligas[liga] = { ...(estado.ligas[liga] || {}), ts: Date.now(), erro: String(e.message || e) };
      }
    }
    estado.ts = Date.now(); estado.erro = null;
  } catch (e) {
    estado.ts = Date.now(); estado.erro = String(e.message || e);
  } finally { 
    rodando = false; estado.rodando = false; 
  }
}

export function iniciar(onLiga) {
  if (timer) return;
  const tick = () => rodada(onLiga).catch(() => {});
  tick();
  timer = setInterval(tick, INTERVALO);
}

export function obterEstado() { return JSON.parse(JSON.stringify(estado)); }
