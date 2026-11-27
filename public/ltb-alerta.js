/* ============================================================================
 * ALERTA DE QUEBRA DE LTB  ·  sempre no grafico ACUMULADO 00h
 * ----------------------------------------------------------------------------
 * Vigia as 9 ligas no mercado selecionado. LTB = mesma linha de tendencia de
 * baixa desenhada no grafico (linhaTendencia, ultimos 40 jogos do 00h).
 * Dispara quando o ultimo jogo fecha ACIMA da LTB e o jogo anterior estava
 * abaixo (quebra nova). Um aviso por LTB. Nao avisa com < 60 jogos no dia.
 * Botao liga/desliga no painel lateral (salvo no navegador).
 * ========================================================================== */
(function () {
  'use strict';
  var LS = 'amd_alerta_ltb00', MIN_DIA = 60, INTERVALO = 45000;
  var avisados = {}, ultimoMerc = null;
  var NOMES = { eng: 'ENG', ita: 'ITA', spa: 'SPA', mnd: 'MND', bra: 'BRA', lat: 'LAT', cam: 'CAM', cop: 'COP', ame: 'AME' };

  function ligado() { try { return localStorage.getItem(LS) !== '0'; } catch (e) { return true; } }
  function mercado() { try { return (typeof state !== 'undefined' && state.mercado) || 'Over 2.5'; } catch (e) { return 'Over 2.5'; } }

  function botao() {
    var b = document.getElementById('ltbAlert00');
    if (b) return b;
    var ref = document.getElementById('fib50AlertStatus');
    if (!ref || !ref.parentNode) return null;
    b = document.createElement('button');
    b.type = 'button'; b.id = 'ltbAlert00'; b.className = 'btn-al ltb00-alert';
    var st = document.createElement('small'); st.id = 'ltbAlert00Status'; st.className = 'fib50-status';
    ref.parentNode.insertBefore(st, ref.nextSibling);
    ref.parentNode.insertBefore(b, st);
    b.addEventListener('click', function () {
      try { localStorage.setItem(LS, ligado() ? '0' : '1'); } catch (e) {}
      if (ligado() && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      pinta(); if (ligado()) verifica(true);
    });
    return b;
  }
  function pinta(txt) {
    var b = botao(); if (!b) return;
    var on = ligado();
    b.textContent = on ? '📉 Alerta quebra de LTB (00h): LIGADO' : '📉 Alerta quebra de LTB (00h): DESLIGADO';
    b.classList.toggle('armed', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    var st = document.getElementById('ltbAlert00Status');
    if (st) st.textContent = on ? (txt || 'vigiando as 9 ligas no ' + mercado() + ' · gráfico 00h') : 'desligado';
  }

  function ltbDe(line) {
    if (typeof linhaTendencia !== 'function') return null;
    try { return linhaTendencia(line, 'LTB'); } catch (e) { return null; }
  }
  function valorLTB(l, i) { var m = (l.b.v - l.a.v) / (l.b.i - l.a.i); return l.b.v + m * (i - l.b.i); }

  function avisa(lg, merc, jogo, l, line, ac) {
    var nome = NOMES[lg] || lg.toUpperCase(), n = line.length;
    var titulo = '📈 QUEBRA DE LTB ' + (jogo.hora || '') + ' — ' + nome + ' · ' + merc;
    var corpo = 'Gráfico 00h rompeu a LTB: linha ' + line[n - 1].toFixed(1) + '% acima de ' + valorLTB(l, n - 1).toFixed(1) + '%' +
      (jogo.ta ? ' · jogo ' + jogo.ta + ' x ' + jogo.tb + ' ' + jogo.a + '-' + jogo.b : '') +
      (ac && ac.conhecido ? (ac.ok ? ' · 00h ▲ liberado (MM9>MM21, linha≥MM9)' : ' · ⛔ 00h ainda não liberou: ' + ac.motivo) : '');
    if (typeof mostrarAviso === 'function') mostrarAviso(titulo + ' · ' + corpo);
    if (typeof somDeAlertaLigado === 'function' && somDeAlertaLigado() && typeof bip === 'function') bip();
    if (typeof alertaPodeDispararAgora === 'function' && !alertaPodeDispararAgora()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opcoes = { body: corpo, tag: 'amd-ltb00-' + lg + '-' + (jogo.hora || ''), renotify: true, requireInteraction: true, data: { url: '/index.html' } };
    var direta = function () { try { return new Notification(titulo, opcoes); } catch (e) { return null; } };
    var reg = typeof registrarAlertasDeFundo === 'function' ? registrarAlertasDeFundo() : Promise.resolve(null);
    Promise.resolve(reg).then(function (r) {
      if (r && typeof r.showNotification === 'function') return Promise.resolve(r.showNotification(titulo, opcoes)).catch(direta);
      return direta();
    }).catch(direta);
  }

  /* inicial=true: so registra as quebras ja existentes, sem avisar (evita
     alerta velho ao abrir a pagina ou ligar o botao) */
  function verifica(inicial) {
    if (!ligado() || !window.AcumGuard || !window.AcumGuard.serieHoje) return;
    var merc = mercado(), rompidas = [];
    if (merc !== ultimoMerc) { ultimoMerc = merc; inicial = true; }
    (window.AcumGuard.ligas || Object.keys(NOMES)).forEach(function (lg) {
      var s = window.AcumGuard.serieHoje(lg, merc);
      if (!s || s.line.length < MIN_DIA) return;
      var line = s.line, n = line.length, l = ltbDe(line);
      if (!l || l.b.i >= n - 1) return;
      /* sem folga: mesmo criterio do 'QUEBROU A LTB' do grafico (a folga atrasava 1 jogo) */
      var tol = 0;
      var agora = line[n - 1] > valorLTB(l, n - 1) + tol;
      /* cruzou nos ultimos 3 jogos (ciclo de 30s pode pegar 2 jogos de uma vez) */
      var cruzou = false;
      for (var k = Math.max(l.b.i + 1, n - 3); k < n; k++) if (line[k] > valorLTB(l, k) + tol && line[k - 1] <= valorLTB(l, k - 1) + tol) cruzou = true;
      var chave = lg + '|' + merc + '|' + s.dia + '|' + l.a.i + '-' + l.b.i;
      if (agora) rompidas.push(NOMES[lg]);
      if (agora && cruzou && !avisados[chave]) {
        avisados[chave] = 1;
        if (!inicial) avisa(lg, merc, s.jogos[n - 1], l, line, window.AcumGuard.estado(lg, merc));
      }
    });
    pinta(rompidas.length ? 'acima da LTB agora: ' + rompidas.join(', ') : null);
  }

  function ciclo() {
    if (!ligado()) { pinta(); return; }
    if (window.AcumGuard && window.AcumGuard.atualizaLiga) (window.AcumGuard.ligas || []).forEach(window.AcumGuard.atualizaLiga);
    setTimeout(function () { verifica(false); }, 2500);
  }
  /* tempo real: o servidor avisa (SSE) quando entra jogo novo numa liga;
     recarrega so essa liga e confere na hora, sem esperar o ciclo */
  function escutaServidor() {
    if (!('EventSource' in window)) return;
    var es;
    try { es = new EventSource('/api/eventos'); } catch (e) { return; }
    es.onmessage = function (ev) {
      var p; try { p = JSON.parse(ev.data || '{}'); } catch (e) { return; }
      if (!p || p.tipo !== 'liga' || !ligado() || !window.AcumGuard || !window.AcumGuard.atualizaLiga) return;
      var lg = String(p.liga || '').toLowerCase().slice(0, 3);
      Promise.resolve(window.AcumGuard.atualizaLiga(lg)).then(function () { verifica(false); });
    };
  }
  function init() {
    pinta();
    escutaServidor();
    setTimeout(function () { verifica(true); }, 3000);
    setInterval(ciclo, INTERVALO);
  }
  window.AlertaLTB00 = { verifica: verifica, ligado: ligado };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 2000); });
  else setTimeout(init, 2000);
})();
