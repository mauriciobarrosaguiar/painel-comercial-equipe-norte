# Painel Gerencial de Vendas - Equipe Norte

Sistema Streamlit para gestão comercial da Equipe Norte, com leitura das bases em Excel, extração do Bússola Web, metas, indicadores de OL, mix prioritário, lançamentos, SIP, ações promocionais e oportunidades comerciais.

## Como rodar localmente

1. Instale as dependências:

```bash
pip install -r requirements.txt
```

2. Rode o aplicativo:

```bash
streamlit run app.py
```

3. Acesse o endereço mostrado no terminal, normalmente `http://localhost:8501`.

## Arquivos na pasta data

Coloque estes arquivos dentro da pasta `data/`:

- `bussola.xlsx`
- `PAINEL EQUIPE NORTE.xlsx`
- `template_acoes_promocionais.xlsx`
- `template_produtos_mix.xlsx`
- `sip_grupos.json` (criado automaticamente para cadastro manual de SIP)
- `metas_comerciais.json`

O painel também permite carregar arquivos pela tela **Importação**.
Por segurança, as bases reais em Excel, metas, SIPs cadastradas e logins locais ficam fora do GitHub pelo `.gitignore`.

O cadastro de SIP fica somente no painel, salvo em `data/sip_grupos.json`. A planilha oficial de clientes não precisa receber coluna "Grupo SIP".

## Persistência no Streamlit Cloud

Para que uploads, metas, SIPs e acessos salvos não sejam perdidos quando o app reiniciar, configure estes Secrets no Streamlit Cloud:

```toml
GITHUB_TOKEN = "token_do_github_com_permissao_contents_write"
GITHUB_REPO = "mauriciobarrosaguiar/painel-comercial-equipe-norte"
GITHUB_BRANCH = "main"
PERSISTENCE_KEY = "chave_gerada_na_tela_importacao"
```

O token precisa ter permissão de leitura e escrita em Contents no repositório. A chave `PERSISTENCE_KEY` aparece pronta para copiar na tela **Importação** quando ainda não há persistência configurada. Os arquivos persistidos ficam criptografados no GitHub.

## Como atualizar as bases

Use a tela **Importação** para:

- informar login e senha da GD ou dos consultores no Bússola Web;
- executar a automação de extração da base do Bússola;
- cadastrar metas do gerente territorial;
- cadastrar metas dos consultores;
- fazer upload manual de arquivos quando necessário.

Quando o login da GD estiver preenchido e marcado, a extração roda somente com a GD, porque esse acesso baixa a base de todos os vendedores. Sem a GD, o painel roda todos os consultores que tiverem login, senha e a opção de extração marcada.

O CNPJ e o EAN são tratados como texto, com remoção de pontuação para cruzamento. Produtos sem classificação aparecem como `SEM CLASSIFICACAO`.

## Como subir no GitHub

```bash
git init
git add .
git commit -m "Cria painel gerencial de vendas equipe norte"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

## Como publicar no Streamlit Cloud

1. Suba o projeto para o GitHub.
2. Acesse [share.streamlit.io](https://share.streamlit.io).
3. Escolha o repositório.
4. Configure o arquivo principal como `app.py`.
5. Publique o app.

## Bases complementares

Se `template_produtos_mix.xlsx` estiver vazio, o painel abre normalmente, mas alerta que os produtos precisam ser classificados. O campo `tipo_mix` aceita:

- `PRIORITARIO`
- `LANCAMENTO`
- `LINHA`
- `COMBATE`

O painel também cria espaço para os dados pessoais dos clientes:

- `PROPRIETARIO/DIRETOR`
- `COMPRADOR/GERENTE DE COMPRAS`
- `CARGO`
- `CELULAR`
- `EMAIL`
