/* ============================================================================
 *  NPRO — porte do Narciso PRO 12.2.0 para a grade do AMD LIVE
 * ============================================================================
 *  O que veio do NPRO.js original:
 *    - engine de score por odds semelhantes (over/ambas/confiança, peso recente)
 *    - probabilidade de sobreviver a 2 gales
 *    - overlay direto na célula: entrada + GALE 1 + GALE 2
 *    - paleta de cores por faixa de probabilidade
 *
 *  O que NÃO veio (de propósito):
 *    - clique automático em botão de aposta (a grade do AMD é leitura, não tem
 *      botão de entrada — e clique automático em casa de aposta é risco puro)
 *    - controle de banca / stop loss / stop win (isso já é o Placar)
 *    - qualquer leitura de bbtips/thtips: o NPro aqui lê só o seu #grade
 *
 *  DEPENDÊNCIAS: nenhuma. Arquivo solto, não toca em app.js.
 *  INSTALAÇÃO: <script defer src="npro.js"></script> no fim do index.html
 * ========================================================================== */
(function () {
  'use strict';

  // ───────────────────────────────────────────────────────────
  //  1. CONFIGURAÇÃO
  // ───────────────────────────────────────────────────────────
  var CFG = {
    minJogos:    12,     // mínimo de jogos já resolvidos p/ liberar a análise
    minAmostra:   5,     // mínimo de jogos semelhantes p/ confiar no número
    tolOdd:    0.15,     // ± em cada odd para considerar "odds semelhantes"
    z:         1.96,     // 95% — exigência estatística p/ acender (ver secao 6b)
    corrigirM:  true,    // corrige o z pelo nº de células testadas (ver secao 6b)
    liftMin:   0.00,     // vantagem minima sobre a base do mercado, em fracao
    maxSinais:    6,     // máximo de células acesas ao mesmo tempo
    intervalo: 5000,     // ms entre varreduras
    jogosPorHora: 20     // colunas por linha (usado p/ estimar o minuto)
  };

  var LS = 'npro_ligado';

  // ───────────────────────────────────────────────────────────
  //  2. ESTADO
  // ───────────────────────────────────────────────────────────
  var ON = false;
  var timer = null;
  var obs = null;
  var aplicando = false;   // trava p/ o observer não reagir ao próprio overlay
  var marcadas = [];       // células com overlay no momento

  // ───────────────────────────────────────────────────────────
  //  3. ESTILO
  // ───────────────────────────────────────────────────────────
  var CSS = ''
    + '.npro-card{font:700 8px/1.2 "Share Tech Mono",ui-monospace,monospace;'
    + 'display:flex;justify-content:space-between;gap:2px;padding:2px 3px;'
    + 'background:rgba(0,0,0,.85);white-space:nowrap;overflow:hidden;'
    + 'border-radius:3px 3px 0 0;margin:-2px -2px 2px -2px;position:relative;z-index:5}'
    + '.npro-hit{outline:2px solid var(--npro-cor);outline-offset:-2px;'
    + 'border-radius:4px;position:relative;animation:nproPulse 1.6s ease-in-out infinite}'
    + '@keyframes nproPulse{0%,100%{box-shadow:0 0 0 0 transparent}'
    + '50%{box-shadow:0 0 10px 0 var(--npro-cor)}}'
    + '@media (prefers-reduced-motion:reduce){.npro-hit{animation:none}}'
    + '#nproBtn.on{box-shadow:0 0 8px rgba(0,200,255,.45)}'
    + '#nproBtn .npro-n{opacity:.75;font-size:10px;margin-left:3px}';

  // ───────────────────────────────────────────────────────────
  //  4. UTILITÁRIOS
  // ───────────────────────────────────────────────────────────
  function cor(pct) {                     // mesma escala do original
    if (pct >= 55) return '#22dd55';
    if (pct >= 38) return '#ffaa00';
    return '#ff5555';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Area da normal padrao ate z (erf por aproximacao de Abramowitz-Stegun). */
  function normalDeZ(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989422804014327 * Math.exp(-z * z / 2);
    var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
          + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  /**
   * Inversa da normal padrao (aproximacao de Acklam). Precisa dela porque o z
   * deixa de ser 1.96 quando corrigimos o teste multiplo.
   */
  function zDe(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
             138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
             66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
             3.754408661907416];
    var lim = 0.02425, q, r;
    if (p < lim) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    if (p <= 1 - lim) {
      q = p - 0.5; r = q * q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q /
             (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }

  /**
   * Limite INFERIOR do intervalo de Wilson para k acertos em n tentativas.
   * E o piso honesto da taxa: com 3 de 4 o piso e baixissimo, com 300 de 400
   * ele quase encosta em 75%. E o que impede amostra pequena de virar sinal.
   */
  function wilsonInf(k, n, z) {
    if (!n) return 0;
    z = z || 1.96;
    var p = k / n;
    var d = 1 + (z * z) / n;
    var centro = p + (z * z) / (2 * n);
    var margem = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centro - margem) / d);
  }

  /** Lê a hora da faixa (.hour-label) que precede a linha. */
  function horaDaLinha(row) {
    var p = row.previousElementSibling;
    while (p && !p.classList.contains('hour-label')) p = p.previousElementSibling;
    var m = p && (p.textContent || '').match(/(\d{1,2})\s*h/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Minuto estimado da coluna: 60 / jogos por hora. */
  function minutoDaColuna(ci, total) {
    var passo = 60 / (total || CFG.jogosPorHora);
    return Math.round(ci * passo);
  }

  /** Rótulo curto p/ o card (a célula tem ~60px): só o minuto. */
  function etiquetaCurta(c) {
    if (c.hora === null) return 'c' + pad2(c.ci + 1);
    return pad2(minutoDaColuna(c.ci, c.totalCols)) + "'";
  }

  /** Rótulo completo p/ o tooltip. */
  function etiquetaCheia(c) {
    if (c.hora === null) return 'coluna ' + pad2(c.ci + 1);
    return pad2(c.hora) + ':' + pad2(minutoDaColuna(c.ci, c.totalCols));
  }

  // ───────────────────────────────────────────────────────────
  //  5. COLETA
  //  Lê o #grade e devolve os jogos em ordem CRONOLÓGICA
  //  (a grade renderiza a hora mais nova em cima, então invertemos).
  // ───────────────────────────────────────────────────────────
  function coletar() {
    var rows = [].slice.call(document.querySelectorAll('#grade .gridrow'));
    if (!rows.length) return [];
    var seq = [];

    rows.slice().reverse().forEach(function (row) {
      var hora = horaDaLinha(row);
      var ms = [].slice.call(row.children).filter(function (el) {
        return el.classList.contains('match');
      });
      ms.forEach(function (el, ci) {
        var odds = [].slice.call(el.querySelectorAll('.od')).map(function (o) {
          return parseFloat(o.dataset.odd);
        }).filter(function (n) { return !isNaN(n) && n > 1; });

        var txt = (el.querySelector('.score') || {}).textContent || '';
        var pl = txt.match(/(\d{1,2})\s*[-x]\s*(\d{1,2})/i);

        seq.push({
          el: el,
          ci: ci,
          totalCols: ms.length,
          hora: hora,
          odds: odds,
          placar: pl ? [parseInt(pl[1], 10), parseInt(pl[2], 10)] : null,
          // o próprio app já classifica a célula pelo mercado ativo:
          pago: el.classList.contains('pay'),
          red:  el.classList.contains('nopay'),
          pend: el.classList.contains('neutral')
        });
      });
    });
    return seq;
  }

  /** Índices dos jogos já resolvidos com odds parecidas com "odds". */
  function similares(odds, seq, tol) {
    var out = [];
    if (!odds.length) return out;
    for (var i = 0; i < seq.length; i++) {
      var c = seq[i];
      if (c.pend || !c.odds.length) continue;
      if (!c.pago && !c.red) continue;
      var ok = true;
      var len = Math.min(odds.length, c.odds.length, 3);
      for (var k = 0; k < len; k++) {
        if (Math.abs(odds[k] - c.odds[k]) > tol) { ok = false; break; }
      }
      if (ok) out.push(i);
    }
    return out;
  }

  function buscarSimilares(odds, seq) {
    var s = similares(odds, seq, CFG.tolOdd);
    if (s.length < CFG.minAmostra) s = similares(odds, seq, CFG.tolOdd * 2);
    return s;
  }

  // ───────────────────────────────────────────────────────────
  //  6. ENGINE DE SCORE  (porte de analisar())
  //  greenRate*0.60 + ambasRate*0.20 + (green*ambas)*0.15 + confiança
  //  Peso quadrático: jogo mais recente pesa mais.
  //  Diferença do original: "green" não é mais ≥3 gols fixo — é o que o
  //  seu app marcou como pagou/não pagou, então serve p/ os 69 mercados.
  // ───────────────────────────────────────────────────────────
  function scoreDe(odds, seq) {
    var idx = buscarSimilares(odds, seq);
    if (idx.length < CFG.minAmostra) return null;

    var somaG = 0, somaA = 0, somaP = 0, brutos = 0;
    idx.forEach(function (i, ord) {
      var c = seq[i];
      var green = c.pago ? 1 : 0;
      brutos += green;
      var ambas = (c.placar && c.placar[0] > 0 && c.placar[1] > 0) ? 1 : 0;
      var peso = Math.pow((ord + 1) / idx.length, 2);
      somaG += green * peso;
      somaA += ambas * peso;
      somaP += peso;
    });

    var green = somaP > 0 ? somaG / somaP : 0;
    var ambas = somaP > 0 ? somaA / somaP : 0;
    var conf = Math.min(idx.length / 10, 1) * 0.15;
    var score = (green * 0.60) + (ambas * 0.20) + (green * ambas * 0.15) + conf;

    return {
      score: Math.min(score, 1), n: idx.length, green: green, idx: idx,
      k: brutos, piso: wilsonInf(brutos, idx.length, CFG.z)
    };
  }

  // ───────────────────────────────────────────────────────────
  //  7. PROBABILIDADE DE 2 GALES  (porte de calcularProbGales())
  //  Aqui o gale é o JOGO SEGUINTE da grade, não o 2º gol do jogo.
  //  Cascata honesta:
  //    p0  = pagou já na entrada
  //    pg1 = pagou no jogo seguinte, DADO que a entrada deu red
  //    pg2 = pagou 2 jogos depois, DADO red + red
  //    sobrevive = p0 + (1-p0)*pg1 + (1-p0)*(1-pg1)*pg2
  // ───────────────────────────────────────────────────────────
  function probGales(idx, seq) {
    if (!idx || !idx.length) return null;
    var n = 0, hit0 = 0, base1 = 0, hit1 = 0, base2 = 0, hit2 = 0;

    idx.forEach(function (i) {
      var c = seq[i];
      n++;
      if (c.pago) { hit0++; return; }
      var a = seq[i + 1];
      if (!a || a.pend) return;
      base1++;
      if (a.pago) { hit1++; return; }
      var b = seq[i + 2];
      if (!b || b.pend) return;
      base2++;
      if (b.pago) hit2++;
    });

    if (!n) return null;
    var p0 = hit0 / n;
    var pg1 = base1 ? hit1 / base1 : 0;
    var pg2 = base2 ? hit2 / base2 : 0;
    var sobrevive = p0 + (1 - p0) * pg1 + (1 - p0) * (1 - pg1) * pg2;

    return {
      p0: p0, pg1: pg1, pg2: pg2, sobrevive: sobrevive,
      n: n, base1: base1, base2: base2
    };
  }

  // ───────────────────────────────────────────────────────────
  //  8. OVERLAY NA CÉLULA  (porte de _marcarCelula / destacarNaGrade)
  // ───────────────────────────────────────────────────────────
  function marcar(el, titulo, corHex, pct, dica) {
    if (!el) return;
    limpar(el);
    el.classList.add('npro-hit');
    el.style.setProperty('--npro-cor', corHex);
    if (dica) { el.setAttribute('data-npro-dica', dica); el.title = dica; }

    var card = document.createElement('div');
    card.className = 'npro-card';
    card.style.color = corHex;
    card.style.borderBottom = '1px solid ' + corHex;
    var a = document.createElement('span'); a.textContent = titulo;
    var b = document.createElement('span');
    b.textContent = (pct === null || isNaN(pct)) ? '\u2014' : pct + '%';
    card.appendChild(a); card.appendChild(b);
    el.insertBefore(card, el.firstChild);
    marcadas.push(el);
  }

  function limpar(el) {
    if (!el) return;
    el.classList.remove('npro-hit');
    el.style.removeProperty('--npro-cor');
    el.removeAttribute('data-npro-dica');
    el.removeAttribute('title');
    var c = el.querySelector('.npro-card');
    if (c) c.parentNode.removeChild(c);
  }

  function limparTudo() {
    marcadas.forEach(limpar);
    marcadas = [];
    // varredura de segurança (a grade pode ter sido re-renderizada)
    [].slice.call(document.querySelectorAll('.npro-hit')).forEach(limpar);
  }

  // ───────────────────────────────────────────────────────────
  //  9. VARREDURA — o ciclo que acende a tela
  // ───────────────────────────────────────────────────────────
  function varrer() {
    if (!ON) return;
    aplicando = true;
    try {
      limparTudo();

      var seq = coletar();
      var resolvidos = seq.filter(function (c) { return c.pago || c.red; });
      if (resolvidos.length < CFG.minJogos) { badge('...'); return; }

      // BASE DO MERCADO: quanto o mercado inteiro paga agora.
      // O limiar e relativo a isto, nao um numero fixo — assim o NPro
      // funciona igual no Over 1.5 (base alta) e no Over 4.5 (base baixa).
      var base = resolvidos.filter(function (c) { return c.pago; }).length
               / resolvidos.length;

      // 1a passada: todo mundo que tem amostra suficiente pra ser testado.
      var testaveis = [];
      seq.forEach(function (c, i) {
        if (!c.pend || !c.odds.length) return;
        var s = scoreDe(c.odds, seq);
        if (s) testaveis.push({ i: i, c: c, s: s });
      });

      // TESTE MULTIPLO: 20 células testadas a 95% dao ~1 falso positivo por
      // tela, so de sorte. Bonferroni: aperta o z pelo numero de testes.
      var m = Math.max(1, testaveis.length);
      var zEfetivo = (CFG.corrigirM && m > 1)
        ? zDe(1 - (1 - normalDeZ(CFG.z)) / m)
        : CFG.z;

      // 2a passada: PORTA. O piso de Wilson tem que passar da base do mercado.
      // Sem isso, 3 greens em 4 jogos viram "sinal" — e nao sao.
      var cand = [];
      testaveis.forEach(function (x) {
        var s = x.s;
        s.piso = wilsonInf(s.k, s.n, zEfetivo);
        if (s.piso <= base + CFG.liftMin) return;
        s.base = base;
        s.lift = (s.k / s.n) - base;
        s.z = zEfetivo;
        s.testes = m;
        cand.push({ i: x.i, c: x.c, s: s, g: probGales(s.idx, seq) });
      });

      cand.sort(function (a, b) { return b.s.piso - a.s.piso; });
      cand = cand.slice(0, CFG.maxSinais);

      cand.forEach(function (x) {
        var g = x.g;
        // Amostra pequena não vira porcentagem: vira "—" cinza.
        // Sem isso o card mostra 0% ou 100% em cima de 3 jogos e parece certeza.
        var f1 = (g && g.base1 >= CFG.minAmostra);
        var f2 = (g && g.base2 >= CFG.minAmostra);
        var pTot = g ? Math.round(g.sobrevive * 100) : null;
        var p1 = f1 ? Math.round(g.pg1 * 100) : null;
        var p2 = f2 ? Math.round(g.pg2 * 100) : null;

        var dica = 'NPro · entrada ' + etiquetaCheia(x.c)
          + ' · ' + x.s.k + '/' + x.s.n + ' greens em odds semelhantes'
          + ' (' + (x.s.k / x.s.n * 100).toFixed(0) + '%)'
          + ' · base do mercado ' + (x.s.base * 100).toFixed(1) + '%'
          + ' · piso de Wilson ' + (x.s.piso * 100).toFixed(1) + '%'
          + ' (z ' + x.s.z.toFixed(2) + ', corrigido p/ ' + x.s.testes + ' testes)'
          + ' · score ' + (x.s.score * 100).toFixed(0) + '%'
          + (g ? ' · entrada seca ' + Math.round(g.p0 * 100) + '%' : '');

        marcar(x.c.el, '\u26A1 ' + etiquetaCurta(x.c), '#00c8ff', pTot, dica);
        if (seq[x.i + 1] && seq[x.i + 1].pend)
          marcar(seq[x.i + 1].el, 'G1', f1 ? cor(p1) : '#5a6b78', p1,
            'gale 1 · ' + (g ? g.base1 : 0) + ' casos'
            + (f1 ? '' : ' — amostra pequena demais p/ %'));
        if (seq[x.i + 2] && seq[x.i + 2].pend)
          marcar(seq[x.i + 2].el, 'G2', f2 ? cor(p2) : '#5a6b78', p2,
            'gale 2 · ' + (g ? g.base2 : 0) + ' casos'
            + (f2 ? '' : ' — amostra pequena demais p/ %'));
      });

      badge(cand.length);
    } catch (e) {
      console.warn('[NPro]', e);
    } finally {
      setTimeout(function () { aplicando = false; }, 60);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  10. BOTÃO ON/OFF
  // ───────────────────────────────────────────────────────────
  function badge(n) {
    var b = document.getElementById('nproBtn');
    if (!b) return;
    var s = b.querySelector('.npro-n');
    if (s) s.textContent = ON ? '(' + n + ')' : '';
  }

  function ligar() {
    ON = true;
    localStorage.setItem(LS, '1');
    var b = document.getElementById('nproBtn');
    if (b) b.classList.add('on');
    varrer();
    clearInterval(timer);
    timer = setInterval(varrer, CFG.intervalo);
    observar();
  }

  function desligar() {
    ON = false;
    localStorage.setItem(LS, '0');
    var b = document.getElementById('nproBtn');
    if (b) b.classList.remove('on');
    clearInterval(timer); timer = null;
    if (obs) { obs.disconnect(); obs = null; }
    limparTudo();
    badge('');
  }

  function alternar() { ON ? desligar() : ligar(); }

  /** A grade é redesenhada pelo app.js; o observer reaplica o overlay. */
  function observar() {
    var g = document.getElementById('grade');
    if (!g || obs) return;
    var deb = null;
    obs = new MutationObserver(function () {
      if (aplicando || !ON) return;
      clearTimeout(deb);
      deb = setTimeout(varrer, 300);
    });
    obs.observe(g, { childList: true, subtree: true });
  }

  function criarBotao() {
    if (document.getElementById('nproBtn')) return true;
    var horas = document.getElementById('horas');
    var barra = horas && horas.parentElement;      // .panel-head da grade
    if (!barra) return false;

    var b = document.createElement('button');
    b.id = 'nproBtn';
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', 'false');
    b.title = 'NPro — acende as células com entrada e os 2 gales';
    b.innerHTML = '\u26A1 NPro <span class="npro-n"></span>';
    b.addEventListener('click', function () {
      alternar();
      b.setAttribute('aria-pressed', ON ? 'true' : 'false');
    });

    var ancora = document.getElementById('btnHT');
    if (ancora && ancora.parentElement === barra) barra.insertBefore(b, ancora.nextSibling);
    else barra.appendChild(b);
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  11. INICIALIZAÇÃO
  // ───────────────────────────────────────────────────────────
  function iniciar() {
    var st = document.createElement('style');
    st.id = 'npro-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    // a barra pode ainda não existir no primeiro tick
    var tentativas = 0;
    var t = setInterval(function () {
      if (criarBotao() || ++tentativas > 40) {
        clearInterval(t);
        if (localStorage.getItem(LS) === '1') ligar();
      }
    }, 250);

    window.NPro = {
      ligar: ligar, desligar: desligar, alternar: alternar,
      varrer: varrer, cfg: CFG, ligado: function () { return ON; }
    };
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
