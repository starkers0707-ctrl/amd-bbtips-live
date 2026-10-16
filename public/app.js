/* ============================================================
   AMD LIVE — Dashboard Inteligente
   Front-end estático. Números gerados localmente por RNG com
   semente. Para ligar numa fonte real, troque as funções do
   bloco DADOS (serie / resultados / renderGrade).
   ============================================================ */

/* ---------- RNG com semente ---------- */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = n => String(n).padStart(2, '0');

/* Gols por time seguem Poisson — lambda 1.24 dá média 2.48 gols/jogo. */
function poisson(rng, lambda = 1.24) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 12);
  return k - 1;
}

/* ---------- ESTADO ---------- */
const state = { liga: 'ita', mercado: 'Over 2.5', mercadosGrafico: ['Over 2.5'], modoMercadosGrafico: 'fixo', qtd: 240, horas: 6, metrica: '% pagamento', visual: 'Clássico', gradeMercado: 'Over 2.5', zoom: 1, ht: false, mostrarTime: true,
  graficoTravado: true, panGrafico: 0, ancoraGrafico: null,
  totalFonteGrafico: 0, ultimoJogoViewport: null, odds: ['AS','O2.5','O3.5'] };
const parametrosQuadro = new URLSearchParams(window.location.search);
const modoQuadro = parametrosQuadro.get('quadro') === '1';
const ligaDoQuadro = String(parametrosQuadro.get('liga') || '').toLowerCase();
if (modoQuadro) document.body.classList.add('quadro-grafico');
function textoLinhaMercado(mercado) {
  const nome = String(mercado || '').trim();
  const total = nome.match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i);
  if (total) return 'Linha: ' + (total[1].toLowerCase() === 'over' ? '+' : '-') + total[2] + ' gols';
  if (/^5\+\s*Gols$/i.test(nome)) return 'Linha: +4.5 gols';
  if (/^OUT HT$/i.test(nome)) return 'Linha: 3+ gols no HT';
  if (/Ambas/i.test(nome)) return 'Linha: ambas marcam';
  if (/Placar/i.test(nome)) return 'Linha: placar exato';
  if (/Total Gols/i.test(nome)) return 'Linha: total de gols';
  return 'Linha: ' + (nome || 'mercado atual');
}
window.mercadoGraficoAtual = () => state.mercado;
window.atualizarSeletorLigaGrafico = function () {
  const comparar = window.GraficoReal &&
    typeof window.GraficoReal.modo === 'function' &&
    window.GraficoReal.modo() === 'ligas';
  const botao = document.getElementById('cligaBtn');
  const nomes = { ita:'ITA',eng:'ENG',spa:'SPA',mnd:'MND',bra:'BRA',lat:'LAT',cam:'CAM',cop:'COP',ame:'AME',split:'Split' };
  const chave = String(state.liga || 'ita').toLowerCase();
  if (botao) {
    botao.textContent = comparar
      ? 'Ligas: Todas (9)'
      : 'Liga: ' + (nomes[chave] || state.liga) + ' ⌄';
    botao.disabled = !!comparar;
    botao.classList.toggle('compare', !!comparar);
    botao.setAttribute('aria-label', comparar
      ? 'Comparando as 9 ligas da extensão'
      : 'Selecionar liga do gráfico');
  }
  const caixa = document.querySelector('.chart-liga');
  if (caixa) caixa.classList.toggle('compare', !!comparar);
};
window.definirLigaApp = function (novaLiga) {
  const chave = String(novaLiga || '').trim().toLowerCase();
  const nomes = { ita:'ITA',eng:'ENG',spa:'SPA',mnd:'MND',bra:'BRA',lat:'LAT',cam:'CAM',cop:'COP',ame:'AME',split:'Split' };
  if (!nomes[chave]) return false;
    /* Este e o caminho real da troca de liga: a barra lateral e o
       dados-reais.js chamam definirLigaApp, nao o bindTabs.
       Guardo o enquadramento antes do reset da linha seguinte e
       devolvo logo depois, para o zoom nao zerar a cada troca. */
    var _zA = state.zoom;
    var _pA = state.panGrafico;
    var _aA = state.ancoraGrafico;
    var _dA = (typeof desenhos !== 'undefined' && Array.isArray(desenhos))
      ? desenhos.slice() : null;
    resetarViewportGrafico(false, true);
    state.zoom = _zA;
    state.panGrafico = _pA;
    state.ancoraGrafico = _aA;
    var _slA = document.getElementById('zoom');
    if (_slA) _slA.value = String(_zA);
    if (_dA && typeof desenhos !== 'undefined' && Array.isArray(desenhos)) {
      desenhos.length = 0;
      for (var _kA = 0; _kA < _dA.length; _kA++) desenhos.push(_dA[_kA]);
      state.ultimoJogoViewport = null;
    }
    if (false)
  resetarViewportGrafico(false, true);
  state.liga = nomes[chave];
  document.querySelectorAll('#leagues .tab').forEach(botao => {
    const valor = String(botao.dataset.v || botao.textContent || '')
      .trim().toLowerCase();
    const ativo = valor === chave;
    botao.classList.toggle('active', ativo);
    botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  window.atualizarSeletorLigaGrafico();
  document.querySelectorAll('#cligaMenu button').forEach(botao => {
    botao.classList.toggle('on', botao.dataset.liga === chave);
  });
  window.dispatchEvent(new CustomEvent('amd:liga-alterada', {
    detail: { liga: chave, nome: nomes[chave] }
  }));
  return true;
};
var ODDS_LISTA=[['CASA','Casa vence'],['FORA','Fora vence'],
  ['AS','Ambas Marcam (Sim)'],['AN','Ambas Marcam (Não)'],['O1.5','Over 1.5'],
  ['O2.5','Over 2.5'],['O3.5','Over 3.5'],['U1.5','Under 1.5'],['U2.5','Under 2.5'],
  ['U3.5','Under 3.5'],['5+','5+ Gols']];
var PADRAO = { mm1: 9, mm2: 21, mm3: 30, rapida: 12, lenta: 26, sinal: 9, rsi: 14 };
var cfg = Object.assign({}, PADRAO);
const sel = { teams: new Set(), odds: new Set(), cols: new Set() };
const CHAVE_ALERTA_TIMES = 'amdlive.times-alerta.v1';
const timesVigiados = new Set();
const jogosVistosAlertaTime = new Set();
let modoEscolherTimeAlerta = false;
let alertaTimesInicializado = false;

try {
  const salvos = JSON.parse(localStorage.getItem(CHAVE_ALERTA_TIMES) || '[]');
  if (Array.isArray(salvos)) salvos.forEach(nome => {
    nome = String(nome || '').trim();
    if (nome) timesVigiados.add(nome);
  });
} catch (e) { /* armazenamento indisponivel: o alerta segue nesta aba */ }
let colPctAtual = [];

const NORMAL = {
  'Over 0.5': 92.1, 'Over 1.5': 74.8, 'Over 2.5': 42.6, 'Over 3.5': 20.7,
  '5+ Gols': 7.4, 'Ambas Marcam': 48.9, 'Under 0.5': 7.9, 'Under 1.5': 25.2,
  'Under 2.5': 57.4, 'Total Gols': 38.0, 'Placar Correto': 11.3,
};
const TIMES = ['SAN','PAL','INT','CRU','COR','RED','VAS','BAH','BAT','VIT','BOT','SÃO','COU','CHA','BOL','REM','GRE','ATH','MIR','ATL','FLA','SAH','NAC','JUV'];
const NOMES = ['Leões','Falcões','Atlético','Real Norte','União','Estrela','Nacional','Vitória','Sport','Central','Racing','City','Olympic','Juventus','Albânia','Inglaterra'];

function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- DADOS ---------- */
/* % historica de cada mercado, medida por simulacao do mesmo
   modelo que gera a grade — vale para os 44 mercados. */
const _baseCache = {};
function baseMercado(mkt) {
  if (_baseCache[mkt] != null) return _baseCache[mkt];
  const rng = makeRng(seedOf('base' + mkt));
  const N = 4000; let pag = 0;
  for (let i = 0; i < N; i++) {
    const gh = poisson(rng), ga = poisson(rng);
    if (pagou(mkt, { gh, ga, hh: Math.min(gh, poisson(rng, 0.55)), ha: Math.min(ga, poisson(rng, 0.55)) })) pag++;
  }
  return (_baseCache[mkt] = +((pag / N) * 100).toFixed(1));
}
function normalDe(m) { return NORMAL[m] != null ? NORMAL[m] : baseMercado(m); }
function serieCompleta() {
  const rng = makeRng(seedOf(state.liga + state.mercado));
  const base = normalDe(state.mercado);
  const out = []; let v = base;
  for (let i = 0; i < 480; i++) {
    v += (rng() - 0.48) * 7;
    v = Math.max(base * 0.5, Math.min(base * 1.55, v));
    out.push(+v.toFixed(1));
  }
  return out;
}
/* Mostra os ultimos n pontos da mesma serie: trocar a quantidade
   revela mais historico, nao gera dados diferentes. */
function serie(n, metrica) {
  if (window.GraficoReal && typeof window.GraficoReal.serie === 'function') {
    const real = window.GraficoReal.serie(n, metrica);
    return Array.isArray(real) ? real : [];
  }
  return [];
}

function metricaVisualAtual() {
  return ['Odd', 'Gols', 'EV', 'Taxa de acerto'].includes(state.metrica)
    ? state.metrica : '% pagamento';
}

function configuracaoMetrica(nome) {
  const metrica = nome || metricaVisualAtual();
  if (metrica === 'Odd') return { nome: 'Odd média', unidade: '', casas: 2,
    limitada: false, piso: 0.12, delta: 'Δ' };
  if (metrica === 'Gols') return { nome: 'Média de gols', unidade: '', casas: 2,
    limitada: false, piso: 0.12, delta: 'Δ' };
  if (metrica === 'EV') return { nome: 'EV', unidade: '%', casas: 1,
    limitada: false, piso: 2, delta: 'pp' };
  if (metrica === 'Taxa de acerto') return { nome: 'Acerto conservador', unidade: '%',
    casas: 1, limitada: true, piso: 0.6, delta: 'pp' };
  return { nome: '% pagamento', unidade: '%', casas: 1,
    limitada: true, piso: 0.6, delta: 'pp' };
}

function formatarMetrica(valor, config, comUnidade) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  const texto = numero.toFixed(config.casas).replace(/\.0$/, '');
  return texto + (comUnidade === false ? '' : config.unidade);
}

function resultados(n) {
  if (!window.Real || typeof window.Real.jogos !== 'function') return [];
  let reais = [];
  try { reais = window.Real.jogos() || []; } catch (e) { return []; }
  return reais.filter(j => j && j.resolvido).map(j => {
    try { return pagou(state.mercado, j) ? 'G' : 'R'; }
    catch (e) { return null; }
  }).filter(Boolean).slice(-Math.max(1, n || 1));
}
/* Ranking do time DENTRO do mercado ativo — 1 = melhor. */
function rankMap() {
  const rng = makeRng(seedOf('rank' + state.liga + state.mercado));
  const arr = [...TIMES];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  const m = {}; arr.forEach((t, i) => (m[t] = i + 1));
  return m;
}

/* ============================================================
   ANÁLISE TÉCNICA
   ============================================================ */

/* Topos e fundos: extremo local numa janela de +-k barras. */
function pivots(pts, k = 2) {
  const out = [];
  for (let i = k; i < pts.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (pts[j] >= pts[i]) isH = false;
      if (pts[j] <= pts[i]) isL = false;
    }
    if (isH) out.push({ i, v: pts[i], t: 'H' });
    else if (isL) out.push({ i, v: pts[i], t: 'L' });
  }
  return out;
}
/* Zigue-zague: alterna topo/fundo, guardando sempre o mais extremo. */
function zigzag(pts, k = 2) {
  const out = [];
  for (const q of pivots(pts, k)) {
    const last = out[out.length - 1];
    if (!last) { out.push(q); continue; }
    if (last.t === q.t) {
      if ((q.t === 'H' && q.v > last.v) || (q.t === 'L' && q.v < last.v)) out[out.length - 1] = q;
    } else out.push(q);
  }
  return out;
}
/* LTA liga fundos ascendentes; LTB liga topos descendentes. */
function linhaTendencia(pts, tipo) {
  const alvo = tipo === 'LTA' ? 'L' : 'H';
  /*
   * Curvas de pagamento têm muitos patamares iguais. Primeiro colapsamos cada
   * patamar e então procuramos pivôs recentes; o algoritmo antigo exigia
   * desigualdade em todos os pontos e quase nunca encontrava LTA/LTB.
   */
  const inicio = Math.max(0, pts.length - 40);
  const compacta = [];
  for (let i = inicio; i < pts.length; i++) {
    const ultimo = compacta[compacta.length - 1];
    if (ultimo && ultimo.v === pts[i]) ultimo.i = i;
    else compacta.push({ i, v: pts[i] });
  }
  const ps = [];
  for (let i = 1; i < compacta.length - 1; i++) {
    const p = compacta[i];
    const esquerda = compacta.slice(Math.max(0, i - 2), i);
    const direita = compacta.slice(i + 1, Math.min(compacta.length, i + 3));
    const isH = esquerda.concat(direita).every(q => p.v > q.v);
    const isL = esquerda.concat(direita).every(q => p.v < q.v);
    if (isH) ps.push({ i: p.i, v: p.v, t: 'H' });
    else if (isL) ps.push({ i: p.i, v: p.v, t: 'L' });
  }
  const candidatos = ps.filter(p => p.t === alvo);
  if (candidatos.length < 2) return null;
  for (let i = candidatos.length - 1; i > 0; i--) {
    const a = candidatos[i - 1], b = candidatos[i];
    if (tipo === 'LTA' ? b.v > a.v : b.v < a.v) return { a, b };
  }
  return null;
}
/* Fibonacci: acha máxima e mínima sozinho e projeta as retrações. */
function fibo(pts) {
  let hi = 0, lo = 0;
  pts.forEach((v, i) => { if (v > pts[hi]) hi = i; if (v < pts[lo]) lo = i; });
  const up = hi > lo;
  const iA = up ? lo : hi, iB = up ? hi : lo;
  const a = pts[iA], b = pts[iB];
  const niveis = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  return { up, iA, iB, niveis: niveis.map(n => ({ n, v: b - (b - a) * n })) };
}
/* Renko: tijolos de tamanho fixo, ignora o tempo. */
function renko(pts, box) {
  const out = []; let base = pts[0];
  for (const v of pts) {
    while (v - base >= box) { base += box; out.push({ de: base - box, para: base, up: true }); }
    while (base - v >= box) { base -= box; out.push({ de: base + box, para: base, up: false }); }
  }
  return out;
}
function rsi(pts, p = 14) {
  const out = new Array(pts.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i] - pts[i - 1];
    const up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
  }
  return out;
}
/* Congestão: trechos onde o preço fica preso numa faixa estreita. */
function congestao(pts, larg, minBarras = 5) {
  const zonas = []; let i = 0;
  while (i < pts.length) {
    let j = i, mn = pts[i], mx = pts[i];
    while (j + 1 < pts.length) {
      const nmn = Math.min(mn, pts[j + 1]), nmx = Math.max(mx, pts[j + 1]);
      if (nmx - nmn > larg) break;
      mn = nmn; mx = nmx; j++;
    }
    if (j - i + 1 >= minBarras) { zonas.push({ de: i, ate: j, mn, mx }); i = j + 1; }
    else i++;
  }
  return zonas;
}
function sma(arr, p) {
  return arr.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += arr[j];
    return s / p;
  });
}

/* ---------- TABS ---------- */
function bindTabs(id, onChange) {
  const box = document.getElementById(id);
  if (!box) return;
  box.addEventListener('click', e => {
    const b = e.target.closest('.tab, .chip');
    if (!b || !box.contains(b)) return;
    if (b.classList.contains('chip')) { b.classList.toggle('on'); onChange && onChange(b.textContent.trim(), b); return; }
    box.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    b.classList.add('active');
    onChange && onChange(b.dataset.v || b.textContent.trim(), b);
  });
}
function ligado(nome) {
  const c = [...document.querySelectorAll('#overlays .chip')].find(x => x.textContent.trim().toLowerCase() === nome.toLowerCase());
  return c ? c.classList.contains('on') : false;
}

/* ---------- KPIs ---------- */
function renderKpis() {
  const normal = normalDe(state.mercado);
  const s = serie(40);
  const atual = s.length && Number.isFinite(Number(s[s.length - 1]))
    ? Number(s[s.length - 1]) : null;
  const temp = atual == null ? null : Math.round((atual / normal) * 100);
  const res = resultados(60);
  const ult5 = res.slice(-5);
  const contextoKpi = window.GraficoReal && typeof window.GraficoReal.contexto === 'function'
    ? window.GraficoReal.contexto() : null;

  document.getElementById('kMercado').textContent = state.mercado;
  const kLinha = document.getElementById('kLinha');
  if (kLinha) kLinha.textContent = textoLinhaMercado(state.mercado);
  document.getElementById('kJogos').textContent = contextoKpi && contextoKpi.modo === 'acum'
    ? (contextoKpi.quantidade || 0) : state.qtd;
  document.getElementById('kAtual').textContent = atual == null ? '—' :
    atual.toFixed(0) + '%';
  document.getElementById('kNormal').textContent = normal.toFixed(1) + '%';

  const kt = document.getElementById('kTemp');
  kt.textContent = temp == null ? '—' : temp + '%';
  document.getElementById('kTempTxt').textContent = temp == null ? 'Aguardando' :
    temp >= 115 ? 'Quente' : temp <= 85 ? 'Frio' : 'Normal';
  kt.className = 'val ' + (temp == null ? 'blue' :
    temp >= 115 ? 'orange' : temp <= 85 ? 'blue' : 'green');

  document.getElementById('kSeq').innerHTML = ult5.map(r => `<span class="${r === 'G' ? 'g' : 'r'}">${r}</span>`).join('');

  if (!res.length) {
    document.getElementById('kSeqTxt').textContent = 'Aguardando dados reais';
    document.getElementById('fitaSeq').textContent = 'Aguardando dados reais';
    document.getElementById('kLast').className = 'bigdot';
    document.getElementById('kLastTxt').textContent = '—';
    document.getElementById('ligaAtiva').textContent = state.liga;
    document.getElementById('gLiga').textContent = state.liga;
    document.getElementById('btTitle').textContent =
      `Backtest · ${state.liga} — ${state.mercado}`;
    return;
  }

  const last = res[res.length - 1];
  let run = 1;
  for (let i = res.length - 2; i >= 0 && res[i] === last; i--) run++;
  const seqTxt = (last === 'G' ? '+' : '-') + run + ' ' + (last === 'G' ? 'Green' : 'Red');
  document.getElementById('kSeqTxt').textContent = seqTxt;
  document.getElementById('fitaSeq').textContent = seqTxt;
  document.getElementById('kLast').className = 'bigdot ' + (last === 'G' ? 'g' : 'r');
  document.getElementById('kLastTxt').textContent = last === 'G' ? 'Green' : 'Red';

  document.getElementById('ligaAtiva').textContent = state.liga;
  document.getElementById('gLiga').textContent = state.liga;
  document.getElementById('btTitle').textContent = `Backtest · ${state.liga} — ${state.mercado}`;
  }

/* ---------- SVG ---------- */
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const txt = (attrs, s) => { const t = el('text', attrs); t.textContent = s; return t; };

function instalarNeon(svg) {
  if (state.visual !== 'Neon') return;
  const defs = el('defs', {});
  const filtro = el('filter', { id: 'amdNeonGlow', x: '-40%', y: '-40%',
    width: '180%', height: '180%' });
  filtro.appendChild(el('feGaussianBlur', { stdDeviation: '3.2', result: 'brilho' }));
  const merge = el('feMerge', {});
  merge.appendChild(el('feMergeNode', { in: 'brilho' }));
  merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
  filtro.appendChild(merge);
  defs.appendChild(filtro);
  svg.appendChild(defs);
}

function comNeon(attrs) {
  if (state.visual === 'Neon') attrs.filter = 'url(#amdNeonGlow)';
  return attrs;
}

/*
 * Mantém a barra acima do gráfico presa ao jogo do ponto selecionado. O
 * relógio geral da página continua no cabeçalho; aqui mostramos o relógio
 * virtual do jogo, inclusive quando o usuário passa o mouse pelo histórico.
 */
function atualizarInfoGrafico(meta, valor, mercado) {
  meta = meta || {};
  const porId = id => document.getElementById(id);
  const hora = meta.rotulo || meta.hora ||
    (meta.minuto != null && meta.hora != null
      ? pad(meta.hora) + ':' + pad(meta.minuto) : '—');
  const timeA = meta.timeA || meta.casa || '';
  const timeB = meta.timeB || meta.fora || '';
  const jogo = timeA || timeB ? (timeA || '—') + ' x ' + (timeB || '—') : '—';
  const ft = meta.FT || meta.ft || meta.placarFT || meta.placar || '—';
  const ht = meta.HT || meta.ht || meta.placarHT || '—';
  if (porId('iHora')) porId('iHora').textContent = hora;
  if (porId('iJogo')) porId('iJogo').textContent = jogo;
  if (porId('iFT')) porId('iFT').textContent = ft;
  if (porId('iHT')) porId('iHT').textContent = ht;
  if (porId('iMercado')) porId('iMercado').textContent =
    String(mercado || meta.mercado || state.mercado).toUpperCase();
  if (porId('iValorRotulo')) porId('iValorRotulo').textContent = 'Gols';
  let gols = Number(meta.golsJogo);
  if (!Number.isFinite(gols)) {
    const partes = String(ft).match(/(\d+)\s*[-x:]\s*(\d+)/i);
    gols = partes ? Number(partes[1]) + Number(partes[2]) : NaN;
  }
  if (porId('iValor')) porId('iValor').textContent =
    Number.isFinite(gols) ? String(gols) : '—';
  if (porId('iUnidade')) porId('iUnidade').textContent = '';
}

function valorComparativoNoIndice(pacote, indice) {
  const valores = (pacote && pacote.ligas || []).map(liga => {
    const contexto = Array.isArray(liga.contexto) ? liga.contexto[indice] : null;
    const jogo = Array.isArray(liga.jogos) ? liga.jogos[indice] : null;
    return {
      liga,
      valor: Array.isArray(liga.serie) ? Number(liga.serie[indice]) : NaN,
      meta: contexto || jogo || {},
      jogo: jogo || contexto || {}
    };
  }).filter(item => Number.isFinite(item.valor));
  const maior = valores.length ? Math.max(...valores.map(item => item.valor)) : NaN;
  const melhores = Number.isFinite(maior)
    ? valores.filter(item => item.valor === maior) : [];
  return { valores, maior, melhores };
}

function escaparHover(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function nomeLigaComparativo(liga) {
  const id = String(liga && (liga.id || liga.liga) || '').toLowerCase();
  const nomes = { ita:'ITA', eng:'ENG', spa:'SPA', mnd:'MND', bra:'BRA', lat:'LAT', cam:'CAM', cop:'COP', ame:'AME', split:'Split' };
  return nomes[id] || String(liga && liga.nome || id || 'Liga').toUpperCase();
}

function cartaoJogoComparativo(item) {
  const meta = item.meta || {};
  const jogo = item.jogo || {};
  const horario = meta.rotulo || meta.hora || jogo.rotulo || jogo.hora || '—';
  const timeA = meta.timeA || jogo.timeA || jogo.time_a || '—';
  const timeB = meta.timeB || jogo.timeB || jogo.time_b || '—';
  const ft = meta.FT || meta.ft || meta.placarFT || jogo.ft || jogo.placar || '—';
  const ht = meta.HT || meta.ht || meta.placarHT || jogo.ht || '—';
  const pagou = meta.pagou === true;
  const classe = meta.pagou === true ? ' pagou' : meta.pagou === false ? ' nao-pagou' : '';
  return `<span class="tip-liga-jogo${classe}" style="--tip-liga-cor:${item.liga.cor}">` +
    `<span class="tip-liga-top"><i></i><b>${escaparHover(nomeLigaComparativo(item.liga))}</b>` +
    `<strong>${item.valor.toFixed(1)}%</strong></span>` +
    `<span class="tip-confronto">${escaparHover(timeA)} × ${escaparHover(timeB)}</span>` +
    `<span class="tip-placar">${escaparHover(horario)} · FT <b>${escaparHover(ft)}</b> · HT ${escaparHover(ht)}` +
    `${meta.pagou === true || meta.pagou === false ? ` · <em>${pagou ? 'PAGOU' : 'NÃO PAGOU'}</em>` : ''}</span></span>`;
}

function atualizarInfoComparativo(pacote, indice) {
  const porId = id => document.getElementById(id);
  const pontos = Math.max(0, Number(pacote && pacote.pontos) || 0);
  const i = Math.max(0, Math.min(Math.max(0, pontos - 1),
    indice == null ? pontos - 1 : indice));
  const leitura = valorComparativoNoIndice(pacote, i);
  const atras = Math.max(0, pontos - 1 - i);
  const nomes = leitura.melhores.map(item => item.liga.nome).join(' / ');
  if (porId('iHora')) porId('iHora').textContent = atras ? `${atras} jogos atrás` : 'Agora';
  if (porId('iJogo')) porId('iJogo').textContent = !leitura.valores.length
    ? 'Carregando as 4 ligas'
    : (pacote && pacote.completo
      ? (leitura.melhores.length > 1 ? 'Empate: ' : 'Melhor: ')
      : 'Liderança parcial: ') + nomes;
  if (porId('iFT')) porId('iFT').textContent = '—';
  if (porId('iHT')) porId('iHT').textContent = '—';
  if (porId('iMercado')) porId('iMercado').textContent =
    String(pacote && pacote.mercado || state.mercado).toUpperCase();
  if (porId('iValorRotulo')) porId('iValorRotulo').textContent = 'Pagamento';
  if (porId('iValor')) porId('iValor').textContent = Number.isFinite(leitura.maior)
    ? leitura.maior.toFixed(1) : '—';
  if (porId('iUnidade')) porId('iUnidade').textContent = Number.isFinite(leitura.maior) ? '%' : '';
}

function renderResumoComparativo(pacote) {
  const caixa = document.getElementById('topLigasLegend');
  if (!caixa) return;
  const comparacaoCompleta = !!(pacote && pacote.completo);
  const melhores = new Set((comparacaoCompleta && pacote.melhores || []).map(liga => liga.id));
  caixa.hidden = false;
  caixa.innerHTML = (pacote && pacote.ligas || []).map(liga => {
    const pronto = liga.atual !== null && liga.atual !== undefined &&
      Number.isFinite(Number(liga.atual));
    const variacao = liga.variacao !== null && liga.variacao !== undefined
      ? Number(liga.variacao) : NaN;
    const classe = pronto ? '' : ' is-loading';
    const melhor = melhores.has(liga.id) ? ' is-best' : '';
    const sinal = Number.isFinite(variacao) ? (variacao > 0 ? '+' : '') + variacao.toFixed(1) + ' pp' : '';
    const corVar = variacao > 0 ? 'ok' : variacao < 0 ? 'no' : '';
    const status = pronto ? liga.atual.toFixed(1) + '%' : 'carregando…';
    return `<div class="top-liga-item${classe}${melhor}" role="listitem" tabindex="0" style="--liga-cor:${liga.cor}">` +
      `<i class="top-traco"></i><span class="top-nome">${liga.nome}</span>` +
      `<b class="top-valor">${status}</b>` +
      `<span class="top-var ${corVar}">${sinal}</span></div>`;
  }).join('');
}

function renderLeituraComparativo(pacote) {
  renderHackerGrafico([], true);
  const prontas = (pacote && pacote.ranking || []).filter(liga =>
    Number.isFinite(Number(liga.atual)));
  const melhores = pacote && pacote.melhores || [];
  const nomeMelhor = melhores.map(liga => liga.nome).join(' / ');
  const valor = melhores.length ? Number(melhores[0].atual) : NaN;
  const completo = !!(pacote && pacote.completo);
  const lzona = document.getElementById('lzona');
  const lsetas = document.getElementById('lsetas');
  const ldesc = document.getElementById('ldesc');
  const tendencia = document.getElementById('tendencia');
  const sinais = document.getElementById('sinais');

  if (!prontas.length) {
    if (lzona) lzona.textContent = 'TOP LIGAS';
    if (lsetas) lsetas.textContent = '';
    if (ldesc) ldesc.textContent = 'Carregando o histórico real das ligas da extensão…';
    if (tendencia) tendencia.innerHTML = 'Comparativo: <b>aguardando as ligas da extensão</b>';
    if (sinais) sinais.innerHTML = '';
    return;
  }

  if (lzona) lzona.textContent = completo
    ? (melhores.length > 1 ? 'EMPATE' : 'MELHOR') : 'PARCIAL';
  if (lsetas) lsetas.textContent = '→';
  if (ldesc) ldesc.textContent = completo
    ? `${nomeMelhor} · ${valor.toFixed(1)}% em ${pacote.mercado}`
    : `${prontas.length}/9 ligas carregadas · sem declarar vencedora ainda`;
  if (tendencia) tendencia.innerHTML = `Top Ligas: <b>${pacote.janela} jogos por ponto</b> · ` +
    `${pacote.pontos} pontos alinhados por jogos atrás`;
  if (sinais) {
    sinais.innerHTML = prontas.map((liga, i) => {
      const classe = i === 0 ? 'up' : Number(liga.variacao) < 0 ? 'down' : 'neutro';
      return `<div class="cel"><div class="k">${i + 1}º · ${liga.nome}</div>` +
        `<div class="v ${classe}" style="color:${liga.cor}">${Number(liga.atual).toFixed(1)}%</div></div>`;
    }).join('');
  }
}

let ultimoAlertaDirecaoLigas = '';
function renderDirecaoLigas() {
  const caixa = document.getElementById('direcaoLigas');
  if (!caixa || !window.DirecaoLigasModel || !window.GraficoReal ||
      typeof window.GraficoReal.comparativoMercado !== 'function') return;
  const pacotes = {
    over25: window.GraficoReal.comparativoMercado('Over 2.5', state.qtd),
    over35: window.GraficoReal.comparativoMercado('Over 3.5', state.qtd),
    over5: window.GraficoReal.comparativoMercado('5+ Gols', state.qtd)
  };
  const leitura = window.DirecaoLigasModel.analisar(pacotes, { janela: state.qtd });
  if (!leitura.pronto) {
    caixa.hidden = false; caixa.className = 'direcao-ligas';
    caixa.textContent = 'Direção: ' + leitura.motivo; return;
  }
  const c = leitura.candidata, atual = leitura.atual;
  caixa.hidden = false;
  caixa.className = 'direcao-ligas' + (leitura.alerta ? ' is-alert' : '');
  caixa.style.setProperty('--direcao-cor', c.cor || '#29e8a0');
  caixa.innerHTML = `<div class="dir-top"><span class="dir-kicker">${leitura.alerta ? '🚨 PRÉ-VIRADA' : 'DIREÇÃO MONITORADA'}</span>` +
    `<span class="dir-liga">${c.nome}</span><span>horizonte ${c.horizonte}</span>` +
    `<span class="dir-score">ÍNDICE ${c.indice}/100 · ${c.confirmacoes}/3 mercados</span></div>` +
    `<div class="dir-evidencias">Líder atual: <b>${atual.nome}</b> · ${c.evidencias.join(' · ') || 'aguardando confirmação'}` +
    ` <span class="dir-aviso">· direção estatística, não garantia</span></div>`;
  const chave = leitura.alerta ? c.id + '|' + c.status + '|' + c.horizonte : '';
  if (chave && chave !== ultimoAlertaDirecaoLigas) {
    ultimoAlertaDirecaoLigas = chave;
    mostrarAviso(`🚨 PRÉ-VIRADA ${c.nome} · direção para ${c.horizonte} · índice ${c.indice}/100`);
    if (somDeAlertaLigado()) bip();
  } else if (!chave) ultimoAlertaDirecaoLigas = '';
}

function renderTopLigas(svg, W, H) {
  const pacote = window.GraficoReal && typeof window.GraficoReal.comparativo === 'function'
    ? window.GraficoReal.comparativo(state.qtd) : null;
  const sub = document.getElementById('macd');
  if (sub) { sub.innerHTML = ''; sub.style.height = '0px'; }
  renderMenuChart();
  renderResumoComparativo(pacote || { ligas: [] });
  renderLeituraComparativo(pacote || {});
  renderDirecaoLigas();
  atualizarInfoComparativo(pacote || {}, pacote && pacote.pontos ? pacote.pontos - 1 : 0);
  if (typeof window.atualizarSeletorLigaGrafico === 'function') {
    window.atualizarSeletorLigaGrafico();
  }

  const ligas = (pacote && pacote.ligas || []).filter(liga =>
    Array.isArray(liga.serie) && liga.serie.length >= 2);
  const n = Number(pacote && pacote.pontos) || 0;
  const viewportTop = { visiveis: n, total: n, pan: 0, zoom: 1 };
  atualizarControlesViewport('ligas', viewportTop);
  atualizarResumoPeriodoGrafico(viewportTop, 'ligas', {});
  if (ligas.length < 2 || n < 2) {
    geo = null;
    svg.setAttribute('aria-label', 'Top Ligas carregando dados reais da extensão');
    svg.appendChild(txt({
      x: W / 2, y: H / 2 - 8, fill: '#e7edf1', 'font-size': 14,
      'font-weight': 700, 'text-anchor': 'middle'
    }, 'Carregando as ligas da extensão…'));
    svg.appendChild(txt({
      x: W / 2, y: H / 2 + 16, fill: '#8fa3ad', 'font-size': 10.5,
      'text-anchor': 'middle'
    }, 'As ligas usam o mesmo mercado e a mesma janela.'));
    return;
  }

  const padL = 54, padR = W < 720 ? 78 : 102, padT = 35, padB = 34;
  const todos = ligas.flatMap(liga => liga.serie.map(Number)).filter(Number.isFinite);
  const lo = Math.min(...todos), hi = Math.max(...todos);
  const folga = Math.max(3, (hi - lo) * .12);
  let min = Math.max(0, lo - folga), max = Math.min(100, hi + folga);
  if (max - min < 10) {
    const meio = (min + max) / 2;
    min = Math.max(0, meio - 5);
    max = Math.min(100, meio + 5);
  }
  const x = i => padL + (i * (W - padL - padR)) / (n - 1);
  const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const titulo = document.createElementNS(NS, 'title');
  titulo.textContent = `Top Ligas — ${pacote.mercado}, janela de ${pacote.janela} jogos`;
  svg.appendChild(titulo);
  const descricao = document.createElementNS(NS, 'desc');
  descricao.textContent = 'Linhas alinhadas por jogos anteriores. ' +
    (!pacote.completo ? 'Comparação parcial; ainda não há vencedora.' :
      pacote.empate ? 'Há empate na liderança.' :
        `A melhor liga agora é ${pacote.melhor ? pacote.melhor.nome : 'indefinida'}.`);
  svg.appendChild(descricao);
  svg.setAttribute('aria-label', `Comparativo das ligas da extensão em ${pacote.mercado}`);
  svg.appendChild(txt({ x: padL, y: 15, fill: '#e7edf1', 'font-size': 11,
    'font-weight': 700 }, `TOP LIGAS · ${pacote.mercado} · janela ${pacote.janela} jogos`));
  svg.appendChild(txt({ x: W - padR, y: 15,
    fill: pacote.completo ? '#18e34d' : '#ff9d00', 'font-size': 9.5,
    'font-weight': 700, 'text-anchor': 'end' }, pacote.completo
      ? `${n} pontos por liga`
      : 'carregando histórico completo…'));

  for (let i = 0; i <= 5; i++) {
    const yy = padT + (i * (H - padT - padB)) / 5;
    const valor = max - (i * (max - min)) / 5;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy,
      stroke: '#162833', 'stroke-width': 1 }));
    svg.appendChild(txt({ x: padL - 8, y: yy + 3.5, fill: '#8fa3ad',
      'font-size': 9.5, 'text-anchor': 'end', 'font-family': 'monospace' },
      valor.toFixed(1).replace('.0', '') + '%'));
  }
  svg.appendChild(el('line', { x1: padL, x2: padL, y1: padT,
    y2: H - padB, stroke: '#2a3a44' }));

  const referencia = Number(pacote.base);
  if (Number.isFinite(referencia) && referencia >= min && referencia <= max) {
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(referencia),
      y2: y(referencia), stroke: '#96a5ad', 'stroke-width': 1,
      'stroke-dasharray': '5 5', opacity: .65 }));
    svg.appendChild(txt({ x: padL + 5, y: y(referencia) - 5, fill: '#96a5ad',
      'font-size': 9 }, `normal ${referencia.toFixed(1)}%`));
  }

  const melhores = new Set((pacote.completo ? pacote.melhores || [] : []).map(liga => liga.id));
  const tracos = { copa: '', euro: '8 4', super: '3 3', premier: '12 4 2 4' };
  const ordenadas = ligas.slice().sort((a, b) =>
    Number(melhores.has(a.id)) - Number(melhores.has(b.id)));
  ordenadas.forEach(liga => {
    let d = '';
    liga.serie.forEach((valor, i) => {
      d += (i ? ' L ' : 'M ') + x(i) + ' ' + y(valor);
    });
    const attrs = { d, fill: 'none', stroke: liga.cor,
      'stroke-width': melhores.has(liga.id) ? 3 : 1.9,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .96 };
    if (tracos[liga.id]) attrs['stroke-dasharray'] = tracos[liga.id];
    svg.appendChild(el('path', comNeon(attrs)));
    const raioPonto = n <= 80 ? 2.1 : n <= 240 ? 1.15 : .7;
    liga.serie.forEach((valor, i) => {
      svg.appendChild(el('circle', { cx: x(i), cy: y(valor),
        r: i === n - 1 ? 4 : raioPonto, fill: liga.cor, stroke: '#07151e',
        'stroke-width': i === n - 1 ? 1.5 : .8 }));
    });
  });

  const etiquetas = ligas.map(liga => ({
    liga, realY: y(liga.serie[n - 1]), labelY: y(liga.serie[n - 1])
  })).sort((a, b) => a.labelY - b.labelY);
  etiquetas.forEach((item, i) => {
    if (i && item.labelY < etiquetas[i - 1].labelY + 14)
      item.labelY = etiquetas[i - 1].labelY + 14;
  });
  if (etiquetas.length && etiquetas[etiquetas.length - 1].labelY > H - padB) {
    const desloca = etiquetas[etiquetas.length - 1].labelY - (H - padB);
    etiquetas.forEach(item => { item.labelY -= desloca; });
  }
  etiquetas.forEach(item => {
    const valor = item.liga.serie[n - 1];
    svg.appendChild(el('line', { x1: x(n - 1) + 4, y1: item.realY,
      x2: W - padR + 7, y2: item.labelY, stroke: item.liga.cor,
      'stroke-width': 1, opacity: .75 }));
    svg.appendChild(txt({ x: W - padR + 11, y: item.labelY + 3.5,
      fill: item.liga.cor, 'font-size': 9.5, 'font-weight': 700 },
      `${item.liga.nome} ${Number(valor).toFixed(1)}%`));
  });

  const passoRotulo = Math.max(1, Math.round((n - 1) / 6));
  for (let i = 0; i < n; i += passoRotulo) {
    const atras = n - 1 - i;
    svg.appendChild(txt({ x: x(i), y: H - 7, fill: '#8fa3ad',
      'font-size': 9.5, 'text-anchor': 'middle', 'font-family': 'monospace' },
      atras ? `-${atras}` : 'agora'));
  }
  if ((n - 1) % passoRotulo) {
    svg.appendChild(txt({ x: x(n - 1), y: H - 7, fill: '#8fa3ad',
      'font-size': 9.5, 'text-anchor': 'middle', 'font-family': 'monospace' }, 'agora'));
  }
  svg.appendChild(txt({ x: padL, y: H - 21, fill: '#5f7480', 'font-size': 8.5 },
    'jogos atrás'));

  const principal = pacote.melhor && pacote.melhor.serie.length
    ? pacote.melhor : ligas[0];
  geo = { comparativo: true, pacote, ligas, pts: principal.serie,
    x, y, padL, padR, padT, padB, W, H,
    cur: principal.serie[n - 1], min, max };
  restaurarInfoHoverGrafico();
}

/* ---------- GRÁFICO ---------- */
let geo = null;
let hoverGrafico = { ativo: false, tipo: '', proporcao: 1 };
let arrastoCameraGrafico = null;
let quadroCameraGrafico = 0;
const ZOOM_GRAFICO_MAX = 32;

function modoAtualDoGrafico() {
  return window.GraficoReal && typeof window.GraficoReal.modo === 'function'
    ? window.GraficoReal.modo() : 'janela';
}

function numeroEntre(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, Number(valor) || minimo));
}

function chaveMetaGrafico(meta) {
  meta = meta || {};
  if (meta.slotAbs !== null && meta.slotAbs !== undefined && meta.slotAbs !== '' &&
      Number.isFinite(Number(meta.slotAbs))) return 'slot:' + Number(meta.slotAbs);
  if (meta.id != null && meta.id !== '') return 'id:' + String(meta.id);
  const hora = meta.rotulo || meta.hora || '';
  const a = meta.timeA || meta.casa || '';
  const b = meta.timeB || meta.fora || '';
  const ft = meta.FT || meta.ft || meta.placarFT || meta.placar || '';
  return hora || a || b || ft ? [hora, a, b, ft].join('|') : null;
}

function alinharMetaGrafico(meta, total) {
  const lista = Array.isArray(meta) ? meta.slice() : [];
  if (lista.length > total) return lista.slice(-total);
  if (lista.length < total)
    return Array(total - lista.length).fill(null).map(() => ({})).concat(lista);
  return lista;
}

/* ---------- GOLDEN CROSS / DEATH CROSS ---------- */
const gdCrossAlerta = {
  armado: false,
  escopo: '',
  ultimaChave: null,
  ultimoAlerta: null
};

function resetarGDCross() {
  gdCrossAlerta.armado = false;
  gdCrossAlerta.escopo = '';
  gdCrossAlerta.ultimaChave = null;
  gdCrossAlerta.ultimoAlerta = null;
}

function configurarGDCross(ativo, botao) {
  resetarGDCross();
  if (botao) botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  if (!ativo) return;
  desbloquearAlertasSonoros();
  habilitarAlertasDeFundo();
  const p = window.GDCross && typeof window.GDCross.periodos === 'function'
    ? window.GDCross.periodos(cfg.mm1, cfg.mm2)
    : { rapida: Math.min(cfg.mm1, cfg.mm2), lenta: Math.max(cfg.mm1, cfg.mm2),
        valido: cfg.mm1 !== cfg.mm2 };
  if (p.valido === false) {
    mostrarAviso('GDCROSS precisa de MM1 e MM2 diferentes na Config');
    return;
  }
  mostrarAviso(`GDCROSS ativado \u00b7 MM${p.rapida}/MM${p.lenta} \u00b7 ` +
    'a voz anunciar\u00e1 somente o pr\u00f3ximo cruzamento confirmado');
}

function analisarGDCross(pontos) {
  if (!window.GDCross || typeof window.GDCross.analisar !== 'function') return null;
  return window.GDCross.analisar(pontos, cfg.mm1, cfg.mm2);
}

function chavePontoGDCross(meta, indice, valor) {
  return chaveMetaGrafico(meta) ||
    ['ponto', indice, Number(valor).toFixed(4)].join(':');
}

/* A linha historica continua mostrando tudo que chegou ao banco, mas alertas
   operacionais nao podem nascer de um lote velho. Cinco minutos e meio cobrem
   a duracao normal do jogo virtual mais uma coleta; acima disso o alerta ja
   nao serve como entrada. */
const ALERTA_DADO_MAX_MS = 5.5 * 60 * 1000;
function dadoDeAlertaRecente(meta) {
  meta = meta || {};
  const slot = Number(meta.slotAbs != null ? meta.slotAbs : meta.slot);
  return !Number.isFinite(slot) || Date.now() - slot <= ALERTA_DADO_MAX_MS;
}

function somDeAlertaLigado() {
  const botao = document.getElementById('btnSound');
  return !botao || botao.textContent.trim() !== '\ud83d\udd07';
}

function processarAlertaGDCross(analise, pontos, metas, escopo, mercado, liga) {
  if (!ligado('GDCROSS')) {
    resetarGDCross();
    return;
  }
  if (!analise || !analise.valido || !pontos.length) return;

  const chaves = pontos.map((valor, indice) =>
    chavePontoGDCross(metas[indice] || {}, indice, valor));
  const ultimaChave = chaves[chaves.length - 1];

  /* Ao ativar ou trocar liga, mercado ou periodo, apenas arma o estado atual. */
  if (!gdCrossAlerta.armado || gdCrossAlerta.escopo !== escopo) {
    gdCrossAlerta.armado = true;
    gdCrossAlerta.escopo = escopo;
    gdCrossAlerta.ultimaChave = ultimaChave;
    return;
  }
  if (gdCrossAlerta.ultimaChave === ultimaChave) return;

  const indiceAnterior = chaves.lastIndexOf(gdCrossAlerta.ultimaChave);
  if (indiceAnterior < 0) {
    gdCrossAlerta.ultimaChave = ultimaChave;
    return; // historico recarregado: rearma sem alerta antigo
  }

  const novos = analise.cruzamentos.filter(c => c.indice > indiceAnterior);
  if (!novos.length) {
    gdCrossAlerta.ultimaChave = ultimaChave;
    return;
  }
  const cruzamento = novos[novos.length - 1];
  /* Um lote atrasado pode trazer varios jogos de uma vez. O cruzamento fica
     desenhado no historico, mas so o ponto mais recente pode gerar aviso. */
  if (cruzamento.indice !== pontos.length - 1) {
    gdCrossAlerta.ultimaChave = ultimaChave;
    return;
  }
  const meta = metas[cruzamento.indice] || {};
  if (!dadoDeAlertaRecente(meta)) {
    gdCrossAlerta.ultimaChave = ultimaChave;
    return;
  }
  const chaveAlerta = [escopo, cruzamento.tipo,
    chavePontoGDCross(meta, cruzamento.indice, pontos[cruzamento.indice])].join('|');
  if (gdCrossAlerta.ultimoAlerta === chaveAlerta) return;

  /* Se a protecao curta de carregamento/foco ainda estiver ativa, nao consome
     o ponto. A proxima leitura do mesmo jogo dispara o alerta, em vez de ele
     ficar marcado como tratado sem voz nem notificacao. */
  if (!alertaPodeDispararAgora()) return;
  gdCrossAlerta.ultimaChave = ultimaChave;
  gdCrossAlerta.ultimoAlerta = chaveAlerta;

  const golden = cruzamento.tipo === 'golden';
  const nome = golden ? 'GOLDEN CROSS' : 'DEATH CROSS';
  const direcao = golden ? 'acima' : 'abaixo';
  const horario = meta.rotulo ||
    (meta.hora != null && meta.minuto != null ? pad(meta.hora) + ':' + pad(meta.minuto) : '');
  mostrarAviso(`${golden ? '\ud83c\udfc6' : '\ud83d\udc80'} ${nome} \u00b7 ${mercado} \u00b7 ` +
    `MM${analise.periodoRapido} cruzou ${direcao} da MM${analise.periodoLento}` +
    (horario ? ` \u00b7 ${horario}` : ''));
  falarAlertaGDCross(cruzamento.tipo, liga || state.liga, horario);
}

const mediaAlerta = { armado: false, escopo: '', ultimaChave: null,
  ativo: false, ultimoAlerta: '' };

function resetarAlertaMedias() {
  mediaAlerta.armado = false;
  mediaAlerta.escopo = '';
  mediaAlerta.ultimaChave = null;
  mediaAlerta.ativo = false;
}

function configurarAlertaMedias(ativo) {
  resetarAlertaMedias();
  if (!ativo) return;
  desbloquearAlertasSonoros();
  habilitarAlertasDeFundo();
  mostrarAviso('🔔 MM ALERTA ativado · avisará quando MM1, MM2 e MM3 ficarem abaixo do gráfico');
}

function analisarAlertaMedias(pontos) {
  if (!window.MediaAlertModel || typeof window.MediaAlertModel.analisar !== 'function')
    return { valido: false, confirmado: false };
  return window.MediaAlertModel.analisar(pontos, [cfg.mm1, cfg.mm2, cfg.mm3]);
}

function nomeLigaAlerta(liga) {
  const nomes = { ita:'ITA', eng:'ENG', spa:'SPA', mnd:'MND', bra:'BRA', lat:'LAT', cam:'CAM', cop:'COP', ame:'AME', split:'Split' };
  const chave = String(liga || '').trim().toLowerCase();
  return nomes[chave] || String(liga || 'Liga');
}

function notificarAlertaMedias(analise, mercado, liga) {
  if (!alertaPodeDispararAgora()) return;
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const nomeLiga = nomeLigaAlerta(liga);
  const texto = `${nomeLiga} · ${mercado} em ${analise.atual}% · ` + analise.periodos.map((p, i) =>
    `MM${p} ${analise.medias[i]}%`).join(' · ');
  const opcoes = { body: texto, tag: 'amd-mm-abaixo-' + String(liga) + '-' + String(mercado),
    renotify: true, requireInteraction: true, data: { url: '/index.html' } };
  registrarAlertasDeFundo().then(reg => {
    if (reg && typeof reg.showNotification === 'function')
      return reg.showNotification('📈 Médias abaixo · ' + nomeLiga, opcoes);
    try { return new Notification('📈 Médias abaixo · ' + nomeLiga, opcoes); } catch (e) { return null; }
  }).catch(() => {});
}

function processarAlertaMedias(analise, pontos, metas, escopo, mercado, liga) {
  if (!ligado('MM ALERTA')) { resetarAlertaMedias(); return; }
  if (!analise || !analise.valido || !pontos.length) return;
  const indice = pontos.length - 1;
  const ultimaMetaMedia = metas[indice] || {};
  const ultimaChave = chavePontoGDCross(ultimaMetaMedia, indice, pontos[indice]);
  if (!mediaAlerta.armado || mediaAlerta.escopo !== escopo) {
    mediaAlerta.armado = true;
    mediaAlerta.escopo = escopo;
    mediaAlerta.ultimaChave = ultimaChave;
    mediaAlerta.ativo = analise.confirmado;
    return;
  }
  if (mediaAlerta.ultimaChave === ultimaChave) return;
  if (!dadoDeAlertaRecente(ultimaMetaMedia)) {
    mediaAlerta.ultimaChave = ultimaChave;
    mediaAlerta.ativo = analise.confirmado;
    return;
  }
  const chavesMedia = pontos.map((valor, i) =>
    chavePontoGDCross(metas[i] || {}, i, valor));
  const indiceMediaAnterior = chavesMedia.lastIndexOf(mediaAlerta.ultimaChave);
  /* Nao anuncia condicao descoberta dentro de um lote atrasado. */
  if (indiceMediaAnterior !== pontos.length - 2) {
    mediaAlerta.ultimaChave = ultimaChave;
    mediaAlerta.ativo = analise.confirmado;
    return;
  }
  if (analise.confirmado && !mediaAlerta.ativo) {
    /* A protecao de carregamento nao pode consumir a mudanca. Mantendo a
       chave anterior, o mesmo resultado sera reavaliado no proximo poll. */
    if (!alertaPodeDispararAgora()) return;
    mediaAlerta.ultimaChave = ultimaChave;
    mediaAlerta.ativo = true;
    const chave = escopo + '|' + ultimaChave;
    if (mediaAlerta.ultimoAlerta === chave) return;
    mediaAlerta.ultimoAlerta = chave;
    const detalhes = analise.periodos.map((p, i) => `MM${p} ${analise.medias[i]}%`).join(' · ');
    const nomeLiga = nomeLigaAlerta(liga);
    mostrarAviso(`📈 MÉDIAS ABAIXO DO GRÁFICO · ${nomeLiga} · ${mercado} ${analise.atual}% · ${detalhes}`);
    notificarAlertaMedias(analise, mercado, liga);
    if (somDeAlertaLigado()) bip();
  } else {
    mediaAlerta.ultimaChave = ultimaChave;
    if (!analise.confirmado) mediaAlerta.ativo = false;
  }
}

function desenharGDCross(svg, analise, viewport, x, y, padL, padR, padT, padB, W, H) {
  if (!ligado('GDCROSS') || !analise) return;
  const rotulo = analise.valido
    ? `GDCROSS \u00b7 MM${analise.periodoRapido}/${analise.periodoLento}`
    : 'GDCROSS \u00b7 configure MM1 e MM2 diferentes';
  svg.appendChild(txt({ x: W - padR - 4, y: 15, fill: '#ffd400',
    'font-size': 9.5, 'font-weight': 700, 'text-anchor': 'end',
    'font-family': 'monospace' }, rotulo));
  if (!analise.valido) return;

  const visiveis = analise.cruzamentos.filter(c =>
    c.indice >= viewport.inicio && c.indice < viewport.fim).slice(-12);
  visiveis.forEach(cruzamento => {
    const indice = cruzamento.indice - viewport.inicio;
    const cx = x(indice), cy = y(cruzamento.valor);
    const golden = cruzamento.tipo === 'golden';
    const cor = golden ? '#ffd400' : '#ff343d';
    const grupo = el('g', { 'class': 'gd-cross-marker',
      'aria-label': golden ? 'Golden Cross' : 'Death Cross' });
    const titulo = el('title', {});
    titulo.textContent = (golden ? 'Golden Cross' : 'Death Cross') +
      `: MM${analise.periodoRapido} cruzou ` + (golden ? 'acima' : 'abaixo') +
      ` da MM${analise.periodoLento}`;
    grupo.appendChild(titulo);
    grupo.appendChild(el('line', { x1: cx, x2: cx,
      y1: Math.max(padT, cy - 13), y2: Math.min(H - padB, cy + 13),
      stroke: cor, 'stroke-width': 1, 'stroke-dasharray': '2 2', opacity: .8 }));
    grupo.appendChild(el('circle', { cx, cy, r: 7, fill: '#07151e',
      stroke: cor, 'stroke-width': 2 }));
    grupo.appendChild(txt({ x: cx, y: cy + 3, fill: cor, 'font-size': 8,
      'font-weight': 900, 'text-anchor': 'middle' }, golden ? 'G' : 'D'));
    const labelY = golden
      ? Math.max(padT + 8, cy - 11)
      : Math.min(H - padB - 2, cy + 18);
    grupo.appendChild(txt({ x: cx, y: labelY, fill: cor, 'font-size': 7.5,
      'font-weight': 800, 'text-anchor': 'middle' }, golden ? 'GOLDEN' : 'DEATH'));
    svg.appendChild(grupo);
  });
}

function resetarViewportGrafico(renderizar, limparAnotacoes) {
  state.zoom = 1;
  state.panGrafico = 0;
  state.ancoraGrafico = null;
  state.totalFonteGrafico = 0;
  hoverGrafico.ativo = false;
  const slider = document.getElementById('zoom');
  if (slider) slider.value = '1';
  if (limparAnotacoes && typeof desenhos !== 'undefined' && Array.isArray(desenhos)) {
    desenhos.length = 0;
    if (typeof arrasto !== 'undefined') arrasto = null;
  }
  if (renderizar !== false && typeof renderChart === 'function') renderChart();
}

function definirZoomGrafico(valor) {
  state.zoom = numeroEntre(Math.round(Number(valor) || 1), 1, ZOOM_GRAFICO_MAX);
  const slider = document.getElementById('zoom');
  if (slider) slider.value = String(state.zoom);
  renderChart();
}

function montarViewportGrafico(pontos, meta, modo) {
  const total = pontos.length;
  const metaCompleta = alinharMetaGrafico(meta, total);
  const ultimaChaveFonte = total ? chaveMetaGrafico(metaCompleta[total - 1]) : null;
  if (ultimaChaveFonte && state.ultimoJogoViewport &&
      ultimaChaveFonte !== state.ultimoJogoViewport &&
      typeof desenhos !== 'undefined' && Array.isArray(desenhos)) {
    /* Desenhos antigos usam índices locais; um novo jogo desloca esses índices. */
    desenhos.length = 0;
    if (typeof arrasto !== 'undefined') arrasto = null;
  }
  if (ultimaChaveFonte) state.ultimoJogoViewport = ultimaChaveFonte;
  const base = modo === 'janela' ? Math.min(total, Math.max(2, state.qtd)) : total;
  const maxZoom = Math.max(1, Math.min(ZOOM_GRAFICO_MAX, Math.ceil(base / 5)));
    /* Na troca de liga a nova entra com total ⟶ 0 por um instante.
       A linha abaixo limitava o zoom a maxZoom, que com total 0 vale
       1, esmagando o zoom antes de os dados chegarem. Reproduzido:
       6x virava 1x e o painel mostrava '0 jogos visiveis'.
       Guardo o valor aqui e devolvo se a serie estiver vazia. */
    var _zoomAntesDoLimite = state.zoom;
  state.zoom = numeroEntre(Math.round(state.zoom), 1, maxZoom);
    /* Serie vazia: devolve o zoom. Quando os jogos da liga nova
       chegarem, esta mesma funcao roda de novo com total > 0 e o
       limite passa a valer normalmente. */
    if (!total) state.zoom = _zoomAntesDoLimite;
  const visiveis = Math.min(total,
    Math.max(Math.min(5, total), Math.ceil(base / state.zoom)));

  if (state.graficoTravado) {
    state.panGrafico = 0;
    state.ancoraGrafico = null;
  } else if (state.panGrafico > 0 && state.ancoraGrafico) {
    let indiceAncora = -1;
    for (let i = metaCompleta.length - 1; i >= 0; i--) {
      if (chaveMetaGrafico(metaCompleta[i]) === state.ancoraGrafico) {
        indiceAncora = i;
        break;
      }
    }
    if (indiceAncora >= 0) state.panGrafico = total - 1 - indiceAncora;
  } else if (!state.graficoTravado && state.panGrafico > 0 &&
      state.totalFonteGrafico && total > state.totalFonteGrafico) {
    state.panGrafico += total - state.totalFonteGrafico;
  }

  const maxPan = Math.max(0, total - visiveis);
  state.panGrafico = state.graficoTravado ? 0
    : Math.round(numeroEntre(state.panGrafico, 0, maxPan));
  const fim = total - state.panGrafico;
  const inicio = Math.max(0, fim - visiveis);
  const metaVisivel = metaCompleta.slice(inicio, fim);
  const periodoMeta = modo === 'acum'
    ? metaCompleta.slice()
    : metaCompleta.slice(Math.max(0, fim - base), fim);
  const periodoPontos = modo === 'acum'
    ? pontos.slice()
    : pontos.slice(Math.max(0, fim - base), fim);
  if (!state.graficoTravado && state.panGrafico > 0) {
    state.ancoraGrafico = chaveMetaGrafico(metaCompleta[fim - 1]);
  } else {
    state.ancoraGrafico = null;
  }
  state.totalFonteGrafico = total;

  return {
    pontos: pontos.slice(inicio, fim), meta: metaVisivel, periodoMeta,
    periodoPontos,
    inicio, fim, total, base, visiveis: fim - inicio, maxPan,
    pan: state.panGrafico, zoom: state.zoom, maxZoom, modo
  };
}

function golsNoMeta(meta) {
  const direto = Number(meta && meta.golsJogo);
  if (Number.isFinite(direto)) return direto;
  const ft = meta && (meta.FT || meta.ft || meta.placarFT || meta.placar);
  const partes = String(ft || '').match(/(\d+)\s*[-x:]\s*(\d+)/i);
  return partes ? Number(partes[1]) + Number(partes[2]) : NaN;
}

function atualizarResumoPeriodoGrafico(viewport, modo, contexto) {
  const resumo = document.getElementById('resumoPeriodoGrafico');
  if (!resumo) return;
  if (modo === 'ligas') {
    resumo.textContent = '4 ligas · mesmo mercado e período';
    return;
  }
  const meta = viewport && viewport.periodoMeta || [];
  const metaVisivel = viewport && viewport.meta || [];
  const quantidade = meta.length;
  const somar = lista => (lista || []).reduce((acc, item) => {
    const gols = golsNoMeta(item);
    if (Number.isFinite(gols)) { acc.gols += gols; acc.jogos++; }
    return acc;
  }, { gols: 0, jogos: 0 });
  const periodo = somar(meta);
  const visao = somar(metaVisivel);
  const faixa = modo === 'acum' && contexto && contexto.periodo
    ? ' · ' + contexto.periodo : '';
  const visiveis = viewport && viewport.visiveis < quantidade
    ? ' · zoom: ' + viewport.visiveis + ' jogos / ' + visao.gols + ' gols visíveis' : '';
  resumo.textContent = quantidade + ' jogos · ' +
    (periodo.jogos ? periodo.gols + ' gols no período' : 'gols aguardando') + faixa + visiveis;
}

function atualizarControlesViewport(modo, viewport) {
  const comparativo = modo === 'ligas';
  const acumulado = modo === 'acum';
  const travadoEfetivo = comparativo || state.graficoTravado;
  const livre = !travadoEfetivo;
  const painel = document.getElementById('graficoPanel');
  const svg = document.getElementById('chart');
  if (painel) {
    painel.classList.toggle('grafico-livre', livre);
    painel.classList.toggle('grafico-travado', travadoEfetivo);
    painel.classList.toggle('grafico-arrastando', !!arrastoCameraGrafico);
    painel.dataset.chartLocked = travadoEfetivo ? 'true' : 'false';
    painel.dataset.chartDragging = arrastoCameraGrafico ? 'true' : 'false';
  }
  if (svg) {
    svg.style.cursor = livre ? (arrastoCameraGrafico ? 'grabbing' : 'grab') : '';
    svg.style.touchAction = livre ? 'pan-y' : '';
  }

  const lock = document.getElementById('lockTitle');
  if (lock) {
    lock.disabled = comparativo;
    lock.textContent = comparativo
      ? '🏆 Top Ligas — visão conjunta'
      : state.graficoTravado
        ? '🔒 Travado — clique para mover'
        : '🔓 Livre — arraste para ver jogos antigos';
    lock.setAttribute('aria-pressed', travadoEfetivo ? 'true' : 'false');
    lock.setAttribute('aria-label', comparativo
      ? 'Comparativo das quatro ligas'
      : state.graficoTravado
        ? 'Destravar o gráfico para arrastar'
        : 'Travar o gráfico no jogo atual');
  }
  const status = document.getElementById('chartViewStatus');
  if (status) {
    if (comparativo) status.textContent = 'Top Ligas · ' + ((viewport && viewport.visiveis) || 0) + ' pontos';
    else if (!viewport) status.textContent = 'Aguardando jogos';
    else if (state.graficoTravado) status.textContent = 'Atual · ' + viewport.visiveis + ' jogos visíveis';
    else if (viewport.pan) status.textContent = 'Histórico · ' + viewport.pan + ' jogos até o atual';
    else status.textContent = 'Livre · acompanhando o jogo atual';
  }

  const valor = document.getElementById('chartZoomValue');
  if (valor) valor.textContent = state.zoom + '×';
  const slider = document.getElementById('zoom');
  const maxZoom = viewport && viewport.maxZoom || ZOOM_GRAFICO_MAX;
  if (slider) {
    slider.min = '1'; slider.max = String(maxZoom);
    slider.value = String(state.zoom); slider.disabled = comparativo;
  }
  const menos = document.getElementById('chartZoomOut');
  const mais = document.getElementById('chartZoomIn');
  const agora = document.getElementById('chartNow');
  if (menos) menos.disabled = comparativo || state.zoom <= 1;
  if (mais) mais.disabled = comparativo || state.zoom >= maxZoom;
  if (agora) agora.disabled = comparativo || !(viewport && viewport.pan);
  const qtd = document.getElementById('qtd');
  if (qtd) {
    qtd.classList.toggle('is-disabled', acumulado);
    qtd.setAttribute('aria-disabled', acumulado ? 'true' : 'false');
    qtd.title = acumulado
      ? 'No Acumulado, a faixa de horas define os jogos' : 'Quantidade da Janela móvel';
    qtd.querySelectorAll('button').forEach(botao => { botao.disabled = acumulado; });
  }
}

function guardarHoverGrafico(tipo, indice, total) {
  hoverGrafico = {
    ativo: true,
    tipo,
    proporcao: total > 1 ? indice / (total - 1) : 1
  };
}

function restaurarInfoHoverGrafico() {
  if (!hoverGrafico.ativo || !geo || !Array.isArray(geo.pts) || !geo.pts.length)
    return false;
  const tipoAtual = geo.comparativo ? 'comparativo' : 'normal';
  if (hoverGrafico.tipo !== tipoAtual) {
    hoverGrafico.ativo = false;
    return false;
  }
  const i = Math.max(0, Math.min(geo.pts.length - 1,
    Math.round(hoverGrafico.proporcao * (geo.pts.length - 1))));
  if (geo.comparativo) {
    atualizarInfoComparativo(geo.pacote, i);
  } else {
    const meta = geo.meta && geo.meta[i] || {};
    atualizarInfoGrafico(meta, geo.pts[i],
      meta.mercado || geo.contexto && geo.contexto.mercado || state.mercado);
  }
  return true;
}

function renderChart() {
  const svg = document.getElementById('chart');
  const modoAtualGrafico = modoAtualDoGrafico();
  const direcaoLigas = document.getElementById('direcaoLigas');
  if (direcaoLigas && modoAtualGrafico !== 'ligas') direcaoLigas.hidden = true;
  const painelGrafico = document.getElementById('graficoPanel');
  if (painelGrafico) painelGrafico.classList.toggle('modo-ligas', modoAtualGrafico === 'ligas');
  if (painelGrafico) painelGrafico.classList.toggle('visual-neon', state.visual === 'Neon');
  const W = svg.clientWidth || 900, H = svg.clientHeight || 230;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  instalarNeon(svg);

  const legendaLigas = document.getElementById('topLigasLegend');
  if (modoAtualGrafico === 'ligas') {
    renderTopLigas(svg, W, H);
    return;
  }
  const metricaGrafico = metricaVisualAtual();
  const configMetrica = configuracaoMetrica(metricaGrafico);
  svg.setAttribute('aria-label', 'Gráfico de ' + configMetrica.nome + ' para ' +
    state.mercado + ' da liga ' + state.liga);
  if (legendaLigas) legendaLigas.hidden = true;
  if (typeof window.atualizarSeletorLigaGrafico === 'function') {
    window.atualizarSeletorLigaGrafico();
  }

  const pontosPagamentoFonte = serie();
  const pontosFonte = metricaGrafico === '% pagamento'
    ? pontosPagamentoFonte : serie(undefined, metricaGrafico);
  const contextoGrafico = window.GraficoReal &&
    typeof window.GraficoReal.contexto === 'function'
    ? (window.GraficoReal.contexto() || {}) : {};
  const modoGrafico = contextoGrafico.modo || modoAtualGrafico || 'janela';
  const mercadoGrafico = contextoGrafico.mercado || state.mercado;
  const ligaGrafico = window.Real && typeof window.Real.liga === 'function'
    ? window.Real.liga() : state.liga;
  const metaFonte = alinharMetaGrafico(contextoGrafico.meta,
    Array.isArray(pontosFonte) ? pontosFonte.length : 0);
  const gdCrossAnalise = analisarGDCross(pontosPagamentoFonte);
  const mediaAlertaAnalise = analisarAlertaMedias(pontosPagamentoFonte);
  const gdCrossEscopo = [
    window.Real && typeof window.Real.liga === 'function' ? window.Real.liga() : state.liga,
    mercadoGrafico, modoGrafico, contextoGrafico.faixa || '',
    contextoGrafico.janela || state.qtd,
    gdCrossAnalise && gdCrossAnalise.periodoRapido,
    gdCrossAnalise && gdCrossAnalise.periodoLento
  ].join('|');
  const mediaAlertaEscopo = [
    window.Real && typeof window.Real.liga === 'function' ? window.Real.liga() : state.liga,
    mercadoGrafico, modoGrafico, contextoGrafico.faixa || '',
    contextoGrafico.janela || state.qtd, cfg.mm1, cfg.mm2, cfg.mm3
  ].join('|');
  const viewport = montarViewportGrafico(
    Array.isArray(pontosFonte) ? pontosFonte : [], metaFonte, modoGrafico);
  const pts = viewport.pontos;
  const metaGrafico = viewport.meta;
  const viewportPagamento = montarViewportGrafico(
    Array.isArray(pontosPagamentoFonte) ? pontosPagamentoFonte : [], metaFonte, modoGrafico);
  const ptsPagamento = viewportPagamento.pontos;
  const paletaMercados = ['#32a4ff', '#ffd400', '#b28dff', '#19d7d1',
    '#ff8a34', '#ff66b3', '#78e06f', '#9fb7ff'];
  const selecionadosGrafico = mercadosSelecionadosGrafico();
  const seriesMercados = [];
  if (selecionadosGrafico.length > 1 && window.GraficoReal &&
      typeof window.GraficoReal.serieMercado === 'function') {
    selecionadosGrafico.filter(m => m !== mercadoGrafico).forEach((mercado, ordem) => {
      const pacote = window.GraficoReal.serieMercado(mercado, undefined, metricaGrafico);
      if (!pacote || !Array.isArray(pacote.serie)) return;
      let valores = [];
      const contextoParalelo = Array.isArray(pacote.contexto)
        ? pacote.contexto : [];
      /* A grade pode terminar de atualizar entre a leitura da linha principal
         e das secundarias. Alinhar pelo slot do jogo evita descartar toda a
         comparacao por causa de um unico resultado novo. */
      if (contextoParalelo.length && metaGrafico.length) {
        const porSlot = new Map();
        contextoParalelo.forEach((meta, indice) => {
          const chave = meta && (meta.slotAbs != null ? `a:${meta.slotAbs}`
            : meta.slot != null ? `s:${meta.slot}`
              : meta.rotulo ? `r:${meta.rotulo}|${meta.timeA || ''}|${meta.timeB || ''}` : '');
          if (chave) porSlot.set(chave, pacote.serie[indice]);
        });
        valores = metaGrafico.map(meta => {
          const chave = meta && (meta.slotAbs != null ? `a:${meta.slotAbs}`
            : meta.slot != null ? `s:${meta.slot}`
              : meta.rotulo ? `r:${meta.rotulo}|${meta.timeA || ''}|${meta.timeB || ''}` : '');
          return chave ? porSlot.get(chave) : undefined;
        });
      }
      if (valores.length !== pts.length || valores.some(v => !Number.isFinite(v))) {
        const deslocamento = pacote.serie.length - pontosFonte.length;
        const inicio = Math.max(0, viewport.inicio + deslocamento);
        const fim = Math.max(inicio, viewport.fim + deslocamento);
        valores = pacote.serie.slice(inicio, fim);
      }
      if (valores.length !== pts.length || valores.some(v => !Number.isFinite(v))) return;
      seriesMercados.push({ mercado, valores,
        cor: paletaMercados[ordem % paletaMercados.length] });
    });
  }
  atualizarControlesViewport(modoGrafico, viewport);
  atualizarResumoPeriodoGrafico(viewport, modoGrafico, contextoGrafico);
  const kJogosGrafico = document.getElementById('kJogos');
  if (kJogosGrafico) kJogosGrafico.textContent = modoGrafico === 'acum'
    ? (contextoGrafico.quantidade || 0) : state.qtd;
  if (modoGrafico === 'janela' && contextoGrafico.completo === false) {
    const statusCarga = document.getElementById('chartViewStatus');
    if (statusCarga) statusCarga.textContent =
      `Carregando ${Math.min(viewport.base, viewport.total)}/${state.qtd} pontos completos`;
  }
  if (!Array.isArray(pts) || pts.length < 2) {
    geo = null;
    hoverGrafico.ativo = false;
    const sub = document.getElementById('macd');
    if (sub) { sub.innerHTML = ''; sub.style.height = '0px'; }
    svg.appendChild(txt({
      x: W / 2, y: H / 2, fill: '#8fa3ad', 'font-size': 13,
      'font-weight': 700, 'text-anchor': 'middle'
    }, 'Aguardando ao menos 2 resultados reais da grade'));
    atualizarInfoGrafico({}, NaN, state.mercado);
    renderMenuChart();
    const tendencia = document.getElementById('tendencia');
    if (tendencia) tendencia.innerHTML =
      'Tendência: <b>aguardando dados reais</b>';
    const leitor = document.getElementById('leitor');
    if (leitor) leitor.textContent = 'Aguardando resultados reais da grade…';
    renderHackerGrafico([], false);
    return;
  }
  const n = pts.length;
  const mediasGrafico = ligado('Médias')
    ? [
        { periodo: cfg.mm1, cor: '#32a4ff', valores: sma(pts, cfg.mm1) },
        { periodo: cfg.mm2, cor: '#ffb000', valores: sma(pts, cfg.mm2) },
        { periodo: cfg.mm3, cor: '#ff4fd8', valores: sma(pts, cfg.mm3) }
      ]
    : metricaGrafico === '% pagamento' && ligado('GDCROSS') && gdCrossAnalise
      ? [
          { periodo: gdCrossAnalise.periodoRapido, cor: '#32a4ff',
            valores: gdCrossAnalise.mediaRapida.slice(viewport.inicio, viewport.fim) },
          { periodo: gdCrossAnalise.periodoLento, cor: '#ff9d00',
            valores: gdCrossAnalise.mediaLenta.slice(viewport.inicio, viewport.fim) }
        ]
      : [];
  const padL = 52, padR = selecionadosGrafico.length > 1 ? 118 : 88,
    padT = 26, padB = 24;
  const usarRenko = ligado('Renko');
  const usarVela = state.visual === 'Candle' && !usarRenko;
  const caixa = Math.max(0.6, +((Math.max(...pts) - Math.min(...pts)) / 12).toFixed(1));
  const tijolos = usarRenko ? renko(pts, caixa) : [];

  /* minima e maxima do mercado na quantidade escolhida */
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const iLo = pts.indexOf(lo), iHi = pts.indexOf(hi);
  const subindoFib = iHi > iLo;

  /* Mercados diferentes possuem patamares naturais muito distantes (por
     exemplo, Over 1.5 costuma ficar bem acima de Over 3.5). Na comparacao,
     deslocamos apenas a geometria das linhas secundarias para que todas
     comecem no mesmo ponto da principal. Assim o grafico compara movimento,
     permite cruzamentos e continua exibindo o percentual REAL nos rotulos e
     no tooltip. */
  seriesMercados.forEach(item => {
    const deslocamentoVisual = pts[0] - item.valores[0];
    item.valoresPlot = item.valores.map(valor => valor + deslocamentoVisual);
  });

  let vals = usarRenko && tijolos.length ? tijolos.flatMap(t => [t.de, t.para]) : pts;
  seriesMercados.forEach(item => { vals = vals.concat(item.valoresPlot); });
  mediasGrafico.forEach(item => { vals = vals.concat(item.valores.filter(Number.isFinite)); });
  if (metricaGrafico === '% pagamento' && !usarRenko && !usarVela &&
      ligado('GDCROSS') && gdCrossAnalise) {
    vals = vals.concat(
      gdCrossAnalise.mediaRapida.slice(viewport.inicio, viewport.fim),
      gdCrossAnalise.mediaLenta.slice(viewport.inicio, viewport.fim)
    ).filter(Number.isFinite);
  }
  const valoresEscala = vals.filter(Number.isFinite);
  const menorEscala = Math.min(...valoresEscala);
  const maiorEscala = Math.max(...valoresEscala);
  const faixaEscala = Math.max(0, maiorEscala - menorEscala);
  const folgaEscala = Math.max(configMetrica.piso / 2, faixaEscala * 0.08);
  let min = menorEscala - folgaEscala;
  let max = maiorEscala + folgaEscala;
  if (max - min < configMetrica.piso) {
    const meio = (max + min) / 2;
    min = meio - configMetrica.piso / 2;
    max = meio + configMetrica.piso / 2;
  }
  if (configMetrica.limitada) {
    min = Math.max(0, min);
    max = Math.min(100, max);
  }
  const x = i => padL + (i * (W - padL - padR)) / (n - 1);
  const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  for (let i = 0; i <= 5; i++) {
    const yy = padT + (i * (H - padT - padB)) / 5;
    const valor = max - (i * (max - min)) / 5;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy,
      stroke: '#0f1f29' }));
    svg.appendChild(txt({ x: padL - 8, y: yy + 3.5, fill: '#8fa3ad',
      'font-size': 9.5, 'text-anchor': 'end', 'font-family': 'monospace' },
      formatarMetrica(valor, configMetrica, true)));
  }
  svg.appendChild(el('line', { x1: padL, x2: padL, y1: padT,
    y2: H - padB, stroke: '#24343e' }));

  if (ligado('Congestão')) {
    for (const z of congestao(pts, (max - min) * 0.12, 4))
      svg.appendChild(el('rect', { x: x(z.de), y: y(z.mx), width: Math.max(2, x(z.ate) - x(z.de)),
        height: Math.max(2, y(z.mn) - y(z.mx)), fill: '#96a5ad', opacity: .1,
        stroke: '#96a5ad', 'stroke-opacity': .28, 'stroke-dasharray': '3 3' }));
  }

  /* ---------- FIBONACCI GRANDE ---------- */
  const niveis = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const valorNivel = k => (subindoFib ? lo + (hi - lo) * k : hi - (hi - lo) * k);
  const cur = pts[n - 1];
  let nivelPerto = niveis[0], dPerto = Infinity;
  if (ligado('Fibonacci')) {
    for (const k of niveis) {
      const v = valorNivel(k), yy = y(v);
      const forte = k === 0 || k === 1 || k === 0.5;
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy,
        stroke: '#b28dff', 'stroke-width': forte ? 1.1 : 0.7,
        'stroke-dasharray': forte ? '6 4' : '3 4', opacity: forte ? .75 : .5 }));
      svg.appendChild(txt({ x: W - padR + 5, y: yy + 3.5, fill: '#b28dff',
        'font-size': 9.5, 'font-weight': forte ? 700 : 400, 'font-family': 'monospace' },
        (k * 100).toFixed(1).replace('.0', '') + '%'));
      const d = Math.abs(cur - v);
      if (d < dPerto) { dPerto = d; nivelPerto = k; }
    }
    svg.appendChild(txt({ x: padL + 4, y: 14, fill: '#b28dff', 'font-size': 10.5, 'font-weight': 700 },
      `Fib ${subindoFib ? 'alta' : 'baixa'} ${lo.toFixed(0)}\u2192${hi.toFixed(0)} \u00b7 linha no ${(nivelPerto * 100).toFixed(1).replace('.0', '')}%`));
  }

  svg.appendChild(txt({ x: W - padR - 4, y: y(hi) - 7, fill: '#8fa3ad',
    'font-size': 11, 'text-anchor': 'end', 'font-weight': 600 },
    `Topo ${formatarMetrica(hi, configMetrica, true)}`));
  svg.appendChild(txt({ x: W - padR - 4, y: y(lo) + 16, fill: '#8fa3ad',
    'font-size': 11, 'text-anchor': 'end', 'font-weight': 600 },
    `Fundo ${formatarMetrica(lo, configMetrica, true)}`));

  const subiu = cur >= pts[0];
  const corLinha = subiu ? '#18e34d' : '#ff343d';
  const desenharSeriesSecundarias = () => {
    seriesMercados.forEach(item => {
      let caminho = `M ${x(0)} ${y(item.valoresPlot[0])}`;
      item.valoresPlot.forEach((valor, indice) => {
        if (!indice) return;
        caminho += modoGrafico === 'acum'
          ? ` H ${x(indice)} V ${y(valor)}`
          : ` L ${x(indice)} ${y(valor)}`;
      });
      svg.appendChild(el('path', comNeon({ d: caminho, fill: 'none',
        stroke: item.cor, 'stroke-width': state.visual === 'Neon' ? 2.2 : 1.7,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .9 })));
      svg.appendChild(el('circle', { cx: x(n - 1),
        cy: y(item.valoresPlot[n - 1]), r: 3.2, fill: item.cor }));
    });
  };

  if (usarRenko && tijolos.length) {
    const bw = (W - padL - padR) / tijolos.length;
    tijolos.forEach((t, i) => {
      const top = Math.max(t.de, t.para), bot = Math.min(t.de, t.para);
      svg.appendChild(el('rect', { x: padL + i * bw + bw * 0.12, y: y(top),
        width: Math.max(1.5, bw * 0.76), height: Math.max(1.5, y(bot) - y(top)),
        fill: t.up ? '#18e34d' : '#ff343d', opacity: .9, rx: 1 }));
    });
    svg.appendChild(txt({ x: padL + 4, y: padT - 4, fill: '#96a5ad', 'font-size': 9, 'font-family': 'monospace' },
      `RENKO \u00b7 caixa ${formatarMetrica(caixa, configMetrica, true)}`));
  } else if (usarVela) {
    const velas = montaVelas(pts);
    if (!velas.length) {
      svg.appendChild(txt({ x: W / 2, y: H / 2, fill: '#ff9d00', 'font-size': 13, 'font-weight': 700, 'text-anchor': 'middle' },
        'Amostra insuficiente para velas em ' + state.mercado));
      svg.appendChild(txt({ x: W / 2, y: H / 2 + 18, fill: '#96a5ad', 'font-size': 10.5, 'text-anchor': 'middle' },
        'este mercado exige ' + minPorVela(state.mercado) + ' jogos por vela \u00b7 aumente a Qtd. Jogos'));
      geo = { pts: pts, meta: metaGrafico, contexto: contextoGrafico,
        viewport: viewport,
        x: x, y: y, padL: padL, padR: padR, padT: padT, padB: padB,
        W: W, H: H, cur: pts[n-1], min: min, max: max };
      atualizarInfoGrafico(metaGrafico[n - 1], pts[n - 1], mercadoGrafico);
      restaurarInfoHoverGrafico();
      renderSub(pts);
      const leituraPagamento = ptsPagamento.length ? ptsPagamento : pts;
      renderLeitura(leituraPagamento, Math.min(...leituraPagamento),
        Math.max(...leituraPagamento), nivelPerto, subindoFib, mercadoGrafico,
        viewportPagamento.periodoPontos);
      processarAlertaGDCross(gdCrossAnalise, pontosPagamentoFonte, metaFonte,
        gdCrossEscopo, mercadoGrafico, ligaGrafico);
      processarAlertaMedias(mediaAlertaAnalise, pontosPagamentoFonte, metaFonte,
        mediaAlertaEscopo, mercadoGrafico, ligaGrafico);
      return;
    }
    const bw = (W - padL - padR) / velas.length;
    velas.forEach(function (v, i) {
      const cx = padL + i * bw + bw / 2, sobe = v.f >= v.a, cor = sobe ? '#18e34d' : '#ff343d';
      svg.appendChild(el('line', { x1: cx, x2: cx, y1: y(v.max), y2: y(v.min), stroke: cor, 'stroke-width': 1 }));
      const topo = y(Math.max(v.a, v.f)), base2 = y(Math.min(v.a, v.f));
      svg.appendChild(el('rect', { x: cx - bw * 0.32, y: topo, width: Math.max(1.5, bw * 0.64),
        height: Math.max(1.2, base2 - topo), fill: cor, opacity: .92 }));
      if (Math.abs(v.z) >= 2) svg.appendChild(txt({ x: cx, y: y(v.max) - 4, fill: cor,
        'font-size': 8, 'font-weight': 700, 'text-anchor': 'middle' }, Math.abs(v.z).toFixed(1)));
    });
    svg.appendChild(txt({ x: padL + 4, y: padT - 4, fill: '#96a5ad', 'font-size': 9, 'font-family': 'monospace' },
      'CANDLE \u00b7 ' + velas.length + ' velas \u00b7 ' + velas[0].n + ' jogos cada \u00b7 m\u00ednimo do mercado: ' + minPorVela(state.mercado)));
    if (window.CandleTrendModel && typeof window.CandleTrendModel.prever === 'function') {
      const previsaoCandle = window.CandleTrendModel.prever({
          pontos: ptsPagamento.length ? ptsPagamento : pts,
        metas: metaGrafico,
        janela: contextoGrafico.janela || state.qtd,
        base: normalDe(mercadoGrafico),
        horizontes: [1, 3, 5]
      });
      const iconeDirecao = { ALTA: '\u2191', BAIXA: '\u2193', LATERAL: '\u2192' };
      const corDirecao = { ALTA: '#18e34d', BAIXA: '#ff4650', LATERAL: '#ffd43b' };
      const principal = previsaoCandle.projecoes[previsaoCandle.projecoes.length - 1];
      const resumo = previsaoCandle.projecoes.map(function (p) {
        return p.jogos + 'j ' + iconeDirecao[p.direcao] + ' ' + p.confianca + '%';
      }).join(' \u00b7 ');
      svg.appendChild(txt({ x: W - padR - 4, y: padT - 4,
        fill: corDirecao[principal.direcao], 'font-size': 9, 'font-weight': 800,
        'text-anchor': 'end', 'font-family': 'monospace' },
        'PR\u00d3X. TEND\u00caNCIA \u00b7 ' + resumo +
        ' \u00b7 entrada estimada ' + previsaoCandle.probabilidadeEntrada.toFixed(1) + '%'));
    }
  } else {
    let d = `M ${x(0)} ${y(pts[0])}`;
    pts.forEach((v, i) => {
      if (!i) return;
      d += modoGrafico === 'acum'
        ? ` H ${x(i)} V ${y(v)}`
        : ` L ${x(i)} ${y(v)}`;
    });
    svg.appendChild(el('path', comNeon({ d, fill: 'none', stroke: corLinha,
      'stroke-width': state.visual === 'Neon' ? (n > 120 ? 1.7 : 2.7) : (n > 120 ? 1.1 : 2),
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' })));

    desenharSeriesSecundarias();

    if (mediasGrafico.length) {
      mediasGrafico.forEach(item => {
        const cor = item.cor, m = item.valores;
        let dd = '', ini = false;
        m.forEach((v, i) => { if (v == null) return; dd += (ini ? ' L ' : 'M ') + x(i) + ' ' + y(v); ini = true; });
        if (dd) svg.appendChild(el('path', {
          d: dd, fill: 'none', stroke: cor, 'stroke-width': 1.7,
          opacity: .98, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'data-mm': String(item.periodo)
        }));
      });
      mediasGrafico.forEach((item, indice) => {
        svg.appendChild(txt({
          x: padL + 8 + indice * 58, y: 15, fill: item.cor,
          'font-size': 10, 'font-weight': 800, 'font-family': 'monospace'
        }, 'MM' + item.periodo));
      });
    }
    const raio = n <= 40 ? 3.4 : n <= 120 ? 2.4 : n <= 240 ? 1.4 : n <= 480 ? .7 : .5;
    if (raio) pts.forEach((v, i) => svg.appendChild(el('circle', { cx: x(i), cy: y(v),
      r: i === n - 1 ? raio + 1.2 : raio, fill: i === n - 1 ? corLinha : '#9aa7b0' })));
    /* rotulos de valor: todos quando cabe, so nos pivos quando aperta */
    const rotular = n <= 24 ? pts.map((v, i) => ({ i, v, t: i && v < pts[i-1] ? 'L' : 'H' })) : n <= 60 ? pivots(pts, 2) : [];
    for (const p of rotular)
      svg.appendChild(txt({ x: x(p.i), y: y(p.v) + (p.t === 'H' ? -10 : 18), fill: '#e7edf1',
        'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle' }, p.v.toFixed(0)));
  }

  if ((usarRenko || usarVela) && seriesMercados.length) {
    desenharSeriesSecundarias();
  }

  if (metricaGrafico === '% pagamento' && !usarRenko && !usarVela) {
    desenharGDCross(svg, gdCrossAnalise, viewport, x, y,
      padL, padR, padT, padB, W, H);
  }

  if (ligado('LTA/LTB')) {
    [['LTA', '#18e34d'], ['LTB', '#ff343d']].forEach(([tipo, cor]) => {
      const lt = linhaTendencia(pts, tipo);
      if (!lt) return;
      const m = (lt.b.v - lt.a.v) / (lt.b.i - lt.a.i);
      const vFim = lt.b.v + m * (n - 1 - lt.b.i);
      svg.appendChild(el('line', { x1: x(lt.a.i), y1: y(lt.a.v), x2: x(n - 1), y2: y(vFim),
        stroke: cor, 'stroke-width': 1.6, 'stroke-dasharray': '7 5', opacity: .95 }));
      svg.appendChild(txt({ x: W - padR - 4, y: y(vFim) - 5, fill: cor, 'font-size': 10,
        'font-weight': 700, 'text-anchor': 'end' }, tipo));
    });
  }
  if (ligado('Topo/Fundo')) for (const p of pivots(pts, 2))
    svg.appendChild(el('path', { d: p.t === 'H' ? `M ${x(p.i)} ${y(p.v) - 14} l 4 6 l -8 0 z` : `M ${x(p.i)} ${y(p.v) + 14} l 4 -6 l -8 0 z`,
      fill: p.t === 'H' ? '#ff343d' : '#18e34d' }));
  if (ligado('Elliott')) {
    const z = zigzag(pts, 2).slice(-8), rot = ['1','2','3','4','5','A','B','C'];
    z.forEach((p, i) => {
      svg.appendChild(el('circle', { cx: x(p.i), cy: y(p.v), r: 8, fill: '#07151e', stroke: '#ffd400', 'stroke-width': 1.2 }));
      svg.appendChild(txt({ x: x(p.i), y: y(p.v) + 3.5, fill: '#ffd400', 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }, rot[i] || ''));
    });
  }
  if (ligado('Linha Atual')) {
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(cur), y2: y(cur),
      stroke: '#ff9d00', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: .85 }));
  }
  /* Identificacao permanente na ponta direita. O fundo translucido conserva
     a leitura das linhas e evita que a porcentagem se misture ao grafico. */
  const rotuloMercadoCurto = mercado => String(mercado)
    .replace('Ambas Marcam (Sim)', 'Ambas S')
    .replace('Ambas Marcam (Não)', 'Ambas N')
    .replace('Ambas Marcam', 'Ambas');
  const etiquetas = [{ mercado: mercadoGrafico, valor: cur,
    valorPlot: cur, cor: corLinha }]
    .concat(seriesMercados.map(item => ({ mercado: item.mercado,
      valor: item.valores[n - 1], valorPlot: item.valoresPlot[n - 1],
      cor: item.cor })))
    .sort((a, b) => y(a.valorPlot) - y(b.valorPlot));
  etiquetas.forEach((item, indice) => {
    const natural = y(item.valorPlot);
    const anterior = indice ? etiquetas[indice - 1].yEtiqueta : -Infinity;
    item.yEtiqueta = Math.max(padT + 9, Math.min(H - padB - 9,
      Math.max(natural, anterior + 19)));
  });
  for (let indice = etiquetas.length - 2; indice >= 0; indice--) {
    etiquetas[indice].yEtiqueta = Math.min(etiquetas[indice].yEtiqueta,
      etiquetas[indice + 1].yEtiqueta - 19);
  }
  etiquetas.forEach(item => {
    const xx = W - padR + 5, yy = item.yEtiqueta;
    svg.appendChild(el('line', { x1: x(n - 1) + 3, x2: xx,
      y1: y(item.valorPlot), y2: yy, stroke: item.cor, 'stroke-width': .8,
      opacity: .5 }));
    svg.appendChild(el('rect', { x: xx, y: yy - 9, width: padR - 9,
      height: 18, rx: 5, fill: item.cor, opacity: .14,
      stroke: item.cor, 'stroke-opacity': .48 }));
    svg.appendChild(txt({ x: xx + 6, y: yy + 3.5, fill: item.cor,
      'font-size': 9.5, 'font-weight': 700, 'font-family': 'monospace' },
      `${rotuloMercadoCurto(item.mercado)} ${formatarMetrica(item.valor, configMetrica, true)}`));
  });

  /* eixo X */
  const passo = Math.max(1, Math.round(n / 7));
  pts.forEach((_, i) => {
    if (i % passo && i !== n - 1) return;
    const meta = metaGrafico[i] || {};
    const rotulo = meta.rotulo ||
      (meta.hora != null && meta.minuto != null
        ? pad(meta.hora) + ':' + pad(meta.minuto) : '');
    svg.appendChild(txt({ x: x(i), y: H - 5, fill: '#8fa3ad', 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'monospace' },
      rotulo));
  });

  geo = { pts, meta: metaGrafico, contexto: contextoGrafico, viewport, x, y,
    seriesMercados: [{ mercado: mercadoGrafico, valores: pts, cor: corLinha }].concat(seriesMercados),
    medias: mediasGrafico,
    padL, padR, padT, padB, W, H, cur, min, max,
    metrica: metricaGrafico, configMetrica };
  const metaFib50 = metaGrafico[n - 1] || {};
  const contextoFib50 = [ligaGrafico, mercadoGrafico, metricaGrafico, modoGrafico,
    contextoGrafico.faixa || '', contextoGrafico.janela || state.qtd].join('|');
  const chaveFib50 = [metaFib50.id || '', metaFib50.slotAbs || '', metaFib50.slot || '',
    metaFib50.rotulo || '', metaFib50.hora || '', metaFib50.minuto || '',
    metaFib50.jogo || metaFib50.nome || '', n].join('|') || String(cur);
  processarAlertaFib50({
    contexto: contextoFib50,
    chave: chaveFib50,
    valor: cur,
    nivel: valorNivel(0.5),
    valorTexto: formatarMetrica(cur, configMetrica, true),
    nivelTexto: formatarMetrica(valorNivel(0.5), configMetrica, true),
    liga: ligaGrafico,
    mercado: mercadoGrafico,
    metrica: metricaGrafico,
    slotAbs: metaFib50.slotAbs,
    horario: metaFib50.rotulo ||
      (metaFib50.hora != null && metaFib50.minuto != null
        ? pad(metaFib50.hora) + ':' + pad(metaFib50.minuto) : '')
  });
  const pagamentoAtual = ptsPagamento.length ? ptsPagamento[ptsPagamento.length - 1] : NaN;
  if (!viewport.pan && Number.isFinite(pagamentoAtual)) checarAlerta(pagamentoAtual);
  processarAlertaGDCross(gdCrossAnalise, pontosPagamentoFonte, metaFonte,
    gdCrossEscopo, mercadoGrafico, ligaGrafico);
  processarAlertaMedias(mediaAlertaAnalise, pontosPagamentoFonte, metaFonte,
    mediaAlertaEscopo, mercadoGrafico, ligaGrafico);
  atualizarInfoGrafico(metaGrafico[n - 1], cur, mercadoGrafico);
  restaurarInfoHoverGrafico();
  renderSub(pts);
  renderMenuChart();
  const minimoPagamento = ptsPagamento.length ? Math.min(...ptsPagamento) : lo;
  const maximoPagamento = ptsPagamento.length ? Math.max(...ptsPagamento) : hi;
  renderLeitura(ptsPagamento.length ? ptsPagamento : pts,
    minimoPagamento, maximoPagamento, nivelPerto, subindoFib, mercadoGrafico,
    viewportPagamento.periodoPontos);
  renderDesenhos();
}

/* ---------- LEITURA — fórmulas portadas do server.js do caramelo-live ---------- */
function emaArr(a,p){var k=2/(p+1),out=[],e=a[0];for(var i=0;i<a.length;i++){e=i?a[i]*k+e*(1-k):a[i];out.push(e);}return out;}
function macdCaramelo(s){var m1=emaArr(s,cfg.mm1||10),m2=emaArr(s,cfg.mm2||20);
  return{mm1:m1,mm2:m2,hist:s.map(function(_,i){return m1[i]-m2[i];})};}
function zoneSignal(series){
  if(!series.length)return{zona:'\u2014',zonaPct:0,direcao:'\u2014',pagamento:'\u2014',sinal:'AGUARDAR',atual:NaN,macd:0,mm1:0,mm2:0,subindo:false,descendo:false};
  var sorted=series.slice().sort(function(a,b){return a-b;});
  var p=function(q){return sorted[Math.min(sorted.length-1,Math.max(0,Math.round((sorted.length-1)*q)))];};
  var min=p(0.05),max=p(0.95),cur=series[series.length-1];
  var range=Math.max(1,max-min);
  var zonaPct=Math.round((Math.max(min,Math.min(max,cur))-min)/range*100);
  var md=macdCaramelo(series);
  var macd=md.hist[md.hist.length-1];
  var macdPrev=md.hist[md.hist.length-4]!==undefined?md.hist[md.hist.length-4]:macd;
  var subindo=macd>0.2&&macd>=macdPrev;
  var descendo=macd<-0.2||(macd<macdPrev-0.2);
  var zona=zonaPct<=25?'Fundo':zonaPct<=45?'Baixa':zonaPct>=78?'Topo':zonaPct>=60?'Alta':'Meio';
  var sinal='AGUARDAR',pagamento='\u2014';
  if(zonaPct>=78){sinal='TOPO — NÃO ENTRAR (risco RED)';pagamento=descendo?'Saída/pagamento':'\u2014';}
  else if(zonaPct>=60&&descendo){sinal='PROTEGER PARCIAL';pagamento='Parcial';}
  else if(zonaPct<=35&&subindo){sinal='COMPRA (fundo subindo)';pagamento='Alvo meio';}
  else if(zonaPct<=35&&!subindo){sinal='FUNDO — aguardar virada';}
  else if(subindo&&zonaPct<60){sinal='SUBINDO (a favor)';}
  else if(descendo){sinal='RECUO';}
  return{zona:zona,zonaPct:zonaPct,atual:+cur.toFixed(1),direcao:subindo?'Subindo':descendo?'Descendo':'Lateral',
    pagamento:pagamento,sinal:sinal,macd:+macd.toFixed(2),
    mm1:+md.mm1[md.mm1.length-1].toFixed(1),mm2:+md.mm2[md.mm2.length-1].toFixed(1),
    subindo:subindo,descendo:descendo};}
function comboScore(o){
  var pts={hist:o.graphSubindo?15:o.graphTopo?-15:0,trend:o.graphSubindo?10:o.graphTopo?-10:0,
    minimum:o.temMinima?25:0,cycle:o.cycleStrong?15:o.cycleBuilding?8:0,prob:o.probStrong?15:0,
    ev:o.evStrong?10:0,base:o.baseForte?10:0,longMinimum:o.minimaLonga?5:0};
  var s=0;for(var k in pts)s+=pts[k];
  s=Math.max(0,Math.min(100,s));
  if(!o.temMinima||!o.graphSubindo)s=Math.min(s,64);
  if(o.coldOdd||!o.probStrong||!o.evStrong)s=Math.min(s,54);
  var ready=s>=70&&o.temMinima&&o.graphSubindo&&o.probStrong&&o.evStrong&&o.baseForte&&!o.coldOdd;
  return{score:Math.round(s),ready:ready,points:pts};}

/*
 * Leitor aprendido do próprio gráfico (k-vizinhos mais parecidos).
 * Para cada movimento antigo, mede o que ocorreu três jogos depois. O ponto
 * atual é comparado somente com trechos cujo futuro já é conhecido, evitando
 * olhar o resultado que ainda não aconteceu. É um sinal estatístico, não uma
 * promessa de pagamento.
 */
function aprenderMovimentoGrafico(serie) {
  if (window.HackerModel && typeof window.HackerModel.aprender === 'function') {
    return window.HackerModel.aprender(serie, state.qtd);
  }
  return { pronto: false, faltam: 1 };
}

function avaliarSinalHacker(leitura, zona, passoMercado, sinaisGrafico) {
  if (window.HackerModel && typeof window.HackerModel.avaliar === 'function') {
    return window.HackerModel.avaliar(leitura, zona, passoMercado, sinaisGrafico);
  }
  return { forte: false, antecipado: false, classe: 'aguardar', sinal: 'AGUARDAR', motivo: 'motor carregando' };
}

let alertaHackerAtivo = '';

function renderHackerGrafico(serie, comparativo, mercadoGrafico, sinaisGrafico) {
  const box = document.getElementById('hackerSinal');
  if (!box) return null;
  if (!ligado('Hacker IA')) {
    box.hidden = true;
    return null;
  }
  box.hidden = false;
  if (comparativo) {
    box.className = 'hacker-sinal aprendendo';
    box.textContent = 'Hacker IA: selecione Janela ou Acumulado para ler uma liga';
    return null;
  }
  const leitura = aprenderMovimentoGrafico(serie);
  if (!leitura.pronto) {
    box.className = 'hacker-sinal aprendendo';
    box.textContent = `Hacker IA aprendendo · faltam ${Math.max(1, leitura.faltam)} pontos`;
    box.title = 'O leitor aguarda uma amostra mínima antes de emitir sinal.';
    return leitura;
  }
  const zona = zoneSignal(serie);
  const limitesAprendidos = leitura.limitesAdaptativos || {};
  zona.limiarAtivacao = Number(limitesAprendidos.ativacao);
  zona.limiarConfirmacao = Number(limitesAprendidos.confirmacao);
  if (!Number.isFinite(zona.limiarAtivacao) ||
      !Number.isFinite(zona.limiarConfirmacao)) {
    const ordenada = serie.slice().map(Number).filter(Number.isFinite)
      .sort((a, b) => a - b);
    const faixa = q => ordenada[Math.max(0, Math.min(ordenada.length - 1,
      Math.round((ordenada.length - 1) * q)))];
    zona.limiarAtivacao = +faixa(.55).toFixed(1);
    zona.limiarConfirmacao = +faixa(.75).toFixed(1);
  }
  const passoMercado = Math.max(.1, 100 / Math.max(2, Number(state.qtd) || 20));
  const decisao = avaliarSinalHacker(leitura, zona, passoMercado, sinaisGrafico);
  leitura.sinal = decisao.sinal;
  leitura.classe = decisao.classe;
  leitura.forte = decisao.forte;
  leitura.antecipado = !!decisao.antecipado;
  leitura.motivo = decisao.motivo;
  leitura.alertaRisco = !!decisao.alertaRisco;
  leitura.alertaOportunidade = !!decisao.alertaOportunidade;
  leitura.confluencias = Number(decisao.confluencias) || 0;
  leitura.totalConfluencias = Number(decisao.totalConfluencias) || 0;
  leitura.alvoEstrutural = decisao.alvo;
  const delta = (leitura.projecao >= 0 ? '+' : '') + leitura.projecao.toFixed(1);
  box.className = 'hacker-sinal ' + leitura.classe;
  box.textContent = leitura.totalConfluencias
    ? `Hacker IA · ${leitura.sinal} · ${leitura.motivo}` +
      ` · confluência ${leitura.confluencias}/${leitura.totalConfluencias}` +
      ` · médias ${zona.mm1}/${zona.mm2} · MACD ${zona.macd}`
    : `Hacker IA · ${leitura.sinal} · ${leitura.motivo} · ${leitura.confianca}%` +
      ` · vantagem do padrão ${leitura.vantagemPadrao >= 0 ? '+' : ''}${leitura.vantagemPadrao} pp` +
      ` · acerto conservador ${leitura.limiteInferior}%` +
      ` · níveis aprendidos ${zona.limiarAtivacao}/${zona.limiarConfirmacao}%` +
      ` · ${leitura.amostraEfetiva} padrões efetivos · projeção 1–3 jogos ${delta} pp`;
  const estrutura = leitura.fundoDuplo && leitura.fundoDuplo.encontrado
    ? ` Fundo duplo ${leitura.fundoDuplo.fundo1}/${leitura.fundoDuplo.fundo2}%` +
      ` · linha de confirmação ${leitura.fundoDuplo.linha}%.`
    : leitura.tendenciaDefinida && leitura.tendenciaDefinida.definida
      ? ` Tendência definida: +${leitura.tendenciaDefinida.ganho} pp em ` +
        `${leitura.tendenciaDefinida.pontos} pontos · eficiência ` +
        `${leitura.tendenciaDefinida.eficiencia}%.`
      : '';
  box.title = `Semelhança média ${leitura.similaridade}%. Consistência entre 1, 2 e 3 jogos: ` +
    `${leitura.consistencia}%. Janelas rápidas/confirmadas: ${leitura.janelas}. ` +
    `Base direcional do gráfico: ${leitura.taxaBase}%. Limites aprendidos: ` +
    `${zona.limiarAtivacao}% / ${zona.limiarConfirmacao}% ` +
    `(${limitesAprendidos.casos || 0} movimentos favoráveis).${estrutura} ` +
    `A entrada só é liberada com confirmação gráfica.`;
  const escopo = String(state.liga) + '|' + String(mercadoGrafico || state.mercado);
  const escopoRisco = escopo + '|queda';
  const escopoOportunidade = escopo + '|oportunidade';
  if (leitura.alertaRisco && alertaHackerAtivo !== escopoRisco) {
    alertaHackerAtivo = escopoRisco;
    mostrarAviso(`⚠ Hacker IA: ALERTA DE QUEDA em ${state.liga} · ${mercadoGrafico || state.mercado}` +
      ` · ${leitura.motivo} · confluência ${leitura.confluencias}/${leitura.totalConfluencias}`);
    if (somDeAlertaLigado()) bip();
  } else if (leitura.forte && alertaHackerAtivo !== escopo) {
    alertaHackerAtivo = escopo;
    mostrarAviso(`🤖 Hacker IA: ENTRADA VALIDADA em ${state.liga} · ${mercadoGrafico || state.mercado}` +
      ` · confiança ${leitura.confianca}% · projeção ${delta} pp`);
    if (somDeAlertaLigado()) bip();
  } else if (leitura.alertaOportunidade && alertaHackerAtivo !== escopoOportunidade) {
    alertaHackerAtivo = escopoOportunidade;
    mostrarAviso(`🔎 Hacker IA: OPORTUNIDADE ANTECIPADA em ${state.liga} · ${mercadoGrafico || state.mercado}` +
      ` · ${leitura.motivo} · confiança ${leitura.confianca}% · projeção ${delta} pp`);
    if (somDeAlertaLigado()) bip();
  } else if (!leitura.forte && !leitura.alertaRisco && !leitura.alertaOportunidade &&
      (alertaHackerAtivo === escopo || alertaHackerAtivo === escopoRisco ||
       alertaHackerAtivo === escopoOportunidade)) {
    alertaHackerAtivo = '';
  }
  return leitura;
}

function renderLeitura(pts,lo,hi,nivel,subindoFib,mercadoGrafico,pontosPeriodo){
  var z=zoneSignal(pts),n=pts.length,cur=pts[n-1],
    normal=normalDe(mercadoGrafico||state.mercado);
  var temMinima=z.zonaPct<=25,minimaLonga=temMinima&&n>=40;
  var lta=linhaTendencia(pts,'LTA'),ltb=linhaTendencia(pts,'LTB'),quebrou=false;
  if(ltb){var m=(ltb.b.v-ltb.a.v)/(ltb.b.i-ltb.a.i);quebrou=cur>(ltb.b.v+m*(n-1-ltb.b.i));}
  var passoEstrutura=Math.max(.1,100/Math.max(2,Number(state.qtd)||20));
  var rompeuLTA=false,retesteLTAFalhou=false;
  if(lta){
    var mlta=(lta.b.v-lta.a.v)/(lta.b.i-lta.a.i);
    var vlta=function(i){return lta.b.v+mlta*(i-lta.b.i);};
    var tolLta=Math.max(.2,passoEstrutura*.45),indiceQuebra=-1;
    for(var il=Math.max(lta.b.i+1,n-28);il<n;il++){
      if(pts[il-1]>=vlta(il-1)-tolLta&&pts[il]<vlta(il)-tolLta){indiceQuebra=il;break;}
    }
    rompeuLTA=indiceQuebra>=0||cur<vlta(n-1)-tolLta;
    if(indiceQuebra>=0&&indiceQuebra<n-2){
      var melhorReteste=-Infinity;
      for(var ir=indiceQuebra+1;ir<n-1;ir++) melhorReteste=Math.max(melhorReteste,pts[ir]-vlta(ir));
      retesteLTAFalhou=melhorReteste>=-tolLta*1.5&&cur<vlta(n-1)-tolLta&&
        pts[n-1]<pts[n-2]-passoEstrutura*.1;
    }
  }
  var serieHacker=Array.isArray(pontosPeriodo)&&pontosPeriodo.length
    ?pontosPeriodo:pts;
  renderHackerGrafico(serieHacker,false,mercadoGrafico,{quebrouLTB:quebrou,
    rompeuLTA:rompeuLTA,retesteLTAFalhou:retesteLTAFalhou});
  var cs=comboScore({graphSubindo:z.subindo,graphTopo:z.zonaPct>=78,temMinima:temMinima,
    minimaLonga:minimaLonga,cycleStrong:quebrou&&z.subindo,cycleBuilding:quebrou,
    probStrong:cur>=normal,evStrong:cur>=normal*1.05,baseForte:n>=40,coldOdd:cur<normal*0.7});
  document.getElementById('lzona').textContent=z.zona.toUpperCase();
  document.getElementById('lsetas').textContent=pts.slice(-7).map(function(v,i,a){
    return i===0?'':v>a[i-1]?'\u2191':v<a[i-1]?'\u2193':'\u2192';}).join('');
  document.getElementById('ldesc').textContent=z.sinal+' · zona '+z.zonaPct+'%';
  document.getElementById('tendencia').innerHTML='Tendência: <b>'+z.direcao.toLowerCase()+'</b>'
    +(lta?' · <span class="lta">LTA ↗ (suporte)</span>':'')
    +(ltb?' · <span class="ltb">LTB ↘ (resistência)</span>':'')
    +(quebrou?' · <span class="lta">QUEBROU A LTB</span>':'')
    +(ligado('LTA/LTB')&&!lta&&!ltb?' · LTA/LTB: amostra insuficiente':'');
  var cel=function(k,v,c){return '<div class="cel"><div class="k">'+k+'</div><div class="v '+(c||'neutro')+'">'+v+'</div></div>';};
  document.getElementById('sinais').innerHTML=
    cel('Score',cs.score+(cs.ready?' ✓':''),cs.score>=70?'up':cs.score>=55?'mid':'down')+
    cel('Sinal','<span style="font-size:10px">'+z.sinal+'</span>',z.sinal.indexOf('COMPRA')===0?'up':z.sinal.indexOf('TOPO')===0?'down':'neutro')+
    cel('Zona',z.zona+' '+z.zonaPct+'%','mid')+
    cel('Direção',z.direcao,z.direcao==='Subindo'?'up':z.direcao==='Descendo'?'down':'neutro')+
    cel('MACD',z.macd.toFixed(2),z.macd>=0?'up':'down')+
    cel('MM1 / MM2',z.mm1+' / '+z.mm2)+
    cel('Pagamento',cur.toFixed(1)+'%',cur>=normal?'up':'down')+
    (function(){var f=forcaAtual(pts);return cel('For\u00e7a',
      (f.z>=0?'+':'')+f.z.toFixed(1)+' <span style="font-size:9px">'+f.rotulo+'</span>',f.classe);})();}

/* ---------- MIRA E TOOLTIP ---------- */
function montarMira() {
  const wrap = document.querySelector('.chart-main');
  const svg = document.getElementById('chart');
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.innerHTML = '<span>Passe o cursor no gráfico para ver os dados do jogo.</span>';
  const subpainel = document.getElementById('macd');
  wrap.insertBefore(tip, subpainel || null);
  const mira = document.createElement('div');
  mira.className = 'mira'; mira.hidden = true;
  mira.innerHTML = '<i class="mv"></i><i class="mh"></i><span class="mira-pct"></span>';
  wrap.appendChild(mira);

  svg.addEventListener('mousemove', e => {
    if (arrastoCameraGrafico) {
      mira.hidden = true;
      return;
    }
    if (!geo) return;
    const r = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const svgTop = r.top - wrapRect.top;
    const px = e.clientX - r.left;
    /* A horizontal segue a altura real do ponteiro. Antes ela dependia de
       geo.y(valor); em pontos sem valor numérico o resultado era NaN e o
       navegador descartava o top, deixando somente a linha vertical. */
    const posicaoY = Number.isFinite(Number(e.offsetY))
      ? Number(e.offsetY)
      : (Number.isFinite(Number(e.clientY)) ? Number(e.clientY) - r.top : geo.padT);
    const cruzY = Math.max(0, Math.min(r.height, posicaoY)) + svgTop;
    const yDentroGrafico = Math.max(geo.padT,
      Math.min(geo.H - geo.padB, posicaoY));
    const percentualLinha = geo.max -
      ((yDentroGrafico - geo.padT) / (geo.H - geo.padT - geo.padB)) *
      (geo.max - geo.min);
    const rotuloPct = mira.querySelector('.mira-pct');
    const configHover = geo.configMetrica || configuracaoMetrica('% pagamento');
    rotuloPct.style.top = cruzY + 'px';
    rotuloPct.textContent = formatarMetrica(percentualLinha, configHover, true);
    const passo = (geo.W - geo.padL - geo.padR) / (geo.pts.length - 1);
    let i = Math.round((px - geo.padL) / passo);
    i = Math.max(0, Math.min(geo.pts.length - 1, i));

    if (geo.comparativo) {
      guardarHoverGrafico('comparativo', i, geo.pts.length);
      const leitura = valorComparativoNoIndice(geo.pacote, i);
      if (!leitura.valores.length) return;
      const cx = geo.x(i);
      const atras = geo.pts.length - 1 - i;
      const lideres = leitura.melhores.map(item => item.liga.nome).join(' / ');

      mira.hidden = false;
      mira.querySelector('.mv').style.left = cx + 'px';
      mira.querySelector('.mh').style.top = cruzY + 'px';
      tip.classList.add('tip-ligas');
      tip.innerHTML = `<span class="tip-ligas-cabecalho"><b>${atras ? atras + ' jogos atrás' : 'Agora'} · ` +
        `${escaparHover(geo.pacote.mercado)}</b><span>${leitura.melhores.length > 1 ? 'Empate' : 'Melhor'}: ` +
        `<b>${escaparHover(lideres)}</b></span></span><span class="tip-ligas-grade">` +
        leitura.valores.map(cartaoJogoComparativo).join('') + '</span>';
      atualizarInfoComparativo(geo.pacote, i);
      return;
    }

    tip.classList.remove('tip-ligas');
    const v = geo.pts[i];
    guardarHoverGrafico('normal', i, geo.pts.length);
    const cx = geo.x(i);
    const meta = (geo.meta && geo.meta[i]) || {};
    const hhmm = meta.rotulo || meta.hora || '—';
    const times = meta.timeA || meta.timeB
      ? (meta.timeA || '—') + ' x ' + (meta.timeB || '—') : '';
    const ft = meta.FT || meta.ft || meta.placarFT || meta.placar || '—';
    const ht = meta.HT || meta.ht || meta.placarHT || '—';
    const mercado = meta.mercado ||
      (geo.contexto && geo.contexto.mercado) || state.mercado;
    const dif = i ? v - geo.pts[i - 1] : 0;

    mira.hidden = false;
    mira.querySelector('.mv').style.left = cx + 'px';
    mira.querySelector('.mh').style.top = cruzY + 'px';

    const linhasHover = Array.isArray(geo.seriesMercados) && geo.seriesMercados.length > 1
      ? geo.seriesMercados.map(item =>
          `<span style="color:${item.cor}">${item.mercado} · <b>${formatarMetrica(item.valores[i], configHover, true)}</b></span>`
        ).join('')
      : `<span>${configHover.nome} · ${formatarMetrica(v, configHover, true)}</span>`;
    const linhasMedias = Array.isArray(geo.medias)
      ? geo.medias.map(item => {
          const valorMedia = item.valores[i];
          return Number.isFinite(valorMedia)
            ? `<span style="color:${item.cor}">MM(${item.periodo}): <b>${valorMedia.toFixed(2)}</b></span>`
            : '';
        }).join('')
      : '';
    tip.innerHTML = `<b>${hhmm}${times ? ' · ' + times : ''}</b>` +
      `<span>FT ${ft} · HT ${ht}</span>` + linhasHover + linhasMedias +
      `<span class="${dif >= 0 ? 'ok' : 'no'}">${dif >= 0 ? '+' : ''}` +
      `${formatarMetrica(dif, configHover, false)} ${configHover.delta}</span>`;
    atualizarInfoGrafico(meta, v, mercado);
  });
  svg.addEventListener('mouseleave', () => {
    hoverGrafico.ativo = false;
    mira.hidden = true;
    if (geo) {
      if (geo.comparativo) {
        atualizarInfoComparativo(geo.pacote, geo.pts.length - 1);
        return;
      }
      const meta = geo.meta && geo.meta[geo.meta.length - 1];
      atualizarInfoGrafico(meta, geo.cur,
        (geo.contexto && geo.contexto.mercado) || state.mercado);
    }
  });
}

/* ---------- SUBPAINEL: MACD e/ou RSI ---------- */
function renderSub(pts) {
  const svg = document.getElementById('macd');
  const mostrarMacd = ligado('MACD'), mostrarRsi = ligado('RSI');
  const n = (mostrarMacd ? 1 : 0) + (mostrarRsi ? 1 : 0);
  if (!n) { svg.style.height = '0px'; svg.innerHTML = ''; return; }
  const alturas = [];
  if (mostrarMacd) alturas.push(n === 2 ? 70 : 78);
  if (mostrarRsi) alturas.push(n === 2 ? 73 : 81);
  const alt = alturas.reduce(function (soma, altura) { return soma + altura; }, 0);
  svg.style.height = alt + 'px';
  const W = svg.clientWidth || 900, H = alt;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const padR = 46;
  let y0 = 0;
  let faixa = 0;
  let hh = alturas[faixa];

  if (mostrarMacd) {
    const f = sma(pts, cfg.rapida), s = sma(pts, cfg.lenta);
    const linha = pts.map(function (_, i) { return (f[i] != null && s[i] != null) ? f[i] - s[i] : 0; });
    const sig = sma(linha, cfg.sinal);
    const hist = linha.map(function (v, i) { return sig[i] != null ? v - sig[i] : 0; });
    const todos = linha.concat(hist).concat(sig.filter(function (v) { return v != null; }));
    const mx = Math.max.apply(null, todos.map(Math.abs)) || 1;
    const bw = (W - padR) / hist.length, mid = y0 + hh / 2;
    const esc = function (v) { return mid - (v / mx) * (hh / 2 - 12); };
    svg.appendChild(el('line', { x1: 0, x2: W - padR, y1: mid, y2: mid, stroke: '#2a3a44' }));
    hist.forEach(function (v, i) {
      svg.appendChild(el('rect', { x: i * bw + 1, y: v >= 0 ? esc(v) : mid, width: Math.max(1, bw - 2),
        height: Math.max(1, Math.abs(esc(v) - mid)), fill: v >= 0 ? '#18e34d' : '#ff343d', opacity: .85 }));
    });
    let dm = '', ds = '', im = false, is = false;
    linha.forEach(function (v, i) { const X = i * bw + bw / 2; dm += (im ? ' L ' : 'M ') + X + ' ' + esc(v); im = true; });
    sig.forEach(function (v, i) { if (v == null) return; const X = i * bw + bw / 2; ds += (is ? ' L ' : 'M ') + X + ' ' + esc(v); is = true; });
    if (dm) svg.appendChild(el('path', { d: dm, fill: 'none', stroke: '#e7edf1', 'stroke-width': 1.5 }));
    if (ds) svg.appendChild(el('path', { d: ds, fill: 'none', stroke: '#ffd400', 'stroke-width': 1.4, 'stroke-dasharray': '4 3' }));
    [['#18e34d', 'Histograma (+)'], ['#ff343d', 'Histograma (−)'], ['#e7edf1', 'MACD'], ['#ffd400', 'Sinal']]
      .forEach(function (par, k) {
        const X = 6 + k * 96;
        svg.appendChild(el('circle', { cx: X, cy: y0 + 8, r: 3.2, fill: par[0] }));
        svg.appendChild(txt({ x: X + 7, y: y0 + 11, fill: '#96a5ad', 'font-size': 8.5 }, par[1]));
      });
    svg.appendChild(txt({ x: W - padR + 6, y: mid + 3, fill: '#96a5ad', 'font-size': 8, 'font-family': 'monospace' },
      cfg.rapida + '/' + cfg.lenta + '/' + cfg.sinal));
    y0 += hh;
    faixa += 1;
    hh = alturas[faixa] || hh;
  }
  if (mostrarRsi) {
    const r = rsi(pts, cfg.rsi);
    const yy = v => y0 + hh - 8 - (v / 100) * (hh - 16);
    [30, 50, 70].forEach(nv => {
      svg.appendChild(el('line', { x1: 0, x2: W - padR, y1: yy(nv), y2: yy(nv), stroke: '#162832', 'stroke-dasharray': nv === 50 ? '' : '3 3' }));
      svg.appendChild(txt({ x: W - padR + 6, y: yy(nv) + 3, fill: '#96a5ad', 'font-size': 8, 'font-family': 'monospace' }, String(nv)));
    });
    let dd = '', ini = false;
    r.forEach((v, i) => { if (v == null) return; dd += (ini ? ' L ' : 'M ') + (i * (W - padR)) / (r.length - 1) + ' ' + yy(v); ini = true; });
    if (dd) svg.appendChild(el('path', { d: dd, fill: 'none', stroke: '#c88bff', 'stroke-width': 1.4 }));
    svg.appendChild(txt({ x: 4, y: y0 + 10, fill: '#96a5ad', 'font-size': 8.5, 'font-family': 'monospace' }, 'RSI ' + cfg.rsi));
  }
}

/* ---------- RADAR ---------- */
function renderRadar() {
  const box = document.getElementById('radar');
  let jogos = [];
  try {
    if (window.Real && typeof window.Real.gradeJogos === 'function')
      jogos = window.Real.gradeJogos().filter(j => j && j.resolvido);
  } catch (e) {}
  if (!jogos.length) {
    box.innerHTML = '<div class="radar-row"><div class="radar-txt">' +
      '<div class="t"><b>Aguardando dados reais da grade…</b></div>' +
      '</div></div>';
    return;
  }

  const mercados = [
    ['Over 3.5', 'Over 3.5'],
    ['Ambas Marcam', 'Ambas Marcam (Sim)'],
    ['Over 2.5', 'Over 2.5'],
    ['5+ Gols', '5+ Gols']
  ];
  box.innerHTML = mercados.map(([rotulo, mercado]) => {
    const seq = jogos.map(j => pagou(mercado, j));
    const pagos = seq.filter(Boolean).length;
    const meio = Math.max(1, Math.floor(seq.length / 2));
    const antiga = seq.slice(0, meio);
    const recente = seq.slice(meio);
    const pAntiga = antiga.filter(Boolean).length / antiga.length * 100;
    const pRecente = recente.length
      ? recente.filter(Boolean).length / recente.length * 100 : pAntiga;
    const delta = pRecente - pAntiga;
    const classe = delta > 3 ? 'up' : delta < -3 ? 'min' : 'brk';
    const icone = delta > 3 ? '↗' : delta < -3 ? '↘' : '→';
    const ultimos = seq.slice(-6).map((ok, i) =>
      (ok ? '🟢' : '🔴') + ' ' + pad(jogos.slice(-6)[i].minuto)
    ).join('  ');
    return `<div class="radar-row"><div class="radar-ico ${classe}">${icone}</div>
      <div class="radar-txt"><div class="t"><b>${state.liga} · ${rotulo}</b> —
      ${(pagos / seq.length * 100).toFixed(1)}% (${pagos}/${seq.length}) ·
      ${delta > 3 ? 'subindo' : delta < -3 ? 'caindo' : 'estável'}</div>
      <div class="radar-last">Últimos reais: ${ultimos}</div></div></div>`;
  }).join('');
}

/* ---------- FITA ---------- */
function renderFita() {
  document.getElementById('fita').innerHTML =
    resultados(26).map(r => `<span class="${r === 'G' ? 'g' : 'r'}">${r}</span>`).join('');
}

/* ---------- BACKTEST ---------- */
function renderBacktest() {
  document.getElementById('backtest').innerHTML =
    '<tr><td colspan="7" style="text-align:center;color:var(--muted)">' +
    'Aguardando jogos reais da API…</td></tr>';
}

/* ---------- GRADE ---------- */
const GRUPOS_MERCADO = [
  ['Over', ['Over 0.5', 'Over 1.5', 'Over 2.5', 'Over 3.5']],
  ['Primeiro tempo', ['OUT HT', 'Over 0.5 HT', 'Empate HT', 'Casa HT', 'Fora HT', 'Viradinha HT→FT']],
  ['Under', ['Under 0.5', 'Under 1.5', 'Under 2.5', 'Under 3.5']],
  ['Indicadores', ['Total Gols (FT)', 'Gols Casa (FT)', 'Gols Fora (FT)']],
  ['Ambas marcam', ['Ambas Marcam (Sim)', 'Ambas Marcam (N\u00e3o)']],
  ['Gols exatos 2\u00ba Tempo', ['0 gol / 2\u00ba tempo', '1 gol / 2\u00ba tempo', '2 gols / 2\u00ba tempo', '3 gols / 2\u00ba tempo', '4 gols / 2\u00ba tempo']],
  ['Gols exatos', ['0 Gol', '1 Gol', '2 Gols', '3 Gols', '4 Gols', '5+ Gols']],
  ['Resultado FT', ['Casa FT', 'Empate FT', 'Fora FT']],
  ['Resultado/Ambos Marcam', ['Casa/Fora e Sim', 'Casa e Sim', 'Casa e N\u00e3o', 'Fora e Sim', 'Fora e N\u00e3o', 'Empate e Sim', 'Empate e N\u00e3o']],
  ['Total Gols \u2014 Casa', ['Casa 0 Gols', 'Casa 1 Gol', 'Casa 2 Gols', 'Casa 3 Gols', 'Casa 4 Gols']],
  ['Total Gols \u2014 Fora', ['Fora 0 Gols', 'Fora 1 Gol', 'Fora 2 Gols', 'Fora 3 Gols', 'Fora 4 Gols']],
  ['Placar \u2014 Casa', ['Casa 1-0','Casa 2-0','Casa 2-1','Casa 3-0','Casa 3-1','Casa 3-2','Casa 4-0']],
  ['Placar \u2014 Empate', ['Empate 0-0','Empate 1-1','Empate 2-2','Empate 3-3']],
  ['Placar \u2014 Visitante', ['Visitante 0-1','Visitante 0-2','Visitante 1-2','Visitante 0-3','Visitante 1-3','Visitante 2-3','Visitante 0-4']],
  ['Placar \u2014 Qualquer', ['Qualquer 1-0','Qualquer 2-0','Qualquer 2-1','Qualquer 3-0','Qualquer 3-1','Qualquer 3-2','Qualquer 4-0']],
];
const MERCADOS_GRADE = GRUPOS_MERCADO.flatMap(g => g[1]);

/* O jogo pagou o mercado?
   j = { gh, ga, hh, ha } — placar final e do intervalo. */
function pagou(mkt, j) {
  const t = j.gh + j.ga;
  const temHtNumerico = j.hh !== null && j.hh !== undefined && j.ha !== null && j.ha !== undefined &&
    Number.isFinite(Number(j.hh)) && Number.isFinite(Number(j.ha));
  const ht = temHtNumerico ? Number(j.hh) + Number(j.ha) : NaN;
  const st = temHtNumerico ? (j.gh - Number(j.hh)) + (j.ga - Number(j.ha)) : NaN;   /* gols do 2o tempo */
  const htOut = String(j.placarHT || j.resultado_ht || j.HT || j.ht || '').trim().toUpperCase() === 'OUT';
  const casa = j.gh > j.ga, fora = j.ga > j.gh, empate = j.gh === j.ga;
  const ambas = j.gh > 0 && j.ga > 0;
  switch (mkt) {
    case 'Over 0.5': return t >= 1;
    case 'Over 1.5': return t >= 2;
    case 'Over 2.5': return t >= 3;
    case 'Over 3.5': return t >= 4;
    case 'OUT HT': return htOut || (Number.isFinite(ht) && ht >= 3);
    case 'Over 0.5 HT': return Number.isFinite(ht) && ht >= 1;
    case 'Empate HT': return temHtNumerico && Number(j.hh) === Number(j.ha);
    case 'Casa HT': return temHtNumerico && Number(j.hh) > Number(j.ha);
    case 'Fora HT': return temHtNumerico && Number(j.ha) > Number(j.hh);
    case 'Viradinha HT→FT':
      return temHtNumerico &&
        ((Number(j.hh) > Number(j.ha) && j.ga > j.gh) ||
         (Number(j.ha) > Number(j.hh) && j.gh > j.ga));
    case 'Under 0.5': return t < 1;
    case 'Under 1.5': return t < 2;
    case 'Under 2.5': return t < 3;
    case 'Under 3.5': return t < 4;
    /* indicadores: destacam o jogo acima da media da liga */
    case 'Total Gols (FT)': return t >= 3;
    case 'Gols Casa (FT)': return j.gh >= 2;
    case 'Gols Fora (FT)': return j.ga >= 2;
    case 'Ambas Marcam (Sim)': return ambas;
    case 'Ambas Marcam (N\u00e3o)': return !ambas;
    case 'Casa FT': return casa;
    case 'Empate FT': return empate;
    case 'Fora FT': return fora;
    case 'Casa/Fora e Sim': return !empate && ambas;
    case 'Casa e Sim': return casa && ambas;
    case 'Casa e N\u00e3o': return casa && !ambas;
    case 'Fora e Sim': return fora && ambas;
    case 'Fora e N\u00e3o': return fora && !ambas;
    case 'Empate e Sim': return empate && ambas;
    case 'Empate e N\u00e3o': return empate && !ambas;
    case '5+ Gols': return t >= 5;
    default: {
      let m = mkt.match(/^(\d) gols? \/ 2\u00ba tempo$/); if (m) return st === +m[1];
      m = mkt.match(/^(\d) Gols?$/); if (m) return t === +m[1];
      m = mkt.match(/^Casa (\d) Gols?$/); if (m) return j.gh === +m[1];
      m = mkt.match(/^Fora (\d) Gols?$/); if (m) return j.ga === +m[1];
      m = mkt.match(/^(Casa|Empate|Visitante|Qualquer) (\d)-(\d)$/);
      if (m) {
        const a = +m[2], b = +m[3];
        if (m[1] === 'Qualquer') return (j.gh === a && j.ga === b) || (j.gh === b && j.ga === a);
        return j.gh === a && j.ga === b;
      }
      return t >= 3;
    }
  }
}

function mercadosSelecionadosGrafico() {
  if (state.modoMercadosGrafico !== 'varios') {
    state.mercadosGrafico = [state.mercado];
    return state.mercadosGrafico;
  }
  const lista = Array.isArray(state.mercadosGrafico)
    ? state.mercadosGrafico.filter(m => typeof m === 'string' && m.trim()) : [];
  if (!lista.includes(state.mercado)) lista.unshift(state.mercado);
  state.mercadosGrafico = [...new Set(lista)].slice(0, 6);
  return state.mercadosGrafico;
}
function menuHTML(sel, multiplos) {
  const marcados = multiplos ? mercadosSelecionadosGrafico() : [sel];
  return GRUPOS_MERCADO.map(([titulo, itens]) =>
    `<div class="mkt-grupo">${titulo}</div>` +
    itens.map(m => `<button class="${marcados.includes(m) ? 'on' : ''}" data-m="${m}" aria-pressed="${marcados.includes(m)}">${multiplos ? `<span class="cx ${marcados.includes(m) ? 'm' : ''}"></span>` : ''}${m}</button>`).join('')
  ).join('');
}
function renderMenuChart() {
  const selecionados = mercadosSelecionadosGrafico();
  document.getElementById('cmktMenu').innerHTML =
    '<div class="mkt-select-mode" role="group" aria-label="Modo de seleção">' +
      `<button type="button" data-chart-select-mode="fixo" class="${state.modoMercadosGrafico === 'fixo' ? 'active' : ''}">Fixo</button>` +
      `<button type="button" data-chart-select-mode="varios" class="${state.modoMercadosGrafico === 'varios' ? 'active' : ''}">Vários</button>` +
    '</div>' +
    `<div class="mkt-multi-help">${state.modoMercadosGrafico === 'fixo'
      ? 'Clique para trocar o mercado atual'
      : 'Marque até 6 mercados para comparar'}</div>` +
    menuHTML(state.mercado, state.modoMercadosGrafico === 'varios');
  document.getElementById('cmktBtn').textContent = state.modoMercadosGrafico === 'varios' && selecionados.length > 1
    ? 'Mercados: ' + selecionados.length + ' selecionados \u2304'
    : 'Mercado: ' + state.mercado + ' \u2304';
  document.getElementById('cmktBtn').title = selecionados.join(' + ');
}
function renderMenuMercados() {
  document.getElementById('mktMenu').innerHTML = menuHTML(state.gradeMercado);
  document.getElementById('mktBtn').textContent = 'Mercado: ' + state.gradeMercado + ' \u2304';
}

function modoGradeDesde00() {
  const ativo = document.querySelector('#horas .active');
  return !!ativo && /^0*0\s*h/i.test((ativo.textContent || '').trim());
}

function renderGrade() {
  const linhasMarcadasAntes = [...document.querySelectorAll(
    '#grade .hour-label input[type="checkbox"]'
  )].map(input => input.checked);
  const LIGACFG = { Copa:{ini:1,passo:3,cols:20}, Super:{ini:1,passo:3,cols:20},
    Euro:{ini:2,passo:3,cols:20}, Premier:{ini:0,passo:3,cols:20}, Express:{ini:0,passo:1,cols:60} };
  const LG = LIGACFG[state.liga] || LIGACFG.Super;
  const COLS = LG.cols;
  const mkt = state.gradeMercado;
  /* Lente HT: avalia e mostra o placar do intervalo. */
  const lente = function (j) { return j; };
  const rng = makeRng(seedOf('grade' + state.liga + state.horas));
  const rank = rankMap();
  const agora = new Date().getHours();

  /* 1) gera os jogos (independente do mercado, como na vida real) */
  const linhas = [];
  /* Nos intervalos comuns há uma linha extra para o jogo em curso. No modo
     00h, state.horas já é "hora atual + 1" e portanto já inclui essa linha.
     Criar outra fazia nascer 23h/22h do dia anterior e exigia escondê-las
     depois, causando a grade alternar visualmente durante cada repintura. */
  const fimLinhas = state.horas - (modoGradeDesde00() ? 1 : 0);
  for (let h = -1; h < fimLinhas; h++) {
    const cel = [];
    for (let c = 0; c < COLS; c++) {
      const a = pick(rng, TIMES);
      let b = pick(rng, TIMES);
      if (b === a) b = TIMES[(TIMES.indexOf(a) + 1) % TIMES.length];
      const gh = poisson(rng), ga = poisson(rng);
      const od = {};
      ODDS_LISTA.forEach(function (p) { od[p[0]] = (100 / normalDe(p[1]) * (0.88 + rng() * 0.26)).toFixed(2); });
      cel.push({ a, b, gh, ga, od,
        hh: Math.min(gh, poisson(rng, 0.55)), ha: Math.min(ga, poisson(rng, 0.55)),
        o: [(1.62 + rng() * .3).toFixed(2), (1.80 + rng() * .3).toFixed(2), (2.00 + rng() * .3).toFixed(2)] });
    }
    linhas.push({ hora: (agora - h + 24) % 24, pendente: h === -1, cel });
  }

  /* 2) por coluna: % do minuto na liga e total de gols */
  const resolvidas = linhas.filter(l => !l.pendente);
  const colPct = [], colGols = [], colGreens = [];
  for (let c = 0; c < COLS; c++) {
    let pag = 0, g = 0;
    for (const l of resolvidas) {
      const j = l.cel[c];
      g += j.gh + j.ga;
      if (pagou(mkt, lente(j))) pag++;
    }
    colPct.push(resolvidas.length ? Math.round((pag / resolvidas.length) * 100) : 0);
    colGols.push(g);
    colGreens.push(pag);
  }

  /* 3) desenha */
  const tmpl = `grid-template-columns:64px repeat(${COLS},minmax(${COLS>20?'78px':'0'},1fr))`;
  const classePct = p => (p >= 50 ? 'alta' : p >= 30 ? 'media' : 'baixa');
  let html = '';
  html += `<div class="grid-headrow grid-order-row" style="${tmpl}"><div class="gh lead">COL</div>${
    Array.from({ length: COLS }, (_, i) => `<div class="gh order">${i + 1}</div>`).join('')}</div>`;
  html += `<div class="grid-headrow" style="${tmpl}"><div class="gh lead">MIN</div>${
    Array.from({ length: COLS }, (_, i) => `<div class="gh">${pad((LG.ini + i * LG.passo) % 60)}</div>`).join('')}</div>`;
  html += `<div class="grid-headrow" style="${tmpl}"><div class="gh lead">%</div>${
    colPct.map((p, i) => `<div class="gh col ${classePct(p)}" data-col="${i}" title="clique para somar">${p}%</div>`).join('')}</div>`;
  html += `<div class="grid-headrow" style="${tmpl}"><div class="gh lead">GOLS</div>${
    colGols.map(g => `<div class="gh gols">${g}</div>`).join('')}</div>`;
  html += `<div class="grid-headrow grid-greens-row" style="${tmpl}"><div class="gh lead">GREEN</div>${
    colGreens.map(g => `<div class="gh greens">${g}</div>`).join('')}</div>`;

  let totGols = 0, totJogos = 0;
  let indiceLinha = 0;
  for (const l of linhas) {
    const linhaMarcada = linhasMarcadasAntes[indiceLinha++] !== false;
    html += `<div class="hour-label"><input type="checkbox"${linhaMarcada ? ' checked' : ''}><span class="hour-text">${pad(l.hora)}h</span>${
      l.pendente ? ' <span class="hour-status" style="color:var(--blue)">· em curso</span>' : ''}</div>`;
    html += `<div class="gridrow" style="${tmpl}"><div class="row-pct" aria-label="Porcentagem da linha">—</div>`;
    let ci = -1;
    for (const j of l.cel) {
      ci++;
      totGols += j.gh + j.ga; totJogos++;
      const cls = l.pendente ? 'neutral' : pagou(mkt, lente(j)) ? 'pay' : 'nopay';
      html += `<div class="match ${cls}" data-col="${ci}">
        <div class="teams" ${state.mostrarTime ? '' : 'hidden'}>
          <span class="tm" data-team="${j.a}">${j.a} <i class="rk">(${rank[j.a]})</i></span>
          <span class="tm" data-team="${j.b}">${j.b} <i class="rk">(${rank[j.b]})</i></span>
        </div>
        ${state.ht || l.pendente ? '<div class="htline">' + (l.pendente ? 'A SAIR' : 'HT ' + j.hh + '-' + j.ha) + '</div>' : ''}
        <div class="score">${l.pendente ? '\u2014' : j.gh + '-' + j.ga}</div>
        <div class="odds">${state.odds.map(function(o){
          /*
           * A grade real é a única fonte das odds. Até a API preencher o card,
           * mostramos apenas o rótulo — nunca uma cotação simulada.
           */
          return '<span class="od" data-rot="'+o+'">'+o+'</span>';
        }).join('<br>')}</div></div>`;
    }
    html += '</div>';
  }

  colPctAtual = colPct;
  document.getElementById('grade').innerHTML = html;
  document.getElementById('gGols').textContent = totGols;
  document.getElementById('gMedia').textContent = (totGols / totJogos).toFixed(2);
  document.getElementById('gradeTitle').textContent = 'Grade de jogos \u2014 ' + mkt;
  let pagTot = 0, jogTot = 0;
  resolvidas.forEach(function (l) { l.cel.forEach(function (j) { jogTot++; if (pagou(mkt, lente(j))) pagTot++; }); });
  const bd = document.getElementById('pctMercado');
  if (bd) bd.innerHTML = mkt
    + ' — <b style="color:var(--green)">' + (jogTot ? Math.round(pagTot / jogTot * 100) : 0) + '%</b> pagando · '
    + jogTot + ' jogos · ' + state.horas + 'h';
  renderMenuMercados();
  aplicarSelecao();
  renderAlertaTimes();
  if (window.Real && typeof window.Real.pintar === 'function') {
    setTimeout(window.Real.pintar, 0);
  }
}

/* Marca todos os iguais ao que foi clicado. */
function chaveSelecaoOdd(el) {
  if (!el || !el.dataset.odd) return null;
  const rotulo = (el.dataset.rot ||
    (el.textContent || '').split('@')[0]).trim().toUpperCase();
  return rotulo ? rotulo + '|' + el.dataset.odd : null;
}

function aplicarSelecao() {
  const box = document.getElementById('grade');
  /* A grade real tem um único controlador multi-seleção em maxima.js. */
  if (window.RankingGradeReal &&
      typeof window.RankingGradeReal.aplicarMarcacao === 'function') {
    if (box.querySelector('.match[data-real="1"]'))
      window.RankingGradeReal.aplicarMarcacao();
    return;
  }
  box.querySelectorAll('.match').forEach(m => m.classList.remove('hit'));
  box.querySelectorAll('.tm,.od').forEach(s => {
    const chave = s.classList.contains('tm') ? s.dataset.team : chaveSelecaoOdd(s);
    const on = s.classList.contains('tm') ? sel.teams.has(chave) :
      (chave != null && sel.odds.has(chave));
    s.classList.toggle('sel', on);
    if (on) s.closest('.match').classList.add('hit');
  });
  box.querySelectorAll('[data-col]').forEach(e => e.classList.toggle('colsel', sel.cols.has(+e.dataset.col)));
  const bar = document.getElementById('selInfo');
  const itens = [...sel.teams, ...[...sel.odds].map(o => o.replace('|', ' @'))];
  const cols = [...sel.cols].sort((a, b) => a - b);
  const partes = [];
  if (itens.length) partes.push(`Marcados (${box.querySelectorAll('.match.hit').length} jogos): ${itens.map(i => `<b>${i}</b>`).join(' ')}`);
  if (cols.length) {
    const soma = cols.reduce((a, c) => a + (colPctAtual[c] || 0), 0);
    partes.push(`Colunas <b>${cols.map(c => pad(c + 1)).join(' + ')}</b> \u2192 soma <b>${soma}%</b> \u00b7 m\u00e9dia <b>${(soma / cols.length).toFixed(1)}%</b>`);
  }
  bar.innerHTML = partes.length
    ? partes.join(' \u2003 ') + ' <button class="chip" id="limparSel">limpar</button>'
    : '';
}

/* ---------- ALERTA DE TIME NA GRADE ---------- */
let alertasPausadosAte = Date.now() + 5000;
function alertaPodeDispararAgora() { return Date.now() >= alertasPausadosAte; }
function jogoAindaNaoComecou(jogo) {
  if (!jogo || jogo.resolvido) return false;
  const slot = Number(jogo.slot);
  let agora = null;
  try { agora = window.Real && typeof window.Real.agoraSlot === 'function' ? Number(window.Real.agoraSlot()) : null; } catch (e) {}
  return !Number.isFinite(slot) || !Number.isFinite(agora) || slot >= agora;
}
window.AMDAlertaPodeDisparar = alertaPodeDispararAgora;
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    alertasPausadosAte = Date.now() + 5000;
    resetarGDCross(); resetarAlertaMedias();
    alertaTimesInicializado = false;
  }
});
function normalizarNomeTime(nome) {
  return String(nome || '').trim().toLocaleLowerCase('pt-BR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function nomeTimeDaGrade(tm) {
  return String((tm && (tm.dataset.team || tm.title)) || '').trim();
}

function timeEstaVigiado(nome) {
  const chave = normalizarNomeTime(nome);
  return [...timesVigiados].some(item => normalizarNomeTime(item) === chave);
}

function salvarTimesVigiados() {
  try { localStorage.setItem(CHAVE_ALERTA_TIMES, JSON.stringify([...timesVigiados])); }
  catch (e) { /* armazenamento indisponivel */ }
}

function chaveAlertaJogo(jogo) {
  return [jogo && jogo.slot, normalizarNomeTime(jogo && jogo.timeA),
    normalizarNomeTime(jogo && jogo.timeB)].join('|');
}

function jogosAtuaisParaAlerta() {
  try {
    if (window.Real && typeof window.Real.gradeJogos === 'function')
      return window.Real.gradeJogos().filter(Boolean);
  } catch (e) {}
  return [...document.querySelectorAll('#grade .match[data-real="1"]')]
    .map(el => el.__realJogo).filter(Boolean);
}

function registrarJogosAtuaisDoTime(nome) {
  const chaveTime = normalizarNomeTime(nome);
  jogosAtuaisParaAlerta().forEach(jogo => {
    if (normalizarNomeTime(jogo.timeA) === chaveTime ||
        normalizarNomeTime(jogo.timeB) === chaveTime)
      jogosVistosAlertaTime.add(chaveAlertaJogo(jogo));
  });
}

function renderAlertaTimes() {
  const bar = document.getElementById('teamAlertBar');
  const botao = document.getElementById('teamAlertMode');
  const lista = document.getElementById('teamAlertList');
  if (botao) {
    botao.classList.toggle('on', modoEscolherTimeAlerta);
    botao.setAttribute('aria-pressed', modoEscolherTimeAlerta ? 'true' : 'false');
    botao.textContent = modoEscolherTimeAlerta
      ? '👉 Toque no time' : '🔔 Alertar time';
  }
  if (bar) bar.classList.toggle('choosing', modoEscolherTimeAlerta);
  if (lista) {
    lista.replaceChildren();
    if (!timesVigiados.size) {
      const vazio = document.createElement('span');
      vazio.className = 'team-alert-empty';
      vazio.textContent = 'Nenhum time vigiado';
      lista.appendChild(vazio);
    } else {
      [...timesVigiados].forEach(nome => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'team-alert-chip';
        chip.dataset.removeTeamAlert = nome;
        chip.title = 'Remover alerta de ' + nome;
        chip.textContent = '🔔 ' + nome + ' ×';
        lista.appendChild(chip);
      });
    }
  }
  document.querySelectorAll('#grade .tm').forEach(tm => {
    const vigiado = timeEstaVigiado(nomeTimeDaGrade(tm));
    tm.classList.toggle('team-watch', vigiado);
    if (vigiado) tm.setAttribute('data-team-watch', '1');
    else tm.removeAttribute('data-team-watch');
  });
}

function alternarAlertaDoTime(nome) {
  nome = String(nome || '').trim();
  if (!nome) return;
  let existente = null;
  timesVigiados.forEach(item => {
    if (normalizarNomeTime(item) === normalizarNomeTime(nome)) existente = item;
  });
  if (existente) {
    timesVigiados.delete(existente);
    mostrarAviso('🔕 Alerta removido: ' + existente);
  } else {
    timesVigiados.add(nome);
    registrarJogosAtuaisDoTime(nome);
    desbloquearAlertasSonoros();
    habilitarAlertasDeFundo();
    mostrarAviso('🔔 ' + nome + ' será avisado quando aparecer na grade');
  }
  modoEscolherTimeAlerta = false;
  salvarTimesVigiados();
  renderAlertaTimes();
}

function notificarTimeEncontrado(nome, jogo) {
  const horario = Number.isFinite(Number(jogo.hora)) && Number.isFinite(Number(jogo.minuto))
    ? pad(Number(jogo.hora)) + ':' + pad(Number(jogo.minuto)) : 'novo jogo';
  const confronto = String(jogo.timeA || '') + ' x ' + String(jogo.timeB || '');
  mostrarAviso('🔔 ' + nome + ' apareceu: ' + confronto + ' · ' + horario);
  if (somDeAlertaLigado()) {
    bip();
    setTimeout(bip, 420);
  }
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opcoes = {
    body: confronto + ' · ' + horario + ' · ' + String(state.liga || ''),
    tag: 'amd-time-' + chaveAlertaJogo(jogo),
    renotify: true,
    requireInteraction: true,
    data: { url: '/index.html' }
  };
  registrarAlertasDeFundo().then(reg => {
    if (reg && typeof reg.showNotification === 'function')
      return reg.showNotification('⚽ Time encontrado: ' + nome, opcoes);
    try { return new Notification('⚽ Time encontrado: ' + nome, opcoes); }
    catch (e) { return null; }
  }).catch(() => {});
}

function verificarAlertasDeTime() {
  const todos = jogosAtuaisParaAlerta().filter(Boolean);
  if (!alertaTimesInicializado) {
    todos.forEach(jogo => jogosVistosAlertaTime.add(chaveAlertaJogo(jogo)));
    alertaTimesInicializado = true;
    renderAlertaTimes();
    return;
  }
  const jogos = todos.filter(jogo => jogoAindaNaoComecou(jogo));
  jogos.forEach(jogo => {
    const chaveJogo = chaveAlertaJogo(jogo);
    if (jogosVistosAlertaTime.has(chaveJogo)) return;
    jogosVistosAlertaTime.add(chaveJogo);
    const encontrados = [...timesVigiados].filter(nome => {
      const chave = normalizarNomeTime(nome);
      return chave === normalizarNomeTime(jogo.timeA) ||
        chave === normalizarNomeTime(jogo.timeB);
    });
    encontrados.forEach(nome => notificarTimeEncontrado(nome, jogo));
  });
  renderAlertaTimes();
}

/* ---------- RELÓGIO ---------- */
let restante = 103;
function tick() {
  const d = new Date();
  document.getElementById('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (!hoverGrafico.ativo && (!geo || (!geo.comparativo && (!geo.meta || !geo.meta.length))))
    document.getElementById('iHora').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  restante--;
  if (restante < 0) { restante = 180; renderChart(); renderKpis(); }
  document.getElementById('kTimer').textContent = `00:${pad(Math.floor(restante / 60))}:${pad(restante % 60)}`;
}

/* ---------- ALERTA DE MERCADO ---------- */
let alertaAtivo = false;
let contextoAudioAlertas = null;
let registroAlertasFundo = null;
let ultimaAmostraFib50 = null;
const estadoAlertaFib50 = { armado: false, contexto: '', anterior: null };

function obterContextoAudioAlertas() {
  if (contextoAudioAlertas && contextoAudioAlertas.state !== 'closed')
    return contextoAudioAlertas;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try { contextoAudioAlertas = new AudioCtx(); } catch (e) { contextoAudioAlertas = null; }
  return contextoAudioAlertas;
}

function desbloquearAlertasSonoros() {
  const ac = obterContextoAudioAlertas();
  if (ac && ac.state === 'suspended') {
    const retomada = ac.resume();
    if (retomada && typeof retomada.catch === 'function') retomada.catch(() => {});
  }
}

function registrarAlertasDeFundo() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!registroAlertasFundo) {
    registroAlertasFundo = navigator.serviceWorker.register('/sw-alertas.js?v=20260815a', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return registroAlertasFundo;
}

function habilitarAlertasDeFundo() {
  registrarAlertasDeFundo();
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    const permissao = Notification.requestPermission();
    if (permissao && typeof permissao.catch === 'function') permissao.catch(() => {});
  } catch (e) { /* navegador sem permissão: o áudio continua disponível */ }
}

function notificarGDCross(tipo, liga, horario) {
  if (!alertaPodeDispararAgora()) return;
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const golden = tipo === 'golden';
  const titulo = golden ? '🏆 GOLDEN CROSS' : '💀 DEATH CROSS';
  const texto = textoAlertaGDCross(tipo, liga, horario).replace(/\.\s*$/, '');
  const opcoes = {
    body: texto,
    tag: 'amd-gdcross-' + tipo + '-' + String(liga || state.liga || '') + '-' +
      String(horario || ''),
    renotify: true,
    requireInteraction: true,
    data: { url: '/index.html' }
  };
  registrarAlertasDeFundo().then(reg => {
    if (reg && typeof reg.showNotification === 'function') return reg.showNotification(titulo, opcoes);
    try { return new Notification(titulo, opcoes); } catch (e) { return null; }
  }).catch(() => {});
}

function atualizarBotaoFib50() {
  const botao = document.getElementById('fib50Alert');
  const status = document.getElementById('fib50AlertStatus');
  if (!botao || !status) return;
  botao.classList.toggle('armed', estadoAlertaFib50.armado);
  botao.setAttribute('aria-pressed', estadoAlertaFib50.armado ? 'true' : 'false');
  botao.textContent = estadoAlertaFib50.armado
    ? '⏳ Fib 50% armado · cancelar'
    : '📐 Alertar rompimento Fib 50%';
  status.classList.toggle('armed', estadoAlertaFib50.armado);
  status.textContent = estadoAlertaFib50.armado
    ? 'Ativo · aguardando um novo cruzamento real'
    : 'Desativado · avisa no próximo cruzamento';
}

function notificarRompimentoFib50(amostra, direcao) {
  if (!alertaPodeDispararAgora()) return;
  const sentido = direcao === 'alta' ? 'PARA CIMA' : 'PARA BAIXO';
  const horario = amostra.horario || document.getElementById('iHora').textContent || '--:--';
  const texto = '📐 FIB 50% ROMPEU ' + sentido + ' · ' + amostra.liga + ' · ' +
    amostra.mercado + ' · ' + amostra.valorTexto + ' cruzou ' + amostra.nivelTexto +
    ' · ' + horario;
  mostrarAviso(texto);
  bip();
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opcoes = {
    body: texto,
    tag: 'amd-fib50-' + String(amostra.contexto || '') + '-' + String(amostra.chave || ''),
    renotify: true,
    requireInteraction: true,
    data: { url: '/index.html' }
  };
  registrarAlertasDeFundo().then(reg => {
    if (reg && typeof reg.showNotification === 'function')
      return reg.showNotification('📐 Rompimento Fibonacci 50%', opcoes);
    try { return new Notification('📐 Rompimento Fibonacci 50%', opcoes); }
    catch (e) { return null; }
  }).catch(() => {});
}

function processarAlertaFib50(amostra) {
  ultimaAmostraFib50 = amostra;
  if (!estadoAlertaFib50.armado) return;
  if (!estadoAlertaFib50.anterior || estadoAlertaFib50.contexto !== amostra.contexto) {
    estadoAlertaFib50.contexto = amostra.contexto;
    estadoAlertaFib50.anterior = amostra;
    atualizarBotaoFib50();
    return;
  }
  if (String(estadoAlertaFib50.anterior.chave || '') === String(amostra.chave || '')) return;
  if (!dadoDeAlertaRecente(amostra)) {
    estadoAlertaFib50.anterior = amostra;
    return;
  }
  const detector = window.AMDFib50Alert && window.AMDFib50Alert.detectarRompimento;
  const direcao = typeof detector === 'function'
    ? detector(estadoAlertaFib50.anterior, amostra) : '';
  estadoAlertaFib50.anterior = amostra;
  if (!direcao) return;
  estadoAlertaFib50.armado = false;
  atualizarBotaoFib50();
  notificarRompimentoFib50(amostra, direcao);
}

function alternarAlertaFib50() {
  if (estadoAlertaFib50.armado) {
    estadoAlertaFib50.armado = false;
    estadoAlertaFib50.anterior = null;
    atualizarBotaoFib50();
    mostrarAviso('📐 Alerta Fibonacci 50% desativado');
    return;
  }
  if (!ultimaAmostraFib50) {
    mostrarAviso('📐 Ainda não há dados no gráfico para armar a Fibonacci 50%');
    return;
  }
  estadoAlertaFib50.armado = true;
  estadoAlertaFib50.contexto = ultimaAmostraFib50.contexto;
  estadoAlertaFib50.anterior = ultimaAmostraFib50;
  desbloquearAlertasSonoros();
  habilitarAlertasDeFundo();
  atualizarBotaoFib50();
  mostrarAviso('📐 Fib 50% armado · aguardando o próximo rompimento real');
}

function bip() {
  if (!alertaPodeDispararAgora()) return;
  try {
    const ac = obterContextoAudioAlertas(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); setTimeout(() => { try { o.stop(); } catch (e) {} }, 260);
  } catch (e) { /* navegador bloqueou audio: segue com o aviso visual */ }
}
function tocarSireneGDCross() {
  if (!ligado('GDCROSS') || !somDeAlertaLigado()) return;
  try {
    const ac = obterContextoAudioAlertas(); if (!ac) return;
    if (ac.state === 'suspended') {
      const retomada = ac.resume();
      if (retomada && typeof retomada.then === 'function') {
        retomada.then(tocarSireneGDCross).catch(() => {});
      }
      return;
    }
    const o = ac.createOscillator(), g = ac.createGain();
    const inicio = ac.currentTime, fim = inicio + 5;
    o.type = 'sawtooth';
    o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(.0001, inicio);
    g.gain.linearRampToValueAtTime(.055, inicio + .04);
    g.gain.setValueAtTime(.055, fim - .05);
    g.gain.linearRampToValueAtTime(.0001, fim);
    for (let t = 0; t < 5; t += .64) {
      const comeco = inicio + t;
      const pico = Math.min(fim, comeco + .32);
      const volta = Math.min(fim, comeco + .64);
      o.frequency.setValueAtTime(620, comeco);
      o.frequency.linearRampToValueAtTime(960, pico);
      if (volta > pico) o.frequency.linearRampToValueAtTime(620, volta);
    }
    o.start(inicio);
    o.stop(fim);
    o.addEventListener('ended', () => {
      try { o.disconnect(); g.disconnect(); } catch (e) {}
    }, { once: true });
  } catch (e) { /* navegador bloqueou audio: segue com o aviso visual */ }
}
function textoAlertaGDCross(tipo, liga, horario) {
  const ligaAtual = liga || state.liga || '';
  if (window.GDCross && typeof window.GDCross.formatarAlerta === 'function')
    return window.GDCross.formatarAlerta(tipo, ligaAtual, horario);
  const cruzamento = tipo === 'golden' ? 'Golden Cross' : 'Death Cross';
  const frase = [nomeLigaAlerta(ligaAtual), cruzamento, String(horario || '').trim()]
    .filter(Boolean).join(' ');
  return frase + '. ' + frase + '.';
}
function falarAlertaGDCross(tipo, liga, horario) {
  if (!alertaPodeDispararAgora()) return;
  if (!ligado('GDCROSS') || !somDeAlertaLigado()) return;
  const texto = textoAlertaGDCross(tipo, liga, horario);
  notificarGDCross(tipo, liga, horario);
  let falou = false;
  if ('speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance === 'function') {
    try {
      window.speechSynthesis.cancel();
      const fala = new window.SpeechSynthesisUtterance(texto);
      fala.lang = 'pt-BR';
      fala.rate = .92;
      fala.pitch = 1;
      fala.volume = 1;
      window.speechSynthesis.speak(fala);
      falou = true;
    } catch (e) { /* se a voz falhar, usa a sirene abaixo */ }
  }
  /* Em segundo plano a API de voz pode aceitar a fala e ficar silenciosa.
     A sirene pelo AudioContext persistente funciona como segunda proteção. */
  if (!falou || document.hidden) tocarSireneGDCross();
}
function mostrarAviso(texto) {
  const a = document.getElementById('aviso');
  a.textContent = texto; a.hidden = false;
  clearTimeout(a._t); a._t = setTimeout(() => { a.hidden = true; }, 6000);
}
window.addEventListener('amd:market-low-alert', function (ev) {
  const d = ev && ev.detail ? ev.detail : {};
  if (!d.mercado || !Number.isFinite(Number(d.taxa))) return;
  mostrarAviso('🔔 ' + d.mercado + ' abaixo da média nas últimas 3h: ' +
    Number(d.taxa).toFixed(1) + '% · normal ' +
    Number(d.normal).toFixed(1) + '% · limite ' +
    Number(d.limite).toFixed(1) + '%');
  if (somDeAlertaLigado()) bip();
});
function checarAlerta(cur) {
  const on = document.getElementById('alOn');
  if (!on || !on.checked) { alertaAtivo = false; return; }
  const alvo = parseFloat(document.getElementById('alAlvo').value);
  const zsel = (document.getElementById('alZona') || {}).value || '';
  const z = geo ? zoneSignal(geo.pts) : null;
  const bateu = zsel ? (z && z.zona === zsel) : (!isNaN(alvo) && cur >= alvo);
  if (!zsel && isNaN(alvo)) return;
  if (bateu && !alertaAtivo) {
    alertaAtivo = true;
    mostrarAviso('\ud83d\udd14 ' + state.mercado + (zsel ? ' entrou na zona ' + zsel : ' atingiu ' + cur.toFixed(1) + '% (alvo ' + alvo + '%)'));
    bip();
  } else if (!bateu) alertaAtivo = false;
}

/* ---------- PREFERÊNCIAS ---------- */
const CHAVE = 'amdlive.prefs.v1';
let horaGrade00Conhecida = null;
function salvarPrefs() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({
      liga: state.liga, mercado: state.mercado,
      mercadosGrafico: mercadosSelecionadosGrafico(), gradeMercado: state.gradeMercado,
      modoMercadosGrafico: state.modoMercadosGrafico,
      horas: modoGradeDesde00() ? 0 : state.horas,
      horas00: modoGradeDesde00() ? state.horas : undefined,
      modo00: modoGradeDesde00(), qtd: state.qtd, visual: state.visual,
      hackerIA: ligado('Hacker IA'),
      mmAlerta: ligado('MM ALERTA'),
      overlays: [...document.querySelectorAll('#overlays .chip')]
        .filter(c => c.classList.contains('on') && c.textContent.trim() !== 'GDCROSS')
        .map(c => c.textContent.trim()),
      periodos: Object.assign({}, cfg),
    }));
  } catch (e) { /* modo privado: segue sem salvar */ }
}
function carregarPrefs() {
  let p; try { p = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return; }
  if (!p) return;
  if (p.periodos && typeof p.periodos === 'object') {
    Object.keys(PADRAO).forEach(k => {
      const valor = Number(p.periodos[k]);
      if (Number.isFinite(valor) && valor >= 1 && valor <= 99) cfg[k] = valor;
    });
  }
  const horasSalvas = Number(p.horas);
  /* Migra preferências antigas: no modo 00h era gravada a quantidade dinâmica
     (por exemplo 20), valor que não corresponde a nenhum botão de intervalo. */
  const modo00Salvo = p.modo00 === true || horasSalvas === 0 ||
    ([3, 6, 12, 24, 48].indexOf(horasSalvas) < 0 && horasSalvas > 0);
  const horas00Salvas = Number(p.horas00);
  const quantidade00Inicial = horas00Salvas >= 1 && horas00Salvas <= 24
    ? horas00Salvas : Math.min(new Date().getHours() + 1, 24);
  Object.assign(state, {
    liga: p.liga ?? state.liga, mercado: p.mercado ?? state.mercado,
    mercadosGrafico: Array.isArray(p.mercadosGrafico) && p.mercadosGrafico.length
      ? p.mercadosGrafico : [p.mercado ?? state.mercado],
    modoMercadosGrafico: p.modoMercadosGrafico === 'varios' ? 'varios' : 'fixo',
    gradeMercado: p.gradeMercado ?? state.gradeMercado,
    horas: modo00Salvo ? quantidade00Inicial : (p.horas ?? state.horas),
    qtd: p.qtd ?? state.qtd,
    visual: p.visual ?? state.visual,
  });
  const marcar = (id, valor) => {
    const box = document.getElementById(id); if (!box) return;
    box.querySelectorAll('.tab').forEach(t => {
      const igual = (t.dataset.v || t.textContent.trim()).replace(/^\S+\s/, '') === String(valor).replace(/^\S+\s/, '');
      t.classList.toggle('active', igual);
    });
  };
  marcar('leagues', state.liga); marcar('markets', state.mercado);
  marcar('qtd', state.qtd); marcar('horas', modo00Salvo ? '00h' : state.horas + 'h');
  marcar('visual', state.visual);
  if (Array.isArray(p.overlays)) {
    document.querySelectorAll('#overlays .chip').forEach(c => {
      const nome = c.textContent.trim();
      if (nome === 'GDCROSS') {
        c.classList.remove('on');
        c.setAttribute('aria-pressed', 'false');
        return;
      }
      if (nome === 'MM ALERTA') {
        const ativoMm = p.mmAlerta == null ? true : !!p.mmAlerta;
        c.classList.toggle('on', ativoMm);
        c.setAttribute('aria-pressed', ativoMm ? 'true' : 'false');
        return;
      }
      const ativo = nome === 'Hacker IA' && p.hackerIA == null
        ? true : (nome === 'Hacker IA' ? !!p.hackerIA : p.overlays.includes(nome));
      c.classList.toggle('on', ativo);
    });
  }
}

/* ---------- INIT ---------- */
function renderAll() { renderKpis(); renderChart(); renderRadar(); renderFita(); renderBacktest(); renderGrade(); }

const barra = document.createElement('div');
barra.className = 'selbar'; barra.id = 'selInfo';
document.getElementById('grade').before(barra);

const barraAlertaTime = document.createElement('div');
barraAlertaTime.className = 'team-alert-bar';
barraAlertaTime.id = 'teamAlertBar';
barraAlertaTime.innerHTML = '<button class="chip" id="teamAlertMode" type="button" aria-pressed="false">🔔 Alertar time</button>' +
  '<span class="team-alert-help">Marque um time e receba aviso quando surgir jogo novo:</span>' +
  '<span class="team-alert-list" id="teamAlertList"></span>';
barra.after(barraAlertaTime);
renderAlertaTimes();

document.getElementById('teamAlertMode').addEventListener('click', e => {
  modoEscolherTimeAlerta = !modoEscolherTimeAlerta;
  if (modoEscolherTimeAlerta) {
    desbloquearAlertasSonoros();
    habilitarAlertasDeFundo();
    mostrarAviso('Toque no nome do time que deseja vigiar');
  }
  renderAlertaTimes();
  e.currentTarget.blur();
});

document.getElementById('teamAlertList').addEventListener('click', e => {
  const botao = e.target.closest('[data-remove-team-alert]');
  if (!botao) return;
  alternarAlertaDoTime(botao.dataset.removeTeamAlert);
});

window.addEventListener('amd:grade-data', verificarAlertasDeTime);

bindTabs('leagues', v => {
    /* O zoom e o pan sobrevivem a troca de liga. Antes o reset da
       linha seguinte zerava tudo e voce perdia o enquadramento a
       cada troca. Guardo aqui e devolvo logo depois do reset. */
    var _zoomAnt = state.zoom;
    var _panAnt = state.panGrafico;
    var _ancAnt = state.ancoraGrafico;
    var _desAnt = (typeof desenhos !== 'undefined' && Array.isArray(desenhos))
      ? desenhos.slice() : null;
  resetarViewportGrafico(false, true);
    /* Devolve o enquadramento que o reset acima acabou de zerar. */
    state.zoom = _zoomAnt;
    state.panGrafico = _panAnt;
    state.ancoraGrafico = _ancAnt;
    var _sl = document.getElementById('zoom');
    if (_sl) _sl.value = String(_zoomAnt);
    if (_desAnt && typeof desenhos !== 'undefined' && Array.isArray(desenhos)) {
      desenhos.length = 0;
      for (var _k = 0; _k < _desAnt.length; _k++) desenhos.push(_desAnt[_k]);
      /* zerar esta marca impede que montarViewportGrafico apague os
         desenhos ao ver que o ultimo jogo mudou de liga. */
      state.ultimoJogoViewport = null;
    }
  state.liga = v.replace(/^\S+\s/, '');
  if (window.Real && typeof window.Real.trocarLiga === 'function')
    window.Real.trocarLiga(state.liga);
  renderAll();
});
bindTabs('markets', (v, btn) => {
  if (v === 'Placar Correto') { abrirPlacares(btn); return; }
  if (NORMAL[v] != null) { resetarViewportGrafico(false, true); state.mercado = v; if (MERCADOS_GRADE.includes(v)) state.gradeMercado = v; sel.teams.clear(); sel.odds.clear(); renderAll(); }
});
/* Janela de placares ancorada na aba Placar Correto. */
function abrirPlacares(btn) {
  const velho = document.getElementById('pcMenu');
  if (velho) { velho.remove(); return; }
  const m = document.createElement('div');
  m.id = 'pcMenu'; m.className = 'mktmenu';
  m.style.position = 'fixed'; m.style.zIndex = '90'; m.style.right = 'auto';
  m.innerHTML = GRUPOS_MERCADO.filter(g => g[0].indexOf('Placar') === 0)
    .map(([t, itens]) => `<div class="mkt-grupo">${t}</div>` +
      itens.map(x => `<button class="${x === state.gradeMercado ? 'on' : ''}" data-m="${x}">${x}</button>`).join('')).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(6, Math.min(innerWidth - 250, r.left)) + 'px';
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    resetarViewportGrafico(false, true);
    state.gradeMercado = b.dataset.m; state.mercado = b.dataset.m;
    m.remove(); renderKpis(); renderChart(); renderGrade();
  });
  setTimeout(() => document.addEventListener('click', function fora(ev) {
    if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', fora); }
  }), 0);
}
bindTabs('qtd', v => { resetarViewportGrafico(false, true); state.qtd = +v; renderKpis(); renderChart(); });
bindTabs('visual', v => { state.visual = v; renderChart(); });
function selecionarMercadoControle(mercado) {
  if (!mercado || !MERCADOS_GRADE.includes(mercado)) return;
  resetarViewportGrafico(false, true);
  state.mercado = mercado;
  state.gradeMercado = mercado;
  sel.teams.clear();
  sel.odds.clear();
  renderAll();
}
bindTabs('ft', v => {
  const nomes = {
    'Ambas S': 'Ambas Marcam (Sim)',
    'Ambas N': 'Ambas Marcam (Não)'
  };
  selecionarMercadoControle(nomes[v] || v);
});
bindTabs('ht', v => {
  state.ht = true;
  const botaoHt = document.getElementById('btnHT');
  if (botaoHt) {
    botaoHt.classList.add('on');
    botaoHt.textContent = 'HT ON';
  }
  // "Resultado HT" liga a exibicao do placar de intervalo. Os demais
  // botoes tambem mudam o calculo do grafico e da grade para o mercado HT.
  if (v === 'Resultado HT') renderGrade();
  else selecionarMercadoControle(v);
});
bindTabs('metric', v => { state.metrica = v; renderChart(); renderAuto(); });
bindTabs('horas', v => {
  state.horas = parseInt(v, 10);
      /* Faixa 00h: o texto do botao vira 0 no parseInt. Aqui esse 0
         e convertido em 'hora atual do jogo + 1', para a grade
         desenhar as linhas 00, 01 ... ate a hora corrente e parar.
         A hora vem do ultimo jogo carregado, nao do relogio do
         computador: o relogio do jogo corre adiantado, e o corte
         precisa ser o mesmo que aparece na grade. */
      if (state.horas === 0) {
        var hh = window.Real && typeof window.Real.horaAtual === 'function'
          ? window.Real.horaAtual() : null;
        if (!Number.isFinite(hh)) hh = horaGrade00Conhecida;
        /* Sem snapshot ainda, usa a hora local apenas como moldura provisoria.
           Nunca abre 24h inteiras: era isso que mostrava 23h anterior e fazia
           os futuros sumirem ate a primeira resposta da API. */
        if (!Number.isFinite(hh)) hh = new Date().getHours();
        state.horas = Math.min(hh + 1, 24);
      }
  renderGrade();
  if (window.Real && typeof window.Real.buscar === 'function')
    window.Real.buscar().then(window.Real.pintar);
});

/* Mantém a quantidade de linhas sincronizada quando o relógio virtual muda
   de hora, sem esconder/restaurar linhas durante a pintura dos cartões. */
window.addEventListener('amd:real-data', function (ev) {
  const detalhe = ev && ev.detail ? ev.detail : {};
  let hh = detalhe.horaAtual == null ? NaN : Number(detalhe.horaAtual);
  if (!Number.isFinite(hh) && window.Real &&
      typeof window.Real.horaAtual === 'function') hh = window.Real.horaAtual();
  if (!Number.isFinite(hh)) return;
  horaGrade00Conhecida = hh;
  if (!modoGradeDesde00()) return;
  const novaQuantidade = Math.min(hh + 1, 24);
  if (state.horas === novaQuantidade) return;
  state.horas = novaQuantidade;
  salvarPrefs();
  renderGrade();
});
bindTabs('overlays', (nome, botao) => {
  if (nome === 'GDCROSS') configurarGDCross(botao.classList.contains('on'), botao);
  if (nome === 'MM ALERTA') configurarAlertaMedias(botao.classList.contains('on'));
  renderChart();
});

document.getElementById('grade').addEventListener('click', e => {
  const timeAlerta = e.target.closest('.tm');
  if (modoEscolherTimeAlerta && timeAlerta) {
    e.preventDefault();
    e.stopImmediatePropagation();
    alternarAlertaDoTime(nomeTimeDaGrade(timeAlerta));
    return;
  }
  if (window.RankingGradeReal &&
      typeof window.RankingGradeReal.aplicarMarcacao === 'function') return;
  const c = e.target.closest('.gh.col');
  if (c) { const i = +c.dataset.col; sel.cols.has(i) ? sel.cols.delete(i) : sel.cols.add(i); aplicarSelecao(); return; }
  const t = e.target.closest('.tm'), o = e.target.closest('.od');
  if (t) { sel.teams.has(t.dataset.team) ? sel.teams.delete(t.dataset.team) : sel.teams.add(t.dataset.team); aplicarSelecao(); }
  else if (o) {
    const chave = chaveSelecaoOdd(o);
    if (!chave) return;
    sel.odds.has(chave) ? sel.odds.delete(chave) : sel.odds.add(chave);
    aplicarSelecao();
  }
}, true);
document.addEventListener('click', e => {
  if (e.target.id === 'limparSel') { sel.teams.clear(); sel.odds.clear(); sel.cols.clear(); aplicarSelecao(); }
  const menu = document.getElementById('mktMenu');
  const cmenu = document.getElementById('cmktMenu');
  const lmenu = document.getElementById('cligaMenu');
  if (e.target.id === 'mktBtn') {
    menu.hidden = !menu.hidden;
    cmenu.hidden = true;
    if (lmenu) lmenu.hidden = true;
    return;
  }
  if (e.target.id === 'cmktBtn') {
    cmenu.hidden = !cmenu.hidden;
    menu.hidden = true;
    if (lmenu) lmenu.hidden = true;
    return;
  }
  if (e.target.id === 'cligaBtn') {
    if (e.target.disabled || (window.GraficoReal &&
        typeof window.GraficoReal.modo === 'function' &&
        window.GraficoReal.modo() === 'ligas')) {
      if (lmenu) lmenu.hidden = true;
      return;
    }
    if (lmenu) lmenu.hidden = !lmenu.hidden;
    menu.hidden = true;
    cmenu.hidden = true;
    return;
  }
  const lopt = e.target.closest('#cligaMenu button');
  if (lopt) {
    resetarViewportGrafico(false, true);
    const novaLiga = lopt.dataset.liga;
    if (lmenu) lmenu.hidden = true;
    const troca = window.Real && typeof window.Real.trocarLiga === 'function'
      ? window.Real.trocarLiga(novaLiga)
      : Promise.resolve(window.definirLigaApp(novaLiga));
    Promise.resolve(troca).then(() => {
      if (window.GraficoReal) window.GraficoReal.atualizar(false);
    });
    return;
  }
  const opt = e.target.closest('#mktMenu button');
  if (opt) {
    resetarViewportGrafico(false, true);
    state.gradeMercado = opt.dataset.m;
    state.mercado = opt.dataset.m;
    menu.hidden = true;
    renderKpis(); renderGrade(); renderChart();
    if (window.GraficoReal) window.GraficoReal.atualizar();
    return;
  }
  const seletorModo = e.target.closest('#cmktMenu [data-chart-select-mode]');
  if (seletorModo) {
    state.modoMercadosGrafico = seletorModo.dataset.chartSelectMode === 'varios'
      ? 'varios' : 'fixo';
    if (state.modoMercadosGrafico === 'fixo') {
      state.mercadosGrafico = [state.mercado];
      renderChart();
    }
    renderMenuChart();
    salvarPrefs();
    return;
  }
  const copt = e.target.closest('#cmktMenu button[data-m]');
  if (copt) {
    resetarViewportGrafico(false, true);
    const escolhido = copt.dataset.m;
    if (state.modoMercadosGrafico === 'fixo') {
      state.mercado = escolhido;
      state.gradeMercado = escolhido;
      state.mercadosGrafico = [escolhido];
      cmenu.hidden = true;
      renderMenuChart();
      renderKpis(); renderGrade(); renderChart();
      salvarPrefs();
      if (window.GraficoReal) window.GraficoReal.atualizar();
      return;
    }
    const atuais = mercadosSelecionadosGrafico();
    const indice = atuais.indexOf(escolhido);
    if (indice >= 0 && atuais.length > 1) {
      atuais.splice(indice, 1);
      if (state.mercado === escolhido) state.mercado = atuais[0];
    } else if (indice < 0 && atuais.length < 6) {
      atuais.push(escolhido);
      state.mercado = escolhido;
    } else if (indice < 0) {
      mostrarAviso('Máximo de 6 mercados no mesmo gráfico para manter a leitura clara.');
    }
    state.mercadosGrafico = atuais;
    state.gradeMercado = state.mercado;
    renderMenuChart();
    renderKpis(); renderGrade(); renderChart();
    salvarPrefs();
    if (window.GraficoReal) window.GraficoReal.atualizar();
    return;
  }
  if (!e.target.closest('.mktsel')) {
    menu.hidden = true;
    cmenu.hidden = true;
    if (lmenu) lmenu.hidden = true;
  }
});

/* Ferramenta FIB da barra lateral liga o Fibonacci. */
document.getElementById('tools').addEventListener('click', e => {
  const b = e.target.closest('.tool'); if (!b) return;
  const eraAtivo = b.classList.contains('active');
  document.querySelectorAll('#tools .tool').forEach(t => t.classList.remove('active'));
  b.classList.add('active');
  const rotulo = b.textContent.trim();
  if (b.dataset.tool === 'auto-movimentos') {
    reguaAutomatica = !eraAtivo;
    if (!reguaAutomatica) b.classList.remove('active');
    ferramenta = 'cursor';
    renderChart();
    return;
  }
  reguaAutomatica = false;
  if (rotulo === '\u232b') {                    /* apagar marcacoes */
    sel.teams.clear(); sel.odds.clear(); sel.cols.clear(); aplicarSelecao();
    if (window.RankingGradeReal &&
        typeof window.RankingGradeReal.limparSelecoes === 'function')
      window.RankingGradeReal.limparSelecoes();
    desenhos.length = 0; reguaAutomatica = false; renderDesenhos();
    for (const nome of ['Fibonacci', 'Elliott', 'Topo/Fundo', 'Congestão', 'LTA/LTB']) {
      const c = [...document.querySelectorAll('#overlays .chip')].find(x => x.textContent.trim() === nome);
      if (c) c.classList.remove('on');
    }
    renderChart(); return;
  }
  if (rotulo === '\u2672') {                    /* resetar para o padrao */
    document.querySelectorAll('#overlays .chip').forEach(c =>
      c.classList.toggle('on', ['Linha Atual','Médias','MACD','Fibonacci','LTA/LTB'].includes(c.textContent.trim())));
    renderChart(); return;
  }
  ferramenta = FERRAMENTAS[rotulo] || 'cursor';
  if (rotulo === '⊕') { definirZoomGrafico(state.zoom + 1); return; }
  if (rotulo === '⊖') { definirZoomGrafico(state.zoom - 1); return; }
  const mapa = { FIB: 'Fibonacci' };
  const alvo = mapa[rotulo];
  if (alvo) {
    const chip = [...document.querySelectorAll('#overlays .chip')].find(c => c.textContent.trim() === alvo);
    if (chip) { chip.classList.add('on'); renderChart(); }
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('#grafmodo [data-modo], #acumBar .tab')) return;
  resetarViewportGrafico(false, true);
  setTimeout(renderChart, 0);
});

document.getElementById('btnRefresh').addEventListener('click', () => {
  const inicio = performance.now();
  const atualizar = window.Real && typeof window.Real.buscar === 'function'
    ? window.Real.buscar().then(() => window.Real.pintar())
    : Promise.resolve(renderAll());
  atualizar.finally(() => {
    document.getElementById('ping').textContent =
      Math.max(1, Math.round(performance.now() - inicio)) + 'ms';
  });
});
document.getElementById('btnSound').addEventListener('click', e => {
  e.currentTarget.textContent = e.currentTarget.textContent === '🔊' ? '🔇' : '🔊';
  if (e.currentTarget.textContent === '🔊') {
    desbloquearAlertasSonoros();
    habilitarAlertasDeFundo();
  }
});
const lockGrafico = document.getElementById('lockTitle');
if (lockGrafico) lockGrafico.addEventListener('click', () => {
  state.graficoTravado = !state.graficoTravado;
  if (state.graficoTravado) {
    state.panGrafico = 0;
    state.ancoraGrafico = null;
  }
  hoverGrafico.ativo = false;
  renderChart();
});
const navToggle = document.getElementById('navToggle');
if (navToggle) navToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));

let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderChart, 160); });

carregarPrefs();
if (modoQuadro && ['copa', 'euro', 'super', 'premier'].includes(ligaDoQuadro)) {
  window.definirLigaApp(ligaDoQuadro);
}
montarMira();
const sliderZoomGrafico = document.getElementById('zoom');
if (sliderZoomGrafico) sliderZoomGrafico.addEventListener('input', e => definirZoomGrafico(e.target.value));
const zoomMenosGrafico = document.getElementById('chartZoomOut');
const zoomMaisGrafico = document.getElementById('chartZoomIn');
const agoraGrafico = document.getElementById('chartNow');
if (zoomMenosGrafico) zoomMenosGrafico.addEventListener('click', () => definirZoomGrafico(state.zoom - 1));
if (zoomMaisGrafico) zoomMaisGrafico.addEventListener('click', () => definirZoomGrafico(state.zoom + 1));
if (agoraGrafico) agoraGrafico.addEventListener('click', () => {
  state.panGrafico = 0;
  state.ancoraGrafico = null;
  hoverGrafico.ativo = false;
  renderChart();
});
document.getElementById('alTestar').addEventListener('click', () => {
  const alvo = document.getElementById('alAlvo').value;
  mostrarAviso(`\ud83d\udd14 sinal de teste \u00b7 ${state.mercado} \u00b7 alvo ${alvo}%`);
  bip();
});
const botaoAlertaFib50 = document.getElementById('fib50Alert');
if (botaoAlertaFib50) botaoAlertaFib50.addEventListener('click', alternarAlertaFib50);
atualizarBotaoFib50();
document.getElementById('centralizar').addEventListener('click', () => resetarViewportGrafico(true));
document.getElementById('alOn').addEventListener('change', () => renderChart());
document.getElementById('alAlvo').addEventListener('change', () => { alertaAtivo = false; renderChart(); });

renderAll();
sincronizarAria();
tick();
setInterval(tick, 1000);
registrarAlertasDeFundo();
document.addEventListener('pointerdown', desbloquearAlertasSonoros, { once: true, capture: true });
document.addEventListener('keydown', desbloquearAlertasSonoros, { once: true, capture: true });
document.addEventListener('click', salvarPrefs);

/* Espelha o estado visual dos botões para leitores de tela. */
function sincronizarAria() {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-pressed', t.classList.contains('active')));
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.classList.contains('on')));
  document.querySelectorAll('.nav-item').forEach(n => n.setAttribute('aria-current', n.classList.contains('active') ? 'page' : 'false'));
}
document.addEventListener('click', sincronizarAria);


/* ---------- CAMADA DE DESENHO ---------- */
var desenhos = [], ferramenta = 'cursor', arrasto = null, reguaAutomatica = false;
var FERRAMENTAS = {'↖':'cursor','╱':'tend','−':'horiz','⌁':'regua','□':'rect','I':'livre','T':'texto','EQ':'eq'};

/* Encontra somente pivôs já confirmados e transforma os movimentos relevantes
   em réguas. O último ponto corrente não vira pivô, evitando repintar sinais. */
function reguasAutomaticas() {
  if (!reguaAutomatica || !geo || geo.comparativo || !Array.isArray(geo.pts) || geo.pts.length < 7) return [];
  const pts = geo.pts;
  const janela = pts.length >= 100 ? 3 : 2;
  const extremos = zigzag(pts, janela);
  if (extremos.length < 2) return [];
  const faixa = Math.max(...pts) - Math.min(...pts);
  const minimo = Math.max(faixa * .06, 0.05);
  const inicio = geo.viewport ? Number(geo.viewport.inicio) || 0 : 0;
  const movimentos = [];
  for (let i = 1; i < extremos.length; i++) {
    const a = extremos[i - 1], b = extremos[i];
    if (Math.abs(b.v - a.v) < minimo) continue;
    movimentos.push({ tipo: 'regua', automatico: true,
      i1: inicio + a.i, v1: a.v, i2: inicio + b.i, v2: b.v });
  }
  return movimentos.slice(-14);
}
function pontoDados(ev) {
  const svg = document.getElementById('chart'), r = svg.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (geo.W / r.width), py = (ev.clientY - r.top) * (geo.H / r.height);
  const passo = (geo.W - geo.padL - geo.padR) / (geo.pts.length - 1);
  const i = Math.max(0, Math.min(geo.pts.length - 1, Math.round((px - geo.padL) / passo)));
  const v = geo.min + (1 - (py - geo.padT) / (geo.H - geo.padT - geo.padB)) * (geo.max - geo.min);
  const ix = Math.max(0, Math.min(geo.pts.length - 1, (px - geo.padL) / passo));
  /* As anotações ficam ancoradas no índice absoluto da fonte. Assim o zoom
     e o arraste da câmera apenas mudam a posição visível, sem deslocar o
     desenho para outro jogo. */
  const inicio = geo.viewport ? Number(geo.viewport.inicio) || 0 : 0;
  return { i: inicio + i, ix: inicio + ix, v: v };
}
function renderDesenhos(previa) {
  const svg = document.getElementById('chart');
  if (!svg || !geo || !desenhos) return;
  svg.querySelectorAll('.dz').forEach(function (e) { e.remove(); });
  const inicio = geo.viewport ? Number(geo.viewport.inicio) || 0 : 0;
  const fim = inicio + geo.pts.length - 1;
  const indiceLocal = function (indice) { return Number(indice) - inicio; };
  const pontoVisivel = function (indice) {
    return Number(indice) >= inicio && Number(indice) <= fim;
  };
  const segmentoVisivel = function (a, b) {
    const menor = Math.min(Number(a), Number(b));
    const maior = Math.max(Number(a), Number(b));
    return maior >= inicio && menor <= fim;
  };
  const automaticos = previa ? [] : reguasAutomaticas();
  const todos = (previa ? desenhos.concat([previa]) : desenhos).concat(automaticos);
  todos.forEach(function (d) {
    const temSegundoPonto = d.i2 != null;
    if (d.tipo !== 'horiz' && d.tipo !== 'livre' &&
        (temSegundoPonto ? !segmentoVisivel(d.i1, d.i2) : !pontoVisivel(d.i1))) return;
    const x1 = geo.x(indiceLocal(d.i1)), y1 = geo.y(d.v1);
    const x2 = temSegundoPonto ? geo.x(indiceLocal(d.i2)) : 0;
    const y2 = d.v2 != null ? geo.y(d.v2) : 0;
    const g = el('g', { class: 'dz' });
    if (d.tipo === 'tend') g.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#32a4ff', 'stroke-width': 1.8 }));
    if (d.tipo === 'horiz') g.appendChild(el('line', { x1: geo.padL, y1: y1, x2: geo.W - geo.padR, y2: y1, stroke: '#32a4ff', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
    if (d.tipo === 'rect') g.appendChild(el('rect', { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), fill: 'rgba(50,164,255,.13)', stroke: '#32a4ff', 'stroke-width': 1.3 }));
    if (d.tipo === 'texto') g.appendChild(txt({ x: x1, y: y1, fill: '#ffd400', 'font-size': 12, 'font-weight': 700 }, d.txt || ''));
    if (d.tipo === 'regua') {
      const dif = d.v2 - d.v1, pc = d.v1 ? (dif / d.v1) * 100 : 0, cor = dif >= 0 ? '#18e34d' : '#ff343d';
      g.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: cor, 'stroke-width': d.automatico ? 2.1 : 1.8, 'stroke-dasharray': '4 3' }));
      g.appendChild(el('circle', { cx: x1, cy: y1, r: 3.5, fill: '#fff' }));
      g.appendChild(el('circle', { cx: x2, cy: y2, r: 3.5, fill: '#fff' }));
      g.appendChild(txt({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 9, fill: cor, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' },
        (dif >= 0 ? '+' : '') + dif.toFixed(1) + ' pp · ' + (pc >= 0 ? '+' : '') + pc.toFixed(1) + '%'));
    }
    if (d.tipo === 'eq') {
      const eq = (d.v1 + d.v2) / 2, ye = geo.y(eq);
      g.appendChild(el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#b28dff', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .85 }));
      g.appendChild(el('line', { x1: geo.padL, y1: ye, x2: geo.W - geo.padR, y2: ye, stroke: '#a855f7', 'stroke-width': 2 }));
      g.appendChild(el('circle', { cx: x1, cy: y1, r: 4.5, fill: 'none', stroke: '#b28dff', 'stroke-width': 1.8 }));
      g.appendChild(el('circle', { cx: x2, cy: y2, r: 4.5, fill: 'none', stroke: '#b28dff', 'stroke-width': 1.8 }));
      g.appendChild(el('rect', { x: geo.W - geo.padR - 66, y: ye - 10, width: 62, height: 20, rx: 10, fill: '#1a0f2e', stroke: '#a855f7', 'stroke-width': 1.3 }));
      g.appendChild(txt({ x: geo.W - geo.padR - 35, y: ye + 4.5, fill: '#e9d5ff', 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' }, 'EQ ' + eq.toFixed(0) + '%'));
    }
    if (d.tipo === 'livre' && d.pontos && d.pontos.length > 1) {
      const visiveis = d.pontos.filter(function (p) { return pontoVisivel(p.i); });
      if (visiveis.length < 2) return;
      let dd = '';
      visiveis.forEach(function (p, k) {
        dd += (k ? ' L ' : 'M ') + geo.x(indiceLocal(p.i)) + ' ' + geo.y(p.v);
      });
      g.appendChild(el('path', { d: dd, fill: 'none', stroke: '#ffd400', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    svg.appendChild(g);
  });
}
(function () {
  const svg = document.getElementById('chart');
  svg.addEventListener('mousedown', function (ev) {
    if (ferramenta === 'cursor' || !geo || geo.comparativo) return;
    const p = pontoDados(ev);
    if (ferramenta === 'texto') { const t = prompt('Texto:'); if (t) { desenhos.push({ tipo: 'texto', i1: p.i, v1: p.v, txt: t }); renderDesenhos(); } return; }
    if (ferramenta === 'horiz') { desenhos.push({ tipo: 'horiz', i1: p.i, v1: p.v }); renderDesenhos(); return; }
    if (ferramenta === 'livre') { arrasto = { tipo: 'livre', i1: p.ix, v1: p.v, pontos: [{ i: p.ix, v: p.v }] }; return; }
    arrasto = { tipo: ferramenta, i1: p.i, v1: p.v, i2: p.i, v2: p.v };
  });
  svg.addEventListener('mousemove', function (ev) {
    if (!arrasto) return; const p = pontoDados(ev);
    if (arrasto.tipo === 'livre') arrasto.pontos.push({ i: p.ix, v: p.v });
    else { arrasto.i2 = p.i; arrasto.v2 = p.v; }
    renderDesenhos(arrasto);
  });
  window.addEventListener('mouseup', function () { if (!arrasto) return; desenhos.push(arrasto); arrasto = null; renderDesenhos(); });
})();

/* Arraste horizontal da câmera. O deslocamento fica ancorado no jogo visto,
   então resultados novos não puxam o usuário de volta para o jogo atual. */
(function instalarCameraGrafico() {
  const svg = document.getElementById('chart');
  if (!svg || typeof window.PointerEvent === 'undefined') return;

  function redesenharCamera() {
    if (quadroCameraGrafico) return;
    const raf = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
    quadroCameraGrafico = raf(() => {
      quadroCameraGrafico = 0;
      renderChart();
    });
  }

  function terminarArrasto(ev) {
    if (!arrastoCameraGrafico ||
        (ev && ev.pointerId !== arrastoCameraGrafico.pointerId)) return;
    try {
      if (ev && svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    } catch (erro) { /* o navegador pode já ter liberado a captura */ }
    arrastoCameraGrafico = null;
    atualizarControlesViewport(modoAtualDoGrafico(), geo && geo.viewport);
  }

  svg.addEventListener('pointerdown', ev => {
    if (state.graficoTravado || ferramenta !== 'cursor' || !geo ||
        geo.comparativo || !geo.viewport || ev.button !== 0) return;
    const larguraUtil = Math.max(1, svg.getBoundingClientRect().width *
      (geo.W - geo.padL - geo.padR) / geo.W);
    const passoPx = larguraUtil / Math.max(1, geo.pts.length - 1);
    arrastoCameraGrafico = {
      pointerId: ev.pointerId, x: ev.clientX,
      pan: state.panGrafico, passoPx
    };
    try { svg.setPointerCapture(ev.pointerId); } catch (erro) { /* opcional */ }
    hoverGrafico.ativo = false;
    atualizarControlesViewport(modoAtualDoGrafico(), geo.viewport);
    ev.preventDefault();
  });

  svg.addEventListener('pointermove', ev => {
    if (!arrastoCameraGrafico || ev.pointerId !== arrastoCameraGrafico.pointerId ||
        !geo || !geo.viewport) return;
    const delta = Math.round((ev.clientX - arrastoCameraGrafico.x) /
      Math.max(1, arrastoCameraGrafico.passoPx));
    const novoPan = Math.round(numeroEntre(arrastoCameraGrafico.pan + delta,
      0, geo.viewport.maxPan));
    if (novoPan !== state.panGrafico) {
      state.panGrafico = novoPan;
      state.ancoraGrafico = null;
      redesenharCamera();
    }
    ev.preventDefault();
  });

  svg.addEventListener('pointerup', terminarArrasto);
  svg.addEventListener('pointercancel', terminarArrasto);
  svg.addEventListener('lostpointercapture', terminarArrasto);
})();


/* ---------- CONFIGURACAO DE PERIODOS ---------- */
function abrirConfig(btn) {
  const velho = document.getElementById('cfgBox'); if (velho) { velho.remove(); return; }
  const campos = [['mm1','MM1'],['mm2','MM2'],['mm3','MM3'],['rapida','MACD Rapida'],['lenta','MACD Lenta'],['sinal','MACD Sinal'],['rsi','RSI Periodo']];
  const m = document.createElement('div'); m.id = 'cfgBox'; m.className = 'cfgbox';
  m.innerHTML = campos.map(function (c) { return '<label>' + c[1] + ':<input type="number" min="1" max="99" data-k="' + c[0] + '" value="' + cfg[c[0]] + '"></label>'; }).join('')
    + '<button id="cfgReset">Restaurar Padrao</button>';
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(6, Math.min(innerWidth - 200, r.left - 80)) + 'px';
  m.addEventListener('input', function (e) { const k = e.target.dataset.k; if (k) { cfg[k] = Math.max(1, +e.target.value || 1); salvarPrefs(); renderChart(); } });
  m.addEventListener('click', function (e) {
    if (e.target.id === 'cfgReset') { Object.assign(cfg, PADRAO);
      m.querySelectorAll('input').forEach(function (i) { i.value = cfg[i.dataset.k]; }); salvarPrefs(); renderChart(); }
  });
}
document.addEventListener('click', function (e) { const b = e.target.closest('#btnConfig'); if (b) abrirConfig(b); });

document.addEventListener('click', function (e) {
  const b = e.target.closest('#btnHT'); if (!b) return;
  state.ht = !state.ht; b.classList.toggle('on', state.ht);
  b.textContent = state.ht ? 'HT ON' : 'HT'; renderGrade();
});


/* ---------- RELATORIO DIARIO ---------- */
function dadosDia(off) {
  const d = new Date(); d.setDate(d.getDate() - off);
  const chave = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const rng = makeRng(seedOf('dia' + chave));
  const total = off === 0 ? 40 + Math.floor(rng() * 90) : 200 + Math.floor(rng() * 300);
  const nomes = ['madrugada', 'manhã', 'tarde', 'noite'];
  const buckets = { madrugada: [], 'manhã': [], tarde: [], noite: [] };
  const jogos = [], porBloco = Math.ceil(total / 4);
  for (let i = 0; i < total; i++) {
    const gh = poisson(rng), ga = poisson(rng);
    const j = { gh: gh, ga: ga, hh: Math.min(gh, poisson(rng, 0.55)), ha: Math.min(ga, poisson(rng, 0.55)) };
    jogos.push(j);
    buckets[nomes[Math.min(3, Math.floor(i / porBloco))]].push(j);
  }
  const pct = function (arr, m) { return arr.length ? Math.round(arr.filter(function (j) { return pagou(m, j); }).length / arr.length * 100) : 0; };
  const gols = jogos.reduce(function (a, j) { return a + j.gh + j.ga; }, 0);
  return { data: d, jogos: total, media: (gols / total).toFixed(2),
    o25: pct(jogos, 'Over 2.5'), o35: pct(jogos, 'Over 3.5'),
    p5: pct(jogos, '5+ Gols'), amb: pct(jogos, 'Ambas Marcam (Sim)'),
    periodos: nomes.map(function (n) { return { nome: n, n: buckets[n].length, pct: pct(buckets[n], 'Over 3.5') }; })
      .filter(function (p) { return p.n; }) };
}
function abrirRelatorio() {
  const velho = document.getElementById('relBox'); if (velho) { velho.remove(); return; }
  const dias = []; for (let k = 0; k < 7; k++) dias.push(dadosDia(k));
  const seta = function (a, b) { const d = a - b;
    return d >= 3 ? '<span class="sobe">↗ +' + d + '</span>'
      : d <= -3 ? '<span class="desce">↘ ' + d + '</span>' : '<span class="igual">≈</span>'; };
  const box = document.createElement('div'); box.id = 'relBox'; box.className = 'relbox';
  box.innerHTML = '<div class="relpainel"><div class="relhead">📅 Relatório por data — regime diário do algoritmo'
    + ' <small>(↗/↘ = comparado ao dia anterior)</small><button id="relFechar">✕</button></div>'
    + dias.map(function (d, i) {
        const ant = dias[i + 1];
        const cmp = function (v, k) { return ant ? seta(v, ant[k]) : ''; };
        return '<div class="relcard"><div class="reltit">' + d.data.toLocaleDateString('pt-BR')
          + (i === 0 ? ' <em>(em andamento)</em>' : '') + ' — ' + d.jogos + ' jogos · média ' + d.media + ' gols</div>'
          + '<div class="rellin">Over 2.5 <b>' + d.o25 + '%</b> ' + cmp(d.o25, 'o25')
          + ' · Over 3.5 <b>' + d.o35 + '%</b> ' + cmp(d.o35, 'o35')
          + ' · 5+ <b>' + d.p5 + '%</b> ' + cmp(d.p5, 'p5')
          + ' · Ambas <b>' + d.amb + '%</b> ' + cmp(d.amb, 'amb') + '</div>'
          + '<div class="relper">Over 3.5 por período: '
          + d.periodos.map(function (p) { return p.nome + ' <b>' + p.pct + '%</b> (' + p.n + 'j)'; }).join(' · ')
          + '</div></div>'; }).join('') + '</div>';
  document.body.appendChild(box);
  box.addEventListener('click', function (e) { if (e.target.id === 'relFechar' || e.target === box) box.remove(); });
}
document.addEventListener('click', function (e) { if (e.target.closest('#navRelatorio')) abrirRelatorio(); });

function renderMenuOdds(){
  document.getElementById('oddsMenu').innerHTML='<div class="mkt-grupo">Odds no card</div>'+
    ODDS_LISTA.map(function(p){var on=state.odds.indexOf(p[0])>=0;
      return '<button class="'+(on?'on':'')+'" data-odd-tog="'+p[0]+'"><i class="cx'+(on?' m':'')+'"></i>'+p[1]+'</button>';}).join('');
  document.getElementById('oddsBtn').textContent='\ud83c\udfaf Odds ('+state.odds.length+') \u2304';
  document.getElementById('timeBtn').textContent='\ud83d\udc55 Time '+(state.mostrarTime?'ON':'OFF');
  document.getElementById('timeBtn').classList.toggle('on',state.mostrarTime);}
document.addEventListener('click',function(e){
  var m=document.getElementById('oddsMenu');
  if(e.target.closest('#oddsBtn')){m.hidden=!m.hidden;renderMenuOdds();return;}
  var t=e.target.closest('[data-odd-tog]');
  if(t){var k=t.dataset.oddTog,i=state.odds.indexOf(k);
    /* A última opção também pode ser desligada. Com a lista vazia, os cards
       continuam mostrando times/placar, mas nenhuma linha de odd. */
    if(i>=0)state.odds.splice(i,1);else state.odds.push(k);
    renderGrade();renderMenuOdds();return;}
  if(e.target.closest('#timeBtn')){state.mostrarTime=!state.mostrarTime;renderGrade();renderMenuOdds();return;}
  if(!e.target.closest('.mktsel'))m.hidden=true;
});
renderMenuOdds();

/* ---------- AUTO: varredura dos mercados ---------- */
function varrerMercados() {
  const antes = state.mercado, out = [];
  MERCADOS_GRADE.forEach(function (m) {
    state.mercado = m;
    const s = serie(Math.max(6, Math.round(state.qtd / state.zoom)));
    if (!Array.isArray(s) || s.length < 2) return;
    const z = zoneSignal(s), n = s.length, cur = s[n - 1], normal = normalDe(m);
    const temMin = z.zonaPct <= 25;
    const ltb = linhaTendencia(s, 'LTB'); let quebrou = false;
    if (ltb) { const mm = (ltb.b.v - ltb.a.v) / (ltb.b.i - ltb.a.i); quebrou = cur > (ltb.b.v + mm * (n - 1 - ltb.b.i)); }
    const cs = comboScore({ graphSubindo: z.subindo, graphTopo: z.zonaPct >= 78, temMinima: temMin,
      minimaLonga: temMin && n >= 40, cycleStrong: quebrou && z.subindo, cycleBuilding: quebrou,
      probStrong: cur >= normal, evStrong: cur >= normal * 1.05, baseForte: n >= 40, coldOdd: cur < normal * 0.7 });
    out.push({ m: m, zona: z.zona, zonaPct: z.zonaPct, dir: z.direcao, score: cs.score, ready: cs.ready, quebrou: quebrou });
  });
  state.mercado = antes;
  out.sort(function (a, b) { return b.score - a.score; });
  return out;
}
function renderAuto() {
  let box = document.getElementById('autoBox');
  if (!box) { box = document.createElement('div'); box.id = 'autoBox'; box.className = 'autobox';
    document.getElementById('sinais').after(box); }
  if (state.metrica !== 'AUTO') { box.hidden = true; return; }
  box.hidden = false;
  const r = varrerMercados(), prontos = r.filter(function (x) { return x.ready; }).length;
  box.innerHTML = '<div class="autotit">AUTO \u2014 varredura de ' + r.length + ' mercados \u00b7 '
    + prontos + ' pronto(s) acima de 70</div>'
    + '<table class="autotb"><thead><tr><th>#</th><th>Mercado</th><th>Zona</th><th>Dire\u00e7\u00e3o</th><th>LTB</th><th>Score</th></tr></thead><tbody>'
    + r.slice(0, 10).map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td><button class="linkmkt" data-auto="' + x.m + '">' + x.m + '</button></td>'
          + '<td>' + x.zona + ' ' + x.zonaPct + '%</td><td>' + x.dir + '</td>'
          + '<td>' + (x.quebrou ? '\u2713' : '\u2014') + '</td>'
          + '<td class="sc ' + (x.score >= 70 ? 'up' : x.score >= 55 ? 'mid' : 'down') + '">' + x.score + (x.ready ? ' \u2713' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
}
(function () {
  const mb = document.getElementById('metric');
  if (mb && !mb.querySelector('[data-v="AUTO"]')) {
    const b = document.createElement('button');
    b.className = 'tab sm blue'; b.dataset.v = 'AUTO'; b.textContent = '\u2699 AUTO';
    mb.appendChild(b);
  }
  const lin = document.querySelectorAll('.alerta-box .lin')[1];
  if (lin && !document.getElementById('alZona')) {
    const l = document.createElement('label'); l.className = 'lin';
    l.innerHTML = 'Zona <select id="alZona"><option value="">qualquer</option><option>Fundo</option>'
      + '<option>Baixa</option><option>Meio</option><option>Alta</option><option>Topo</option></select>';
    lin.after(l);
  }
  document.addEventListener('change', function (e) { if (e.target.id === 'alZona') { alertaAtivo = false; renderChart(); } });
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-auto]');
    if (b) { resetarViewportGrafico(false, true); state.mercado = b.dataset.auto; state.gradeMercado = b.dataset.auto; renderAll(); renderAuto(); }
  });
  renderAuto();
})();

/* ---------- VELAS E FORÇA ---------- */
/* Erro padrão de Wilson: corrige o viés do Wald quando n é pequeno
   ou p é extremo — os dois casos comuns aqui (5+ Gols, Under 3.5). */
function sePadrao(pct, n) {
  const z = 1.96, p = Math.max(0.005, Math.min(0.995, pct / 100));
  const den = 1 + z * z / n;
  const meio = (p + z * z / (2 * n)) / den;
  const meia = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return (meia / z) * 100;   /* volta a 1 desvio, em pontos percentuais */
}
/* Aproximação normal exige n*p >= 5 e n*(1-p) >= 5. */
function minPorVela(mkt) {
  const p = Math.max(0.01, Math.min(0.99, normalDe(mkt) / 100));
  return Math.max(10, Math.ceil(5 / p), Math.ceil(5 / (1 - p)));
}
function montaVelas(pts) {
  const minJogos = minPorVela(state.mercado);
  const maxVelas = Math.floor(state.qtd / minJogos);
  if (maxVelas < 2) return [];
  const alvo = Math.max(2, Math.min(30, maxVelas));
  const tam = Math.max(1, Math.floor(pts.length / alvo));
  const jogos = Math.round(state.qtd / alvo);
  const out = [];
  for (let i = 0; i + tam <= pts.length; i += tam) {
    const b = pts.slice(i, i + tam);
    const a = b[0], f = b[b.length - 1];
    const se = sePadrao((a + f) / 2, jogos);
    out.push({ a: a, f: f, max: Math.max.apply(null, b), min: Math.min.apply(null, b),
      n: jogos, se: se, z: se ? (f - a) / se : 0 });
  }
  return out;
}
function forcaAtual(pts) {
  const min = minPorVela(state.mercado);
  const v = montaVelas(pts);
  if (!v.length) return { z: 0, rotulo: 'amostra insuf.', classe: 'neutro', falta: min * 2, insuf: true };
  const z = v[v.length - 1].z, a = Math.abs(z);
  const rotulo = a < 1 ? 'ru\u00eddo' : a < 2 ? 'fraca' : a < 3 ? 'moderada' : 'forte';
  return { z: z, rotulo: rotulo, classe: a < 1 ? 'neutro' : z > 0 ? 'up' : 'down', n: v[v.length - 1].n, insuf: false };
}
