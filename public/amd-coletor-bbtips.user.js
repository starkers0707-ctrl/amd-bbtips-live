// ==UserScript==
// @name         AMD Coletor BBTips
// @namespace    amd.live
// @version      5.2.0
// @description  Coleta somente as ligas Kiron CAM, COP e AME e envia para o AMD
// @author       AMD
// @match        https://thtips.com.br/*
// @match        https://*.thtips.com.br/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.thtips.com.br
// @connect      onrender.com
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 1. CONFIG
  // ============================================================
  const CFG = {
    COLETOR_URL: 'https://amd-bbtips-live.onrender.com/api/dados',
    TOKEN: '',
    FORMATO: 'apidados',      // 'apidados' = POST /api/dados do AMD Live | 'amdlive1' = mosaico | 'bruto' = linhas cruas
    ENVIAR: true,
    INTERVALO_ENVIO: 3000,
    LOTE_MAX: 400,
    AUTO_REFETCH: true,
    INTERVALO_REFETCH: 2500,
    INTERVALO_REFETCH_COMPLETO: 60000,
    PAUSA_REFETCH: 200,
    // MERCADOS: o parametro 'filtros' da API do BBTips devolve as odds de cada
    // mercado pedido. Formato da resposta: "o25@2.48;o35@5.15;ge5@14.00;"
    MERCADOS: 'o25,o35,ge5,ambas,u25,u15,u05',
    LIGA_MAX: 15,          // ate qual id de liga a varredura tenta
    PAUSA_VARREDURA: 350,  // ms entre requests da varredura
    HORAS: '',             // '' mantem o capturado. Ex: 'Horas24' para puxar mais historico
    MAX_AMOSTRA: 4000
  };
  const KIRON_IDS = new Set(['6', '7', '8']); // CAM, COP e AME
  const ehRotaKiron = r => !!r && r.casa === 'playpix' && KIRON_IDS.has(String(r.liga));

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  const store = {
    get: (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } },
    set: (k, v) => { try { GM_setValue(k, v); } catch (e) {} }
  };

  const ROTAS_STORE = 'amd_rotas_v1';
  function temAutorizacao(headers) {
    if (!headers) return false;
    try {
      return Object.keys(headers).some(k =>
        /^authorization$/i.test(k) && String(headers[k] || '').trim()
      );
    } catch (e) { return false; }
  }

  const S = {
    ativo: store.get('amd_ativo', true),
    endpoints: new Map(),   // path -> {n, amostra}
    rotas: new Map(),       // casa|path|liga -> {url, headers}
    ligas: new Map(),       // casa|ligaId -> {n, exemplo}
    nomes: new Map(Object.entries(store.get('amd_nomes', {}))), // casa|ligaId -> nome da aba
    buffer: new Map(),
    versoes: new Set(),
    jogos: 0, entradas: 0, enviados: 0, erros: 0,
    varrendo: 0, ultimoErro: '', ultimoEnvio: 0
  };

  function salvarRotas() {
    const out = {};
    for (const [k, r] of S.rotas) {
      if (!r || !r.url || !temAutorizacao(r.headers)) continue;
      out[k] = { url: r.url, headers: r.headers, casa: r.casa, liga: r.liga };
    }
    store.set(ROTAS_STORE, out);
  }

  try {
    const antigas = store.get(ROTAS_STORE, {}) || {};
    for (const [k, r] of Object.entries(antigas)) {
      if (r && r.url && temAutorizacao(r.headers) && ehRotaKiron(r)) S.rotas.set(k, r);
    }
  } catch (e) {}
  let tokenCapturado = null;

  function tokenDosHeaders(headers) {
    if (!headers) return null;
    try {
      const pares = headers instanceof Headers
        ? Array.from(headers.entries())
        : (Array.isArray(headers) ? headers : Object.entries(headers));
      for (const [k, v] of pares) {
        if (!/^authorization$/i.test(String(k))) continue;
        const t = String(v || '').replace(/^Bearer\s+/i, '').trim();
        if (t.length >= 40) return t;
      }
    } catch (e) {}
    return null;
  }
  let envioRapidoTimer = null;

  function agendarEnvioRapido() {
    // Disparo na primeira mudanca. Nao reinicia o relogio a cada resposta:
    // durante a varredura chegam varias rotas seguidas e o debounce antigo
    // podia adiar o envio ate o fim do lote inteiro.
    if (envioRapidoTimer) return;
    envioRapidoTimer = setTimeout(() => {
      envioRapidoTimer = null;
      enviarLote();
    }, 120);
  }

  // ============================================================
  // 2. MAPA DAS CASAS
  // ============================================================
  const CASA_POR_PATH = [
    [/\/api\/betanoFutebolVirtual/i, 'betano'],
    [/\/api\/PlayPixFutebolVirtual/i, 'playpix'],
    [/\/api\/futebolvirtual/i, 'bet365']
  ];
  const ALVO = /\/api\/(futebolvirtual|betanoFutebolVirtual|PlayPixFutebolVirtual)/i;
  const IGNORAR = /ultimaAtualizacao|validarCadastro/i;

  function casaDaUrl(u) {
    for (const [re, nome] of CASA_POR_PATH) if (re.test(u)) return nome;
    return 'desconhecida';
  }

  function partes(u) {
    try { const x = new URL(u, location.href); return { path: x.pathname, qs: x.search, params: x.searchParams }; }
    catch (e) { return { path: String(u).split('?')[0], qs: '', params: new URLSearchParams() }; }
  }

  // o parametro se chama "liga" no bet365/betano e "Liga" no playpix
  function ligaDaUrl(u) {
    const { params } = partes(u);
    for (const [k, v] of params) if (/^liga$/i.test(k) && v !== '') return String(v);
    return null;
  }

  function trocaLiga(u, novoId) {
    try {
      const x = new URL(u, location.href);
      let nome = null;
      for (const k of Array.from(x.searchParams.keys())) if (/^liga$/i.test(k)) nome = k;
      if (!nome) return null;
      x.searchParams.set(nome, String(novoId));
      if (CFG.HORAS) for (const k of Array.from(x.searchParams.keys())) if (/^horas$/i.test(k)) x.searchParams.set(k, CFG.HORAS);
      if (CFG.MERCADOS) x.searchParams.set('filtros', CFG.MERCADOS);
      return x.toString();
    } catch (e) { return null; }
  }

  // nome da liga: aprendido pelo texto da aba clicada logo antes do request
  const CASAS_NOME = /^(bet ?365|betano|playpix|play ?pix)$/i;
  let ultimoClique = { texto: null, ts: 0 };

  try {
    document.addEventListener('click', ev => {
      try {
        let el = ev.target;
        for (let i = 0; i < 5 && el; i++) {
          const tag = (el.tagName || '').toLowerCase();
          if (['button', 'a', 'li'].includes(tag) || /tab|liga|league|nav|item/i.test(String(el.className || ''))) break;
          el = el.parentElement;
        }
        const txt = ((el && el.textContent) || '').trim().replace(/\s+/g, ' ');
        if (txt && txt.length <= 20 && !CASAS_NOME.test(txt)) ultimoClique = { texto: txt, ts: Date.now() };
      } catch (e) {}
    }, true);
  } catch (e) {}

  function aprenderNomeAPI(casa, ligaId, nome) {
    if (!ligaId || !nome) return;
    const k = casa + '|' + ligaId;
    if (S.nomes.get(k) === nome) return;
    S.nomes.set(k, nome);
    try { store.set('amd_nomes', Object.fromEntries(S.nomes)); } catch (e) {}
  }

  function aprenderNome(casa, ligaId) {
    if (S.nomes.has(casa + '|' + ligaId)) return;
    if (!ligaId || !ultimoClique.texto) return;
    if (Date.now() - ultimoClique.ts > 4000) return;
    const k = casa + '|' + ligaId;
    if (S.nomes.get(k) === ultimoClique.texto) return;
    S.nomes.set(k, ultimoClique.texto);
    try { store.set('amd_nomes', Object.fromEntries(S.nomes)); } catch (e) {}
  }

  // IDs fixos das nove abas PlayPix. Eles nao dependem da ordem de clique nem
  // do texto visual, evitando ENG receber SPA e evitando ligas sem nome.
  const NOMES_PLAYPIX = Object.freeze({
    '1': 'ita', '2': 'eng', '3': 'spa', '4': 'bra', '5': 'lat',
    '6': 'cam', '7': 'cop', '8': 'ame', '9': 'mnd'
  });
  const nomeLiga = (casa, id) => {
    if (id == null) return null;
    if (casa === 'playpix' && NOMES_PLAYPIX[String(id)]) return NOMES_PLAYPIX[String(id)];
    return S.nomes.get(casa + '|' + id) || null;
  };

  function urlEntradas(base, id) {
    try {
      const x = new URL(base, location.href);
      if (!/entradasAnalisadas/i.test(x.pathname)) x.pathname = x.pathname.replace(/\/+$/, '') + '/entradasAnalisadas';
      let nome = null;
      for (const k of Array.from(x.searchParams.keys())) if (/^liga$/i.test(k)) nome = k;
      x.searchParams.set(nome || 'liga', String(id));
      x.searchParams.set('top', '3');
      return x.toString();
    } catch (e) { return null; }
  }

  // ============================================================
  // 3. INTERCEPTACAO
  // ============================================================
  const _fetch = W.fetch;
  try {
    if (typeof _fetch === 'function') {
      W.fetch = function (...args) {
        const p = _fetch.apply(this, args);
        try {
          const a0 = args[0];
          const url = (typeof a0 === 'string') ? a0 : (a0 && a0.url) || '';
          const h = {};
          try {
            const baseHeaders = a0 && typeof a0 !== 'string' ? a0.headers : null;
            if (baseHeaders) new Headers(baseHeaders).forEach((v, k) => { h[k] = v; });
            const initHeaders = args[1] && args[1].headers;
            if (initHeaders) new Headers(initHeaders).forEach((v, k) => { h[k] = v; });
          } catch (e) {}
          if (S.ativo && ALVO.test(url)) {
            p.then(r => { try { r.clone().text().then(t => capturar(url, t, 'fetch', h)).catch(() => {}); } catch (e) {} });
          }
        } catch (e) {}
        return p;
      };
    }
  } catch (e) { console.warn('[AMD] fetch hook falhou', e); }

  try {
    const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (XP) {
      const _open = XP.open, _send = XP.send, _srh = XP.setRequestHeader;
      XP.open = function (m, u) { this.__amdUrl = u; this.__amdH = {}; return _open.apply(this, arguments); };
      XP.setRequestHeader = function (k, v) {
        try { if (this.__amdH) this.__amdH[k] = v; } catch (e) {}
        return _srh.apply(this, arguments);
      };
      XP.send = function () {
        try {
          this.addEventListener('load', () => {
            try {
              const u = this.__amdUrl;
              if (!S.ativo || !ALVO.test(u || '')) return;
              const rt = this.responseType;
              let txt = null;
              if (rt === '' || rt === 'text') txt = this.responseText;
              else if (rt === 'json') txt = JSON.stringify(this.response);
              if (txt) capturar(u, txt, 'xhr', this.__amdH);
            } catch (e) {}
          });
        } catch (e) {}
        return _send.apply(this, arguments);
      };
    }
  } catch (e) { console.warn('[AMD] xhr hook falhou', e); }

  // ============================================================
  // 4. CAPTURA + PARSER
  // ============================================================
  function capturar(url, texto, origem, headers) {
    if (!S.ativo || !texto) return 0;
    const tokenAtivo = tokenDosHeaders(headers);
    if (tokenAtivo && tokenAtivo !== tokenCapturado) {
      tokenCapturado = tokenAtivo;
      setTimeout(() => mandaToken(tokenAtivo), 0);
    }
    const { path } = partes(url);
    const casa = casaDaUrl(url);
    const liga = ligaDaUrl(url);
    // Este coletor e exclusivo do Kiron: ignora as demais casas e ligas.
    if (!ehRotaKiron({ casa, liga })) return 0;

    const reg = S.endpoints.get(path) || { n: 0, amostra: '' };
    reg.n++;
    if (!reg.amostra) reg.amostra = texto.slice(0, CFG.MAX_AMOSTRA);
    S.endpoints.set(path, reg);

    if (IGNORAR.test(path)) return 0;
    if (origem === 'xhr' || origem === 'fetch') aprenderNome(casa, liga);

    // uma rota por casa+endpoint+LIGA, para o refetch cobrir todas as ligas
    const rk = casa + '|' + path + '|' + (liga || '-');
    const antiga = S.rotas.get(rk);
    const h = (headers && Object.keys(headers).length) ? headers : (antiga && antiga.headers) || {};
    S.rotas.set(rk, { url: comOdds(String(url)), headers: h, casa, liga });
    if (temAutorizacao(h)) salvarRotas();

    let json = null;
    try { json = JSON.parse(texto); } catch (e) { return 0; }

    let linhas = [];
    if (/entradasAnalisadas/i.test(path)) {
      if (json && json.liga && liga) aprenderNomeAPI(casa, liga, String(json.liga));
      linhas = parseEntradas(json, url, casa);
    }
    else if (json && Array.isArray(json.Linhas)) linhas = parseGrade(json, url, casa);
    if (!linhas.length) return 0;

    if (liga) {
      const lk = casa + '|' + liga;
      const r = S.ligas.get(lk) || { n: 0, exemplo: null };
      r.n = linhas.length;
      if (!r.exemplo) { const j = linhas.find(x => x.timeA); if (j) r.exemplo = j.timeA + ' x ' + j.timeB; }
      S.ligas.set(lk, r);
    }

    let novas = 0;
    for (const l of linhas) {
      const v = versao(l);
      if (S.versoes.has(v)) continue;
      const k = chave(l);
      const anterior = S.buffer.get(k);
      // Respostas de rotas diferentes podem chegar fora de ordem. Uma resposta
      // velha nao pode transformar novamente em futuro um jogo ja encerrado.
      const anteriorResolvido = anterior && anterior.tipo === 'jogo' &&
        anterior.ftA != null && anterior.ftB != null;
      const novoResolvido = l.tipo === 'jogo' && l.ftA != null && l.ftB != null;
      if (anteriorResolvido && !novoResolvido) continue;
      const mudou = !anterior || versao(anterior) !== v;
      if (!anterior) { if (l.tipo === 'jogo') S.jogos++; else S.entradas++; }
      S.buffer.set(k, l);
      if (mudou) novas++;
    }
    // O resultado que acabou de entrar nao precisa esperar o proximo ciclo
    // da varredura. Envia o snapshot atualizado desta liga quase na hora.
    if (novas > 0) agendarEnvioRapido();
    return linhas.length;
  }

  // forca o parametro filtros para que a API devolva as odds
  function comOdds(u) {
    try {
      const x = new URL(u, location.href);
      if (CFG.MERCADOS && !/entradasAnalisadas/i.test(x.pathname)) x.searchParams.set('filtros', CFG.MERCADOS);
      return x.toString();
    } catch (e) { return u; }
  }

  function semCache(u) {
    try {
      const x = new URL(u, location.href);
      x.searchParams.set('_amd_live', String(Date.now()));
      return x.toString();
    } catch (e) { return u; }
  }

  // "o25@2.48;o35@5.15;ambas@;" -> { o25: 2.48, o35: 5.15 }   (vazios sao ignorados)
  function parseOdds(txt) {
    if (!txt || typeof txt !== 'string') return null;
    const out = {}; let n = 0;
    for (const parte of txt.split(';')) {
      if (!parte) continue;
      const m = parte.match(/^([a-z0-9_]*)@([\d.]*)$/i);
      if (!m) continue;
      // o AMD Live chama o mercado "ambas" de "ambs"
      const nome = (m[1] === 'ambas' ? 'ambs' : (m[1] || 'odd'));
      const val = parseFloat(m[2]);
      if (!isFinite(val) || val <= 0) continue;
      out[nome] = val; n++;
    }
    return n ? out : null;
  }

  function placar(s) {
    if (typeof s !== 'string') return [null, null];
    const m = s.match(/(\d+)\s*[-x:]\s*(\d+)/i);
    return m ? [Number(m[1]), Number(m[2])] : [null, null];
  }

  const limpo = v => {
    if (v == null) return null;
    const s = String(v).replace(/\u0000/g, '').trim();
    return (s === '' || s === '-') ? null : s;
  };

  function horarioDaGrade(lin, c) {
    const horario = limpo(c && c.Horario);
    // Horario identifica o slot unico da partida. `Minuto` pode se repetir em
    // duas celulas da mesma linha e, portanto, serve apenas como fallback.
    if (/^\d{1,2}:\d{2}$/.test(String(horario || ''))) return horario;
    const horaLinha = limpo(c && c.Hora) || limpo(lin && lin.Hora);
    const minutoColuna = limpo(c && c.Minuto);
    if (/^\d{1,2}$/.test(String(horaLinha || '')) &&
        /^\d{1,2}$/.test(String(minutoColuna || ''))) {
      return String(Number(horaLinha)).padStart(2, '0') + ':' +
        String(Number(minutoColuna)).padStart(2, '0');
    }
    if (/^\d{1,2}:\d{2}$/.test(String(horaLinha || ''))) return horaLinha;
    return horario;
  }

  function parseGrade(json, url, casa) {
    const { qs } = partes(url);
    const liga = ligaDaUrl(url);
    const out = [];
    for (const lin of json.Linhas) {
      const cols = lin && lin.Colunas;
      if (!Array.isArray(cols)) continue;
      for (const c of cols) {
        if (!c || (!c.TimeA && !c.TimeB)) continue;
        const [ftA, ftB] = placar(c.Resultado_FT || c.Resultado);
        const [htA, htB] = placar(c.Resultado_HT);
        out.push({
          tipo: 'jogo', casa, liga: liga || null, ligaNome: nomeLiga(casa, liga),
          id: c.Id != null ? c.Id : null,
          horario: horarioDaGrade(lin, c),
          hora: limpo(c.Hora) || (lin.Hora != null ? String(lin.Hora) : null),
          minuto: limpo(c.Minuto),
          timeA: limpo(c.TimeA), timeB: limpo(c.TimeB),
          siglaA: limpo(c.SiglaA), siglaB: limpo(c.SiglaB),
          ftA, ftB, htA, htB,
          totalFT: (ftA == null || ftB == null) ? null : ftA + ftB,
          totalHT: (htA == null || htB == null) ? null : htA + htB,
          primeiroMarcar: limpo(c.PrimeiroMarcar),
          ultimoMarcar: limpo(c.UltimoMarcar),
          vencedorHtFt: limpo(c.Vencedor_HT_FT),
          oddHt: limpo(c.Resultado_HT_Odd),
          odds: parseOdds(c.Odds),
          dataInsercao: limpo(c.DataInsercao),
          atualizadoEm: limpo(json.DataAtualizacao),
          query: qs || null, capturadoEm: Date.now()
        });
      }
    }
    return out;
  }

  function parseEntradas(json, url, casa) {
    const lista = Array.isArray(json && json.entradas) ? json.entradas : [];
    return lista.map(e => ({
      tipo: 'entrada', casa,
      liga: ligaDaUrl(url) || null,
      ligaNome: e.liga || json.liga || nomeLiga(casa, ligaDaUrl(url)) || null,
      id: e.id || null, horario: limpo(e.horario),
      timeA: limpo(e.timeA), timeB: limpo(e.timeB),
      mercado: e.mercado || null, mercadoTexto: e.mercadoTexto || null,
      odd: e.odd != null ? Number(e.odd) : null,
      confianca: e.confianca || null,
      score: e.score != null ? Number(e.score) : null,
      amostra: e.amostra != null ? Number(e.amostra) : null,
      sg: e.sg, g1: e.g1, g2: e.g2, red: e.red,
      aproveitamentoG1: e.aproveitamentoG1,
      estrategiasParecidas: e.estrategiasParecidas,
      assinaturasParecidas: e.assinaturasParecidas,
      performanceRobosAteG1: e.performanceRobosAteG1,
      statusLote: json.status || null, geradoEm: json.generatedAt || null,
      capturadoEm: Date.now()
    }));
  }

  const resolver = l => (l.ligaNome ? l : Object.assign({}, l, { ligaNome: nomeLiga(l.casa, l.liga) }));

  const chave = l => [l.tipo, l.casa, l.liga, l.id != null ? l.id : '', l.horario, l.timeA, l.timeB].join('|');
  const versao = l => l.tipo === 'jogo'
    ? chave(l) + '|' + l.ftA + '-' + l.ftB + '|' + l.htA + '-' + l.htB
    : chave(l) + '|' + l.odd + '|' + l.score;

  // ============================================================
  // 5. VARREDURA DE LIGAS
  // ============================================================
  function varrerLigas() {
    const bases = new Map();
    for (const [k, r] of S.rotas) {
      if (/entradasAnalisadas/i.test(k) || !ehRotaKiron(r)) continue;
      if (!bases.has(r.casa) && temAutorizacao(r.headers)) bases.set(r.casa, r);
    }
    if (!bases.size) { S.ultimoErro = 'recarregue o BBTips uma vez para autorizar'; return; }

    const porCasa = [];
    for (const [, r] of bases) {
      const lista = [];
      for (const i of [6, 7, 8]) {
        const e = urlEntradas(r.url, i);
        const g = trocaLiga(r.url, i);
        if (e) lista.push({ url: e, headers: r.headers });
        if (g) lista.push({ url: g, headers: r.headers });
      }
      porCasa.push(lista);
    }
    // intercala as casas para que uma varredura interrompida cubra todas por igual
    const fila = [];
    const maior = Math.max.apply(null, porCasa.map(l => l.length));
    for (let i = 0; i < maior; i++) for (const l of porCasa) if (l[i]) fila.push(l[i]);
    S.varrendo = fila.length;
    fila.forEach((f, i) => setTimeout(() => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url: f.url, headers: f.headers, timeout: 20000,
          onload: r => {
            if (r.status >= 200 && r.status < 300) capturar(f.url, r.responseText, 'varredura', f.headers);
            else if (r.status === 401) S.ultimoErro = 'sessao expirada (401)';
            S.varrendo--;
          },
          onerror: () => { S.varrendo--; },
          ontimeout: () => { S.varrendo--; }
        });
      } catch (e) { S.varrendo--; }
    }, i * CFG.PAUSA_VARREDURA));
  }

  // ============================================================
  // 6. AUTO-REFETCH
  // ============================================================
  function refetch(somenteGrades) {
    if (!CFG.AUTO_REFETCH || !S.ativo) return;
    // A varredura completa pode levar dezenas de segundos. Bloquear tambem o
    // ciclo rapido nesse periodo fazia o resultado ficar 3 a 10 jogos atrasado
    // e depois chegar todo de uma vez. Durante a varredura pausamos somente o
    // refetch completo; as grades ao vivo continuam sendo consultadas.
    if (S.varrendo > 0 && !somenteGrades) return;
    let i = 0;
    for (const r of S.rotas.values()) {
      if (!ehRotaKiron(r)) continue;
      if (somenteGrades && /entradasAnalisadas/i.test(r.url)) continue;
      const atraso = (i++) * CFG.PAUSA_REFETCH;
      setTimeout(() => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url: semCache(r.url),
          headers: Object.assign({}, r.headers || {}, { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }),
          timeout: 20000,
          onload: x => {
            if (x.status >= 200 && x.status < 300) capturar(r.url, x.responseText, 'refetch', r.headers);
            else if (x.status === 401) S.ultimoErro = 'sessao expirada (401)';
          }
        });
      } catch (e) {}
      }, atraso);
    }
  }
  // Resultado ao vivo: consulta apenas as grades, com baixa latencia.
  // Entradas analisadas sao auxiliares e continuam no ciclo completo de 60 s.
  setInterval(() => refetch(true), CFG.INTERVALO_REFETCH);
  setInterval(() => refetch(false), CFG.INTERVALO_REFETCH_COMPLETO);

  // ============================================================
  // 6b. CONVERSAO PARA O FORMATO DO AMD LIVE 1
  //   mosaico: { passados:[{h,casa,fora,placar,total,odds}], futuros:[{h,casa,fora,odds}] }
  // ============================================================
  const hhmm = s2 => {
    if (!s2) return null;
    const m = String(s2).match(/(\d{1,2})\D(\d{2})/);
    return m ? (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] : String(s2);
  };

  function paraAmdLive() {
    const grupos = new Map();
    for (const l of S.buffer.values()) {
      if (l.tipo !== 'jogo') continue;
      const k = l.casa + '|' + l.liga;
      if (!grupos.has(k)) grupos.set(k, {
        origem: 'bbtips', casa: l.casa, liga: l.liga,
        ligaNome: nomeLiga(l.casa, l.liga), lastUpdated: l.atualizadoEm || null,
        mosaico: { passados: [], futuros: [] }
      });
      const g = grupos.get(k);
      const j = { h: hhmm(l.horario), casa: l.timeA, fora: l.timeB, odds: l.odds || null };
      if (l.oddHt) j.oddHt = Number(l.oddHt);
      if (l.ftA != null && l.ftB != null) {
        j.placar = l.ftA + '-' + l.ftB;
        j.total = l.ftA + l.ftB;
        if (l.htA != null && l.htB != null) { j.placarHt = l.htA + '-' + l.htB; j.totalHt = l.htA + l.htB; }
        g.mosaico.passados.push(j);
      } else {
        g.mosaico.futuros.push(j);
      }
    }
    const ordena = (a, b) => String(a.h).localeCompare(String(b.h));
    for (const g of grupos.values()) { g.mosaico.passados.sort(ordena); g.mosaico.futuros.sort(ordena); }
    return Array.from(grupos.values());
  }

  // ============================================================
  // 6c. PAYLOAD DO /api/dados DO AMD LIVE
  //   { liga, placares:[{a,b,total}], upcoming:[{nome,horario,casa,fora,odds}] }
  // ============================================================
  const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

  function paraApiDados() {
    const out = [];
    for (const g of paraAmdLive()) {
      const nomeLg = slug(g.ligaNome || ('liga' + g.liga));
      if (g.casa !== 'playpix' || !['cam', 'cop', 'ame'].includes(nomeLg)) continue;
      const placares = g.mosaico.passados
        .filter(j => j.placar)
        .map(j => {
          const [a, b] = j.placar.split('-').map(Number);
          const linha = { a, b, total: a + b };
          // nome do confronto: alimenta o Rank de times no dashboard
          if (j.casa && j.fora) linha.nome = j.casa + ' x ' + j.fora;
          if (j.h) linha.hora = j.h;
          if (j.odds) linha.odds = j.odds;
          else if (j.oddHt) linha.odds = { ht: j.oddHt };
          return linha;
        });
      const upcoming = g.mosaico.futuros.map(j => ({
        nome: j.casa + ' x ' + j.fora,
        horario: j.h, casa: j.casa, fora: j.fora, odds: j.odds || {}
      }));
      // Cada liga possui um tamanho diferente e, logo apos abrir a pagina,
      // pode haver somente jogos futuros. O servidor aceita ambos os casos;
      // exigir 20 encerrados mantinha ligas validas presas em "enviados: 0".
      if (!placares.length && !upcoming.length) continue;
      out.push({ liga: g.casa + '-' + nomeLg, placares, upcoming });
    }
    return out;
  }

  // ============================================================
  // 6d. TOKEN -> SERVIDOR
  //   O servidor nao tem sessao no BBTips. Mandando o token, ele passa a
  //   buscar todas as ligas de todas as casas sozinho, a cada 3 min,
  //   mesmo com o navegador fechado. Isso dispensa a varredura manual.
  // ============================================================
  function achaToken() {
    // o BBTips guarda em 'access_token' (as vezes com aspas/espacos) e dentro de 'currentUser'
    const RE = /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+/;
    const tenta = v => { const m = String(v || '').match(RE); return m ? m[0] : null; };
    try {
      // Fonte mais confiavel: o Bearer que o proprio BBTips acabou de usar.
      // O token salvo no localStorage pode continuar presente mesmo expirado.
      for (const r of S.rotas.values()) {
        const hs = (r && r.headers) || {};
        for (const [k, v] of Object.entries(hs)) {
          if (/^authorization$/i.test(k)) {
            const t = tenta(v);
            if (t) return t;
          }
        }
      }
      const diretas = ['access_token', 'token', 'accessToken', 'jwt', 'currentUser'];
      for (const k of diretas) { const t = tenta(localStorage.getItem(k)); if (t) return t; }
      for (const k of Object.keys(localStorage)) { const t = tenta(localStorage.getItem(k)); if (t) return t; }
      for (const k of Object.keys(sessionStorage || {})) { const t = tenta(sessionStorage.getItem(k)); if (t) return t; }
    } catch (e) {}
    return null;
  }

  let _tokenEnviado = null;
  function mandaToken(forcado) {
    if (!CFG.ENVIAR) return;
    const t = String(forcado || tokenCapturado || achaToken() || '').replace(/^Bearer\s+/i, '').trim();
    if (!t) return;
    const base = String(CFG.COLETOR_URL).replace(/\/api\/dados.*$/, '');
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: base + '/api/bbtips/token',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ token: t }), timeout: 20000,
        onload: r => { if (r.status >= 200 && r.status < 300) { _tokenEnviado = t; S.tokenOk = true; } }
      });
    } catch (e) {}
  }
  setTimeout(mandaToken, 5000);
  setInterval(mandaToken, 60000);    // renova a coleta rapida a cada minuto

  // ============================================================
  // 7. ENVIO
  // ============================================================
  function enviarLote() {
    if (!CFG.ENVIAR || !S.ativo || S.buffer.size === 0) return;

    // apidados: uma chamada por casa+liga, no formato que o AMD Live ja aceita
    if (CFG.FORMATO === 'apidados') {
      const pacotes = paraApiDados();
      if (!pacotes.length) { S.ultimoErro = 'sem liga com 20+ jogos'; return; }
      let ok = 0, total = 0;
      pacotes.forEach((pk, i) => setTimeout(() => {
        try {
          GM_xmlhttpRequest({
            method: 'POST', url: CFG.COLETOR_URL,
            headers: { 'Content-Type': 'application/json', 'x-amd-token': CFG.TOKEN },
            data: JSON.stringify(pk), timeout: 30000,
            onload: r => {
              if (r.status >= 200 && r.status < 300) { ok++; total += pk.placares.length + pk.upcoming.length; S.enviados = total; S.ultimoEnvio = Date.now(); S.ultimoErro = ''; }
              else { S.erros++; S.ultimoErro = pk.liga + ': HTTP ' + r.status; }
            },
            onerror: () => { S.erros++; S.ultimoErro = pk.liga + ': rede'; },
            ontimeout: () => { S.erros++; S.ultimoErro = pk.liga + ': timeout'; }
          });
        } catch (e) { S.erros++; S.ultimoErro = String(e.message || e); }
      }, i * 250));
      return;
    }

    // amdlive1 manda o snapshot completo de cada liga (o mosaico precisa estar inteiro)
    if (CFG.FORMATO === 'amdlive1') {
      const ligas = paraAmdLive();
      if (!ligas.length) return;
      try {
        GM_xmlhttpRequest({
          method: 'POST', url: CFG.COLETOR_URL,
          headers: { 'Content-Type': 'application/json', 'x-amd-token': CFG.TOKEN },
          data: JSON.stringify({ origem: 'bbtips', formato: 'amdlive1', enviadoEm: Date.now(), ligas }),
          timeout: 30000,
          onload: r => {
            if (r.status >= 200 && r.status < 300) {
              S.enviados = ligas.reduce((a, g) => a + g.mosaico.passados.length + g.mosaico.futuros.length, 0);
              S.ultimoEnvio = Date.now(); S.ultimoErro = '';
            } else { S.erros++; S.ultimoErro = 'coletor HTTP ' + r.status; }
          },
          onerror: () => { S.erros++; S.ultimoErro = 'coletor rede'; },
          ontimeout: () => { S.erros++; S.ultimoErro = 'coletor timeout'; }
        });
      } catch (e) { S.erros++; S.ultimoErro = String(e.message || e); }
      return;
    }

    const linhas = Array.from(S.buffer.values()).slice(0, CFG.LOTE_MAX).map(resolver);
    const ks = linhas.map(chave), vs = linhas.map(versao);
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: CFG.COLETOR_URL,
        headers: { 'Content-Type': 'application/json', 'x-amd-token': CFG.TOKEN },
        data: JSON.stringify({ origem: 'bbtips', href: location.href, enviadoEm: Date.now(), linhas }),
        timeout: 25000,
        onload: r => {
          if (r.status >= 200 && r.status < 300) {
            ks.forEach(k => S.buffer.delete(k));
            vs.forEach(v => S.versoes.add(v));
            S.enviados += linhas.length; S.ultimoEnvio = Date.now(); S.ultimoErro = '';
          } else { S.erros++; S.ultimoErro = 'coletor HTTP ' + r.status; }
        },
        onerror: () => { S.erros++; S.ultimoErro = 'coletor rede'; },
        ontimeout: () => { S.erros++; S.ultimoErro = 'coletor timeout'; }
      });
    } catch (e) { S.erros++; S.ultimoErro = String(e.message || e); }
  }
  setInterval(enviarLote, CFG.INTERVALO_ENVIO);

  // ============================================================
  // 8. EXPORTAR
  // ============================================================
  function baixar(nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  const exportarJSON = () =>
    baixar('bbtips-' + Date.now() + '.json', JSON.stringify(Array.from(S.buffer.values()).map(resolver), null, 2), 'application/json');

  function exportarCSV() {
    const cols = ['casa', 'liga', 'ligaNome', 'id', 'horario', 'timeA', 'timeB', 'siglaA', 'siglaB',
      'ftA', 'ftB', 'htA', 'htB', 'totalFT', 'totalHT', 'primeiroMarcar', 'ultimoMarcar',
      'vencedorHtFt', 'oddHt', 'dataInsercao'];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const out = [cols.join(',')];
    for (const l0 of S.buffer.values()) { const l = resolver(l0); if (l.tipo === 'jogo') out.push(cols.map(c => esc(l[c])).join(',')); }
    baixar('bbtips-grade-' + Date.now() + '.csv', out.join('\n'), 'text/csv');
  }

  function relatorio() {
    const ligas = [];
    for (const [k, r] of S.ligas) ligas.push({ casaLiga: k, nome: S.nomes.get(k) || null, jogos: r.n, exemplo: r.exemplo });
    const rotas = [];
    for (const [k, r] of S.rotas) rotas.push({ rota: k, url: r.url, auth: !!(r.headers && r.headers.Authorization) });
    const eps = [];
    for (const [p, r] of S.endpoints) eps.push({ path: p, chamadas: r.n, amostra: r.amostra.slice(0, 1500) });
    return JSON.stringify({ ligas, rotas, endpoints: eps }, null, 2);
  }

  // ============================================================
  // 9. PAINEL
  // ============================================================
  const btn = () => 'background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:5px 0;cursor:pointer;font:11px ui-monospace,monospace';

  function montarPainel() {
    if (document.getElementById('amd-coletor')) return;
    const p = document.createElement('div');
    p.id = 'amd-coletor';
    p.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;width:252px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:10px;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none';
    p.innerHTML =
      '<div id="amd-cab" style="display:flex;justify-content:space-between;align-items:center;cursor:move;margin-bottom:8px">' +
      '<b style="letter-spacing:.5px">AMD COLETOR <small style="color:#58a6ff">v5.0</small></b><span id="amd-led" style="width:9px;height:9px;border-radius:50%;background:#3fb950"></span></div>' +
      '<div id="amd-info" style="color:#9198a1"></div>' +
      '<button id="amd-var" style="' + btn() + ';width:100%;margin-top:9px;padding:7px 0;background:#1f6feb;border-color:#1f6feb">Varrer todas as ligas</button>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px">' +
      '<button id="amd-tog" style="' + btn() + '">Pausar</button>' +
      '<button id="amd-end" style="' + btn() + '">Relatorio</button>' +
      '<button id="amd-json" style="' + btn() + '">Salvar AMD</button>' +
      '<button id="amd-csv" style="' + btn() + '">Salvar CSV</button>' +
      '<button id="amd-env" style="' + btn() + '">Enviar agora</button>' +
      '<button id="amd-lim" style="' + btn() + '">Limpar</button></div>';
    document.body.appendChild(p);

    p.querySelector('#amd-var').onclick = varrerLigas;
    p.querySelector('#amd-tog').onclick = e => {
      S.ativo = !S.ativo; store.set('amd_ativo', S.ativo);
      e.target.textContent = S.ativo ? 'Pausar' : 'Coletar';
    };
    p.querySelector('#amd-json').onclick = () => {
      if (CFG.FORMATO === 'apidados') return baixar('apidados-bbtips-' + Date.now() + '.json', JSON.stringify(paraApiDados(), null, 2), 'application/json');
      if (CFG.FORMATO === 'amdlive1') return baixar('amdlive-bbtips-' + Date.now() + '.json', JSON.stringify(paraAmdLive(), null, 2), 'application/json');
      return exportarJSON();
    };
    p.querySelector('#amd-csv').onclick = exportarCSV;
    p.querySelector('#amd-env').onclick = () => { const a = CFG.ENVIAR; CFG.ENVIAR = true; enviarLote(); CFG.ENVIAR = a; };
    p.querySelector('#amd-lim').onclick = () => {
      S.buffer.clear(); S.versoes.clear(); S.endpoints.clear(); S.ligas.clear(); S.nomes.clear(); try { store.set('amd_nomes', {}); } catch (e) {}
      S.jogos = 0; S.entradas = 0; S.enviados = 0; S.erros = 0; S.ultimoErro = '';
    };
    p.querySelector('#amd-end').onclick = abrirRelatorio;
    arrastar(p, p.querySelector('#amd-cab'));
  }

  function abrirRelatorio() {
    const v = document.createElement('div');
    v.style.cssText = 'position:fixed;inset:5%;z-index:2147483647;background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px';
    const t = document.createElement('textarea');
    t.value = relatorio();
    t.style.cssText = 'flex:1;width:100%;background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font:11px ui-monospace,monospace';
    const barra = document.createElement('div');
    barra.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = btn() + ';padding:6px 14px'; b.onclick = fn; return b; };
    barra.append(
      mk('Copiar', () => { t.select(); document.execCommand('copy'); }),
      mk('Salvar arquivo', () => baixar('bbtips-relatorio.json', t.value, 'application/json')),
      mk('Fechar', () => v.remove())
    );
    v.append(t, barra);
    document.body.appendChild(v);
  }

  function arrastar(el, alca) {
    let x = 0, y = 0, on = false;
    alca.addEventListener('mousedown', e => {
      on = true; x = e.clientX - el.offsetLeft; y = e.clientY - el.offsetTop;
      el.style.right = 'auto'; el.style.bottom = 'auto'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!on) return;
      el.style.left = (e.clientX - x) + 'px'; el.style.top = (e.clientY - y) + 'px';
    });
    document.addEventListener('mouseup', () => { on = false; });
  }

  const espera = setInterval(() => { if (document.body) { clearInterval(espera); montarPainel(); } }, 300);

  setInterval(() => {
    const info = document.getElementById('amd-info');
    if (!info) return;
    const led = document.getElementById('amd-led');
    if (led) led.style.background = !S.ativo ? '#484f58' : (S.ultimoErro ? '#d29922' : '#3fb950');
    const cont = {};
    for (const l of S.buffer.values()) cont[l.casa] = (cont[l.casa] || 0) + 1;
    const casas = Object.keys(cont).sort().map(c => c + ':' + cont[c]).join('  ') || '-';
    info.innerHTML =
      'jogos: ' + S.jogos + '  entradas: ' + S.entradas + '<br>' +
      'ligas: ' + S.ligas.size + ' (nome: ' + S.nomes.size + ')  rotas: ' + S.rotas.size + '<br>' +
      casas + '<br>' +
      'enviados: ' + S.enviados + (CFG.ENVIAR ? '' : ' (envio off)') +
      (S.tokenOk ? ' <span style="color:#3fb950">token ok</span>' : '') +
      (S.varrendo > 0 ? '<br><span style="color:#58a6ff">varrendo... ' + S.varrendo + '</span>' : '') +
      (S.ultimoErro ? '<br><span style="color:#f85149">' + S.ultimoErro + '</span>' : '');
  }, 1000);

  console.log('[AMD] coletor bbtips v5.0 carregado (Kiron CAM/COP/AME)');
})();
