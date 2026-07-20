# Plano de migração — Painel Comercial Equipe Norte

## Objetivo

Substituir gradualmente o Streamlit por uma aplicação web corporativa, responsiva e de uso interno, sem interromper o painel atual e preservando as automações do Bússola e do Mercado Farma.

## Arquitetura escolhida

- Front-end: React + Vite + TypeScript
- Interface: Tailwind CSS + componentes corporativos
- Hospedagem: Cloudflare Pages
- API: Cloudflare Workers
- Banco SQL: Cloudflare D1
- Proteção de acesso: Cloudflare Access
- Arquivos e backups: Cloudflare R2 em etapa posterior
- Automações: GitHub Actions + Playwright/Selenium
- Repositório de desenvolvimento: branch `migracao-saas`

## Regras da migração

1. A branch `main` e o Streamlit permanecem funcionando.
2. A nova aplicação será construída isoladamente dentro da pasta `web/`.
3. Os cálculos atuais serão migrados e validados um módulo por vez.
4. Nenhum indicador novo substituirá o atual sem conferência dos resultados.
5. As credenciais do Bússola e Mercado Farma ficarão somente em Secrets.
6. As automações gravarão dados no banco e registrarão status, logs e quantidade de linhas processadas.

## Primeira versão funcional

### Tela inicial

Cards para:

- Visão Geral
- Consultores
- Clientes
- Foco Semanal
- Oportunidades
- Mercado Farma
- SIP / Redes
- Histórico
- Automações
- Administração

### Primeiro módulo a migrar

Visão Geral, contendo:

- filtro de período;
- filtro por consultor e UF;
- OL sem combate;
- OL prioritários;
- OL lançamentos;
- clientes com venda;
- meta e percentual de atingimento;
- falta para 80%, 90% e 100%;
- projeção do mês;
- situação das bases e última atualização.

## Estrutura inicial do banco

- `usuarios`
- `consultores`
- `clientes`
- `produtos`
- `produto_mix`
- `pedidos`
- `itens_pedido`
- `metas`
- `mercado_farma_precos`
- `foco_semanal`
- `acoes_promocionais`
- `sip_grupos`
- `extracoes`
- `extracao_logs`
- `importacoes`

## Etapas

### Etapa 1 — Fundação

- [x] Criar branch separada de migração
- [x] Registrar o plano técnico
- [ ] Criar projeto React em `web/`
- [ ] Criar layout corporativo e página inicial com cards
- [ ] Configurar Cloudflare Pages
- [ ] Criar banco D1
- [ ] Criar migrations SQL
- [ ] Configurar Cloudflare Access

### Etapa 2 — Dados

- [ ] Criar importador das planilhas atuais
- [ ] Migrar clientes
- [ ] Migrar produtos e classificação de mix
- [ ] Migrar metas
- [ ] Migrar pedidos do Bússola
- [ ] Validar CNPJ e EAN como texto
- [ ] Criar prevenção de pedidos duplicados

### Etapa 3 — Painel

- [ ] Migrar Visão Geral
- [ ] Conferir resultados com o Streamlit
- [ ] Migrar Consultores
- [ ] Migrar Clientes
- [ ] Migrar Foco Semanal e Oportunidades
- [ ] Migrar Mercado Farma
- [ ] Migrar Histórico, SIP e Administração

### Etapa 4 — Automações

- [ ] Adaptar Mercado Farma para salvar no D1
- [ ] Transferir extração do Bússola para GitHub Actions
- [ ] Criar tela Central de Automações
- [ ] Registrar início, fim, status, erros e quantidade processada
- [ ] Criar execução manual e programada

### Etapa 5 — Validação e troca

- [ ] Rodar Streamlit e nova aplicação em paralelo
- [ ] Conferir indicadores por período e consultor
- [ ] Conferir Mercado Farma por UF
- [ ] Conferir histórico e metas
- [ ] Liberar acesso para a equipe
- [ ] Desativar o Streamlit somente após validação

## Próxima ação técnica

Criar o projeto React/TypeScript na pasta `web/`, com a página inicial em cards e estrutura preparada para autenticação e API.