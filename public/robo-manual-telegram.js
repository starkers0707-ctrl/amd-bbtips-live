(function () {
  'use strict';
  function q(s) { return document.querySelector(s); }
  function esc(v) { return String(v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function toast(msg) {
    var el = q('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 4000);
  }
  var estado = { configurado: false, conectado: false, canais: [] };

  /* Destino: site, meu Telegram, ou um canal/grupo conectado por este acesso */
  function montaDestinos() {
    var sel = q('#rbDestino'); if (!sel) return;
    var want = sel.dataset.want || sel.value || 'todos';
    var ops = [
      ['todos', '✈ Site + meu Telegram'],
      ['site', '🔔 Só aqui no site (notificação)'],
      ['telegram', '✈ Só no meu Telegram']
    ];
    (estado.canais || []).forEach(function (c) {
      ops.push(['canal:' + c.id, (c.tipo === 'channel' ? '📢 Canal: ' : '👥 Grupo: ') + c.nome]);
    });
    sel.innerHTML = ops.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
    sel.value = ops.some(function (o) { return o[0] === want; }) ? want : 'todos';
  }

  function pinta() {
    var txt;
    if (!estado.configurado) txt = 'ainda não está ligado no servidor.';
    else {
      txt = estado.conectado ? 'conectado' + (estado.nome ? ' (' + estado.nome + ')' : '') : 'seu Telegram não está conectado';
      var n = (estado.canais || []).length;
      if (n) txt += ' · ' + n + (n === 1 ? ' canal/grupo' : ' canais/grupos');
      txt += ' · clique no + para conectar';
    }
    ['#tgStatus', '#tgStatus2'].forEach(function (id) { var el = q(id); if (el) el.textContent = 'Telegram: ' + txt; });
    var badge = q('#tgBadge'); if (badge) badge.textContent = String(1 + (estado.conectado ? 1 : 0) + (estado.canais || []).length);
    montaDestinos();
  }

  async function status() {
    try {
      var r = await fetch('/api/telegram/status', { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) estado = await r.json();
    } catch (_) {}
    pinta();
  }

  var espera = null;
  function aguarda(cond, ok) {
    clearInterval(espera);
    var n = 0;
    espera = setInterval(async function () {
      await status();
      if (cond() || ++n > 100) { clearInterval(espera); if (cond()) toast(ok); }
    }, 3000);
  }

  async function conectarMeu() {
    fechaMenu();
    var r = await fetch('/api/telegram/vincular', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    var j = await r.json().catch(function () { return {}; });
    if (!j.link) return toast(j.erro || 'Não foi possível gerar o link.');
    window.open(j.link, '_blank', 'noopener');
    toast('Abra o Telegram e toque em INICIAR. Aguardando…');
    aguarda(function () { return estado.conectado; }, 'Seu Telegram foi conectado ✅');
  }

  async function adicionar(tipo) {
    var r = await fetch('/api/telegram/vincular', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: tipo }) });
    var j = await r.json().catch(function () { return {}; });
    if (!j.link) return toast(j.erro || 'Não foi possível gerar o link.');
    window.open(j.link, '_blank', 'noopener');
    var antes = (estado.canais || []).length;
    toast('No Telegram: aperte Iniciar e depois ' + (tipo === 'canal' ? 'Escolher canal' : 'Escolher grupo') + '. Esta tela confirma sozinha.');
    aguarda(function () { return (estado.canais || []).length > antes; }, (tipo === 'canal' ? 'Canal' : 'Grupo') + ' conectado ✅ — escolha no Destino.');
  }

  async function desconectar(canal) {
    await fetch('/api/telegram/desvincular', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canal: canal || '' }) });
    await status(); if (q('#tgMenu')) { fechaMenu(); abreMenu(); }
  }

  function fechaMenu() { var m = q('#tgMenu'); if (m) m.remove(); }
  function abreMenu() {
    if (q('#tgMenu')) return fechaMenu();
    if (!estado.configurado) return toast('O Telegram ainda não foi ligado no servidor.');
    var max = estado.max || 5, canais = estado.canais || [];
    var box = document.createElement('div'); box.id = 'tgMenu'; box.className = 'tg-menu';
    var html = '<header><b>✈ Destinos no Telegram</b><small>' + canais.length + ' de ' + max + ' canais/grupos</small></header>' +
      '<div class="tg-tip"><b>Escolha onde receber os sinais</b><p>Toque em <b>Adicionar grupo</b> ou <b>Adicionar canal</b>. No Telegram, aperte <b>Iniciar</b> e depois <b>Escolher grupo</b> ou <b>Escolher canal</b>. A lista abre no próprio Telegram e esta tela confirma sozinha.</p><small>Sem copiar IDs. Só os destinos escolhidos por você ficam ligados ao seu acesso.</small></div>' +
      '<div class="tg-list-title">Destinos conectados</div>';
    html += '<div class="tg-item"><i>' + (estado.conectado ? '✓' : '·') + '</i><div><b>Meu Telegram (privado)</b><small>' + (estado.conectado ? 'Conectado' + (estado.nome ? ' · ' + esc(estado.nome) : '') : 'Não conectado') + '</small></div>' +
      (estado.conectado ? '<button type="button" data-a="sair" title="Desconectar">🗑</button>' : '<button type="button" data-a="meu" class="tg-mini">Conectar</button>') + '</div>';
    canais.forEach(function (c) {
      html += '<div class="tg-item"><i>✓</i><div><b>' + esc(c.nome) + '</b><small>' + (c.tipo === 'channel' ? 'Canal conectado' : 'Grupo conectado') + '</small></div><button type="button" data-a="rm" data-id="' + esc(c.id) + '" title="Remover">🗑</button></div>';
    });
    var cheio = canais.length >= max;
    html += '<button type="button" class="tg-add blue" data-a="grupo"' + (cheio ? ' disabled' : '') + '>👥 Adicionar grupo</button>' +
      '<button type="button" class="tg-add" data-a="canal"' + (cheio ? ' disabled' : '') + '>📢 Adicionar canal</button>';
    box.innerHTML = html;
    q('.tc-dest').appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
      var a = b.dataset.a;
      if (a === 'meu') conectarMeu();
      else if (a === 'grupo' || a === 'canal') adicionar(a);
      else if (a === 'sair') desconectar('');
      else if (a === 'rm') desconectar(b.dataset.id);
    });
  }

  async function testar() {
    var destino = (q('#rbDestino') || {}).value || 'todos';
    var canal = destino.indexOf('canal:') === 0 ? destino.slice(6) : '';
    if (!canal && !estado.conectado) return toast('Conecte o Telegram primeiro (botão + no Destino).');
    var r = await fetch('/api/telegram/enviar', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: '🤖 Teste do AMD Live\nSe chegou aqui, os robôs com este destino vão avisar neste chat.', canal: canal })
    });
    toast(r.ok ? 'Mensagem de teste enviada para o destino escolhido.' : 'Falhou o envio para o Telegram.');
  }

  var c = q('#tgConnect'); if (c) c.addEventListener('click', abreMenu);
  var t = q('#tgTest'); if (t) t.addEventListener('click', testar);
  document.addEventListener('click', function (e) {
    var m = q('#tgMenu');
    if (m && e.composedPath().indexOf(m) < 0 && e.target.id !== 'tgConnect') fechaMenu();
  });
  window.AMDTelegram = { refresh: status };
  status();
})();
