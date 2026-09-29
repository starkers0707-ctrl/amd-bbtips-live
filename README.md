# AMD BBTips Live

AMD Live alimentado pelo BBTips (Bet365 / Betano / PlayPix), nas tres casas.

## Mudancas em relacao ao caramelo-live

- `LIGAS` deixou de ser fixa: vem do env `LIGAS` e cresce sozinha quando o coletor manda uma liga nova em `/api/dados` (formato `casa-liga`).
- Fonte WebSocket do outro projeto desligada por padrao. Religue com `FONTE_WS=1`.
- `/api/dados` liberado do portao de codigo (o coletor manda de fora).
- `/api/liga/:liga` aceita qualquer liga que ja tenha dados em memoria.
- `GH_REPO` virou variavel de ambiente.
- Frontend: seletor de liga montado a partir do `/api/status`; grade `col x horas` removida do mosaico.

## Variaveis de ambiente no Render

| var | valor |
|---|---|
| `ADMIN_KEY` | sua chave do painel /admin |
| `LIGAS` | opcional, ex: `bet365-copa,bet365-euro` |
| `BBTIPS_TOKEN` | token atual do BBTips usado pela coleta automatica |
| `CASAS_ATIVAS` | casas separadas por virgula; padrao `betano,playpix` |
| `FONTE_WS` | deixe vazio |
| `GH_TOKEN` / `GH_REPO` | opcionais, so para persistir os codigos de acesso |

## Deploy

Build `npm install` · Start `npm start` · Node 18+

## Coletor

Userscript `amd-coletor-bbtips.user.js` com `FORMATO: 'apidados'` e `COLETOR_URL` apontando para `/api/dados` deste app.

O endpoint tambem aceita `casa: "playpix"` junto de `nomeLiga`, `ligaNome` ou `leagueName`; o servidor normaliza o identificador para `playpix-nome-da-liga`. O estado da coleta automatica pode ser conferido em `/api/bbtips/estado`, incluindo contagem por casa e quantas ligas chegaram com nome.

## Odds

O BBTips nao entrega odds. Os jogos passados nao precisam delas (o motor calcula tudo com a, b e total); os jogos futuros ficam sem EV/edge ate ligar uma fonte de odds.
