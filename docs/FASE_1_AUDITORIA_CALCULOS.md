# Fase 1 — Auditoria de cálculos, vínculos e legado

Data da auditoria: 20/07/2026  
Branch de trabalho: `fase-1-auditoria-calculos`  
Base auditada: commit `55270eb00d6dfdd8eff33d5259afe09a64a89819`

## Estado encontrado em produção antes das correções

Leitura somente consulta realizada nas APIs públicas do painel:

- OL total faturado: R$ 3.576.778,57.
- OL sem combate exibido: R$ 3.211.928,52.
- OL prioritários: R$ 1.559.829,13.
- OL lançamentos: R$ 533.950,32.
- Carteira oficial: 528 clientes; 391 com venda e 137 sem venda.
- Pedidos faturados contabilizados: 3.807; itens: 37.776.
- Primeira data: 06/01/2026.
- Última data retornada: 07/12/2026, posterior à data da auditoria.
- Produtos da lista oficial: 418 EANs; produtos Mercado Farma no D1: 434.
- Mercado Farma consolidado: 5 UFs, 425 produtos com resultado e última atualização em 10/07/2026.

A diferença entre o OL geral e o OL atribuído aos cinco consultores confirmou faturamento sem vínculo completo com a carteira oficial. Essa diferença passa a ser exposta pela auditoria de CNPJ/consultor em vez de ser silenciosamente descartada.

## Causas confirmadas

1. Datas ISO do Bússola eram processadas com `dayfirst=True`. Assim, `2026-07-12` se transformava em `2026-12-07`.
2. A classificação verificava a palavra `COMBATE` antes da expressão `SEM COMBATE`; por isso, produtos sem combate podiam virar combate.
3. A consulta web usava correspondência parcial de status (`LIKE '%FATURAD%'`), com risco de incluir `NÃO FATURADO`.
4. OL sem combate era calculado como “tudo que não é combate”, incluindo produto sem classificação.
5. Clientes com venda no legado eram contados apenas pelo OL sem combate, não pelo faturamento válido total.
6. Cada sincronização do Bússola apagava pedidos e itens anteriores.
7. A reimportação de metas apagava o mês antes de inserir a nova versão.
8. O leitor de planilhas `xlsx@0.18.5` possuía duas vulnerabilidades altas sem correção no registro npm.
9. SIPs, redes, vínculos e recados existiam apenas no arquivo criptografado da branch `app-storage`, sem tabelas no D1.

## Regras comerciais unificadas

| Indicador | Regra oficial implementada |
|---|---|
| OL total faturado | Soma de `itens_pedido.valor_faturado` para pedido e item ativos, com status exato `FATURADO`, `FATURADO PARCIAL` ou `FATURADO RECUPERADO`. |
| OL sem combate | Apenas `LINHA`, `PRIORITARIO` e `LANCAMENTO`. Produto sem classificação não entra. |
| OL combate | Apenas classificação exata `COMBATE`. |
| OL prioritários | Subconjunto do sem combate com classificação `PRIORITARIO`. |
| OL lançamentos | Subconjunto do sem combate com classificação `LANCAMENTO`. |
| Clientes com venda | Cliente ativo da carteira oficial com qualquer item faturado ativo e valor positivo no período. |
| Período | `data_faturamento`; `data_pedido` somente como contingência quando a data de faturamento estiver ausente. |
| Consultor e UF | Vínculo por CNPJ com o Painel Equipe Norte; não são inferidos do texto do pedido. |
| Produto | Vínculo por EAN normalizado; ausência de classificação aparece como divergência. |

A conciliação obrigatória passou a ser:

`OL total = OL sem combate + OL combate + OL sem classificação`

Prioritários e lançamentos são detalhamentos internos do OL sem combate e, por isso, não são somados novamente ao total.

## Correções e controles adicionados

- Parser de datas ISO corrigido e coberto por teste de regressão.
- Classificação de mix centralizada entre Python, API e importação administrativa.
- Status de faturamento exatos e versões inativas excluídas dos cálculos.
- Cartão compacto de OL total, com OL combate, período, consultor, UF e horário da atualização.
- Tela administrativa “Auditoria dos cálculos”, protegida pela chave administrativa.
- Auditoria persistida no D1 com conciliação, CNPJ, EAN, datas, duplicidades, valores negativos e histórico.
- Reimportação do Bússola por inativação/versionamento, sem exclusão do histórico.
- Metas atuais atualizadas em lote e versões anteriores salvas em `metas_historico`.
- Estrutura D1 de SIP, redes, CNPJs e recados; ausências são inativadas, não apagadas.
- Migração SIP lê o arquivo real criptografado usando `PERSISTENCE_KEY`; não há dados fictícios.
- `xlsx` removido e substituído por `read-excel-file@9.3.2`; `.xls` antigo é recusado com orientação para conversão.
- `package-lock.json` criado para instalações reproduzíveis.
- Backup manual completo do D1 com SHA-256 antes de aplicar migrações.
- Validação automatizada de Python, APIs web, dependências e build em branch/PR.

## Testes locais concluídos

- 11 testes Python: regras comerciais, datas, migrações D1, histórico Bússola e migração SIP.
- 7 testes web: classificação, status, dashboard, consultores, auditoria e versionamento de metas.
- Compilação TypeScript/Vite de produção concluída.
- Auditoria npm: zero vulnerabilidades conhecidas.
- Verificação de sintaxe Python e JavaScript concluída.
- Workflows YAML validados.

## Backups locais verificados

- Repositório completo: `backups/sistema-atual_55270eb_2026-07-20_16-49-54.bundle`  
  SHA-256: `02B14715EBA195F0A9A032A9ECCC8A9D7DB2237CA41EB2F8EA8090D473721CBD`
- Legado criptografado: `legado/app-storage_82c5252_2026-07-20_17-04-45.zip`  
  SHA-256: `2B36195E8CB6434111369EF8B7E56A1D2361C1065B4C70A2DD3456567C1FDE15`
- Lista oficial de 418 EANs: `bases/produtos_mercado_farma_418_eans_2026-07-20_17-04-45.xlsx`  
  SHA-256: `112090E077338F55CA621C69C5E4CE358D2803AE193E5812F4202E0CD627C03D`

## Evidência de origem e segurança

- Migrações D1: <https://developers.cloudflare.com/d1/reference/migrations/>
- Backup e restauração D1: <https://developers.cloudflare.com/d1/reference/backup-restore/>
- Advisory do leitor removido: <https://github.com/advisories/GHSA-4r6h-8v6p-xvw6>
- Leitor substituto: <https://www.npmjs.com/package/read-excel-file>

## Pendências para encerrar a Fase 1

Estas etapas dependem da branch publicada e não devem ser declaradas concluídas antes da evidência remota:

1. Executar e baixar o backup D1 de produção.
2. Confirmar SHA-256 do arquivo exportado.
3. Executar a validação Linux da branch.
4. Revisar e integrar a PR.
5. Confirmar migrações D1, migração dos SIPs reais e deploy.
6. Executar a nova auditoria no D1 de produção.
7. Comparar dashboard, consultores e filtros com a auditoria persistida.
