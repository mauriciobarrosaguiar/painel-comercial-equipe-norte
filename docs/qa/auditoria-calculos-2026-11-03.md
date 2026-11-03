# Auditoria dos cálculos — 03/11/2026

Escopo: implementação publicada do Painel Comercial pessoal de Maurício. Revisão do código e testes de conciliação com SQLite controlado; os testes não são uma leitura da base de produção do Turso.

## Achados corrigidos

| Área | Problema | Correção |
| --- | --- | --- |
| Meta diária | Ausente na Visão Geral. Em Meu desempenho, um script lia valores formatados da tela e contava dias sem feriados no fuso do aparelho. | Cálculo numérico na API, calendário comercial compartilhado com a projeção e data de Brasília; renderização React nos dois módulos. Mantidos gaps de 80/90/100%. |
| SIP | Projeção contava segunda a sexta, sem os feriados usados pelo dashboard. | Mesmo calendário comercial já adotado no painel. |
| SKUs e recompra | Quantidades negativas eram excluídas; estornos não reduziam unidades/cobertura. | Unidades líquidas assinadas; SKU e cliente positivados apenas com saldo positivo no recorte; estorno isolado não conta como recompra. Listas de faltantes incluem saldo zero ou negativo. |
| Sugestões | A existência de linhas podia gerar reposição de uma unidade mesmo quando a compra estava integralmente estornada. | Reposição e cobertura exigem quantidade líquida positiva. |
| Clientes positivados | Dashboard e desempenho podiam contar uma compra positiva inteiramente estornada; a tela Clientes já verificava o saldo. | Conciliação por faturamento líquido positivo de cada cliente no período. Dashboard também usa clientes ativos, como desempenho e carteira. |
| Mercado Farma | MIN de preços com estoque podia escolher zero ou uma oferta marcada com erro. | Menor preço considera oferta OK, preço positivo e estoque; usa preço sem imposto quando disponível, com fallback para preço com imposto. |

## Regra da meta diária

Saldo = máximo(meta mensal − realizado faturado, zero). Meta diária = saldo ÷ dias úteis restantes no mês, incluindo hoje se for útil. O valor é arredondado para cima em centavos para não deixar saldo por arredondamento. Fins de semana e os feriados do calendário comercial existente são excluídos. O calendário comercial existente foi preservado; não foram acrescentados feriados estaduais, municipais ou decisões sobre expediente da empresa.

A meta diária só se aplica ao mês atual completo. Períodos históricos e intervalos parciais não recebem uma meta mensal repartida artificialmente. Meta ausente, meta atingida e fim de mês sem dias úteis recebem tratamento específico, sem divisão por zero.

Exemplo da imagem enviada: em 03/11/2026, meta R$183.884,18, realizado R$83,43 e 19 dias úteis restantes → R$9.673,73/dia. A projeção R$1.585,17 já estava correta: R$83,43 × 19 ÷ 1. O percentual baixo pode aparecer como 0,0% por arredondamento da apresentação.

## Conciliações e preservações

- Mesma base faturada conciliada entre dashboard, desempenho, clientes, SIP e relatório de consultores.
- Pedidos pendentes permanecem separados do faturamento e usam os valores de solicitado/atendido previstos na regra comercial.
- MIX sem combate inclui Linha, Prioritários e Lançamentos; os dois últimos são subconjuntos e não devem ser somados novamente ao sem combate. Combate e não classificados são reconciliados separadamente.
- Mês atual continua vindo do Bússola; histórico agregado não inventa produtos/EANs e não substitui o mês em aberto.
- Fotografias mensais e suas metas/versionamento não foram regravadas por esta alteração.
- Desafio de Gigantes preserva os gatilhos: Positivação ≥80%, Giro ≥100%, teto de 120 por indicador e 240 por SKU. Sua apuração oficial continua fora do painel, conforme aviso existente.
- Separador, estoque, pedido mínimo, UF, preços/impostos, exportações XLSX/PDF/PPT e SIPs continuam cobertos pela suíte existente.

## Limites da conclusão

As conciliações validam as fórmulas e os cenários controlados. Não comprovam que a última extração em produção esteja completa, que os cadastros SAP/EAN estejam todos vinculados ou que não existam duplicidades/divergências reais no Turso. A ferramenta existente em Administração → Auditoria dos cálculos continua disponível para verificar e registrar essas condições na base real.

Giro significa compra/recompra da farmácia, não saída ao consumidor nem estoque disponível. Uma devolução só pode ser descontada se estiver registrada como quantidade/valor negativo na base faturada utilizada.
