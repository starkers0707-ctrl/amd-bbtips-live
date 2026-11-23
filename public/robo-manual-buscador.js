(function () {
  'use strict';
  /* Buscador de padroes: procura no historico real qual placar (ou dupla de
     placares) costuma ser seguido pelo mercado alvo, depois de N pulos, em ate
     X tiros. Clicar em "Usar no robô" monta o quadro com o padrao. */
  var LIGAS = [
    ['eng', 'Inglaterra'], ['ita', 'Itália'], ['spa', 'Espanha'], ['mnd', 'Mundo'], ['bra', 'Brasil'],
    ['lat', 'América Latina'], ['cam', 'Liga dos Campeões'], ['cop', 'Copa do Mundo'], ['ame', 'América']
  ];
  var NOME = {}; LIGAS.forEach(function (l) { NOME[l[0]] = l[1]; });
  var cache = {};
  var ultimos = [];

  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(v) { return String(v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function toast(m) { var el = q('#toast'); if (!el) return; el.textContent = m; el.classList.add('show'); setTimeout(function () { el.classList.remove('show'); }, 3000); }

  function mercadoPlacar(a, b) { return (a > b ? 'Casa ' : a < b ? 'Visitante ' : 'Empate ') + a + '-' + b; }
  function bate(mercado, a, b) {
    var M = window.AMDManualMonitor;
    return !!(M && M.marketMatches(mercado, { resultado_ft: a + '-' + b, gols_a: a, gols_b: b, resultado_ht: '' }));
  }

  function montaFiltros() {
    var alvo = q('#bpAlvo'), fonte = q('#rbMarket') || q('#rbEntryMarket');
    alvo.innerHTML = '';
    Array.prototype.slice.call(fonte.querySelectorAll('optgroup')).forEach(function (g) {
      if (/tempo|Placar/i.test(g.label)) return;
      var ng = document.createElement('optgroup'); ng.label = g.label;
      Array.prototype.slice.call(g.querySelectorAll('option')).forEach(function (o) {
        if (/HT|Total Gols \(FT\)|Gols Casa \(FT\)|Gols Fora \(FT\)/.test(o.textContent)) return;
        var n = document.createElement('option'); n.textContent = o.textContent; ng.appendChild(n);
      });
      if (ng.children.length) alvo.appendChild(ng);
    });
    alvo.value = 'Over 2.5';
    var pulos = q('#bpPulos');
    for (var i = 0; i <= 18; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i + (i === 1 ? ' pulo' : ' pulos'); pulos.appendChild(o); }
    pulos.value = '10';
    var box = q('#bpLigas');
    LIGAS.forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'bp-liga on'; b.dataset.liga = l[0]; b.textContent = l[1];
      b.addEventListener('click', function () { b.classList.toggle('on'); conta(); });
      box.appendChild(b);
    });
    conta();
  }
  function ligasMarcadas() { return qa('.bp-liga.on').map(function (b) { return b.dataset.liga; }); }
  function conta() { q('#bpLigasCount').textContent = 'LIGAS: ' + ligasMarcadas().length + '/' + LIGAS.length; }

  async function historico(liga) {
    var c = cache[liga];
    if (c && Date.now() - c.t < 60000) return c.jogos;
    var r = await fetch('/api/historico?liga=' + encodeURIComponent(liga), { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    var jogos = (j.jogos || []).map(function (x) { return { t: typeof x[0] === 'number' ? x[0] : Date.parse(x[0]), a: Number(x[1]), b: Number(x[2]) }; })
      .filter(function (g) { return Number.isFinite(g.t) && Number.isFinite(g.a) && Number.isFinite(g.b); })
      .sort(function (x, y) { return x.t - y.t; });
    cache[liga] = { t: Date.now(), jogos: jogos };
    return jogos;
  }

  function analisaLiga(liga, jogos, cfg) {
    var desde = Date.now() - cfg.horas * 3600000;
    var g = jogos.filter(function (x) { return x.t >= desde; });
    var n = g.length, meio = g.length ? g[Math.floor(n / 2)].t : 0, res = {};
    var hit = g.map(function (x) { return bate(cfg.alvo, x.a, x.b); });
    for (var i = cfg.k - 1; i < n; i++) {
      var seq = [];
      for (var s = cfg.k - 1; s >= 0; s--) seq.push(g[i - s].a + '-' + g[i - s].b);
      var chave = seq.join('|');
      for (var p = 0; p <= cfg.maxPulos; p++) {
        var ini = i + p + 1;
        if (ini + cfg.tiros - 1 >= n) continue; /* entrada ainda sem todos os tiros */
        var ok = false, tiro = 0;
        for (var t = 0; t < cfg.tiros && ini + t < n; t++) if (hit[ini + t]) { ok = true; tiro = t + 1; break; }
        var id = chave + '#' + p, r = res[id] || (res[id] = { liga: liga, seq: seq, pulo: p, n: 0, win: 0, seco: 0, nR: 0, winR: 0, hist: [] });
        r.n++; if (ok) r.win++; if (tiro === 1) r.seco++;
        if (g[i].t >= meio) { r.nR++; if (ok) r.winR++; }
        r.hist.push(ok);
      }
    }
    return Object.keys(res).map(function (k) { return res[k]; });
  }

  async function buscar() {
    var ligas = ligasMarcadas();
    if (!ligas.length) return toast('Marque pelo menos uma liga.');
    var cfg = {
      horas: Number(q('#bpPeriodo').value), alvo: q('#bpAlvo').value, tiros: Number(q('#bpTiros').value),
      total: Number(q('#bpTotal').value), k: Number(q('#bpPlacares').value), maxPulos: Number(q('#bpPulos').value),
      pctIni: Number(q('#bpPctIni').value) || 0, pctFim: Number(q('#bpPctFim').value || 100), ordem: q('#bpOrdem').value,
      min: Number(q('#bpMin').value)
    };
    cfg.maxPulos = Math.min(cfg.maxPulos, 19 - cfg.k);
    var box = q('#bpResultados');
    box.innerHTML = '<p class="bp-empty">Buscando no histórico…</p>';
    var todos = [], base = { n: 0, win: 0 }, falhas = [];
    await Promise.all(ligas.map(async function (liga) {
      try {
        var jogos = await historico(liga);
        var desde = Date.now() - cfg.horas * 3600000, g = jogos.filter(function (x) { return x.t >= desde; });
        /* taxa base: chance de bater em X tiros entrando em qualquer jogo */
        for (var i = 0; i + cfg.tiros <= g.length; i++) {
          var ok = false; for (var t = 0; t < cfg.tiros; t++) if (bate(cfg.alvo, g[i + t].a, g[i + t].b)) ok = true;
          base.n++; if (ok) base.win++;
        }
        todos = todos.concat(analisaLiga(liga, jogos, cfg));
      } catch (e) { falhas.push(NOME[liga] || liga); }
    }));
    var acaso = base.n ? base.win / base.n * 100 : 0;
    var lista = todos.filter(function (r) {
      var pct = r.win / r.n * 100;
      return r.n >= cfg.min && pct >= cfg.pctIni && pct <= cfg.pctFim;
    });
    lista.forEach(function (r) { r.pct = r.win / r.n * 100; r.pctR = r.nR ? r.winR / r.nR * 100 : null; });
    lista.sort(function (a, b) {
      if (cfg.ordem === 'n') return b.n - a.n || b.pct - a.pct;
      if (cfg.ordem === 'pulo') return a.pulo - b.pulo || b.pct - a.pct;
      if (cfg.ordem === 'recente') return (b.pctR || 0) - (a.pctR || 0) || b.n - a.n;
      return b.pct - a.pct || b.n - a.n;
    });
    ultimos = lista.slice(0, cfg.total);
    ultimos.cfg = cfg;
    if (!ultimos.length) {
      box.innerHTML = '<p class="bp-empty">Nenhuma sequência com esses filtros. Diminua o mínimo de ocorrências ou aumente o período.</p>';
      return;
    }
    box.innerHTML = '<p class="bp-base">Acaso (entrar em qualquer jogo, ' + cfg.tiros + ' tiro' + (cfg.tiros > 1 ? 's' : '') + '): <b>' + acaso.toFixed(1) + '%</b>' +
      (falhas.length ? ' · sem dados: ' + esc(falhas.join(', ')) : '') + '</p>' +
      ultimos.map(function (r, i) {
        var dif = r.pct - acaso, recente = r.pctR == null ? '—' : r.pctR.toFixed(0) + '%';
        var dots = r.hist.slice(-12).map(function (ok) { return '<i class="' + (ok ? 'g' : 'r') + '"></i>'; }).join('');
        return '<article class="bp-card">' +
          '<div class="bp-rank">#' + (i + 1) + '</div>' +
          '<div class="bp-info"><b>' + esc(NOME[r.liga] || r.liga) + '</b>' +
          '<div class="bp-seq">' + r.seq.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('<em>→</em>') +
          '<em>→ ' + r.pulo + ' pulo' + (r.pulo === 1 ? '' : 's') + ' →</em><span class="alvo">' + esc(cfg.alvo) + '</span></div>' +
          '<small>' + r.win + '/' + r.n + ' · seco ' + (r.seco / r.n * 100).toFixed(0) + '% · metade recente ' + recente + ' · ' + (dif >= 0 ? '+' : '') + dif.toFixed(1) + ' p.p. sobre o acaso</small>' +
          '<div class="bp-dots">' + dots + '</div></div>' +
          '<div class="bp-pct">' + r.pct.toFixed(0) + '%</div>' +
          '<button type="button" class="bp-use" data-i="' + i + '">Usar no robô</button>' +
          '</article>';
      }).join('');
    qa('.bp-use').forEach(function (b) { b.addEventListener('click', function () { usar(ultimos[Number(b.dataset.i)], ultimos.cfg); }); });
  }

  function usar(r, cfg) {
    if (!r || !window.AMDManualBuilder) return;
    var cells = r.seq.map(function (s, idx) {
      var p = s.split('-').map(Number);
      return { row: 1, column: idx + 1, markType: 'pattern', market: mercadoPlacar(p[0], p[1]), scoreA: String(p[0]), scoreB: String(p[1]) };
    });
    var col = r.seq.length + r.pulo + 1;
    cells.push({ row: 1, column: col, markType: 'entry', market: cfg.alvo, entryMarket: cfg.alvo });
    window.AMDManualBuilder.applyPattern({
      cells: cells, leagues: [r.liga], entryMarket: cfg.alvo, shots: cfg.tiros,
      name: (NOME[r.liga] || r.liga) + ' ' + r.seq.join(' ') + ' +' + r.pulo + ' ' + cfg.alvo
    });
    fechar();
    toast('Padrão colocado no quadro. Confira e clique em Criar robô.');
  }

  function abrir() { q('#bpModal').hidden = false; document.body.style.overflow = 'hidden'; }
  function fechar() { q('#bpModal').hidden = true; document.body.style.overflow = ''; }

  montaFiltros();
  q('#rbBuscador').addEventListener('click', abrir);
  q('#bpClose').addEventListener('click', fechar);
  q('#bpModal').addEventListener('click', function (e) { if (e.target.id === 'bpModal') fechar(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !q('#bpModal').hidden) fechar(); });
  q('#bpBuscar').addEventListener('click', buscar);
  q('#bpTodas').addEventListener('click', function () { qa('.bp-liga').forEach(function (b) { b.classList.add('on'); }); conta(); });
  q('#bpLimpar').addEventListener('click', function () { qa('.bp-liga').forEach(function (b) { b.classList.remove('on'); }); conta(); });
})();
