/* ============================================================================
 * LEITURA DO TRADER  (chip "Trader" liga/desliga)
 * ----------------------------------------------------------------------------
 * Le o grafico ACUMULADO 00h como um trader le preco:
 *   1. Estrutura: topos e fundos (pivos confirmados) -> ALTA / BAIXA / LATERAL
 *   2. Zonas: suportes e resistencias onde o grafico virou mais vezes no dia
 *   3. Setups: rompimento+reteste, pullback na MM9, falso rompimento (armadilha)
 *      e exaustao (bloqueio)
 *   4. Plano: entrada, invalidacao e alvo
 *   5. Prova: cada setup e testado nos ultimos 7 dias da MESMA liga e mercado,
 *      so quando as regras valem (>= 60 jogos no dia e 00h subindo). Resultado =
 *      green em ate 3 tiros. So e "PROVADO" se o pior caso (Wilson 95%) ficar
 *      acima da taxa normal de 3 tiros.
 * Nada aqui usa jogo futuro: em cada ponto so entram dados ate aquele ponto.
 * ========================================================================== */
(function () {
  'use strict';
  var MIN_DIA = 60, PIVO = 3, CACHE_MS = 60000, LS_VISTO = 'amd_trader_visto';
  var cache = {}, buscando = {}, ultimoTxt = '';

  function chip() {
    return [].slice.call(document.querySelectorAll('#overlays .chip'))
      .filter(function (c) { return c.textContent.trim() === 'Trader'; })[0];
  }
  function ligado() { var c = chip(); return !!(c && c.classList.contains('on')); }
  function liga() {
    try { if (window.Real && typeof window.Real.liga === 'function' && window.Real.liga()) return String(window.Real.liga()).toLowerCase().slice(0, 3); } catch (e) {}
    return String((window.state && window.state.liga) || 'eng').toLowerCase().slice(0, 3);
  }
  function mercado() {
    try { return (typeof state !== 'undefined' && state.mercado) || 'Over 2.5'; } catch (e) { return 'Over 2.5'; }
  }

  function carrega(lg) {
    if (buscando[lg]) return;
    buscando[lg] = true;
    fetch('/api/grade?liga=' + lg + '&horas=168&compacto=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var lista = (j.partidas || []).filter(function (g) { return g.resultado_ft && g.gols_a != null && g.gols_b != null; })
          .sort(function (a, b) { return Date.parse(a.slot_em) - Date.parse(b.slot_em); })
          .map(function (g) { return { a: +g.gols_a, b: +g.gols_b, dia: String(g.slot_em || '').slice(0, 10) }; });
        cache[lg] = { ts: Date.now(), lista: lista };
        desenha();
      }).catch(function () {}).then(function () { buscando[lg] = false; });
  }

  /* ---------- matematica ---------- */
  function mm(arr, p, i) { if (i < p - 1) return NaN; var t = 0; for (var k = i - p + 1; k <= i; k++) t += arr[k]; return t / p; }
  function wilsonInf(ok, n) {
    if (!n) return 0; var z = 1.96, p = ok / n;
    return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
  }
  /* pivos confirmados ate o indice i (precisa de PIVO pontos depois) */
  function pivos(line, ate) {
    var altos = [], baixos = [];
    for (var i = PIVO; i <= ate - PIVO; i++) {
      var max = true, min = true;
      for (var k = 1; k <= PIVO; k++) {
        if (!(line[i] >= line[i - k] && line[i] >= line[i + k])) max = false;
        if (!(line[i] <= line[i - k] && line[i] <= line[i + k])) min = false;
      }
      if (max && line[i] !== line[i - 1]) altos.push({ i: i, v: line[i] });
      if (min && line[i] !== line[i - 1]) baixos.push({ i: i, v: line[i] });
    }
    return { altos: altos, baixos: baixos };
  }
  /* agrupa niveis proximos em zonas (tolerancia em pp) */
  function zonas(pts, tol) {
    var z = [];
    pts.forEach(function (p) {
      var achou = null;
      for (var k = 0; k < z.length; k++) if (Math.abs(z[k].v - p.v) <= tol) { achou = z[k]; break; }
      if (achou) { achou.v = (achou.v * achou.n + p.v) / (achou.n + 1); achou.n++; achou.ult = Math.max(achou.ult, p.i); }
      else z.push({ v: p.v, n: 1, ult: p.i });
    });
    return z;
  }
  function estrutura(pv) {
    var A = pv.altos.slice(-2), B = pv.baixos.slice(-2);
    if (A.length < 2 || B.length < 2) return { tipo: 'LATERAL', txt: 'poucos pivôs' };
    var topoSobe = A[1].v > A[0].v, fundoSobe = B[1].v > B[0].v;
    var tipo = topoSobe && fundoSobe ? 'ALTA' : !topoSobe && !fundoSobe ? 'BAIXA' : 'LATERAL';
    return { tipo: tipo, txt: 'topos ' + A[0].v.toFixed(1) + '→' + A[1].v.toFixed(1) + ' · fundos ' + B[0].v.toFixed(1) + '→' + B[1].v.toFixed(1),
      ultTopo: A[1].v, ultFundo: B[1].v };
  }

  /* analisa o ponto i de um dia (line/bits so ate i). Retorna setups ativos. */
  function analisaPonto(line, i, passo) {
    var m9 = mm(line, 9, i), m21 = mm(line, 21, i), m9a = mm(line, 9, i - 1);
    var gate = i >= MIN_DIA - 1 && m9 > m21 && m9 >= m9a && line[i] >= m9;
    var pv = pivos(line, i);
    var tol = Math.max(.3, passo * 1.2);
    var res = zonas(pv.altos, tol), sup = zonas(pv.baixos, tol);
    var setups = [];
    /* rompimento + reteste: zona de resistencia (>=2 toques) rompida nos ultimos
       10 pontos, voltou ate perto dela e segura acima */
    res.forEach(function (z) {
      if (z.n < 2 || z.ult >= i - 2) return;
      var rompeu = -1;
      for (var k = Math.max(z.ult + 1, i - 10); k < i; k++) if (line[k] > z.v + tol * .5 && line[k - 1] <= z.v + tol * .5) rompeu = k;
      if (rompeu < 0) return;
      var minDepois = Infinity; for (var q = rompeu + 1; q <= i; q++) minDepois = Math.min(minDepois, line[q]);
      if (minDepois <= z.v + tol && minDepois >= z.v - tol * .5 && line[i] >= z.v)
        setups.push({ id: 'reteste', nome: 'Rompimento + reteste', nivel: z.v, inval: z.v - tol, toques: z.n });
    });
    /* pullback na MM9 em tendencia: tocou a MM9 no ponto anterior e voltou a subir */
    if (m9 > m21 && m9 >= m9a && i > 0 && line[i - 1] <= mm(line, 9, i - 1) + passo * .3 && line[i] > line[i - 1] && line[i] >= m9)
      setups.push({ id: 'pullback', nome: 'Pullback na MM9', nivel: m9, inval: Math.min(m9, m21) - passo * .5 });
    /* falso rompimento: perdeu um suporte nos ultimos 4 pontos e voltou acima */
    sup.forEach(function (z) {
      if (z.n < 2 || z.ult >= i - 2) return;
      var perdeu = false; for (var k = Math.max(0, i - 4); k < i; k++) if (line[k] < z.v - tol * .5) perdeu = true;
      if (perdeu && line[i] >= z.v && line[i] > line[i - 1])
        setups.push({ id: 'armadilha', nome: 'Falso rompimento (armadilha)', nivel: z.v, inval: z.v - tol * 1.5, toques: z.n });
    });
    /* exaustao: longe da MM21 (> 2 desvios das ultimas 21 distancias) ou 5 altas seguidas */
    var dist = [], seq = 0;
    for (var d = Math.max(20, i - 20); d <= i; d++) dist.push(line[d] - mm(line, 21, d));
    var media = dist.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, dist.length);
    var dp = Math.sqrt(dist.reduce(function (a, b) { return a + (b - media) * (b - media); }, 0) / Math.max(1, dist.length));
    for (var s = i; s > 0 && line[s] > line[s - 1]; s--) seq++;
    var exaustao = (dp > 0 && line[i] - m21 > media + 2 * dp) || seq >= 5;
    return { m9: m9, m21: m21, m9a: m9a, gate: gate, pv: pv, res: res, sup: sup, tol: tol, setups: setups, exaustao: exaustao, seq: seq };
  }

  var memo = {};
  function calcula(lg, merc) {
    var c = cache[lg];
    var chave = lg + '|' + merc + '|' + (c ? c.ts : 0);
    if (memo.k === chave) return memo.r;
    var r0 = calcula0(lg, merc); memo = { k: chave, r: r0 }; return r0;
  }
  function calcula0(lg, merc) {
    var c = cache[lg];
    var paga = window.AcumGuard && window.AcumGuard.regra ? window.AcumGuard.regra(merc) : null;
    if (!c || !paga) return null;
    var dias = {}, ordem = [];
    c.lista.forEach(function (g) { if (!dias[g.dia]) { dias[g.dia] = []; ordem.push(g.dia); } dias[g.dia].push(paga(g) ? 1 : 0); });
    var hoje = ordem[ordem.length - 1];
    var totalG = 0, totalN = 0, prova = {}, base3ok = 0, base3n = 0;
    ['reteste', 'pullback', 'armadilha'].forEach(function (k) { prova[k] = { n: 0, ok: 0, t1: 0, t2: 0, t3: 0 }; });
    var passoDia = function (n) { return 100 / Math.max(10, n); };
    var atual = null, lineHoje = null;
    ordem.forEach(function (dia) {
      var bits = dias[dia], line = [], s = 0;
      bits.forEach(function (b, i) { s += b; line.push(s / (i + 1) * 100); totalG += b; totalN++; });
      var ehHoje = dia === hoje;
      /* prova: todos os pontos com 3 jogos de futuro conhecido */
      for (var i = MIN_DIA - 1; i + 3 < bits.length; i++) {
        var pagou = bits[i + 1] ? 1 : bits[i + 2] ? 2 : bits[i + 3] ? 3 : 0;
        base3n++; if (pagou) base3ok++;
        var a = analisaPonto(line, i, passoDia(i + 1));
        if (!a.gate || a.exaustao) continue;
        var vistos = {};
        a.setups.forEach(function (st) {
          if (vistos[st.id]) return; vistos[st.id] = 1;
          var p = prova[st.id]; p.n++; if (pagou) { p.ok++; p['t' + pagou]++; }
        });
      }
      if (ehHoje && bits.length) { lineHoje = line; atual = analisaPonto(line, bits.length - 1, passoDia(bits.length)); atual.n = bits.length; }
    });
    var base3 = base3n ? base3ok / base3n : 0;
    Object.keys(prova).forEach(function (k) {
      var p = prova[k]; p.taxa = p.n ? p.ok / p.n : 0; p.inf = wilsonInf(p.ok, p.n);
      p.provado = p.n >= 20 && p.inf >= base3; p.perdedor = p.n >= 20 && p.taxa < base3;
    });
    return { atual: atual, line: lineHoje, prova: prova, base3: base3, dias: ordem.length, hoje: hoje };
  }

  /* ---------- tela ---------- */
  function box() {
    var b = document.getElementById('traderBox');
    if (b) return b;
    var ref = document.getElementById('tendencia');
    if (!ref || !ref.parentNode) return null;
    b = document.createElement('div');
    b.id = 'traderBox';
    b.className = 'trader-box';
    ref.parentNode.insertBefore(b, ref.nextSibling);
    return b;
  }
  function f(v) { return Number.isFinite(v) ? v.toFixed(1) : '—'; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function desenha() {
    var b = box();
    if (!b) return;
    if (!ligado()) { b.hidden = true; return; }
    b.hidden = false;
    var lg = liga(), merc = mercado();
    var c = cache[lg];
    if (!c || Date.now() - c.ts > CACHE_MS) carrega(lg);
    if (!c) { b.className = 'trader-box'; b.textContent = '📈 Leitura do Trader · carregando 7 dias de ' + lg.toUpperCase() + '…'; return; }
    var r = calcula(lg, merc);
    if (!r || !r.atual) { b.className = 'trader-box'; b.textContent = '📈 Leitura do Trader · mercado sem regra de pagamento (' + esc(merc) + ')'; return; }
    var a = r.atual, line = r.line, i = line.length - 1, v = line[i];
    var est = estrutura(a.pv);
    var acima = a.res.filter(function (z) { return z.v > v + a.tol * .3; }).sort(function (x, y) { return x.v - y.v; })[0];
    var abaixo = a.sup.filter(function (z) { return z.v < v - a.tol * .3; }).sort(function (x, y) { return y.v - x.v; })[0];
    var regras = a.n >= MIN_DIA ? (a.gate ? '✓' : '✗') : '✗';
    var regraTxt = a.n < MIN_DIA ? 'dia com ' + a.n + '/' + MIN_DIA + ' jogos'
      : 'linha ' + f(v) + (v >= a.m9 ? ' ≥ ' : ' < ') + 'MM9 ' + f(a.m9) + (a.m9 > a.m21 ? ' > ' : ' < ') + 'MM21 ' + f(a.m21) + (a.m9 >= a.m9a ? ' · MM9 subindo' : ' · MM9 caindo');

    /* setup ativo com prova */
    var melhor = null;
    a.setups.forEach(function (st) {
      var p = r.prova[st.id];
      if (!melhor || (p.inf > r.prova[melhor.id].inf)) melhor = st;
    });
    var veredito, classe, plano;
    if (!a.gate) {
      veredito = 'NÃO ENTRA'; classe = 'sem-entrada';
      plano = 'regra do gráfico 00h não liberou (' + regraTxt + ')';
    } else if (a.exaustao) {
      veredito = 'NÃO ENTRA'; classe = 'sem-entrada';
      plano = 'exaustão: ' + (a.seq >= 5 ? a.seq + ' altas seguidas' : 'linha esticada longe da MM21') + ' · esperar respiro até perto da MM9 ' + f(a.m9);
    } else if (melhor && r.prova[melhor.id].provado) {
      veredito = 'ENTRA'; classe = 'entrada';
      plano = melhor.nome + ' em ' + f(melhor.nivel) + '% · entrada: próximo jogo, 3 tiros · invalida se a linha fechar abaixo de ' +
        f(melhor.inval) + '%' + (acima ? ' · alvo ' + f(acima.v) + '%' : '');
    } else if (melhor) {
      veredito = 'AGUARDAR'; classe = 'aguardar';
      plano = melhor.nome + ' em ' + f(melhor.nivel) + '% apareceu, mas ' +
        (r.prova[melhor.id].perdedor ? 'esse setup PERDE da média nesta liga' : 'ainda sem prova suficiente') + ' · não operar';
    } else {
      veredito = 'AGUARDAR'; classe = 'aguardar';
      plano = est.tipo === 'ALTA'
        ? 'tendência ok, sem gatilho · esperar pullback na MM9 ' + f(a.m9) + '%' + (acima ? ' ou rompimento + reteste de ' + f(acima.v) + '%' : '')
        : 'sem gatilho · ' + (acima ? 'resistência ' + f(acima.v) + '%' : '') + (abaixo ? ' · suporte ' + f(abaixo.v) + '%' : '');
    }

    var provaTxt = ['reteste', 'pullback', 'armadilha'].map(function (k) {
      var p = r.prova[k], nome = { reteste: 'Reteste', pullback: 'Pullback MM9', armadilha: 'Armadilha' }[k];
      if (!p.n) return nome + ': sem ocorrência';
      return nome + ': ' + p.ok + '/' + p.n + ' (1º ' + p.t1 + ' · 2º ' + p.t2 + ' · 3º ' + p.t3 + ') pior caso ' + (p.inf * 100).toFixed(0) + '% ' +
        (p.provado ? '✓ PROVADO' : p.perdedor ? '✗ PERDE' : p.n < 20 ? '· amostra curta' : '· sem vantagem');
    }).join(' │ ');

    var html =
      '<div class="tb-top"><b>📈 Leitura do Trader</b> · ' + lg.toUpperCase() + ' ' + esc(merc) + ' · <span class="tb-v">' + veredito + '</span></div>' +
      '<div><span class="tb-k">Estrutura</span> <b>' + est.tipo + '</b> · ' + esc(est.txt) + '</div>' +
      '<div><span class="tb-k">Regra 00h</span> ' + regras + ' ' + esc(regraTxt) + '</div>' +
      '<div><span class="tb-k">Zonas</span> ' + (acima ? 'resistência ' + f(acima.v) + '% (' + acima.n + ' toques)' : 'sem resistência acima') +
        ' · ' + (abaixo ? 'suporte ' + f(abaixo.v) + '% (' + abaixo.n + ' toques)' : 'sem suporte abaixo') + '</div>' +
      '<div><span class="tb-k">Plano</span> ' + esc(plano) + '</div>' +
      '<div class="tb-prova"><span class="tb-k">Prova ' + r.dias + ' dias</span> ' + esc(provaTxt) + ' │ normal 3 tiros ' + (r.base3 * 100).toFixed(0) + '%</div>';
    if (html !== ultimoTxt) { b.innerHTML = html; ultimoTxt = html; }
    b.className = 'trader-box ' + classe;
  }

  function init() {
    var c = chip();
    if (c && !localStorage.getItem(LS_VISTO)) { c.classList.add('on'); localStorage.setItem(LS_VISTO, '1'); }
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#overlays .chip, #leagues, #markets, .chart-liga, [data-liga]')) setTimeout(function () { ultimoTxt = ''; desenha(); }, 600);
    });
    desenha();
    setInterval(desenha, 5000);
  }
  window.TraderLeitura = { desenha: desenha, calcula: calcula };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 1500); });
  else setTimeout(init, 1500);
})();
