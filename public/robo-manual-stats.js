/* ============================================================================
 * ESTATISTICAS DO ROBO EM MONTAGEM (antes de salvar)
 * Testa o padrao que esta no quadro nos jogos REAIS de cada liga escolhida,
 * jogo a jogo, como o robo teria enviado: dispara quando o padrao fecha,
 * entra no jogo de entrada e segue os tiros consecutivos. Um ciclo por vez.
 * Mostra: greens/total, %, SG/G1/G2…, proximos jogos que o padrao pega e o
 * historico. Usa a MESMA logica do monitor (matchingRow/marketMatches).
 * ========================================================================== */
(function () {
  'use strict';
  var NOMES = { eng: 'Inglaterra', ita: 'Itália', spa: 'Espanha', mnd: 'Mundo', bra: 'Brasil', lat: 'Am. Latina', cam: 'Campeões', cop: 'Copa', ame: 'América' };
  var cache = {}, horas = 24, timer = null, rodando = false;
  try { horas = Number(localStorage.getItem('amd_rm_stats_h')) || 24; } catch (e) {}

  function RM() { return window.AMDManualMonitor; }
  function ts(g) { return Date.parse(g.slot_em || g.criado_em || '') || 0; }
  function hhmm(g) { return String(g.hora).padStart(2, '0') + ':' + String(g.minuto).padStart(2, '0'); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tiroNome(i) { return i === 0 ? 'SG' : 'G' + i; }

  function busca(liga) {
    var c = cache[liga];
    if (c && Date.now() - c.t < 60000) return Promise.resolve(c.j);
    return fetch('/api/grade?liga=' + liga + '&horas=60&compacto=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { partidas: [] }; })
      .then(function (j) { var l = (j.partidas || []).slice().sort(function (a, b) { return ts(a) - ts(b); }); cache[liga] = { t: Date.now(), j: l }; return l; })
      .catch(function () { return []; });
  }

  /* Simula o robo numa liga. */
  function simula(robot, liga, todos) {
    var rm = RM(), C = todos.filter(function (g) { return g.resultado_ft; }), out = [], usados = {}, ocupadoAte = -1;
    if (!C.length) return { sinais: out, proximo: null };
    var fim = ts(C[C.length - 1]), inicio = fim - horas * 3600000;
    for (var t = 0; t < C.length; t++) {
      if (t <= ocupadoAte) continue;
      var comp = C.slice(Math.max(0, t - 60), t + 1).reverse();
      var m = rm.matchingRow(robot, comp);
      if (!m) continue;
      var ti = C.lastIndexOf(m.trigger, t);
      if (ti < 0 || usados[ti]) continue;
      usados[ti] = 1;
      var ei = ti + 1 + (m.skip || 0);
      var mk = m.entry.entryMarket || robot.entryMarket || m.entry.market || 'Over 2.5';
      var tiros = Math.max(1, Number(robot.shots || 1)), res = null, pend = false, jogos = [];
      for (var s = 0; s < tiros; s++) {
        var g = C[ei + s];
        if (!g) { pend = true; break; }
        jogos.push(g);
        if (rm.marketMatches(mk, g)) { res = s; break; }
      }
      if (pend) break;               /* ciclo ainda em aberto: entra em "proximos" */
      ocupadoAte = ei + jogos.length - 1;
      if (ts(C[ei]) < inicio) continue; /* fora da janela escolhida */
      out.push({ liga: liga, hora: hhmm(C[ei]), jogo: C[ei].time_a + ' x ' + C[ei].time_b, mk: mk, green: res != null, tiro: res, placar: (jogos[jogos.length - 1] || {}).resultado_ft });
    }
    /* proximo: o padrao ja fechou e a entrada ainda nao aconteceu? */
    var proximo = null;
    try {
      var compAgora = C.slice(-60).reverse(), mA = rm.matchingRow(robot, compAgora);
      if (mA) {
        var up = rm.nextGame(todos, mA.trigger, mA.skip);
        if (up && !up.resultado_ft) proximo = hhmm(up);
      }
    } catch (e) {}
    return { sinais: out, proximo: proximo };
  }

  function painel() {
    var box = document.getElementById('rmStats');
    if (box) return box;
    var board = document.querySelector('.tc-board');
    if (!board) return null;
    box = document.createElement('div');
    box.id = 'rmStats';
    box.className = 'rm-stats';
    box.innerHTML = '<div class="rm-st-head"><b>Estatísticas</b><span class="rm-st-sub">do padrão montado, testado nos jogos reais</span>' +
      '<select id="rmStH"><option value="6">6h</option><option value="12">12h</option><option value="24">24h</option><option value="48">48h</option></select></div>' +
      '<div id="rmStBody" class="rm-st-body">Monte um padrão para ver as estatísticas.</div>';
    board.appendChild(box);
    var css = document.createElement('style');
    css.textContent = '.rm-stats{margin-top:12px;border:1px solid var(--line,#162832);border-radius:10px;background:rgba(0,0,0,.18);padding:12px}' +
      '.rm-st-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}.rm-st-head b{font-size:15px}.rm-st-sub{color:var(--muted,#96a5ad);font-size:12px;flex:1}' +
      '.rm-st-head select{background:#07151e;color:#fff;border:1px solid var(--line,#162832);border-radius:7px;padding:4px 8px}' +
      '.rm-st-big{text-align:center;font-size:22px;font-weight:900}.rm-st-pct{text-align:center;color:var(--muted,#96a5ad)}' +
      '.rm-st-tiros{text-align:center;margin:4px 0 8px;font-weight:700}.rm-st-tiros i{font-style:normal;color:#8b6cff;margin:0 6px}' +
      '.rm-st-prox{border:1px solid var(--line,#162832);border-radius:8px;padding:6px 8px;text-align:center;font-size:13px;margin-bottom:8px}' +
      '.rm-st-hist summary{cursor:pointer;background:#0a2a14;color:#18e34d;border-radius:8px;padding:7px;text-align:center;font-weight:800;list-style:none}' +
      '.rm-st-hist table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}.rm-st-hist td{padding:3px 4px;border-bottom:1px solid #122431}' +
      '.rm-st-g{color:#18e34d;font-weight:800}.rm-st-r{color:#ff343d;font-weight:800}.rm-st-ligas{font-size:12px;color:var(--muted,#96a5ad);text-align:center;margin-bottom:6px}';
    document.head.appendChild(css);
    var sel = document.getElementById('rmStH');
    sel.value = String(horas);
    sel.addEventListener('change', function () { horas = Number(sel.value); try { localStorage.setItem('amd_rm_stats_h', horas); } catch (e) {} agenda(0); });
    return box;
  }

  function roda() {
    var box = painel(), body = document.getElementById('rmStBody');
    if (!box || !body || !RM() || !window.AMDManualBuilder || !window.AMDManualBuilder.config) return;
    var robot = window.AMDManualBuilder.config();
    var temEntrada = (robot.pattern || []).some(function (p) { return p.markType === 'entry'; });
    var temPadrao = (robot.pattern || []).some(function (p) { return p.markType !== 'entry'; });
    if (!temEntrada || !temPadrao) { body.innerHTML = 'Marque pelo menos uma posição de <b>PADRÃO</b> e a <b>ENTRADA</b> no quadro para ver as estatísticas.'; return; }
    var ligas = (RM().robotLeagues ? RM().robotLeagues(robot) : robot.leagues) || [];
    if (!ligas.length) { body.innerHTML = 'Escolha pelo menos uma liga.'; return; }
    if (rodando) return; rodando = true;
    body.innerHTML = '<span style="color:#96a5ad">Calculando nos jogos reais…</span>';
    Promise.all(ligas.map(function (l) { return busca(l).then(function (j) { try { return simula(robot, l, j); } catch (e) { return { sinais: [], proximo: null, erro: e.message }; } }); }))
      .then(function (res) {
        rodando = false;
        var todos = [], prox = [];
        res.forEach(function (r, i) { todos = todos.concat(r.sinais); prox.push((NOMES[ligas[i]] || ligas[i]) + ': ' + (r.proximo ? '<b>' + r.proximo + '</b>' : '—')); });
        var g = todos.filter(function (s) { return s.green; }).length, n = todos.length, tiros = Math.max(1, Number(robot.shots || 1));
        var porTiro = []; for (var i = 0; i < tiros; i++) porTiro.push(tiroNome(i) + ': ' + todos.filter(function (s) { return s.tiro === i; }).length);
        var hist = todos.slice().reverse().slice(0, 40).map(function (s) {
          return '<tr><td>' + esc(s.hora) + '</td><td>' + esc(NOMES[s.liga] || s.liga) + '</td><td>' + esc(s.jogo) + '</td><td>' + esc(s.placar || '') + '</td><td class="' + (s.green ? 'rm-st-g">' + tiroNome(s.tiro) : 'rm-st-r">RED') + '</td></tr>';
        }).join('');
        body.innerHTML = '<div class="rm-st-big">' + g + '/' + n + ' (' + horas + 'h)</div>' +
          '<div class="rm-st-pct">(' + (n ? (g / n * 100).toFixed(2) : '0.00') + '%) · ' + (n - g) + ' red</div>' +
          '<div class="rm-st-tiros">' + porTiro.join('<i>—</i>') + '</div>' +
          '<div class="rm-st-prox">[Próximos] ' + prox.join(' · ') + '</div>' +
          '<details class="rm-st-hist"><summary>Histórico ▾</summary>' + (hist ? '<table>' + hist + '</table>' : '<div style="padding:6px;color:#96a5ad">Nenhuma entrada nesse período.</div>') + '</details>' +
          '<div class="rm-st-ligas" style="margin-top:6px">Só o quadro (sem métricas). Mesma regra do robô: dispara quando o padrão fecha, tiros consecutivos, um ciclo por vez.</div>';
      });
  }

  function agenda(ms) { clearTimeout(timer); timer = setTimeout(roda, ms == null ? 600 : ms); }
  document.addEventListener('amd:robo-preview', function () { agenda(); });
  document.addEventListener('change', function (e) { if (e.target && e.target.closest && e.target.closest('.tc-builder')) agenda(); }, true);
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#rbPatternGrid, .tc-builder button')) agenda(); }, true);
  setInterval(function () { agenda(0); }, 60000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { painel(); agenda(1500); });
  else { painel(); agenda(1500); }
})();
