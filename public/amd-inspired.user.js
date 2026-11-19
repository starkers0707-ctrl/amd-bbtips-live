// ==UserScript==
// @name         AMD Inspired (CAM / COP / AME)
// @namespace    amd.live
// @version      1.0.0
// @description  Com o thtips.com.br aberto e logado, envia as grades PlayPix CAM/COP/AME para o AMD
// @author       AMD
// @updateURL    https://amd-virtual-live.onrender.com/amd-inspired.user.js
// @downloadURL  https://amd-virtual-live.onrender.com/amd-inspired.user.js
// @match        https://thtips.com.br/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      amd-virtual-live.onrender.com
// @connect      amdlive.com.br
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  // ===== CONFIG =====
  const SERVIDOR = 'https://amd-virtual-live.onrender.com';
  // Chave = valor de TAMPERMONKEY_TOKEN no Render. Pedida uma vez e guardada
  // no Tampermonkey (sobrevive a atualizacoes do script).
  let CHAVE = GM_getValue('chave', '');
  if (!CHAVE) {
    CHAVE = String(prompt('AMD Inspired: cole a chave TAMPERMONKEY_TOKEN do Render') || '').trim();
    if (CHAVE) GM_setValue('chave', CHAVE);
  }
  const INTERVALO = 15000;
  const LIGAS = { cam: 6, cop: 7, ame: 8 };
  const API = 'https://api.thtips.com.br/api/PlayPixFutebolVirtual';

  const marca = {};      // ultimaAtualizacao por liga
  const enviouCheia = {}; // primeira grade vai com 24h
  let rodando = false;
  let status = 'iniciando';

  // So uma aba coleta por vez
  const ABA = Math.random().toString(36).slice(2);
  function souDona() {
    try {
      const d = JSON.parse(localStorage.getItem('amdInspiredAba') || 'null');
      if (!d || d.id === ABA || Date.now() - d.ts > INTERVALO * 3) {
        localStorage.setItem('amdInspiredAba', JSON.stringify({ id: ABA, ts: Date.now() }));
        return true;
      }
    } catch (e) { return true; }
    return false;
  }

  function token() {
    return String(localStorage.getItem('access_token') || '').replace(/"/g, '').trim();
  }

  async function bb(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_amd=' + Date.now(), {
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error('BBTips HTTP ' + r.status);
    return r.json();
  }

  function envia(grades) {
    return new Promise((ok, falha) => GM_xmlhttpRequest({
      method: 'POST',
      url: SERVIDOR + '/api/inspired/grade',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CHAVE },
      data: JSON.stringify({ grades }),
      timeout: 30000,
      onload: r => {
        if (r.status === 401) GM_setValue('chave', '');
        if (r.status >= 200 && r.status < 300) ok(r.responseText);
        else falha(new Error('AMD HTTP ' + r.status + ' ' + String(r.responseText).slice(0, 80)));
      },
      onerror: () => falha(new Error('AMD sem resposta')),
      ontimeout: () => falha(new Error('AMD timeout'))
    }));
  }

  async function ciclo() {
    if (rodando || !souDona()) return;
    if (!CHAVE) { status = 'falta CHAVE no script'; return pinta(); }
    if (!token()) { status = 'faça login no BBTips'; return pinta(); }
    rodando = true;
    try {
      const grades = {};
      for (const [liga, id] of Object.entries(LIGAS)) {
        const ua = String(await bb(`${API}/ultimaAtualizacao?liga=${id}`));
        if (ua === marca[liga]) continue;
        const horas = enviouCheia[liga] ? 'Horas12' : 'Horas24';
        grades[liga] = await bb(`${API}?Liga=${id}&Horas=${horas}&filtros=&confrontos=false&hrsConfrontos=240`);
        grades[liga].__ua = ua;
      }
      const ligas = Object.keys(grades);
      if (ligas.length) {
        const resp = JSON.parse(await envia(grades));
        for (const l of ligas) { marca[l] = grades[l].__ua; enviouCheia[l] = true; }
        status = 'ok ' + new Date().toLocaleTimeString('pt-BR') + ' · ' + ligas.map(l => l.toUpperCase() + ' ' + ((resp.ligas || {})[l] || 0)).join(' · ');
      } else if (!/^ok/.test(status)) status = 'aguardando atualização';
    } catch (e) {
      status = 'erro: ' + e.message;
    } finally {
      rodando = false;
      pinta();
    }
  }

  let selo = null;
  function pinta() {
    if (!selo) {
      selo = document.createElement('div');
      selo.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#0b1210;color:#9fe8b4;border:1px solid #1e3a2a;border-radius:8px;padding:5px 9px;font:11px system-ui,sans-serif;opacity:.9;pointer-events:none';
      document.body.appendChild(selo);
    }
    selo.textContent = 'AMD Inspired: ' + status;
    selo.style.color = /^ok|aguard/.test(status) ? '#9fe8b4' : '#ff8a8a';
  }

  setTimeout(ciclo, 2000);
  setInterval(ciclo, INTERVALO);
})();
