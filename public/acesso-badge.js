/* Mostra ao usuario logado quanto tempo de acesso ainda resta. */
(function () {
  'use strict';
  function restante(ms) {
    if (!(ms > 0)) return 'expirado';
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'min';
  }
  var el = document.createElement('div');
  el.id = 'amd-acesso';
  el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#0b1210;border:1px solid #1e3a2a;color:#9fe0b4;font:12px system-ui;padding:6px 10px;border-radius:999px;box-shadow:0 4px 16px #0008;display:none';
  var expira = 0, nome = '';
  function pinta() {
    if (!expira) return;
    var ms = expira - Date.now();
    el.style.display = 'block';
    el.style.color = ms < 86400000 ? '#f0b90b' : '#9fe0b4';
    el.textContent = '⏳ Acesso' + (nome && nome !== 'Usuario' ? ' de ' + nome : '') + ': ' + restante(ms);
  }
  function carrega() {
    fetch('/api/acesso/sessao', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.ok) { expira = Number(j.expira) || 0; nome = j.nome || ''; pinta(); } })
      .catch(function () {});
  }
  function inicia() { document.body.appendChild(el); carrega(); setInterval(pinta, 30000); setInterval(carrega, 10 * 60000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicia); else inicia();
})();
