(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.AMDFib50Alert = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  function detectarRompimento(anterior, atual) {
    if (!anterior || !atual) return '';
    if (String(anterior.contexto || '') !== String(atual.contexto || '')) return '';
    if (String(anterior.chave || '') === String(atual.chave || '')) return '';

    const valorAnterior = numero(anterior.valor);
    const nivelAnterior = numero(anterior.nivel);
    const valorAtual = numero(atual.valor);
    const nivelAtual = numero(atual.nivel);
    if ([valorAnterior, nivelAnterior, valorAtual, nivelAtual].some(v => v === null)) return '';

    const tolerancia = 1e-9;
    const ladoAnterior = valorAnterior - nivelAnterior;
    const ladoAtual = valorAtual - nivelAtual;
    if (ladoAnterior < -tolerancia && ladoAtual >= -tolerancia) return 'alta';
    if (ladoAnterior > tolerancia && ladoAtual <= tolerancia) return 'baixa';
    return '';
  }

  return { detectarRompimento };
});
