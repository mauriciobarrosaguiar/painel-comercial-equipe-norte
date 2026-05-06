# Painel Gerencial de Vendas - Equipe Norte

Sistema Streamlit para gestao comercial da Equipe Norte, com leitura das bases em Excel, extracao do Bussola Web, metas, indicadores de OL, mix prioritario, lancamentos, SIP, acoes promocionais e oportunidades comerciais.

## Como rodar localmente

1. Instale as dependencias:

```bash
pip install -r requirements.txt
```

2. Rode o aplicativo:

```bash
streamlit run app.py
```

3. Acesse o endereco mostrado no terminal, normalmente `http://localhost:8501`.

## Arquivos na pasta data

Coloque estes arquivos dentro da pasta `data/`:

- `bussola.xlsx`
- `PAINEL EQUIPE NORTE.xlsx`
- `template_acoes_promocionais.xlsx`
- `template_produtos_mix.xlsx`
- `sip_grupos.json` (criado automaticamente para cadastro manual de SIP)
- `metas_comerciais.json`

O painel tambem permite carregar arquivos temporarios pela tela **Importacao**.
Por seguranca, as bases reais em Excel, metas, SIPs cadastradas e logins locais ficam fora do GitHub pelo `.gitignore`.

O cadastro de SIP fica somente no painel, salvo em `data/sip_grupos.json`. A planilha oficial de clientes nao precisa receber coluna "Grupo SIP".

## Como atualizar as bases

Use a tela **Importacao** para:

- informar login e senha do Bussola Web;
- executar a automacao de extracao da base do Bussola;
- cadastrar metas do gerente territorial;
- cadastrar metas dos consultores;
- fazer upload manual de arquivos quando necessario.

O login salvo fica em `data/bussola_login.local.json`, que esta no `.gitignore` e nao deve ir para o GitHub.

O CNPJ e o EAN sao tratados como texto, com remocao de pontuacao para cruzamento. Produtos sem classificacao aparecem como `SEM CLASSIFICACAO`.

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
3. Escolha o repositorio.
4. Configure o arquivo principal como `app.py`.
5. Publique o app.

## Bases complementares

Se `template_produtos_mix.xlsx` estiver vazio, o painel abre normalmente, mas alerta que os produtos precisam ser classificados. O campo `tipo_mix` aceita:

- `PRIORITARIO`
- `LANCAMENTO`
- `LINHA`
- `COMBATE`

O painel tambem cria espaco para os dados pessoais dos clientes:

- `PROPRIETARIO/DIRETOR`
- `COMPRADOR/GERENTE DE COMPRAS`
- `CARGO`
- `CELULAR`
- `EMAIL`
