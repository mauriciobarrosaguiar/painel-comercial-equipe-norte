# Issue #94 — consolidação e homologação do painel pessoal

## Escopo e base

Branch incremental sobre `ab4dc819957818183f7c062791f121b831737e80` (PR #93), que contém a PR #92. Ordem futura de integração: #92 → #93 → esta PR. Não foi feito merge, retarget das PRs existentes, extração externa, importação real, migração ou deploy. `main`, banco, MIX, Bússola, metas e carteira de produção não receberam escrita desta tarefa.

## Causa raiz comprovada

Lidos uma vez os jobs e o log do job 119816568282 da execução 39763456265. As extrações TO/MT/PA, a consolidação (6.358 linhas) e a sincronização (6.066 analisados; zero alterações) passaram. A falha aconteceu no `git pull --rebase origin main` do commit c9c9d02, concorrendo com alterações de CSV, XLSX, status e debug. Não se trata de falha de senha ou de extração nessa tentativa.

## Correção

- Workflow não executa commit, rebase ou push de dados. Permissão de conteúdo reduzida a leitura. Artifacts CSV/XLSX são imutáveis por run/tentativa, com retenção de 90 dias. O Excel autenticado do painel já consulta o banco por UF; não depende da cópia estática do repositório.
- Artifacts atuais são baixados em diretório temporário separado do checkout; CSV/status antigos não podem indicar atualização nova. Saídas da UF são limpas antes do processo. Debug HTML não é publicado no artifact de preço.
- Status obrigatório para aceitar o CSV atual, inclusive caminhos `parciais/parciais`. UF interna deve ser consistente. UFs com falha conservam a base anterior e não voltam a ser sincronizadas sobre dados mais recentes do Turso.
- CSV/XLSX são substituídos por arquivo temporário. Deduplicação por UF/EAN/distribuidora/CNPJ mantém idempotência; EAN com zero inicial permanece texto. Testes conferem preço 9,99 e estoque 12 sem erro de escala.
- Extração por UF, consolidação, sincronização Turso e publicação possuem resultados separados. Turso OK + arquivo falhou continua sendo conclusão incompleta, mostrando explicitamente dados sincronizados e falha de publicação.
- Janela 07h–20h de Brasília da #92 foi preservada na UI, API/fila, workflow e Selenium/timeout. Nenhuma extração foi disparada na homologação.

## Homologação das PRs existentes

#92: revisão do workflow, bloqueios de horário e diagnóstico; regressões de borda 06:59/07:00/19:59/20:00 e interrupção antes das 20h passaram localmente. O texto da descrição da PR contém diagnóstico antigo de login; o log da última tentativa comprova conflito Git e prevalece neste relatório.

#93: preservados ficha em tela inteira, histórico, cobertura por EAN, sugestões e validação de transferência por CNPJ/UF/distribuidora/estoque. Testes de API com banco de fixture verificam sessão, isolamento da carteira e oferta de outra UF rejeitada. Avisos de histórico agregado e data da oferta passaram a ficar visíveis. Nenhum pedido comercial foi emitido.

## Navegação e cards

- Corrigido destino de `Central de automações`: agora rota `automacoes`.
- Ocultado somente atalho redundante `Visão Geral`; dashboard preservado.
- `Consultores` passa a `Meu desempenho`; mantidos rota, metas, relatórios e histórico, sem alterar cálculos.
- Removido botão duplicado `Baixar app mobile`; instalação única na topbar também fica disponível no celular.
- Atalhos organizados em Vendas e metas, Clientes e oportunidades, Mercado Farma e pedidos, Operação e ajustes (recolhível). Separador, Cruzamento e Links úteis permanecem acessíveis. Portal dos atalhos aponta para o grupo Mercado Farma.
- Oportunidades continua como módulo próprio no grupo de Clientes, pois oferece plano de ação distinto; nenhuma funcionalidade eliminada.
- Mantidos KPIs com período, atualização, UF e projeção; clientes sem compra recebem atalho de ação.
- Automações mostram a última ocorrência por rotina e registros ativos; filtro por tipo e opção para expandir todo o histórico recebido da API. Nenhum registro apagado. A API continua retornando até 40 registros, limite já existente.

## Auditoria publicada, com sessão autenticada do proprietário

Navegação real de leitura em desktop e em viewport móvel solicitado 390 × 844 (a extensão retornou largura efetiva 433 em algumas medições). Sem disparar extração, fechamento, importação, edição, exclusão ou pedido.

| Módulo | Evidência observada / limite |
|---|---|
| Dashboard | Indicadores carregaram; cards redundantes e destino incorreto confirmados. Algumas capturas móveis registram carregamento, não erro de banco. |
| Clientes e ficha | Carteira, botão Ver ficha e histórico abriram. Produção ainda mostra ficha lateral antiga, pois #93 não foi publicada. |
| Mercado Farma e carrinho | Vitrine carregou; carrinho vazio abriu e geração estava desabilitada sem cliente. Base histórica também contém MA/PI; não foi apagada. |
| Oportunidades | Plano de ação carregou. Há caso com última compra atual na ficha e dias sem compra divergentes no plano; precisa reconciliação específica antes de tomar decisão comercial. Não alterado por falta de prova da consulta/filtro responsável. |
| Histórico | 25 meses e 1.344 registros importados informados na tela. Histórico agregado não comprova EAN. |
| Automações/Bússola | Agendamentos e histórico visíveis; nenhum botão de executar foi acionado. |
| Consultores | Somente Maurício no desempenho atual; métricas e relatório presentes. |
| Foco Semanal | Formulário e 5 focos anteriores carregaram. Fotografias antigas incluem outros consultores; preservadas. |
| SIP/Redes | SIP e objetivos/resultados carregaram; sem edição. |
| Desafio | Campanha carregou; 81/82 EANs identificados, pendência SAP existente mantida; não foi executada consulta externa. |
| Separador | Importação/colagem e etapas abertas; sem arquivo nem pedido real. |
| Cruzamento | Formulário de lista e UF abertos; sem cotação comercial. |
| Administração | Situação dos acessos e bases exibida; nenhum segredo copiado e nenhuma configuração salva. |
| Anotações | 3 lembretes exibidos, sem edição. Capturas com contato pessoal omitidas do repositório. |
| Links úteis | Estado vazio, formulário e retorno ao painel conferidos. |

Os testes de navegação não equivalem a homologação de todas as operações de escrita/importação de todos os módulos. Capturas antes: `antes-*`, `auditBatch*` (desktop), `auditMobile*` (mobile). #93 não está em produção; não se atribuem capturas da produção às novas funcionalidades.

## Testes e limitações

- Python: **27 passaram + 4 subtestes**; inclui preservação por UF, caminhos aninhados, idempotência, EAN/Excel, ausência de status, falha de publicação com Turso OK e impossibilidade de conflito Git no workflow sem push.
- Node: suíte completa inicial **139/140**; única falha exigia a cópia estática retirada. Teste atualizado; arquivo afetado **7/7** e análise do cliente + correções **10/10** passaram. Rótulos pessoais verificados separadamente.
- TypeScript/Vite: build passou; aviso existente de bundle acima de 500 kB, sem falha.
- npm audit: **zero vulnerabilidades**, sem mudanças de dependências.
- E2E isolado: `scripts/qa_issue94_browser.py`, com APIs fictícias e sem chamada a serviço externo. Confere destino de automações, instalação, ficha inteira e proposta → carrinho com CNPJ/UF, 3 unidades e R$36 com imposto. Faz capturas desktop/mobile e falha se ocorrer escrita externa. Execução local bloqueada: Chromium não disponível; download recebido truncado neste ambiente. A prévia local também não é acessível pelo navegador remoto. Foi preparado passo no CI para execução e upload de capturas. Resultado do CI será registrado após execução; não declarado aprovado antecipadamente.

## Impacto, reversão e aprovação

Sem alteração de schema, migração ou escrita no Turso nesta tarefa. No uso futuro do workflow, somente UFs efetivamente atualizadas são sincronizadas. Snapshots antigos no repositório deixam de ser renovados por esse workflow; devem ser tratados como históricos. Excel atual do painel vem do banco. Artifacts possuem retenção limitada; o histórico comercial permanece no banco.

Reversão: reverter esta PR antes ou após eventual integração, sem restaurar bancos nem apagar dados. Não publicar produção sem CI verde, revisão das evidências e aprovação explícita do proprietário.
