// AUTO-COLETA BBTIPS (roda no servidor)
const MERCADOS = "o25,o35,ge5,ambas,u25,u15,u05";
const CASAS = [
  { casa: "betano",  path: "betanoFutebolVirtual",  param: "liga", max: 12 },
  { casa: "bet365",  path: "futebolvirtual",        param: "liga", max: 6  },
  { casa: "playpix", path: "PlayPixFutebolVirtual", param: "Liga", max: 8  }
];
const API = "https://api.thtips.com.br/api/";
// nomes reais das ligas por casa (a rota entradasAnalisadas so existe no bet365/playpix)
const NOMES = {
  betano: { 1:"brasileirao", 2:"classicos", 3:"copa", 4:"euro", 5:"america", 6:"british", 7:"espanhola", 8:"scudetto", 9:"italiano", 11:"estrelas", 12:"campeoes" }
};
function normalizaNomeLiga(valor) {
  if (valor == null || typeof valor === "object") return null;
  const bruto = String(valor).replace(/\u0000/g, "").trim();
  if (!bruto || /^\d+$/.test(bruto)) return null;
  const nome = bruto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return nome && !/^liga-?\d+$/.test(nome) ? nome : null;
}
function extraiNomeLiga(json) {
  const chaves = /^(liga|nomeliga|nome_liga|league|leagueName|league_name|campeonato|torneio)$/i;
  const fila = [{ valor: json, nivel: 0 }];
  const vistos = new Set();
  while (fila.length) {
    const { valor, nivel } = fila.shift();
    if (!valor || typeof valor !== "object" || vistos.has(valor) || nivel > 4) continue;
    vistos.add(valor);
    for (const [chave, item] of Object.entries(valor)) {
      if (chaves.test(chave)) {
        const nome = normalizaNomeLiga(item);
        if (nome) return nome;
        if (item && typeof item === "object") {
          const interno = normalizaNomeLiga(item.nome || item.Nome || item.name || item.Name || item.descricao || item.Descricao);
          if (interno) return interno;
        }
      }
    }
    for (const item of Object.values(valor)) {
      if (item && typeof item === "object") fila.push({ valor: item, nivel: nivel + 1 });
    }
  }
  return null;
}
function parseOdds(txt) {
  if (!txt || typeof txt !== "string") return null;
  const out = {}; let n = 0;
  for (const parte of txt.split(";")) {
    if (!parte) continue;
    const m = parte.match(/^([a-z0-9_]*)@([\d.]*)$/i);
    if (!m) continue;
    const nome = m[1] === "ambas" ? "ambs" : (m[1] || "odd");
    const val = parseFloat(m[2]);
    if (!isFinite(val) || val <= 0) continue;
    out[nome] = val; n++;
  }
  return n ? out : null;
}
const limpo = v => { if (v == null) return null; const s = String(v).replace(/\u0000/g, "").trim(); return (s === "" || s === "-") ? null : s; };
function placar(s) { if (typeof s !== "string") return [null, null]; const m = s.match(/(\d+)\s*[-x:]\s*(\d+)/i); return m ? [Number(m[1]), Number(m[2])] : [null, null]; }
async function pega(url, token, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) return { erro: "HTTP " + r.status };
    return { json: await r.json() };
  } catch (e) { return { erro: String((e && e.message) || e) }; } finally { clearTimeout(t); }
}
function converte(json) {
  const placares = [], upcoming = [];
  for (const lin of (json && json.Linhas) || []) {
    for (const c of (lin && lin.Colunas) || []) {
      if (!c || (!c.TimeA && !c.TimeB)) continue;
      const timeA = limpo(c.TimeA), timeB = limpo(c.TimeB);
      const nome = (timeA && timeB) ? timeA + " x " + timeB : null;
      const odds = parseOdds(c.Odds) || {};
      const hora = limpo(c.Horario) || "";
      const [a, b] = placar(c.Resultado_FT || c.Resultado);
      if (a != null && b != null) {
        const linha = { a, b, total: a + b, odds };
        if (nome) linha.nome = nome;
        if (hora) linha.hora = hora;
        placares.push(linha);
      } else if (nome) { upcoming.push({ nome, horario: hora, casa: timeA, fora: timeB, odds }); }
    }
  }
  return { placares, upcoming };
}
async function nomeDaLiga(base, param, id, token, jsonPrincipal) {
  const direto = extraiNomeLiga(jsonPrincipal);
  if (direto) return direto;
  const r = await pega(base + "/entradasAnalisadas?" + param + "=" + id + "&top=1", token, 12000);
  return extraiNomeLiga(r.json);
}
const ATIVAS = String(process.env.CASAS_ATIVAS || "betano,playpix").split(",").map(x => x.trim()).filter(Boolean);
const cacheNome = new Map();

async function coletaTudo(token, onLiga, log = () => {}) {
  if (!token) return { ok: false, erro: "sem token" };
  let ok = 0, falhas = 0, nomes = 0;
  const porCasa = {};
  for (const c of CASAS.filter(x => ATIVAS.includes(x.casa))) {
    porCasa[c.casa] = { ligas: 0, nomeadas: 0, falhas: 0 };
    const base = API + c.path;
    for (let id = 0; id <= c.max; id++) {
      const url = base + "?" + c.param + "=" + id + "&Horas=Horas12&filtros=" + encodeURIComponent(MERCADOS);
      const r = await pega(url, token);
      if (r.erro) {
        falhas++; porCasa[c.casa].falhas++;
        if (/401|403/.test(r.erro)) {
          log("[bbtips] token invalido/expirado");
          return { ok: false, erro: "token", ligas: ok, falhas, nomes, porCasa };
        }
        continue;
      }
      const { placares, upcoming } = converte(r.json);
      if (placares.length < 20) continue;
      const ck = c.casa + "|" + id;
      let nome = (NOMES[c.casa] && NOMES[c.casa][id]) || cacheNome.get(ck);
      if (!nome) {
        nome = (await nomeDaLiga(base, c.param, id, token, r.json)) || ("liga-" + id);
        cacheNome.set(ck, nome);
      }
      const nomeado = !/^liga-?\d+$/.test(nome);
      try {
        await onLiga(c.casa + "-" + nome, placares, upcoming, { casa: c.casa, id, nome, nomeado });
        ok++; porCasa[c.casa].ligas++;
        if (nomeado) { nomes++; porCasa[c.casa].nomeadas++; }
      } catch (e) { falhas++; porCasa[c.casa].falhas++; }
      await new Promise(res => setTimeout(res, 120));
    }
    log("[bbtips] " + c.casa + ": " + porCasa[c.casa].ligas + " ligas (" + porCasa[c.casa].nomeadas + " com nome), " + porCasa[c.casa].falhas + " falhas");
  }
  log("[bbtips] auto-coleta: " + ok + " ligas ok, " + falhas + " falhas");
  return { ok: true, ligas: ok, falhas, nomes, porCasa };
}
export { coletaTudo, converte, parseOdds, normalizaNomeLiga, extraiNomeLiga, CASAS, MERCADOS };
