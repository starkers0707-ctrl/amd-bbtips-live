// COLETOR INSPIRED VIA BBTIPS (PlayPix)
// CAM (Champions), COP (Copa do Mundo) e AME (America) sao ligas da Inspired.
// O BBTips entrega a grade de cada uma em /api/PlayPixFutebolVirtual com o
// token Bearer da sessao (localStorage.access_token no thtips.com.br).
// Grade: linhas por hora (mais nova primeiro), 20 jogos por hora, de 3 em 3 min.

const API = "https://api.thtips.com.br/api/PlayPixFutebolVirtual";
export const LIGAS_INSPIRED = { cam: 6, cop: 7, ame: 8 };
const INTERVALO = Number(process.env.INSPIRED_INTERVALO || 10000);
const BRT_OFFSET_H = 3; // Brasil sem horario de verao: UTC-3 fixo

const estado = { ts: 0, erro: null, rodando: false, ligas: {} };
let tokenAtual = "";
let onLigaCb = null;
let timer = null;

const limpo = v => {
  if (v == null) return null;
  const s = String(v).replace(/\u0000/g, "").trim();
  return s === "" || s === "-" ? null : s;
};
function placar(s) {
  const m = typeof s === "string" ? s.match(/(\d+)\s*[-x:]\s*(\d+)/i) : null;
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

async function pega(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(url + sep + "_amd=" + Date.now(), {
      headers: { Authorization: "Bearer " + tokenAtual, Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: ctrl.signal
    });
    if (r.status === 401) return { erro: "token" };
    if (!r.ok) return { erro: "HTTP " + r.status + " " + (await r.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ") };
    return { json: await r.json() };
  } catch (e) {
    return { erro: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

// Dia em BRT (yyyy, mm, dd) de um instante
function diaBRT(ms) {
  const d = new Date(ms - BRT_OFFSET_H * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}
function isoDe(dia, offsetDias, hh, mm) {
  return new Date(Date.UTC(dia.y, dia.m, dia.d + offsetDias, hh + BRT_OFFSET_H, mm)).toISOString();
}

// Converte a grade em jogos com data real (inicio em ISO/UTC).
export function converteGrade(json, liga, agoraMs = Date.now()) {
  const hoje = diaBRT(agoraMs);
  const linhas = (json && json.Linhas) || [];
  const finais = [], futuros = [];
  let offset = null, horaAnterior = null;
  for (const lin of linhas) {
    const horaLinha = Number(lin && lin.Hora);
    if (!Number.isFinite(horaLinha)) continue;
    if (offset === null) offset = horaLinha > hoje.h + 1 ? -1 : (horaLinha < hoje.h - 12 ? 1 : 0);
    else if (horaLinha > horaAnterior) offset -= 1; // virou o dia andando para tras
    horaAnterior = horaLinha;
    for (const c of (lin.Colunas || [])) {
      const casa = limpo(c && c.TimeA), fora = limpo(c && c.TimeB);
      if (!casa || !fora) continue;
      const horario = limpo(c.Horario) || "";
      const hm = horario.match(/^(\d{1,2}):(\d{2})$/);
      if (!hm) continue;
      const inicio = isoDe(hoje, offset, Number(hm[1]), Number(hm[2]));
      const id = `bbtips:${liga}:${inicio}`;
      const [a, b] = placar(limpo(c.Resultado_FT) || limpo(c.Resultado));
      if (a != null && b != null) {
        const jogo = {
          id, nome: `${casa} x ${fora}`, casa, fora, a, b, total: a + b,
          placar: `${a}-${b}`, horario, hora: horario, inicio, odds: {}, fonte: "bbtips-inspired"
        };
        const [ha, hb] = placar(limpo(c.Resultado_HT));
        if (ha != null && hb != null) { jogo.htA = ha; jogo.htB = hb; }
        finais.push(jogo);
      } else if (Date.parse(inicio) > agoraMs - 60000) {
        futuros.push({ id, nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario, inicio, odds: {}, fonte: "bbtips-inspired" });
      }
    }
  }
  finais.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  futuros.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  return { finais, futuros };
}

async function coletaLiga(liga, id) {
  const st = estado.ligas[liga] || (estado.ligas[liga] = { ts: 0, atualizacao: null, jogos: 0, futuros: 0, erro: null, primeira: true });
  const ua = await pega(`${API}/ultimaAtualizacao?liga=${id}`);
  if (ua.erro) { st.erro = ua.erro; return ua.erro; }
  const marca = String(ua.json);
  // Busca a grade quando o BBTips atualizou, ou a cada 2 min por seguranca.
  if (marca === st.atualizacao && Date.now() - st.ts < 120000) return null;
  const horas = st.primeira ? "Horas24" : "Horas12";
  const r = await pega(`${API}?Liga=${id}&Horas=${horas}&filtros=&confrontos=false&hrsConfrontos=240`);
  if (r.erro) { st.erro = r.erro; return r.erro; }
  const { finais, futuros } = converteGrade(r.json, liga);
  if (!finais.length && !futuros.length) { st.erro = "grade vazia"; return null; }
  st.atualizacao = marca; st.ts = Date.now(); st.erro = null; st.primeira = false;
  st.jogos = finais.length; st.futuros = futuros.length;
  st.ultimo = finais.length ? finais[finais.length - 1].horario + " " + finais[finais.length - 1].nome + " " + finais[finais.length - 1].placar : null;
  console.log(`[inspired] ${liga}: ${finais.length} jogos, ${futuros.length} futuros, ultimo ${st.ultimo || "-"} (${horas})`);
  if (onLigaCb) await onLigaCb(liga, finais, futuros);
  return null;
}

// Grade enviada pelo navegador (userscript), quando o servidor e barrado pelo Cloudflare.
export async function recebeGrade(liga, json) {
  if (!(liga in LIGAS_INSPIRED)) return 0;
  const { finais, futuros } = converteGrade(json, liga);
  if (!finais.length && !futuros.length) return 0;
  const st = estado.ligas[liga] || (estado.ligas[liga] = {});
  st.ts = Date.now(); st.erro = null; st.jogos = finais.length; st.futuros = futuros.length; st.fonte = "navegador";
  st.ultimo = finais.length ? finais[finais.length - 1].horario + " " + finais[finais.length - 1].nome + " " + finais[finais.length - 1].placar : null;
  estado.navegadorTs = Date.now();
  if (onLigaCb) await onLigaCb(liga, finais, futuros);
  return finais.length;
}

let bloqueadoAte = 0;
async function ciclo() {
  if (estado.rodando || !tokenAtual || Date.now() < bloqueadoAte) return;
  estado.rodando = true;
  try {
    const erros = await Promise.all(Object.entries(LIGAS_INSPIRED).map(([l, id]) => coletaLiga(l, id).catch(e => String(e.message || e))));
    const erro = erros.includes("token") ? "token" : (erros.find(Boolean) || null);
    if (erro !== estado.erro) console.log("[inspired] " + (erro ? "erro: " + erro : "coleta ok"));
    // Cloudflare barrando o servidor: tenta de novo so a cada 30 min (o navegador cobre).
    if (erro && /HTTP 403/.test(erro)) { bloqueadoAte = Date.now() + 30 * 60000; estado.bloqueado = true; } else estado.bloqueado = false;
    estado.erro = erro;
    estado.ts = Date.now();
  } finally {
    estado.rodando = false;
  }
}

export function definirToken(t) {
  const novo = !!t && t !== tokenAtual;
  tokenAtual = t || "";
  if (novo) {
    for (const st of Object.values(estado.ligas)) st.atualizacao = null;
    setTimeout(ciclo, 0);
  }
  return novo;
}

// Testa um token antes de aceitar (evita que um POST qualquer derrube a coleta).
export async function tokenFunciona(t) {
  try {
    const r = await fetch(`${API}/ultimaAtualizacao?liga=7&_amd=${Date.now()}`, {
      headers: { Authorization: "Bearer " + t, Accept: "application/json" }
    });
    return r.ok;
  } catch (e) { return false; }
}

export function iniciar(token, onLiga) {
  onLigaCb = onLiga;
  tokenAtual = token || "";
  if (timer) clearInterval(timer);
  timer = setInterval(ciclo, INTERVALO);
  setTimeout(ciclo, 3000);
}

export function obterEstado() {
  let expira = null;
  try {
    const p = JSON.parse(Buffer.from(tokenAtual.split(".")[1], "base64url").toString());
    if (p.exp) expira = new Date(p.exp * 1000).toISOString();
  } catch (e) {}
  return { ...estado, temToken: !!tokenAtual, tokenExpira: expira };
}
