// ============================================================================
// BACKTEST AMD LIVE 1 no dashboard (AMD Live 2)
//
// Usa a MESMA matemática do AMD Live 1 (motor.js -> AMD_MOTOR.backtest):
// para cada jogo, refaz a avaliação usando SÓ os jogos anteriores (janela de 400).
// Indicação = nascimento da condição do motor. A mesma condição ativa não se
// repete nos jogos seguintes.
//
// Escreve nas MESMAS colunas da tabela que já existe (#backtest):
//   HORA | JOGO | PLACAR | SCORE | EV | RESULTADO | LIGA
// e reaproveita as classes bt-pos / bt-neg. Nada de CSS novo, nada de HTML novo.
// Não altera app.js, dados-reais.js, acumulado.js nem maxima.js.
// ============================================================================
(function () {
  "use strict";

  var API = "/api/grade?liga=";
  var INTERVALO = 90000;
  var cache = {}, buscando = {};
  var mapaId = {};
  var meuHtml = null, escrevendo = false, observando = false;
  var chaveAtual = null;   // liga|mercado desenhado por ultimo

  // A Vavada entrega odds somente para quatro mercados. O 5+ fica disponivel
  // como estudo independente de frequencia e odd justa.
  var MERCADOS_BT = [
    { id: "o25", nome: "Over 2.5" },
    { id: "o35", nome: "Over 3.5" },
    { id: "ge5", nome: "5+ Gols" },
    { id: "ambas", nome: "Ambas Sim" },
    { id: "ambasN", nome: "Ambas Não" },
  ];
  var mktEscolhido = null;
  try { mktEscolhido = localStorage.getItem("amd_bt_mkt"); } catch (e) {}
  if (!MERCADOS_BT.some(function (m) { return m.id === mktEscolhido; })) mktEscolhido = "o25";

  function montaSeletor() {
    var head = document.getElementById("btTitle");
    head = head ? head.parentNode : null;
    if (!head || head.querySelector(".amd-bt-mkt")) return;
    var link = head.querySelector("a.link");
    var cx = document.createElement("span");
    cx.className = "amd-bt-mkt";
    cx.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-left:auto";
    MERCADOS_BT.forEach(function (M) {
      var b = document.createElement("button");
      b.textContent = M.nome;
      b.dataset.mkt = M.id;
      b.style.cssText = "cursor:pointer;border-radius:6px;padding:3px 8px;font-size:11px;line-height:1.4;" +
        "border:1px solid var(--line,#162832);background:transparent;color:var(--muted,#96a5ad)";
      b.addEventListener("click", function (e) {
        e.preventDefault();
        mktEscolhido = M.id;
        try { localStorage.setItem("amd_bt_mkt", M.id); } catch (err) {}
        pinta();
        roda();
      });
      cx.appendChild(b);
    });
    // O "Ver todos" CONTINUA: e por ele que se chega aos jogos mais antigos.
    // O seletor entra ANTES dele, os dois convivem na mesma linha.
    if (link) {
      link.style.display = "";                 // desfaz o ocultamento da versao anterior
      link.style.marginLeft = "10px";
      link.style.whiteSpace = "nowrap";
      head.insertBefore(cx, link);
    } else {
      head.appendChild(cx);
    }
    head.style.flexWrap = "wrap";
    head.style.rowGap = "6px";
    if (!mktEscolhido) mktEscolhido = "o25";
    pinta();
  }
  function pinta() {
    var cx = document.querySelector(".amd-bt-mkt");
    if (!cx) return;
    [].forEach.call(cx.children, function (b) {
      var on = b.dataset.mkt === mktEscolhido;
      b.style.borderColor = on ? "var(--blue,#32a4ff)" : "var(--line,#162832)";
      b.style.color = on ? "var(--blue,#32a4ff)" : "var(--muted,#96a5ad)";
      b.style.fontWeight = on ? "700" : "400";
    });
  }

  function avisa(txt) {
    var tb = document.getElementById("backtest");
    if (!tb) return;
    escrevendo = true;
    tb.innerHTML = '<tr><td colspan="7">' + txt + "</td></tr>";
    meuHtml = tb.innerHTML;
    escrevendo = false;
    vigiaTabela(tb);
  }

  // ANTI-TREMOR: em vez de repintar por cima (o que faz a tela piscar), a tabela
  // passa a ACEITAR escrita somente do motor. Trancamos a propriedade innerHTML
  // do proprio elemento: qualquer escrita de fora e ignorada silenciosamente.
  // Sem intervalo, sem disputa, sem flicker.
  var descritor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  var descTexto = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  var tituloTrancado = false;
  function trancaTitulo() {
    var el = document.getElementById("btTitle");
    if (!el || tituloTrancado || !descTexto) return;
    tituloTrancado = true;
    try {
      Object.defineProperty(el, "textContent", {
        configurable: true,
        get: function () { return descTexto.get.call(this); },
        set: function (v) { if (escrevendo) descTexto.set.call(this, v); }
      });
    } catch (e) { tituloTrancado = false; }
  }
  function poeTitulo(txt) {
    var el = document.getElementById("btTitle");
    if (!el) return;
    trancaTitulo();
    escrevendo = true;
    el.textContent = txt;
    escrevendo = false;
  }
  function tranca(tb) {
    if (observando || !tb || !descritor) return;
    observando = true;
    try {
      Object.defineProperty(tb, "innerHTML", {
        configurable: true,
        get: function () { return descritor.get.call(this); },
        set: function (v) { if (escrevendo) descritor.set.call(this, v); }
      });
    } catch (e) { observando = false; }
  }
  function vigiaTabela(tb) { tranca(tb); }

  function adapta(p) {
    var a = p.gols_a, b = p.gols_b;
    if (a == null || b == null) return null;
    var o = p.odds || {};
    return {
      id: p.id != null ? String(p.id) : null,     // casa com data-game-id da grade
      horario: String(p.hora == null ? 0 : p.hora).padStart(2, "0") + ":" +
               String(p.minuto == null ? 0 : p.minuto).padStart(2, "0"),
      nome: (p.time_a || "") + " x " + (p.time_b || ""),
      a: a, b: b, total: a + b,
      odds: {
        o25: o["odd_over_2.5"] || null, o35: o["odd_over_3.5"] || null,
        ambs: o["odd_ambas_sim"] || null, ambn: o["odd_ambas_nao"] || null,
        ge5: o["odd_total_gols_extatos_5"] || null,   // "extatos_5" = 5 ou mais (verificado)
        u05: o["odd_under_0.5"] || null, u15: o["odd_under_1.5"] || null,
        u25: o["odd_under_2.5"] || null, o15: o["odd_over_1.5"] || null,
        u35: o["odd_under_3.5"] || null,
        pj: o.pj || null      // probabilidade justa (sem margem) de cada mercado
      }
    };
  }

  function buscar(liga) {
    if (buscando[liga]) return buscando[liga];
    buscando[liga] = fetch(API + liga + "&horas=36&compacto=1", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var out = [], lista = (j && j.partidas) || [];
        for (var i = 0; i < lista.length; i++) { var g = adapta(lista[i]); if (g) out.push(g); }
        mapaId = {};
        for (var k = 0; k < out.length; k++) {
          if (out[k].id) mapaId[out[k].horario + "|" + out[k].nome] = out[k].id;
        }
        cache[liga] = out; buscando[liga] = null; return out;
      })
      .catch(function () { buscando[liga] = null; return cache[liga] || []; });
    return buscando[liga];
  }

  // ---- seleção atual (mesmos seletores do dashboard) ----------------------
  function ativoEm(sel) {
    var raiz = document.querySelector(sel);
    if (!raiz) return null;
    var el = raiz.querySelector(".active,[aria-pressed=true],.on");
    return el ? (el.textContent || "").trim() : null;
  }
  function ligaAtual() {
    try {
      if (window.Real && typeof window.Real.liga === "function") {
        var real = String(window.Real.liga() || "").toLowerCase();
        if (/^(eng|ita|spa|mnd|bra|lat|split)$/.test(real)) return real;
      }
    } catch (e) {}
    var t = (ativoEm(".tabrow") || ativoEm("#cligaMenu") || "").toLowerCase();
    var nomes = ["eng", "ita", "spa", "mnd", "bra", "lat", "split"];
    for (var i = 0; i < nomes.length; i++) if (t.indexOf(nomes[i]) >= 0) return nomes[i];
    return "ita";
  }
  function mercadoAtual() {
    return mktEscolhido || "o25";     // independente da grade
  }
  function jogosHora(liga) {
    return (typeof AMD_MOTOR !== "undefined" && AMD_MOTOR.jogosPorHora) ? AMD_MOTOR.jogosPorHora(liga) : 20;
  }
  function minimoHistorico(liga) {
    // O motor usa 120 jogos para aquecimento e libera o calculo com 150.
    // Exigir 12 horas completas aqui bloqueava o backtest mesmo com 292 jogos
    // validos, como acontece depois de reiniciar a coleta. A janela exibida
    // continua limitada a ate 12h pelo proprio motor.
    return Math.max(150, 6 * jogosHora(liga) + 30);
  }
  function nomeDoMercado(id) {
    for (var i = 0; i < MERCADOS_BT.length; i++) if (MERCADOS_BT[i].id === id) return MERCADOS_BT[i].nome;
    return id;
  }

  // Estudo independente do 5+: cada decisao usa apenas jogos anteriores.
  // O sinal nasce quando a frequencia dos ultimos 60 jogos supera a base longa
  // com 90% de confianca unilateral (z >= 1,28). Sem odd real nao ha EV/ROI;
  // exibimos a odd justa estatistica, sem inventar cotacao.
  function backtest5Mais(jogos, jph) {
    jph = jph || 20;
    // Janelas em horas da liga: aquecimento 6h, base 20h, recente 3h.
    var resultados = [], ativoAnterior = false, nRecente = 3 * jph;
    for (var i = 6 * jph; i < jogos.length; i++) {
      var hist = jogos.slice(Math.max(0, i - 20 * jph), i);
      var recente = hist.slice(-nRecente);
      if (recente.length < nRecente) continue;
      var verdesBase = hist.filter(function (g) { return g.total >= 5; }).length;
      var verdesRecentes = recente.filter(function (g) { return g.total >= 5; }).length;
      var pBase = verdesBase / hist.length;
      var pRecente = verdesRecentes / recente.length;
      var erro = Math.sqrt(Math.max(0.0001, pBase * (1 - pBase) / recente.length));
      var ativo = (pRecente - pBase) / erro >= 1.28;
      if (ativo && !ativoAnterior) {
        var g = jogos[i], prob = Math.round(pRecente * 1000) / 10;
        resultados.push({
          nome: g.nome, horario: g.horario || "", placar: g.a + "-" + g.b,
          score: prob, ev: null, oddJusta: prob > 0 ? +(100 / prob).toFixed(2) : null,
          resultado: g.total >= 5 ? "GREEN" : "RED", green: g.total >= 5
        });
      }
      ativoAnterior = ativo;
    }
    var agora = jogos.length ? jogos[jogos.length - 1].horario : null;
    function minutos(h) { var m = /^(\d{1,2}):(\d{1,2})/.exec(h || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; }
    var agoraMin = minutos(agora);
    var janela = resultados.filter(function (r) {
      var v = minutos(r.horario);
      return v == null || agoraMin == null || (agoraMin - v + 1440) % 1440 <= 720;
    });
    var verdes = resultados.filter(function (r) { return r.green; }).length;
    return {
      ultimos10indicados: janela,
      indicados: { n: resultados.length, green: verdes, pct: resultados.length ? Math.round(verdes / resultados.length * 1000) / 10 : null },
      taxaIndicados: resultados.length ? Math.round(verdes / resultados.length * 1000) / 10 : null,
      roiIndicados: null, cincoMaisSemOdd: true
    };
  }

  // ---- desenho: mesmas colunas e classes da tabela existente --------------
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, ""); }

  function desenha(bt, liga) {
    var tb = document.getElementById("backtest");
    if (!tb) return;
    var lista = (bt && bt.ultimos10indicados) || [];
    if (!lista.length) {
      // passa pelo avisa(), que destranca a escrita - sem isso a proteção bloqueia
      // a mensagem e a tabela fica presa no "calculando" (era exatamente o bug do Under 1.5)
      avisa(bt && bt.cincoMaisSemOdd
        ? "nenhum novo sinal estatístico de 5+ nas últimas 12 horas — frequência calculada sem odd/EV"
        : "nenhum sinal novo nas últimas 12 horas — uma condição já ativa não é repetida em todos os jogos");
      return;
    }
    var linhas = lista.slice().reverse().map(function (u) {
      var green = u.resultado === "GREEN";
      var temEv = typeof u.ev === "number" && isFinite(u.ev);
      var evTxt = temEv ? ((u.ev > 0 ? "+" : "") + u.ev + "%")
        : (u.oddJusta ? "justa @" + u.oddJusta : "—");
      var gid = mapaId[u.horario + "|" + u.nome] || "";
      return '<tr data-gid="' + gid + '" style="cursor:' + (gid ? "pointer" : "default") + '" title="' +
        (gid ? "clique para localizar na grade" : "") + '">' +
        "<td>" + esc(u.horario) + "</td>" +
        "<td>" + (u.alerta ? "⚠️ " : "") + esc(u.nome) + "</td>" +
        "<td>" + esc(u.placar) + "</td>" +
        "<td>" + esc(u.score) + "</td>" +
        '<td class="' + (temEv ? (u.ev > 0 ? "bt-pos" : "bt-neg") : "") + '">' + evTxt + "</td>" +
        '<td class="' + (green ? "bt-pos" : "bt-neg") + '">' + (green ? "✓" : "✗") + "</td>" +
        "<td>" + esc(liga) + "</td>" +
        "</tr>";
    }).join("");
    escrevendo = true;
    tb.innerHTML = linhas;
    meuHtml = tb.innerHTML;
    escrevendo = false;
    vigiaTabela(tb);

    // resumo honesto, se existir algum lugar para ele (não cria elemento novo)
    var alvo = document.getElementById("btResumo");
    if (alvo && bt.indicados) {
      alvo.textContent = bt.cincoMaisSemOdd
        ? "sinais estatísticos " + bt.indicados.n + " · acerto " +
          (bt.taxaIndicados == null ? "—" : bt.taxaIndicados + "%") + " · sem odd/EV"
        : "sinais novos " + bt.indicados.n + " · acerto " +
          (bt.taxaIndicados == null ? "—" : bt.taxaIndicados + "%") +
          " · ROI " + (bt.roiIndicados == null ? "—" : bt.roiIndicados + "%") +
          " · base " + bt.baseGeral + "%";
    }
  }

  // ---- clique na linha -> localiza o jogo na grade ------------------------
  // As celulas da grade trazem data-game-id, o mesmo id que a fonte devolve:
  // casamento exato, sem depender de nome nem de horario.
  var estiloMarca = null;
  function marcaNaGrade(gid) {
    if (!gid) return;
    var alvo = document.querySelector('#grade [data-game-id="' + gid + '"]');
    if (!alvo) return aviso2("esse jogo não está na grade visível — amplie a janela da grade");
    if (!estiloMarca) {
      estiloMarca = document.createElement("style");
      estiloMarca.textContent =
        "@keyframes amdPisca{0%,100%{box-shadow:0 0 0 2px var(--blue,#32a4ff)}50%{box-shadow:0 0 0 6px rgba(50,164,255,.35)}}" +
        ".amd-achado{animation:amdPisca 1s ease-in-out 3;border-radius:4px;position:relative;z-index:3}";
      document.head.appendChild(estiloMarca);
    }
    var antigos = document.querySelectorAll(".amd-achado");
    for (var i = 0; i < antigos.length; i++) antigos[i].classList.remove("amd-achado");
    alvo.classList.add("amd-achado");
    try { alvo.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }); } catch (e) { alvo.scrollIntoView(); }
    setTimeout(function () { alvo.classList.remove("amd-achado"); }, 4000);
  }
  function aviso2(txt) {
    var tit = document.getElementById("btTitle");
    if (!tit) return;
    var antes = tit.textContent;
    poeTitulo(antes + " — " + txt);
    setTimeout(function () { poeTitulo(antes); }, 3500);
  }
  document.addEventListener("click", function (e) {
    var tr = e.target && e.target.closest ? e.target.closest("#backtest tr[data-gid]") : null;
    if (!tr) return;
    var gid = tr.getAttribute("data-gid");
    if (gid) marcaNaGrade(gid);
  });

  function roda() {
    if (typeof AMD_MOTOR === "undefined" || !AMD_MOTOR.backtest) return;
    var liga = ligaAtual(), mkt = mercadoAtual();
    var chave = liga + "|" + mkt;
    if (chave !== chaveAtual) {          // trocou de liga/mercado: nunca deixar a tabela velha
      chaveAtual = chave;
      meuHtml = null;
      poeTitulo("Backtest · " + liga.charAt(0).toUpperCase() + liga.slice(1) + " — " + nomeDoMercado(mkt) +
        (mkt === "ge5" ? " · probabilidade sem EV" : " · sinais novos"));
      avisa("calculando " + nomeDoMercado(mkt) + " · " + liga + "…");
    }
    buscar(liga).then(function (jogos) {
      if (!jogos || jogos.length < minimoHistorico(liga)) {
        avisa("histórico insuficiente: " + (jogos ? jogos.length : 0) +
          " de " + minimoHistorico(liga) + " jogos necessários para iniciar o backtest");
        return;
      }
      var bt;
      try { var temOdd5 = mkt === "ge5" && jogos.filter(function (g) { return g.odds && g.odds.ge5; }).length >= jogos.length * 0.5;
      bt = (mkt === "ge5" && !temOdd5) ? backtest5Mais(jogos, jogosHora(liga)) : AMD_MOTOR.backtest(jogos, mkt, 12 * jogosHora(liga), { liga: liga }); } catch (e) { return; }
      if (!bt || bt.erro) { avisa("sem base suficiente para o backtest deste mercado agora"); return; }
      poeTitulo("Backtest · " + liga.charAt(0).toUpperCase() + liga.slice(1) + " — " + nomeDoMercado(mkt) +
        (mkt === "ge5" ? " · probabilidade sem EV" : " · sinais novos"));
      ultimo = bt; ultimaLiga = liga;
      desenha(bt, liga);
    });
  }

  // ASSUME o renderBacktest do dashboard (ele continua sendo chamado pelos timers
  // existentes, mas quem escreve a tabela agora e este backtest). Sem editar app.js.
  var ultimo = null, ultimaLiga = null;
  function inicia() {
    montaSeletor();
    try {
      window.renderBacktest = function () { if (ultimo) desenha(ultimo, ultimaLiga); };
    } catch (e) {}
    roda();
    setInterval(roda, INTERVALO);
    document.addEventListener("click", function (e) {
      var alvo = e.target;
      if (!alvo || !alvo.closest) return;
      if (alvo.closest("#markets, .tabrow, #cligaMenu, #qtd, #ligaOpts")) setTimeout(roda, 300);
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inicia);
  else inicia();
})();
