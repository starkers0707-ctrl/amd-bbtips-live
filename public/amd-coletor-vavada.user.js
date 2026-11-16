// ==UserScript==
// @name         AMD Coletor Vavada Kiron
// @namespace    amd.live
// @version      1.0.1
// @description  Coleta as seis ligas Kiron diretamente da API Vavada e envia ao AMD Live.
// @match        https://vavada.com/*
// @match        https://*.vavada.com/*
// @grant        GM_xmlhttpRequest
// @connect      sb2virtuals-altenar2.biahosted.com
// @connect      amd-bbtips-live.onrender.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const API = 'https://sb2virtuals-altenar2.biahosted.com/api/';
  const AMD = 'https://amd-bbtips-live.onrender.com/api/dados';
  const QS = {
    culture: 'pt-PT', timezoneOffset: '180', integration: 'vavada',
    deviceType: '1', numFormat: 'en-GB', countryCode: 'BR'
  };
  const INTERVALO = 15000;
  const PAUSA = 120;
  const MAX_HISTORICO = 1500;
  const fallbackIds = { bra: 55, eng: 57, ita: 59, lat: 61, spa: 63, mnd: 92 };
  const regras = {
    eng: /england|inglaterra|english/i,
    ita: /italy|italia|italian/i,
    spa: /spain|espanha|spanish/i,
    mnd: /world|mundial|mundo|copa do mundo/i,
    bra: /brazil|brasil|brasileir/i,
    lat: /latin|latina|america latina|south america/i
  };
  const estado = { rodando: false, ciclo: 0, enviados: 0, erro: '', ligas: {} };
  const cacheDetalhe = new Map();
  const espera = ms => new Promise(r => setTimeout(r, ms));

  function request(method, url, data) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url, data: data == null ? undefined : JSON.stringify(data),
      headers: data == null ? { Accept: 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 12000,
      onload: r => {
        if (r.status < 200 || r.status >= 300) return reject(new Error(`HTTP ${r.status} ${url}`));
        try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
      },
      ontimeout: () => reject(new Error(`timeout ${url}`)),
      onerror: () => reject(new Error(`rede ${url}`))
    }));
  }

  function urlApi(path, extra = {}) {
    const u = new URL(path, API);
    Object.entries({ ...QS, ...extra }).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    return u.href;
  }

  function lista(x, nomes) {
    for (const n of nomes) if (Array.isArray(x?.[n])) return x[n];
    return Array.isArray(x) ? x : [];
  }

  function textoGame(g) {
    return [g?.name, g?.title, g?.displayName, g?.sportName, g?.leagueName, g?.categoryName]
      .filter(Boolean).join(' ');
  }

  function resolveGames(json) {
    const games = lista(json, ['games', 'items', 'data']);
    const usados = new Set();
    const out = {};
    for (const [liga, re] of Object.entries(regras)) {
      let g = games.find(x => !usados.has(x) && re.test(textoGame(x)));
      if (!g) g = games.find(x => Number(x.id) === fallbackIds[liga] || Number(x.typeId) === fallbackIds[liga] || Number(x.gameTypeId) === fallbackIds[liga]);
      if (g) { out[liga] = g; usados.add(g); }
    }
    return { out, disponiveis: games.map(g => ({ id: g.id, dbId: g.dbId, nome: textoGame(g) })).slice(0, 80) };
  }

  function idsMercado(detail, typeId) {
    const m = lista(detail, ['markets', 'marketList']).find(x => Number(x.typeId) === typeId);
    return new Set([...(m?.desktopOddIds || []), ...(m?.mobileOddIds || [])].flat(Infinity).map(Number));
  }

  function oddsMercado(detail, typeId) {
    const ids = idsMercado(detail, typeId);
    return lista(detail, ['odds', 'oddList']).filter(o => ids.has(Number(o.id)));
  }

  function linha(odd) {
    try {
      const sv = typeof odd?.sv === 'string' ? JSON.parse(odd.sv) : odd?.sv;
      return String(sv?.['1'] ?? sv?.[1] ?? '').replace(',', '.');
    } catch { return ''; }
  }

  function nomes(detail, ev) {
    const c = lista(detail, ['competitors', 'participants']);
    const p = String(detail?.name || ev?.name || '').split(/\s+vs\.?\s+|\s+x\s+/i);
    return [c[0]?.name || p[0] || 'Casa', c[1]?.name || p[1] || 'Fora'];
  }

  function horaBR(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }

  function oddPor(detail, mercado, teste) {
    return oddsMercado(detail, mercado).find(teste);
  }

  function parse(detail, ev, liga) {
    const [casa, fora] = nomes(detail, ev);
    const horario = horaBR(detail?.startDate || ev?.startDate);
    const o25 = oddPor(detail, 18, o => Number(o.typeId) === 12 && linha(o) === '2.5');
    const o35 = oddPor(detail, 18, o => Number(o.typeId) === 12 && linha(o) === '3.5');
    const ambs = oddPor(detail, 29, o => Number(o.typeId) === 74 || /^sim$/i.test(String(o.name || '')));
    const ambn = oddPor(detail, 29, o => Number(o.typeId) === 76 || /^n[aã]o$/i.test(String(o.name || '')));
    const inicio = detail?.startDate || ev?.startDate || null;
    const base = { id: `vavada:${liga}:${ev.id}`, nome: `${casa} x ${fora}`, casa, fora, horario, hora: horario, inicio,
      odds: { o25: o25?.price ?? null, o35: o35?.price ?? null, ambs: ambs?.price ?? null, ambn: ambn?.price ?? null }, fonte: 'vavada' };
    if (Number(ev.status) !== 2) return { tipo: 'futuro', jogo: base };
    const exatas = oddsMercado(detail, 199).filter(o => Number(o.oddStatus) === 1);
    const vencedor = oddsMercado(detail, 1).filter(o => Number(o.oddStatus) === 1);
    if (exatas.length !== 1 || vencedor.length !== 1) return null;
    const placar = String(exatas[0].name || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
    if (!placar) return null;
    return { tipo: 'placar', jogo: { ...base, a: Number(placar[1]), b: Number(placar[2]), total: Number(placar[1]) + Number(placar[2]), placar: `${placar[1]}-${placar[2]}` } };
  }

  function chaveStorage(liga) { return `amd-vavada-${liga}-v1`; }
  function historico(liga) {
    try { return JSON.parse(localStorage.getItem(chaveStorage(liga)) || '[]'); } catch { return []; }
  }
  function salvar(liga, jogos) {
    const porId = new Map(historico(liga).concat(jogos).map(j => [j.id, j]));
    const arr = [...porId.values()].sort((a, b) => {
      const ta = Date.parse(a.inicio || '') || 0;
      const tb = Date.parse(b.inicio || '') || 0;
      return ta - tb || String(a.id).localeCompare(String(b.id));
    }).slice(-MAX_HISTORICO);
    localStorage.setItem(chaveStorage(liga), JSON.stringify(arr));
    return arr;
  }

  async function processarLiga(liga, game) {
    const dbId = game.dbId ?? 12;
    const listJson = await request('GET', urlApi('Virtuals/GetEventList', { id: game.id, dbId }));
    const eventos = lista(listJson, ['events', 'items', 'data']);
    const placaresNovos = [], futuros = [];
    for (const ev of eventos) {
      const ck = `${game.id}:${ev.id}:${ev.status}`;
      let p = cacheDetalhe.get(ck);
      if (!p) {
        await espera(PAUSA);
        const d = await request('GET', urlApi('WidgetVirtuals/GetVirtualEventDetails', { eventId: ev.id, id: game.id, dbId }));
        p = parse(d, ev, liga);
        if (p) cacheDetalhe.set(ck, p);
      }
      if (p?.tipo === 'placar') placaresNovos.push(p.jogo);
      if (p?.tipo === 'futuro') futuros.push(p.jogo);
    }
    const placares = salvar(liga, placaresNovos);
    const resposta = await request('POST', AMD, { liga, nomeLiga: liga, placares, upcoming: futuros, fonte: 'vavada-browser' });
    estado.ligas[liga] = { id: game.id, dbId, placares: placares.length, futuros: futuros.length, ts: Date.now(), resposta };
    estado.enviados += placaresNovos.length;
  }

  async function ciclo() {
    if (estado.rodando) return;
    estado.rodando = true; estado.ciclo++; estado.erro = '';
    try {
      const gamesJson = await request('GET', urlApi('Virtuals/GetGames'));
      const resolvido = resolveGames(gamesJson);
      estado.disponiveis = resolvido.disponiveis;
      for (const liga of ['eng', 'ita', 'spa', 'mnd', 'bra', 'lat']) {
        const game = resolvido.out[liga];
        if (!game) { estado.ligas[liga] = { erro: 'liga não localizada em GetGames' }; continue; }
        try { await processarLiga(liga, game); }
        catch (e) { estado.ligas[liga] = { ...(estado.ligas[liga] || {}), erro: String(e.message || e), ts: Date.now() }; }
      }
    } catch (e) { estado.erro = String(e.message || e); }
    finally { estado.rodando = false; render(); }
  }

  function render() {
    let p = document.getElementById('amd-vavada-status');
    if (!p) {
      p = document.createElement('pre'); p.id = 'amd-vavada-status';
      p.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;max-height:42vh;overflow:auto;background:#071018;color:#d7e3ef;border:1px solid #1f6feb;border-radius:10px;padding:12px;font:12px/1.4 monospace;white-space:pre-wrap';
      document.body.appendChild(p);
    }
    p.textContent = `AMD VAVADA DIRETO ${estado.rodando ? 'coletando...' : 'ativo'}\n` +
      `ciclo ${estado.ciclo} · enviados novos ${estado.enviados}\n` +
      (estado.erro ? `ERRO: ${estado.erro}\n` : '') +
      Object.entries(estado.ligas).map(([l, x]) => `${l.toUpperCase()}: ${x.placares ?? 0} resultados · ${x.futuros ?? 0} futuros${x.erro ? ' · ' + x.erro : ''}`).join('\n');
  }

  render();
  ciclo();
  setInterval(ciclo, INTERVALO);
})();
