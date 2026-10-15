// ============================================================================
// AMD QUAD PREMIUM — versão que CALCULA (antes os números eram sorteados)
//
// O painel original produzia os cartões assim:
//     forca = 68 + Math.floor(r()*28)     -> sempre entre 68% e 95%
//     ev    = (8 + r()*14).toFixed(1)     -> sempre entre +8% e +22%
//     amostra = 40 + Math.floor(r()*40)
// com r() semeado pelos próprios filtros. Nenhum jogo era lido, e o EV nunca
// podia ser negativo — o painel mostrava oportunidade boa em qualquer cenário.
//
// Aqui as quatro ferramentas medem os JOGOS REAIS da liga selecionada:
//   1. Analisador de padrões — sequência 🟢🔴 / placar-gatilho / coluna do minuto,
//      medindo o desfecho dentro do nº de TIROS escolhido, contra a régua.
//   2. Ranking de odds — o que a odd promete (1/odd) x o que entregou.
//   3. Topos e fundos — onde a curva está na janela e o que veio depois.
//   4. Rank de confrontos — pares de times, taxa real e nº de encontros.
//
// Os filtros (janela, mercado, equipes, tiros) passam a filtrar dados de verdade.
// Mesma estética: escreve nos mesmos .res / .pos / .txt / .num.
// Nenhum arquivo existente é alterado.
// ============================================================================
(function () {
  "use strict";

  var JOGOS_HORA = 20;                 // 1 jogo a cada 3 minutos
  var pintado = {};                    // html por quadrante (repintura leve)
  var geracao = 0;                     // resposta antiga nunca pinta liga/filtro novo

  // ---- dados --------------------------------------------------------------
  function adapta(p) {
    var a = p.gols_a, b = p.gols_b;
    if (a == null || b == null) return null;
    var o = p.odds || {};
    return {
      horario: String(p.hora == null ? 0 : p.hora).padStart(2, "0") + ":" +
               String(p.minuto == null ? 0 : p.minuto).padStart(2, "0"),
      timeA: (p.time_a || "").trim(), timeB: (p.time_b || "").trim(),
      nome: (p.time_a || "") + " x " + (p.time_b || ""),
      a: a, b: b, total: a + b,
      odds: {
        o25: o["odd_over_2.5"] || null, o35: o["odd_over_3.5"] || null,
        ambs: o["odd_ambas_sim"] || null, ambn: o["odd_ambas_nao"] || null,
        // "extatos_5" engana no nome: e 5 OU MAIS (implicita 9,5% bate com a
        // frequencia real de 9,5% em 859 jogos; exatamente-5 daria 5,5%)
        ge5: o["odd_total_gols_extatos_5"] || null,
        u05: o["odd_under_0.5"] || null, u15: o["odd_under_1.5"] || null,
        u25: o["odd_under_2.5"] || null, u35: o["odd_under_3.5"] || null,
        casa: o["odd_resultado_final_casa"] || null,
        empate: o["odd_resultado_final_empate"] || null,
        fora: o["odd_resultado_final_fora"] || null
      }, slot: p.slot_em || null
    };
  }
  function buscar(liga, horas) {
    // Serviço compartilhado com o EV+: uma consulta ao banco serve os 4 cards.
    if (window.AMD_ANALISE_DADOS && window.AMD_ANALISE_DADOS.buscar) {
      return window.AMD_ANALISE_DADOS.buscar(liga, horas).then(function (lista) {
        var out=[];for(var i=0;i<lista.length;i++){var g=adapta(lista[i]);if(g)out.push(g);}return out;
      });
    }
    var url="/api/grade?liga="+encodeURIComponent(liga)+"&horas="+horas+"&compacto=1";
    return fetch(url,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("banco respondeu "+r.status);return r.json();})
      .then(function(j){var out=[],lista=(j&&j.partidas)||[];for(var i=0;i<lista.length;i++){var g=adapta(lista[i]);if(g)out.push(g);}return out;});
  }

  // ---- leitura dos filtros de cada quadrante ------------------------------
  function ligaAtual() {
    var raiz = document.getElementById("ligaOpts");
    var el = raiz ? raiz.querySelector(".on,.active") : null;
    var t = (el ? el.textContent : "").trim().toLowerCase();
    var nomes = ["copa", "euro", "super", "premier"];
    for (var i = 0; i < nomes.length; i++) if (t.indexOf(nomes[i]) >= 0) return nomes[i];
    return "copa";
  }
  function textoNormal(s) {
    s=String(s||"").toLowerCase();
    return s.normalize?s.normalize("NFD").replace(/[\u0300-\u036f]/g,""):s;
  }
  function filtros(card) {
    var grupos = card.querySelectorAll(".opts");
    function sel(i) {
      var g = grupos[i]; if (!g) return "";
      var o = g.querySelector(".on,.active");
      return o ? (o.textContent || "").trim() : "";
    }
    var m = textoNormal(sel(2));
    var mkt = m.indexOf("over 1.5") >= 0 ? "o15" :
              m.indexOf("under 3.5") >= 0 ? "u35" :
              m.indexOf("under 2.5") >= 0 ? "u25" :
              m.indexOf("under 1.5") >= 0 ? "u15" :
              m.indexOf("ambas nao") >= 0 ? "ambn" :
              m.indexOf("3.5") >= 0 ? "o35" :
              m.indexOf("5+") >= 0 ? "ge5" :
              m.indexOf("ambas") >= 0 ? "ambas" :
              m.indexOf("casa vence") >= 0 ? "casa" :
              m.indexOf("empate") >= 0 ? "empate" :
              m.indexOf("fora vence") >= 0 ? "fora" :
              m.indexOf("placar") >= 0 ? "placar" : "o25";
    var e = textoNormal(sel(3));
    return {
      ferramenta: sel(0),
      horas: parseInt(sel(1).replace(/\D/g, ""), 10) || 6,
      mercado: mkt, mercadoNome: sel(2),
      equipes: e.indexOf("so casa") >= 0 ? "casa" : e.indexOf("so fora") >= 0 ? "fora" : "ambos",
      equipesNome: sel(3),
      tiros: parseInt(sel(4).replace(/\D/g, ""), 10) || 1
    };
  }

  // ---- "pagou" incluindo mercados que o motor não cobre -------------------
  function pagou(g, mkt) {
    if (mkt === "o15") return g.total >= 2;
    if (mkt === "casa") return g.a > g.b;
    if (mkt === "fora") return g.b > g.a;
    if (mkt === "empate") return g.a === g.b;
    if (mkt === "ambn") return !(g.a > 0 && g.b > 0);
    if (mkt === "u15") return g.total <= 1;
    if (mkt === "u25") return g.total <= 2;
    if (mkt === "u35") return g.total <= 3;
    if (mkt === "placar") return false;                 // não é binário
    return AMD_MOTOR.pays(g, mkt);
  }
  function oddDe(g, mkt) {
    var o = g.odds || {}, v = null;
    if (mkt === "o15") v = o.o15;
    else if (mkt === "o25") v = o.o25; else if (mkt === "o35") v = o.o35;
    else if (mkt === "ambas") v = o.ambs;
    else if (mkt === "ambn") v = o.ambn;
    else if (mkt === "u15") v = o.u15; else if (mkt === "u25") v = o.u25;
    else if (mkt === "u35") v = o.u35;
    else if (mkt === "casa") v = o.casa; else if (mkt === "fora") v = o.fora;
    else if (mkt === "empate") v = o.empate;
    else if (mkt === "ge5") v = o.ge5;                  // agora existe (extatos_5 = 5 ou mais)
    else return null;                                   // placar correto: não é binário
    // a fonte entrega a odd como TEXTO ("1.93") - sem converter, od.toFixed quebra
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return isFinite(n) && n > 1.01 ? n : null;
  }

  function janela(jogos, horas) {
    if (!jogos.length) return jogos;
    var fim=Date.parse(jogos[jogos.length-1].slot||""),corte=fim-horas*3600000;
    if(isFinite(fim)){
      var porTempo=jogos.filter(function(g){var t=Date.parse(g.slot||"");return isFinite(t)&&t>corte&&t<=fim;});
      if(porTempo.length)return porTempo;
    }
    var n = horas * JOGOS_HORA;
    return jogos.length > n ? jogos.slice(-n) : jogos;
  }
  function pct(h, n) { return n ? Math.round(h / n * 1000) / 10 : null; }

  // ================= FERRAMENTA 1: analisador de padrões ===================
  function analisadorPadroes(js, f) {
    var seq = js.map(function (g) { return pagou(g, f.mercado) ? "G" : "R"; });
    var T = f.tiros;
    function desfecho(i) {                              // pagou dentro dos N tiros seguintes?
      for (var k = i + 1; k <= i + T && k < js.length; k++) if (seq[k] === "G") return true;
      return (i + T < js.length) ? false : null;
    }
    var rn = 0, rh = 0;
    for (var i = 0; i < js.length; i++) { var d = desfecho(i); if (d === null) continue; rn++; if (d) rh++; }
    var regua = pct(rh, rn);

    var stats = {};
    function conta(chave, i) {
      var d = desfecho(i); if (d === null) return;
      var s = stats[chave] || (stats[chave] = { n: 0, h: 0 });
      s.n++; if (d) s.h++;
    }
    for (var i2 = 4; i2 < js.length; i2++) {
      conta("fita " + seq.slice(i2 - 3, i2 + 1).join(""), i2);
      var g = js[i2], tot = g.total, mx = Math.max(g.a, g.b);
      var cat = tot === 0 ? "0-0" : tot === 1 ? "1 gol" : mx >= 3 ? "goleada" :
                g.a === g.b ? "empate " + g.a + "-" + g.b : "acima de 1-0";
      conta("placar " + cat, i2);
      var mm = (g.horario || "").split(":")[1];
      if (mm) conta("minuto :" + mm, i2);
    }
    var out = [],minPadrao=js.length>=240?12:js.length>=120?8:5;
    for (var ch in stats) {
      var s = stats[ch];
      if (s.n < minPadrao) continue;
      var taxa = pct(s.h, s.n);
      out.push({ titulo: ch, sub: "amostra " + s.n + (s.n < 20 ? " (pequena)" : "") + " · régua " + regua + "%",
                 valor: taxa + "%", extra: (taxa - regua > 0 ? "+" : "") + Math.round((taxa - regua) * 10) / 10 + " pts",
                 ordem: taxa - regua });
    }
    out.sort(function (a, b) { return b.ordem - a.ordem; });
    return { itens: out.slice(0, 6), vazio: "nenhum padrão com "+minPadrao+"+ casos nesta janela — amplie a janela" };
  }

  // ================= FERRAMENTA 2: ranking de odds =========================
  function rankingOdds(js, f) {
    var porOdd = {};
    for (var i = 0; i < js.length; i++) {
      var od = oddDe(js[i], f.mercado);
      if (!od || od <= 1.01) continue;
      var k = od.toFixed(2);
      var s = porOdd[k] || (porOdd[k] = { n: 0, h: 0 });
      s.n++; if (pagou(js[i], f.mercado)) s.h++;
    }
    var out = [],minimo=js.length>=240?8:js.length>=120?5:3;
    for (var k2 in porOdd) {
      var s2 = porOdd[k2];
      if (s2.n < minimo) continue;
      var odd = parseFloat(k2);
      var real = s2.h / s2.n;
      var prometido = 1 / odd;
      var ev = Math.round((real * odd - 1) * 1000) / 10;
      out.push({ titulo: "odd @" + k2, sub: "promete " + Math.round(prometido * 1000) / 10 + "% · entregou " + pct(s2.h, s2.n) + "% · " + s2.n + " jogos",
                 valor: (ev > 0 ? "+" : "") + ev + "%", extra: "EV real", ordem: ev });
    }
    out.sort(function (a, b) { return b.ordem - a.ordem; });
    // Não agrupa em faixas: @4.50 e @4.75 continuam odds distintas.
    if(!out.length&&minimo>2){
      minimo=2;
      for(var k3 in porOdd){
        var s3=porOdd[k3];if(s3.n<minimo)continue;
        var odd3=parseFloat(k3),real3=s3.h/s3.n,ev3=Math.round((real3*odd3-1)*1000)/10;
        out.push({titulo:"odd @"+k3,sub:"promete "+Math.round(1/odd3*1000)/10+"% · entregou "+pct(s3.h,s3.n)+"% · "+s3.n+" jogos (amostra pequena)",valor:(ev3>0?"+":"")+ev3+"%",extra:"EV real",ordem:ev3});
      }
      out.sort(function(a,b){return b.ordem-a.ordem;});
    }
    return { itens: out.slice(0, 6), vazio: "o banco não tem odd válida para este mercado na janela escolhida" };
  }

  // ================= FERRAMENTA 3: topos e fundos ==========================
  function toposFundos(js, f) {
    var JAN = 20;
    var serie = AMD_MOTOR.chartSeries(js, f.mercado, JAN);
    if (!serie || serie.length < 12) return { itens: [], vazio: "janela curta demais para a curva" };
    var mn = Math.min.apply(null, serie), mx = Math.max.apply(null, serie);
    var cur = serie[serie.length - 1];
    var zona = mx > mn ? Math.round((cur - mn) / (mx - mn) * 100) : 50;
    // o que veio DEPOIS quando a curva esteve em cada zona
    var baldes = { "fundo (0-25%)": { n: 0, h: 0 }, "meio (25-75%)": { n: 0, h: 0 }, "topo (75-100%)": { n: 0, h: 0 } };
    var T = f.tiros;
    for (var k = 0; k + T < serie.length; k++) {
      var z = mx > mn ? (serie[k] - mn) / (mx - mn) * 100 : 50;
      var nome = z <= 25 ? "fundo (0-25%)" : z >= 75 ? "topo (75-100%)" : "meio (25-75%)";
      var idx = k + JAN - 1;
      var veio = false;
      for (var t = 1; t <= T; t++) { var g = js[idx + t]; if (g && pagou(g, f.mercado)) { veio = true; break; } }
      baldes[nome].n++; if (veio) baldes[nome].h++;
    }
    var itens = [];
    for (var nm in baldes) {
      var b = baldes[nm];
      if (b.n < 8) continue;
      itens.push({ titulo: nm, sub: b.n + " passagens · em " + T + " tiro" + (T > 1 ? "s" : ""),
                   valor: pct(b.h, b.n) + "%", extra: "pagou depois", ordem: b.h / b.n });
    }
    itens.sort(function (a, b) { return b.ordem - a.ordem; });
    itens.unshift({ titulo: "curva agora: " + (zona <= 25 ? "FUNDO" : zona >= 75 ? "TOPO" : "MEIO"),
                    sub: "pagando " + cur + "% · faixa da janela " + mn + "–" + mx + "%",
                    valor: zona + "%", extra: "posição", ordem: 99 });
    return { itens: itens.slice(0, 6), vazio: "sem base" };
  }

  // ================= FERRAMENTA 4: rank de confrontos ======================
  function rankConfrontos(js, f) {
    var pares = {};
    for (var i = 0; i < js.length; i++) {
      var g = js[i];
      if (!g.timeA || !g.timeB) continue;
      var chave = f.equipes === "ambos"
        ? [g.timeA, g.timeB].sort().join(" x ")
        : (f.equipes === "casa" ? g.timeA + " (casa)" : g.timeB + " (fora)");
      var s = pares[chave] || (pares[chave] = { n: 0, h: 0 });
      s.n++; if (pagou(g, f.mercado)) s.h++;
    }
    var out = [];
    for (var k in pares) {
      var s2 = pares[k];
      if (s2.n < 5) continue;
      out.push({ titulo: k, sub: s2.n + " encontros na janela", valor: pct(s2.h, s2.n) + "%",
                 extra: "pagou " + f.mercadoNome, ordem: s2.h / s2.n });
    }
    out.sort(function (a, b) { return b.ordem - a.ordem || 0; });
    return { itens: out.slice(0, 6), vazio: "nenhum confronto com 5+ encontros nesta janela" };
  }

  // ---- desenho: mesma estrutura .res/.pos/.txt/.num -----------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, ""); }
  function corpo(card, html) {
    var antigos = card.querySelectorAll(".res");
    if (antigos.length) {
      var pai = antigos[0].parentNode;
      for (var i = antigos.length - 1; i >= 0; i--) antigos[i].remove();
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      while (tmp.firstChild) pai.appendChild(tmp.firstChild);
    }
  }
  function aviso(card, txt) {
    corpo(card, '<div class="res"><div class="pos">·</div><div class="txt">' + esc(txt) + "</div><div class=\"num\"></div></div>");
  }

  function calcula(card, jogos, liga) {
    var f = filtros(card);
    if (f.mercado === "placar") return aviso(card, "placar correto não é um mercado binário — use os outros para taxa e EV");
    var js = janela(jogos, f.horas);
    var horasReais = Math.round(jogos.length / JOGOS_HORA);
    if (f.horas > horasReais + 1) {
      return aviso(card, "a fonte guarda ~" + horasReais + "h de histórico — janela de " + f.horas + "h indisponível");
    }
    if (f.equipes !== "ambos") {
      // filtro de mando não muda os jogos, muda a leitura do confronto; mantido no rank
    }
    var r;
    try {
      if (/ranking de odds/i.test(f.ferramenta)) r = rankingOdds(js, f);
      else if (/topos e fundos/i.test(f.ferramenta)) r = toposFundos(js, f);
      else if (/confronto/i.test(f.ferramenta)) r = rankConfrontos(js, f);
      else r = analisadorPadroes(js, f);
    } catch (e) { return aviso(card, "não deu para calcular: " + e.message); }

    if (!r.itens.length) return aviso(card, r.vazio);
    var html = r.itens.map(function (it, i) {
      return '<div class="res"><div class="pos">' + (i + 1) + '</div>' +
        '<div class="txt">' + esc(f.mercadoNome) + " · " + esc(it.titulo) +
        "<small>" + esc(f.equipesNome) + " · " + esc(it.sub) + "</small></div>" +
        '<div class="num"><b>' + esc(it.valor) + "</b><span>" + esc(it.extra) + "</span></div></div>";
    }).join("");
    corpo(card, html);
  }

  function roda() {
    if (typeof AMD_MOTOR === "undefined") return;
    var liga = ligaAtual();
    var quads = document.getElementById("quads");
    if (!quads) return;
    var horas=24;
    [].forEach.call(quads.children,function(card){var h=filtros(card).horas;if(h>horas)horas=h;});
    var minhaGeracao=++geracao;
    buscar(liga,horas).then(function (jogos) {
      if(minhaGeracao!==geracao||liga!==ligaAtual())return;
      if (!jogos || jogos.length < 40) return;
      var atuais=document.getElementById("quads");
      if(atuais)[].forEach.call(atuais.children, function (card) { calcula(card, jogos, liga); });
    }).catch(function(){
      if(minhaGeracao!==geracao)return;
      var atuais=document.getElementById("quads");
      if(atuais)[].forEach.call(atuais.children,function(card){aviso(card,"não foi possível ler o banco agora");});
    });
  }

  function inicia() {
    roda();
    setInterval(roda, 120000);
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("#quads .opt") || t.closest("#ligaOpts") ||
          (t.textContent || "").toLowerCase().indexOf("analisar agora") >= 0) {
        setTimeout(roda, 300);
      }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inicia);
  else inicia();
})();
