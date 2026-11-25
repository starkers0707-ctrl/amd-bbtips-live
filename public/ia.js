/* ============================================================================
 * MINHA IA — cada cliente conecta a PROPRIA IA (chave so no navegador dele).
 * A cada pergunta, monta os dados AO VIVO do site (grafico acumulado 00h,
 * medias, sequencias, colunas, times, proximos jogos e odds) e envia junto com
 * as regras da casa. A chamada vai DIRETO do navegador para o provedor: o
 * servidor do AMD Live nunca ve a chave.
 * ========================================================================== */
(function () {
  'use strict';
  var LS_ENSINO = 'amd_ia_ensino', LS_MODO = 'amd_ia_modo', LS_PROF = 'amd_ia_prof';
  var LS_CFG = 'amd_ia_cfg', LS_LIGAS = 'amd_ia_ligas', LS_MK = 'amd_ia_mk', LS_CHAT = 'amd_ia_chat';
  var LIGAS = [['eng', 'Inglaterra'], ['ita', 'Itália'], ['spa', 'Espanha'], ['mnd', 'Mundo'], ['bra', 'Brasil'], ['lat', 'América Latina'], ['cam', 'Liga dos Campeões'], ['cop', 'Copa'], ['ame', 'Américas']];
  var MK = {
    o25: { nome: 'Over 2.5', odd: 'odd_over_2.5', paga: function (a, b) { return a + b >= 3; } },
    o35: { nome: 'Over 3.5', odd: 'odd_over_3.5', paga: function (a, b) { return a + b >= 4; } },
    ambs: { nome: 'Ambas Marcam', odd: 'odd_ambas_sim', paga: function (a, b) { return a > 0 && b > 0; } },
    ge5: { nome: '5+ Gols', odd: 'odd_total_gols_extatos_5', paga: function (a, b) { return a + b >= 5; } }
  };
  var REGRAS = [
    'Você é o analista de futebol virtual do AMD Live. Responda em português do Brasil, direto e curto.',
    'Use SOMENTE os DADOS AO VIVO enviados na mensagem. Não invente jogos, odds, horários ou números. Se faltar dado, diga que falta.',
    'REGRAS DA CASA (obrigatórias, sem exceção):',
    '1) Gráfico em queda JAMAIS. Só existe entrada se o gráfico ACUMULADO 00h do mercado estiver subindo: MM9 acima da MM21, MM9 subindo e a linha acima da MM9 (campo "acumulado OK = SIM"). Death cross ou linha abaixo da MM9 = não entra.',
    '2) Madrugada: com menos de 60 jogos no dia o gráfico 00h engana — não mande entrada.',
    '3) Nenhum dos 3 tiros pode estar em COLUNA SECA (0 de 3 no mesmo minuto) nem ter TIME FRIO (0 de 3 nos últimos jogos do time).',
    '4) Os 3 tiros são CONSECUTIVOS na mesma liga e o 1º precisa ter folga de pelo menos 1min30 em relação à hora atual. Nunca jogo já começado.',
    '5) Comportamento de pagamento: olhe se a liga está pagando (sequências de green recentes, última 1h acima do dia) ou secando. Liga secando = não entra.',
    '6) No máximo UMA entrada por resposta. Se qualquer regra falhar em todas as ligas, o veredito é AGUARDAR e você explica em uma linha por liga o que falhou.',
    'COMO RESPONDER: escreva como um analista conversando com o apostador, com o SEU raciocínio e as suas palavras, não como formulário. Compare as ligas entre si, diga o que te chamou atenção no comportamento de pagamento (sequências, secas, aceleração ou freio da MM9) e aponte os riscos mesmo quando as regras passam (ex.: time com 1/6, coluna 1/3, odd baixa no meio do bloco). Responda exatamente o que foi perguntado; se a pergunta não pede entrada, não force uma.',
    'Quando houver entrada, termine com os 3 tiros assim: "Tiro N · HH:MM · coluna :MM · TIME x TIME @odd — motivo". Antes deles, diga em uma frase por que essa liga e não as outras.',
    'Seja honesto: futebol virtual é sorteado, nenhuma análise garante green. Nunca prometa resultado e nunca sugira aumentar valor para recuperar perda.'
  ].join('\n');

  var LIVRE = [
    'Você é a IA pessoal de um apostador de futebol virtual (Kiron/Vavada), conectada ao site AMD Live. Converse livremente em português do Brasil, como um parceiro de análise: tire dúvidas, discuta estratégia, analise ligas, mercados, times, colunas, odds e gráficos, explique o que está vendo.',
    'Em cada mensagem você recebe DADOS AO VIVO do site. Use esses dados como fonte da verdade: não invente jogos, odds, horários ou números; se algo não estiver nos dados, diga que não está.',
    'O usuário pode te ensinar o método dele na seção ENSINO DO USUÁRIO: siga esse método e use o vocabulário dele. Quando ele pedir uma entrada, aplique as regras dele.',
    'Seja honesto: futebol virtual é sorteado (RNG), nenhuma análise garante green. Se uma ideia dele não tiver apoio nos dados, diga com respeito. Nunca incentive aumentar valor para recuperar perda.'
  ].join('\n');
  function sistema() {
    var ens = ($('ensino') && $('ensino').value.trim()) || '';
    var base = ($('modo') && $('modo').value === 'regras') ? REGRAS : LIVRE + '\n\nREGRAS DA CASA (referência; o usuário costuma operar assim):\n' + REGRAS.split('REGRAS DA CASA (obrigatórias, sem exceção):')[1].split('COMO RESPONDER')[0];
    return base + (ens ? '\n\nENSINO DO USUÁRIO (siga isto):\n' + ens : '');
  }
  function $(id) { return document.getElementById(id); }
  function ler(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function grava(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var cfg = ler(LS_CFG, { prov: 'gemini', chave: '', modelo: '' });
  var chat = ler(LS_CHAT, []);
  var ultimoModelo = '';

  /* ---------------- dados ao vivo ---------------- */
  function hhmm(g) { return String(g.hora).padStart(2, '0') + ':' + String(g.minuto).padStart(2, '0'); }
  function mm(line, p, i) { if (i < p - 1) return NaN; var t = 0; for (var k = i - p + 1; k <= i; k++) t += line[k]; return t / p; }
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }

  function analisaLiga(id, nome, partidas, mkSel, completo) {
    var fe = partidas.filter(function (g) { return g.resultado_ft && g.gols_a != null; }).sort(function (a, b) { return Date.parse(a.slot_em) - Date.parse(b.slot_em); });
    var fu = partidas.filter(function (g) { return !g.resultado_ft; }).sort(function (a, b) { return Date.parse(a.slot_em) - Date.parse(b.slot_em); });
    if (!fe.length) return '## ' + nome + '\nsem jogos carregados';
    var dia = String(fe[fe.length - 1].slot_em).slice(0, 10);
    var hoje = fe.filter(function (g) { return String(g.slot_em).slice(0, 10) === dia; });
    var linhas = ['## ' + nome + ' (' + id + ') · último jogo fechado ' + hhmm(fe[fe.length - 1]) + ' · ' + hoje.length + ' jogos no dia'];
    Object.keys(MK).forEach(function (k) {
      var M = MK[k], s = 0;
      var line = hoje.map(function (g, i) { s += M.paga(+g.gols_a, +g.gols_b) ? 1 : 0; return s / (i + 1) * 100; });
      var n = line.length - 1, m9 = mm(line, 9, n), m21 = mm(line, 21, n), m9a = mm(line, 9, n - 3);
      var ok = hoje.length >= 60 && m9 > m21 && m9 >= mm(line, 9, n - 1) && line[n] >= m9;
      var r1 = fe.slice(-30), r3 = fe.slice(-90);
      var t1 = pct(r1.filter(function (g) { return M.paga(+g.gols_a, +g.gols_b); }).length, r1.length);
      var t3 = pct(r3.filter(function (g) { return M.paga(+g.gols_a, +g.gols_b); }).length, r3.length);
      var t24 = pct(fe.filter(function (g) { return M.paga(+g.gols_a, +g.gols_b); }).length, fe.length);
      var seq = fe.slice(-20).map(function (g) { return M.paga(+g.gols_a, +g.gols_b) ? 'G' : 'r'; }).join('');
      var seca = 0; for (var i = fe.length - 1; i >= 0 && !M.paga(+fe[i].gols_a, +fe[i].gols_b); i--) seca++;
      var princ = k === mkSel ? ' [MERCADO PRINCIPAL]' : '';
      linhas.push('- ' + M.nome + princ + ': acumulado 00h linha ' + (line[n] || 0).toFixed(2) + '% · MM9 ' + (isFinite(m9) ? m9.toFixed(2) : '—') + ' (há 3 jogos ' + (isFinite(m9a) ? m9a.toFixed(2) : '—') + ') · MM21 ' + (isFinite(m21) ? m21.toFixed(2) : '—') +
        ' · acumulado OK = ' + (ok ? 'SIM' : 'NÃO') + (hoje.length < 60 ? ' (madrugada)' : '') +
        ' · última 1h ' + t1 + '% · 3h ' + t3 + '% · normal 24h ' + t24 + '% · seca atual ' + seca + ' · últimos 20 (antigo→recente) ' + seq);
    });
    var M = MK[mkSel];
    function colSeca(min) { var c = fe.filter(function (g) { return Number(g.minuto) === min; }).slice(-3); return { txt: c.filter(function (g) { return M.paga(+g.gols_a, +g.gols_b); }).length + '/' + c.length, seca: c.length >= 3 && !c.some(function (g) { return M.paga(+g.gols_a, +g.gols_b); }) }; }
    function time(t) { var j = fe.filter(function (g) { return g.time_a === t || g.time_b === t; }); var u6 = j.slice(-6), u3 = j.slice(-3);
      return { txt: u6.filter(function (g) { return M.paga(+g.gols_a, +g.gols_b); }).length + '/' + u6.length, frio: u3.length >= 3 && !u3.some(function (g) { return M.paga(+g.gols_a, +g.gols_b); }) }; }
    if (completo) {
      linhas.push('Jogos fechados das últimas 3h (hora · casa x fora · placar · odds O2.5/O3.5/Ambas):');
      fe.slice(-90).forEach(function (g) { var o = g.odds || {}; linhas.push('  ' + hhmm(g) + ' · ' + g.time_a + ' x ' + g.time_b + ' · ' + g.gols_a + '-' + g.gols_b + ' · ' + (o['odd_over_2.5'] || '?') + '/' + (o['odd_over_3.5'] || '?') + '/' + (o['odd_ambas_sim'] || '?')); });
    }
    linhas.push('Próximos jogos (' + M.nome + '):');
    fu.slice(0, 8).forEach(function (g) {
      var c = colSeca(Number(g.minuto)), ta = time(g.time_a), tb = time(g.time_b), odd = (g.odds || {})[M.odd];
      linhas.push('  ' + hhmm(g) + ' · ' + g.time_a + ' (' + ta.txt + (ta.frio ? ' FRIO' : '') + ') x ' + g.time_b + ' (' + tb.txt + (tb.frio ? ' FRIO' : '') + ') · @' + (odd || '?') +
        ' · coluna :' + String(g.minuto).padStart(2, '0') + ' ' + c.txt + (c.seca ? ' SECA' : ''));
    });
    if (!fu.length) linhas.push('  (sem jogos futuros na grade agora — liga pode estar em pausa)');
    return linhas.join('\n');
  }

  function ligasMarcadas() { return LIGAS.filter(function (l) { var el = $('lg_' + l[0]); return el && el.checked; }); }

  function contexto() {
    var mkSel = $('mk').value, sel = ligasMarcadas();
    return Promise.all(sel.map(function (l) {
      return fetch('/api/grade?liga=' + l[0] + '&horas=24&compacto=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { partidas: [] }; })
        .then(function (j) { return analisaLiga(l[0], l[1], j.partidas || [], mkSel, $('prof').value === 'completo'); })
        .catch(function () { return '## ' + l[1] + '\nfalha ao carregar'; });
    })).then(function (blocos) {
      if ($('prof').value !== 'completo') return blocos;
      return fetch('/api/robo', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
        var nomes = { o35: 'Robô O3.5', o25: 'Robô O2.5 A', o25b: 'Robô O2.5 B', ambas: 'Robô Ambas' };
        var t = Object.keys(nomes).filter(function (k) { return j[k] && j[k].registro; }).map(function (k) {
          var r = j[k].registro, e = j[k].empate || {};
          return '- ' + nomes[k] + ': saldo ' + r.saldo + 'u · hoje ' + r.hoje + 'u · greens ' + r.greens + ' · reds ' + r.redsCiclo + ' · acerto ' + (e.esta == null ? '—' : e.esta + '%') + ' · precisa ' + (e.precisa == null ? '—' : e.precisa + '%') + (j[k].cicloView ? ' · CICLO ABERTO em ' + j[k].cicloView.liga : '');
        }).join('\n');
        return blocos.concat(['## Robôs automáticos do site\n' + (t || 'sem dados')]);
      }).catch(function () { return blocos; });
    }).then(function (blocos) {
      var agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      return 'DADOS AO VIVO DO AMD LIVE · hora atual (Brasília) ' + agora + ' · mercado principal: ' + MK[mkSel].nome +
        '\nLegenda: G = pagou, r = não pagou. Times: x/6 = quantos dos últimos 6 jogos do time pagaram o mercado; FRIO = 0 nos últimos 3. Coluna: x/3 = últimos 3 jogos daquele minuto; SECA = 0 de 3.\n\n' + blocos.join('\n\n');
    });
  }

  /* ---------------- provedores ---------------- */
  function erroHttp(r) { return r.text().then(function (t) { var m = t; try { var j = JSON.parse(t); m = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) {} var er = new Error('HTTP ' + r.status + ': ' + String(m).slice(0, 300)); er.status = r.status; throw er; }); }
  /* Preferencia de modelo: estaveis e rapidos primeiro; experimentais por ultimo. */
  function nota(m) {
    var s = 0; m = String(m).toLowerCase();
    if (/flash/.test(m)) s += 3; if (/pro|sonnet|gpt-?\d|4o|opus/.test(m)) s += 2; if (/lite|mini|haiku/.test(m)) s += 1;
    if (/exp|preview|experimental|hydrogen|test|alpha|beta|tts|image|vision|embed|thinking/.test(m)) s -= 4;
    var v = m.match(/(\d+(?:\.\d+)?)/); if (v) s += Math.min(3, Number(v[1]) / 2);
    return s;
  }
  function ordena(lista) { return lista.slice().sort(function (a, b) { return nota(b) - nota(a) || a.localeCompare(b); }); }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* Ocupado (429/500/502/503/504): tenta de novo e depois troca de modelo sozinho. */
  function perguntarComReserva(hist, aviso) {
    if (!cfg.lista || !cfg.lista.length) {
      /* conexao antiga sem lista de modelos: busca agora para ter reserva */
      return listarModelos(cfg.prov, cfg.chave).then(function (l) { cfg.lista = ordena(l).slice(0, 40); grava(LS_CFG, cfg); }, function () { cfg.lista = []; })
        .then(function () { return perguntarComReserva2(hist, aviso); });
    }
    return perguntarComReserva2(hist, aviso);
  }
  function perguntarComReserva2(hist, aviso) {
    var original = cfg.modelo;
    var reservas = ordena((cfg.lista || []).filter(function (m) { return m !== original; })).slice(0, 3);
    var fila = [original, original].concat(reservas), i = 0;
    function tenta() {
      var modelo = fila[i];
      cfg.modelo = modelo;
      return perguntar(hist).then(function (r) {
        cfg.modelo = original;
        ultimoModelo = modelo + (modelo !== original ? ' (o ' + original + ' estava ocupado)' : '');
        return r;
      }).catch(function (e) {
        cfg.modelo = original;
        var ocupado = [429, 500, 502, 503, 504].indexOf(e.status) >= 0;
        if (!ocupado || ++i >= fila.length) throw e;
        if (aviso) aviso(fila[i] === original ? 'modelo ocupado, tentando de novo…' : 'trocando para ' + fila[i] + '…');
        return espera(fila[i] === original ? 2500 : 500).then(tenta);
      });
    }
    return tenta();
  }

  function listarModelos(prov, chave) {
    if (prov === 'gemini') return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(chave))
      .then(function (r) { return r.ok ? r.json() : erroHttp(r); })
      .then(function (j) { return (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /gemini/i.test(m.name); }).map(function (m) { return m.name.replace(/^models\//, ''); }); });
    if (prov === 'openai') return fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + chave } })
      .then(function (r) { return r.ok ? r.json() : erroHttp(r); })
      .then(function (j) { return (j.data || []).map(function (m) { return m.id; }).filter(function (id) { return /^(gpt|o\d|chatgpt)/i.test(id) && !/audio|realtime|tts|transcribe|image|embedding|search/i.test(id); }); });
    if (prov === 'anthropic') return fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
      .then(function (r) { return r.ok ? r.json() : erroHttp(r); })
      .then(function (j) { return (j.data || []).map(function (m) { return m.id; }); });
    return fetch('https://openrouter.ai/api/v1/models').then(function (r) { return r.ok ? r.json() : erroHttp(r); })
      .then(function (j) { return (j.data || []).map(function (m) { return m.id; }); });
  }

  function perguntar(historico) {
    var prov = cfg.prov, chave = cfg.chave, modelo = cfg.modelo;
    if (prov === 'gemini') {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent?key=' + encodeURIComponent(chave), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema() }] }, contents: historico.map(function (m) { return { role: m.r === 'u' ? 'user' : 'model', parts: [{ text: m.t }] }; }), generationConfig: { temperature: 0.2 } })
      }).then(function (r) { return r.ok ? r.json() : erroHttp(r); })
        .then(function (j) { var c = (j.candidates || [])[0]; return c && c.content ? (c.content.parts || []).map(function (p) { return p.text || ''; }).join('') : ('Sem resposta (' + JSON.stringify(j.promptFeedback || c || {}).slice(0, 200) + ')'); });
    }
    if (prov === 'anthropic') {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: modelo, max_tokens: 3000, system: sistema(), messages: historico.map(function (m) { return { role: m.r === 'u' ? 'user' : 'assistant', content: m.t }; }) })
      }).then(function (r) { return r.ok ? r.json() : erroHttp(r); })
        .then(function (j) { return (j.content || []).map(function (c) { return c.text || ''; }).join(''); });
    }
    var url = prov === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
      body: JSON.stringify({ model: modelo, messages: [{ role: 'system', content: sistema() }].concat(historico.map(function (m) { return { role: m.r === 'u' ? 'user' : 'assistant', content: m.t }; })) })
    }).then(function (r) { return r.ok ? r.json() : erroHttp(r); })
      .then(function (j) { var c = (j.choices || [])[0]; return c && c.message ? (c.message.content || '') : 'Sem resposta'; });
  }

  /* ---------------- tela ---------------- */
  function provNome() { var o = { gemini: 'Gemini', openai: 'ChatGPT', anthropic: 'Claude', openrouter: 'OpenRouter' }; return o[cfg.prov] || cfg.prov; }
  function status(t, cls) { var e = $('stCon'); e.textContent = t; e.className = 'st ' + (cls || ''); }
  function desenhaChat() {
    var box = $('chat');
    box.innerHTML = '';
    if (!chat.length) { var v = document.createElement('div'); v.className = 'nota'; v.textContent = 'Conecte a sua IA, marque as ligas e use um dos botões acima ou escreva sua pergunta.'; box.appendChild(v); }
    chat.forEach(function (m) {
      var d = document.createElement('div'); d.className = 'msg ' + m.r;
      if (m.r === 'a') { d.innerHTML = md(m.t) + (m.mod ? '<div class="mod">✦ ' + esc(m.mod) + '</div>' : ''); }
      else d.textContent = m.r === 'u' ? m.vis || m.t : m.t;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* Markdown leve: titulos, negrito, italico, listas. Escapa tudo antes (sem HTML da IA). */
  function md(t) {
    var linhas = esc(t).split('\n'), out = [], lista = false;
    linhas.forEach(function (l) {
      var inl = function (x) { return x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>'); };
      var h = l.match(/^\s*#{1,4}\s+(.*)$/), li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) { if (!lista) { out.push('<ul>'); lista = true; } out.push('<li>' + inl(li[1]) + '</li>'); return; }
      if (lista) { out.push('</ul>'); lista = false; }
      if (h) out.push('<div class="h">' + inl(h[1]) + '</div>');
      else if (l.trim() === '') out.push('<div class="sp"></div>');
      else out.push('<div>' + inl(l) + '</div>');
    });
    if (lista) out.push('</ul>');
    return out.join('');
  }
  function preencheModelos(lista, atual) {
    var s = $('modelo');
    s.innerHTML = lista.length ? lista.map(function (m) { return '<option>' + m.replace(/[<>&"]/g, '') + '</option>'; }).join('') : '<option value="">nenhum modelo encontrado</option>';
    if (atual && lista.indexOf(atual) >= 0) s.value = atual;
  }

  function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto) return;
    if (!cfg.chave || !cfg.modelo) { status('Conecte a sua IA primeiro (chave + modelo).', 'badt'); return; }
    if (!ligasMarcadas().length) { status('Marque pelo menos uma liga.', 'badt'); return; }
    grava(LS_ENSINO, $('ensino').value);
    var bt = $('btEnviar'); bt.disabled = true; bt.textContent = 'Lendo o site…';
    contexto().then(function (ctx) {
      $('ctx').textContent = ctx;
      chat.push({ r: 'u', t: texto + '\n\n---\n' + ctx, vis: texto });
      desenhaChat();
      bt.textContent = 'IA analisando…';
      /* historico curto: as perguntas antigas vao sem os dados antigos (so a ultima leva os dados ao vivo) */
      var hist = chat.slice(-10).map(function (m, i, arr) { return (m.r === 'u' && i < arr.length - 1) ? { r: 'u', t: m.vis || m.t } : m; })
        .filter(function (m) { return m.r !== 'e'; });
      return perguntarComReserva(hist, function (t) { bt.textContent = t; });
    }).then(function (resp) {
      chat.push({ r: 'a', t: resp || '(vazio)', mod: provNome() + ' · ' + ultimoModelo });
    }).catch(function (e) {
      chat.push({ r: 'e', t: 'Erro da IA: ' + e.message });
    }).then(function () {
      chat = chat.slice(-30); grava(LS_CHAT, chat); desenhaChat();
      bt.disabled = false; bt.textContent = 'Enviar';
    });
  }

  function init() {
    var marcadas = ler(LS_LIGAS, ['eng', 'ita', 'spa', 'mnd']);
    $('ligas').innerHTML = LIGAS.map(function (l) { return '<label><input type="checkbox" id="lg_' + l[0] + '"' + (marcadas.indexOf(l[0]) >= 0 ? ' checked' : '') + '>' + l[1] + '</label>'; }).join('');
    $('ligas').addEventListener('change', function () { grava(LS_LIGAS, ligasMarcadas().map(function (l) { return l[0]; })); });
    $('mk').value = ler(LS_MK, 'o35');
    $('modo').value = ler(LS_MODO, 'livre'); $('modo').addEventListener('change', function () { grava(LS_MODO, $('modo').value); });
    $('prof').value = ler(LS_PROF, 'resumo'); $('prof').addEventListener('change', function () { grava(LS_PROF, $('prof').value); });
    $('ensino').value = ler(LS_ENSINO, '');
    $('btEnsino').addEventListener('click', function () { grava(LS_ENSINO, $('ensino').value); var e = $('stEnsino'); e.textContent = 'Ensino salvo · ' + $('ensino').value.length + ' caracteres · vai em toda conversa'; e.className = 'st ok'; });
    $('mk').addEventListener('change', function () { grava(LS_MK, $('mk').value); });
    $('prov').value = cfg.prov || 'gemini';
    $('chave').value = cfg.chave || '';
    if (cfg.modelo) preencheModelos(cfg.lista && cfg.lista.length ? cfg.lista : [cfg.modelo], cfg.modelo);
    if (cfg.chave && cfg.modelo) status('Conectado · ' + $('prov').selectedOptions[0].textContent + ' · ' + cfg.modelo, 'ok');
    $('prov').addEventListener('change', function () { $('modelo').innerHTML = '<option value="">— clique em “Conectar” para listar —</option>'; cfg.modelo = ''; });
    $('modelo').addEventListener('change', function () { cfg.modelo = $('modelo').value; grava(LS_CFG, cfg); status('Conectado · ' + cfg.modelo, 'ok'); });
    $('btConectar').addEventListener('click', function () {
      var prov = $('prov').value, chave = $('chave').value.trim();
      if (!chave) { status('Cole a sua chave da API.', 'badt'); return; }
      status('Conectando…', 'warn');
      listarModelos(prov, chave).then(function (lista) {
        lista = ordena(lista);
        cfg = { prov: prov, chave: chave, modelo: '', lista: lista.slice(0, 40) };
        preencheModelos(lista, null);
        cfg.modelo = $('modelo').value; grava(LS_CFG, cfg);
        status(lista.length ? 'Conectado · ' + lista.length + ' modelos · escolha o modelo na lista' : 'Chave aceita, mas nenhum modelo de texto encontrado.', lista.length ? 'ok' : 'warn');
      }).catch(function (e) { status('Não conectou: ' + e.message, 'badt'); });
    });
    $('btSair').addEventListener('click', function () {
      cfg = { prov: $('prov').value, chave: '', modelo: '' }; grava(LS_CFG, cfg);
      $('chave').value = ''; preencheModelos([], null); status('Desconectado · chave apagada deste navegador.', 'warn');
    });
    $('btVer').addEventListener('click', function () { $('ctx').textContent = 'carregando…'; $('det').open = true; contexto().then(function (c) { $('ctx').textContent = c; }); });
    $('btEnviar').addEventListener('click', function () { var t = $('txt').value; $('txt').value = ''; enviar(t); });
    $('txt').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('btEnviar').click(); } });
    $('btLimpar').addEventListener('click', function () { chat = []; grava(LS_CHAT, chat); desenhaChat(); });
    Array.prototype.forEach.call(document.querySelectorAll('.quick button'), function (b) { b.addEventListener('click', function () { enviar(b.dataset.q); }); });
    desenhaChat();
  }
  init();
})();
