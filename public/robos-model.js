(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RobosTesteModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PERFIS = {
    agressivo: { nome: 'Agressivo', limiar: 50 },
    equilibrado: { nome: 'Equilibrado', limiar: 65 },
    cauteloso: { nome: 'Cauteloso', limiar: 80 }
  };

  function numero(valor, padrao) {
    var n = Number(valor);
    return isFinite(n) ? n : padrao;
  }

  function calcular(regras, limiar) {
    var lista = Array.isArray(regras) ? regras : [];
    var ativas = lista.filter(function (r) { return r && r.usar !== false; });
    var confirmadas = ativas.filter(function (r) { return !!r.confirmada; });
    var pontos = confirmadas.reduce(function (soma, r) {
      return soma + Math.max(0, numero(r.peso, 0));
    }, 0);
    var maximo = ativas.reduce(function (soma, r) {
      return soma + Math.max(0, numero(r.peso, 0));
    }, 0);
    var alvo = Math.max(1, Math.min(100, Math.round(numero(limiar, 65))));
    var status = pontos >= alvo ? 'ENTRADA'
      : pontos >= Math.max(1, alvo - 15) ? 'OBSERVAR' : 'AGUARDAR';
    return {
      pontos: Math.min(100, Math.round(pontos)),
      maximo: Math.min(100, Math.round(maximo)),
      limiar: alvo,
      status: status,
      confirmadas: confirmadas.length,
      usadas: ativas.length
    };
  }

  function perfil(chave) {
    return PERFIS[chave] || PERFIS.equilibrado;
  }

  return { PERFIS: PERFIS, calcular: calcular, perfil: perfil };
});
