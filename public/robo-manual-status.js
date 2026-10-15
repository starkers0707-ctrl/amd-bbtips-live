(function () {
  'use strict';
  var ROBOTS_KEY = 'amd:robos-manuais:v2';
  var SIGNALS_KEY = 'amd:robos-manuais-sinais:v2';
  function q(selector) { return document.querySelector(selector); }
  function read(key) { try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function robotLeagues(robot) {
    var values = robot && Array.isArray(robot.leagues) && robot.leagues.length
      ? robot.leagues : [robot && robot.league || 'copa'];
    return Array.from(new Set(values.map(function (value) { return String(value || '').toUpperCase(); })));
  }
  function signalDetails(signal) {
    var maximum = Math.max(1, Number(signal.shots || 1));
    var current = Math.max(1, Number(signal.winningShot || signal.currentShot || 1));
    var gameAt = signal.gameSlot ? new Date(signal.gameSlot).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'horário aguardando';
    var attempts = (Array.isArray(signal.attempts) ? signal.attempts : []).map(function (attempt) {
      return 'T' + attempt.number + ' ' + attempt.status + (attempt.score ? ' ' + attempt.score : '');
    }).join(' → ');
    return String(signal.league || 'copa').toUpperCase() + ' · ' + (signal.timeA || '?') + ' x ' + (signal.timeB || '?') +
      ' · TIRO ' + current + '/' + maximum + ' · jogo ' + gameAt + (signal.score ? ' · placar ' + signal.score : '') +
      (attempts ? ' · ciclo: ' + attempts : '');
  }
  function uniqueMarkets(robot, type) {
    var values = (robot.pattern || []).filter(function (item) { return type === 'entry' ? item.markType === 'entry' : item.markType !== 'entry'; }).map(function (item) { return type === 'entry' ? (item.entryMarket || item.market) : item.market; }).filter(Boolean);
    return Array.from(new Set(values));
  }
  function toggleRobot(id) {
    var robots = read(ROBOTS_KEY), robot = robots.find(function (item) { return item.id === id; });
    if (!robot) return;
    robot.active = !robot.active;
    robot.updatedAt = new Date().toISOString();
    if (robot.active) robot.activatedAt = robot.updatedAt;
    write(ROBOTS_KEY, robots);
    render();
  }
  function render() {
    var robots = read(ROBOTS_KEY), signals = read(SIGNALS_KEY);
    var active = robots.filter(function (robot) { return robot.active; });
    q('#rbManualActiveCount').textContent = String(active.length);
    q('#rbManualPendingCount').textContent = String(signals.filter(function (signal) { return signal.status === 'PENDENTE'; }).length);
    q('#rbManualGreenCount').textContent = String(signals.filter(function (signal) { return signal.status === 'GREEN'; }).length);
    q('#rbManualRedCount').textContent = String(signals.filter(function (signal) { return signal.status === 'RED'; }).length);
    q('#rbManualSignalCount').textContent = String(signals.length);

    var robotList = q('#rbManualRobotList'); robotList.innerHTML = '';
    if (!robots.length) robotList.innerHTML = '<div class="rb-manual-empty">Nenhum robô manual salvo. Clique em “Criar ou editar robô”.</div>';
    robots.forEach(function (robot) {
      var item = document.createElement('article'); item.className = 'rb-manual-item';
      var copy = document.createElement('div'), title = document.createElement('h3'), details = document.createElement('p');
      title.textContent = (robot.active ? '● ATIVO · ' : '○ DESATIVADO · ') + (robot.name || 'Robô sem nome');
      var conditions = uniqueMarkets(robot, 'condition').join(' + ') || robot.market || 'não definida';
      var entries = uniqueMarkets(robot, 'entry').join(' + ') || robot.entryMarket || 'não definida';
      details.textContent = robotLeagues(robot).join(', ') + ' · condição: ' + conditions + ' · entrada: ' + entries + ' · ' + (robot.shots || 1) + ' tiro(s)';
      copy.appendChild(title); copy.appendChild(details);
      var actions = document.createElement('div'); actions.className = 'rb-manual-actions';
      var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = robot.active ? 'stop' : 'active'; toggle.textContent = robot.active ? 'Desativar' : 'Ativar'; toggle.addEventListener('click', function () { toggleRobot(robot.id); });
      var edit = document.createElement('a'); edit.href = 'robo-manual.html'; edit.textContent = 'Editar';
      actions.appendChild(toggle); actions.appendChild(edit); item.appendChild(copy); item.appendChild(actions); robotList.appendChild(item);
    });

    var signalList = q('#rbManualSignalList'); signalList.innerHTML = '';
    if (!signals.length) signalList.innerHTML = '<div class="rb-manual-empty">Nenhuma entrada real enviada pelos robôs ainda.</div>';
    signals.slice(0, 200).forEach(function (signal) {
      var row = document.createElement('article'); row.className = 'rb-signal-row';
      var copy = document.createElement('div'), title = document.createElement('h4'), details = document.createElement('p');
      title.textContent = (signal.robotName || 'Robô manual') + ' · ' + (signal.market || 'Entrada');
      details.textContent = signalDetails(signal);
      var badge = document.createElement('b'); badge.className = 'rb-signal-status ' + String(signal.status || 'PENDENTE').toLowerCase(); badge.textContent = signal.status || 'PENDENTE';
      copy.appendChild(title); copy.appendChild(details); row.appendChild(copy); row.appendChild(badge); signalList.appendChild(row);
    });
  }
  window.addEventListener('storage', function (event) { if (event.key === ROBOTS_KEY || event.key === SIGNALS_KEY) render(); });
  window.addEventListener('amd:manual-status-changed', render);
  document.addEventListener('DOMContentLoaded', render);
})();
