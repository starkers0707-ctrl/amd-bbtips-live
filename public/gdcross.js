/* Calculo puro de Golden Cross / Death Cross para o grafico AMD LIVE. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GDCross = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function periodo(valor, fallback) {
    var n = Math.round(Number(valor));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function periodos(mm1, mm2) {
    var a = periodo(mm1, 9);
    var b = periodo(mm2, 21);
    return {
      rapida: Math.min(a, b),
      lenta: Math.max(a, b),
      valido: a !== b
    };
  }

  function mediaMovelSimples(serie, janela) {
    var valores = Array.isArray(serie) ? serie : [];
    var saida = new Array(valores.length).fill(null);
    var soma = 0;
    var validos = 0;
    var fila = [];

    valores.forEach(function (valor, indice) {
      var n = Number(valor);
      var valido = Number.isFinite(n);
      fila.push(valido ? n : null);
      if (valido) { soma += n; validos++; }

      if (fila.length > janela) {
        var removido = fila.shift();
        if (removido !== null) { soma -= removido; validos--; }
      }
      if (fila.length === janela && validos === janela) {
        saida[indice] = soma / janela;
      }
    });
    return saida;
  }

  function analisar(serie, mm1, mm2) {
    var valores = (Array.isArray(serie) ? serie : []).map(function (valor) {
      var n = Number(valor);
      return Number.isFinite(n) ? n : NaN;
    });
    var p = periodos(mm1, mm2);
    var rapida = mediaMovelSimples(valores, p.rapida);
    var lenta = mediaMovelSimples(valores, p.lenta);
    var cruzamentos = [];
    var sinalAnterior = 0;

    if (p.valido) {
      for (var i = 0; i < valores.length; i++) {
        if (rapida[i] === null || lenta[i] === null) continue;
        var diferenca = rapida[i] - lenta[i];
        var sinal = Math.abs(diferenca) < 1e-10 ? 0 : (diferenca > 0 ? 1 : -1);
        if (!sinal) continue;

        if (sinalAnterior && sinal !== sinalAnterior) {
          cruzamentos.push({
            indice: i,
            tipo: sinal > 0 ? 'golden' : 'death',
            valor: (rapida[i] + lenta[i]) / 2,
            mediaRapida: rapida[i],
            mediaLenta: lenta[i]
          });
        }
        sinalAnterior = sinal;
      }
    }

    return {
      valido: p.valido,
      periodoRapido: p.rapida,
      periodoLento: p.lenta,
      mediaRapida: rapida,
      mediaLenta: lenta,
      cruzamentos: cruzamentos
    };
  }

  function normalizarHorario(valor) {
    var texto = String(valor == null ? '' : valor).trim().replace(';', ':');
    var partes = texto.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!partes) return texto;
    var hora = Math.max(0, Math.min(23, Number(partes[1])));
    var minuto = Math.max(0, Math.min(59, Number(partes[2])));
    return String(hora).padStart(2, '0') + ':' + String(minuto).padStart(2, '0');
  }

  function formatarAlerta(tipo, liga, horario) {
    var cruzamento = tipo === 'golden' ? 'Golden Cross' : 'Death Cross';
    var chaveLiga = String(liga || '').trim().toLowerCase();
    var ligas = { copa: 'Copa', euro: 'Euro', super: 'Super', premier: 'Premier' };
    var nomeLiga = ligas[chaveLiga] || String(liga || '').trim();
    var hora = normalizarHorario(horario);
    var frase = [nomeLiga, cruzamento, hora].filter(Boolean).join(' ');
    return frase + '. ' + frase + '.';
  }

  return {
    periodos: periodos,
    mediaMovelSimples: mediaMovelSimples,
    analisar: analisar,
    normalizarHorario: normalizarHorario,
    formatarAlerta: formatarAlerta
  };
});
