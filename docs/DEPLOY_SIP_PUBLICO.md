# Publicação segura do Painel SIP

O painel interno e o acesso dos clientes devem ser publicados como dois aplicativos Streamlit separados, usando o mesmo repositório.

## 1. Painel interno

- Arquivo principal: `app.py`
- Visibilidade: privada
- Uso: equipe comercial, cadastros, importações e administração

## 2. Painel público das SIPs

Crie um segundo aplicativo no Streamlit Community Cloud:

- Repositório: `mauriciobarrosaguiar/painel-comercial-equipe-norte`
- Branch: `main`
- Main file path: `public_app.py`
- URL sugerida: `https://painelequipeale-sip.streamlit.app/`
- Visibilidade: pública

Esse aplicativo não possui menu administrativo. Ele abre somente uma SIP quando recebe um token válido na URL.

## 3. Secrets do aplicativo público

Copie somente as configurações necessárias para leitura da persistência:

```toml
PERSISTENCE_KEY = "MESMA_CHAVE_DO_PAINEL_INTERNO"
GITHUB_REPO = "mauriciobarrosaguiar/painel-comercial-equipe-norte"
GITHUB_STORAGE_BRANCH = "app-storage"
GITHUB_STORE_DIR = ".app_storage"
```

Não coloque o `GITHUB_TOKEN` no aplicativo público quando a branch puder ser lida sem autenticação. Assim, o aplicativo público fica sem permissão de escrita no repositório.

## 4. Secret do painel interno

No aplicativo interno, configure o endereço definitivo do aplicativo público:

```toml
PUBLIC_SIP_URL = "https://painelequipeale-sip.streamlit.app/"
```

## 5. Geração dos links

No painel interno, acesse:

`Campanhas e SIP > Acessos SIP`

Nessa tela é possível:

- ativar ou desativar o acesso externo;
- definir data de expiração;
- copiar o link completo;
- revogar o endereço anterior e gerar um novo token.

Os links antigos, baseados no nome da SIP, são substituídos automaticamente por identificadores aleatórios.
