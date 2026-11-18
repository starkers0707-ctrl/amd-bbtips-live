/* Atualiza grade, grafico e alertas de MM com a aba em segundo plano.
 * O navegador segura os temporizadores de abas escondidas (ate 1x/min), o que
 * atrasava o alerta de medias. O aviso em tempo real do servidor (SSE) nao e
 * segurado: quando chega resultado novo da liga aberta, buscamos na hora. */
(function () {
  'use strict';
  if (!('EventSource' in window)) return;
  var emVoo = false, ultimo = 0;
  function ligaAberta() {
    try { return window.Real && typeof window.Real.liga === 'function' ? String(window.Real.liga() || '').toLowerCase() : ''; }
    catch (e) { return ''; }
  }
  function atualizaAgora() {
    if (emVoo || !window.Real || typeof window.Real.buscar !== 'function') return;
    emVoo = true; ultimo = Date.now();
    Promise.resolve(window.Real.buscar()).then(function (ok) {
      if (ok && typeof window.Real.pintar === 'function') window.Real.pintar();
    }).catch(function () {}).then(function () { emVoo = false; });
  }
  function abre() {
    var es;
    try { es = new EventSource('/api/eventos'); } catch (e) { return; }
    es.onmessage = function (ev) {
      if (!document.hidden) return;              // visivel: o ciclo normal de 2s ja cobre
      var p; try { p = JSON.parse(ev.data || '{}'); } catch (e) { return; }
      if (!p || p.tipo !== 'liga') return;
      var liga = ligaAberta();
      if (liga && p.liga !== liga && liga !== 'split') return;
      if (Date.now() - ultimo < 3000) return;    // no maximo 1 busca a cada 3s
      atualizaAgora();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', abre); else abre();
})();
