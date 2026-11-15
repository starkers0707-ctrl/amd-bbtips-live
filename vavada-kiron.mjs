const GRAPHQL_URL = process.env.VAVADA_GRAPHQL_URL || "https://vavada.com/graphql";
const VIRTUALS_URL = process.env.VAVADA_VIRTUALS_URL || "https://sb2virtuals-altenar2.biahosted.com/api/";
const INTERVALO = Math.max(5000, Number(process.env.VAVADA_INTERVALO || 10000));

// Jogos Kiron "single match" exibidos pela Vavada. As ligas permanecem
// separadas no AMD; os IDs pares correspondem aos campeonatos, que não são a
// grade de jogo único usada pelo painel.
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

function unwrapLaunch(data) {
  const x = data?.data?.launchAltenarSportLayout;
  if (Array.isArray(x)) return x[0] || null;
  return x || null;
}

async function carregarConfig(force = false) {
  if (config && !force) return config;
  const integrationEnv = String(process.env.VAVADA_INTEGRATION_ID || "").trim();
  if (integrationEnv) {
    config = { integrationId: integrationEnv, token: String(process.env.VAVADA_TOKEN || "") };
    return config;
  }
  const body = {
    operationName: "GetSportData",
    variables: {},
    query: "query GetSportData { launchAltenarSportLayout { integrationId shareCode token wsdkUrl } }"
  };
  const r = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`config Vavada HTTP ${r.status}`);
  const json = await r.json();
  const launch = unwrapLaunch(json);
  if (!launch?.integrationId) throw new Error("integrationId não veio da Vavada");
  config = { integrationId: String(launch.integrationId), token: String(launch.token || "") };
  estado.integrationId = config.integrationId;
  return config;
}

function paramsComuns(cfg) {
  return {
    culture: "pt-BR",
    timezoneOffset: "180",
    integration: cfg.integrationId,
    deviceType: "1",
    numFormat: "pt-BR",
    countryCode: "BR"
  };
}

async function api(path, params = {}, retry = true) {
  const cfg = await carregarConfig();
  const url = new URL(path, VIRTUALS_URL);
  for (const [k, v] of Object.entries({ ...paramsComuns(cfg), ...params })) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { accept: "application/json", origin: "https://vavada.com", referer: "https://vavada.com/" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if ((r.status === 401 || r.status === 403) && retry) {
    await carregarConfig(true);
    return api(path, params, false);
  }
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
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

function parseDetail(detail, evento, liga) {
  const exato = oddDoMercado(detail, 199, o => Number(o.oddStatus) === 1 && /^\d+\s*:\s*\d+$/.test(String(o.name || "")));
  if (!exato) return null;
  const [a, b] = String(exato.name).split(":").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  const o25 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && /2[,.]5/.test(String(o.name || o.sv || "")));
  const o35 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && /3[,.]5/.test(String(o.name || o.sv || "")));
  const ambas = oddDoMercado(detail, 29, o => Number(o.typeId) === 74 || /^sim$/i.test(String(o.name || "")));
  const horario = horaBR(detail?.startDate || evento?.startDate);
  return {
    id: `vavada:${liga}:${evento.id}`,
    nome: `${casa} x ${fora}`, casa, fora, a, b, total: a + b,
    placar: `${a}-${b}`, horario, hora: horario,
    odds: { o25: o25?.price ?? null, o35: o35?.price ?? null, ambs: ambas?.price ?? null },
    fonte: "vavada"
  };
}

function parseUpcoming(detail, evento, liga) {
  const competidores = lista(detail, ["competitors", "participants"]);
  const nomes = String(detail?.name || evento?.name || "").split(/\s+vs\.?\s+|\s+x\s+/i);
  const casa = competidores[0]?.name || nomes[0] || "Casa";
  const fora = competidores[1]?.name || nomes[1] || "Fora";
  const o25 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && /2[,.]5/.test(String(o.name || o.sv || "")));
  const o35 = oddDoMercado(detail, 18, o => Number(o.typeId) === 12 && /3[,.]5/.test(String(o.name || o.sv || "")));
  const ambas = oddDoMercado(detail, 29, o => Number(o.typeId) === 74 || /^sim$/i.test(String(o.name || "")));
  const horario = horaBR(detail?.startDate || evento?.startDate);
  return { id: `vavada:${liga}:${evento.id}`, nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario,
    odds: { o25: o25?.price ?? null, o35: o35?.price ?? null, ambs: ambas?.price ?? null }, fonte: "vavada" };
}

async function detalhes(game, evento) {
  return api("WidgetVirtuals/GetVirtualEventDetails", { eventId: evento.id, id: game.id, dbId: game.dbId });
}

async function rodada(onLiga) {
  if (rodando) return;
  rodando = true; estado.rodando = true;
  try {
    const gamesJson = await api("Virtuals/GetGames");
    const games = lista(gamesJson, ["games", "items", "data"]);
    for (const [liga, tipo] of Object.entries(LIGAS)) {
      const game = games.find(g => Number(g.id) === tipo || Number(g.typeId) === tipo || Number(g.gameTypeId) === tipo);
      if (!game) { estado.ligas[liga] = { erro: `jogo Kiron ${tipo} não encontrado` }; continue; }
      try {
        const evJson = await api("Virtuals/GetEventList", { id: game.id, dbId: game.dbId });
        const eventos = lista(evJson, ["events", "items", "data"]);
        const fechados = [];
        const futuros = [];
        for (const ev of eventos) {
          const chave = `${liga}:${ev.id}:${ev.status}`;
          let salvo = conhecidos.get(chave);
          if (!salvo) {
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
  } finally { rodando = false; estado.rodando = false; }
}

export function iniciar(onLiga) {
  if (timer) return;
  const tick = () => rodada(onLiga).catch(() => {});
  tick();
  timer = setInterval(tick, INTERVALO);
}

export function obterEstado() { return JSON.parse(JSON.stringify(estado)); }
