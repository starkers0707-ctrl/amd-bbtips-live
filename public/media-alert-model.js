(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MediaAlertModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function smaNoIndice(serie, periodo, indice) {
    if (indice < periodo - 1) return null;
    var soma = 0;
    for (var i = indice - periodo + 1; i <= indice; i += 1) soma += serie[i];
    return soma / periodo;
  }

  function analisar(serieInformada, periodosInformados) {
    var serie = (Array.isArray(serieInformada) ? serieInformada : [])
      .map(Number).filter(Number.isFinite);
    var periodos = (Array.isArray(periodosInformados) ? periodosInformados : [])
      .map(function (p) { return Math.max(1, Math.round(Number(p) || 1)); })
      .slice(0, 3);
    if (periodos.length !== 3 || serie.length < Math.max.apply(null, periodos) + 1)
      return { valido: false, confirmado: false };

    var ultimo = serie.length - 1, anterior = ultimo - 1;
    var faixa = serie.slice(Math.max(0, serie.length - 40));
    var tolerancia = Math.max(.02,
      (Math.max.apply(null, faixa) - Math.min.apply(null, faixa)) * .002);
    function leitura(indice) {
      var medias = periodos.map(function (p) { return smaNoIndice(serie, p, indice); });
      var maior = Math.max.apply(null, medias);
      return { atual: serie[indice], medias: medias, acima: serie[indice] > maior + tolerancia };
    }
    var agora = leitura(ultimo), antes = leitura(anterior);
    return {
      valido: true,
      confirmado: agora.acima && antes.acima,
      atual: Math.round(agora.atual * 10) / 10,
      medias: agora.medias.map(function (v) { return Math.round(v * 10) / 10; }),
      periodos: periodos,
      margem: Math.round((agora.atual - Math.max.apply(null, agora.medias)) * 10) / 10
    };
  }

  return { analisar: analisar };
});
