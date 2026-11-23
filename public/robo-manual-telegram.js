(function () {
  'use strict';
  function q(s) { return document.querySelector(s); }
  function toast(msg) {
    var el = q('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 3500);
  }
  var estado = { configurado: false, conectado: false };

  function pinta() {
    var txt;
    if (!estado.configurado) txt = 'Telegram ainda não está ligado no servidor.';
    else if (estado.conectado) txt = 'Conectado' + (estado.nome ? ' (' + estado.nome + ')' : '') + ' · @' + estado.bot;
    else txt = 'Não conectado · clique no + para ligar seu Telegram';
    ['#tgStatus', '#tgStatus2'].forEach(function (id) { var el = q(id); if (el) el.textContent = 'Telegram: ' + txt; });
    var badge = q('#tgBadge'); if (badge) badge.textContent = estado.conectado ? '2' : '1';
    var plus = q('#tgConnect');
    if (plus) { plus.textContent = estado.conectado ? '✓' : '+'; plus.title = estado.conectado ? 'Telegram conectado (clique para desconectar)' : 'Conectar Telegram'; }
  }

  async function status() {
    try {
      var r = await fetch('/api/telegram/status', { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) estado = await r.json();
    } catch (_) {}
    pinta();
  }

  var espera = null;
  async function conectar() {
    if (!estado.configurado) return toast('O Telegram ainda não foi ligado no servidor.');
    if (estado.conectado) {
      if (!window.confirm('Desconectar o Telegram deste acesso?')) return;
      await fetch('/api/telegram/desvincular', { method: 'POST', credentials: 'same-origin' });
      return status();
    }
    var r = await fetch('/api/telegram/vincular', { method: 'POST', credentials: 'same-origin' });
    var j = await r.json().catch(function () { return {}; });
    if (!j.link) return toast(j.erro || 'Não foi possível gerar o link.');
    window.open(j.link, '_blank', 'noopener');
    toast('Abra o Telegram e toque em INICIAR. Aguardando…');
    clearInterval(espera);
    var tentativas = 0;
    espera = setInterval(async function () {
      await status();
      if (estado.conectado || ++tentativas > 60) {
        clearInterval(espera);
        if (estado.conectado) toast('Telegram conectado ✅');
      }
    }, 3000);
  }

  async function testar() {
    if (!estado.conectado) return toast('Conecte o Telegram primeiro (botão + no Destino).');
    var r = await fetch('/api/telegram/enviar', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: '🤖 Teste do AMD Live\nSe chegou aqui, seus robôs vão avisar neste chat.' })
    });
    toast(r.ok ? 'Mensagem de teste enviada.' : 'Falhou o envio para o Telegram.');
  }

  var c = q('#tgConnect'); if (c) c.addEventListener('click', conectar);
  var t = q('#tgTest'); if (t) t.addEventListener('click', testar);
  status();
})();
