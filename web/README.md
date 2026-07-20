# Painel Comercial Equipe Norte — Cloudflare

Nova interface do Painel Comercial, construída com React, Vite, Cloudflare Workers e banco D1.

## Implantação automática

O projeto está preparado para o recurso oficial **Deploy to Cloudflare**. Durante a implantação, o Cloudflare cria o Worker, o banco D1 e executa as migrações iniciais.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

```bash
npm run deploy
```

## Verificação

Após publicar, acesse `/api/health` no endereço do Worker para conferir a conexão com o D1.
