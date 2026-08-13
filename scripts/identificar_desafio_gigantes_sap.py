from __future__ import annotations

import os
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from selenium.webdriver import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from src.configuracoes import carregar_login_bussola
from src.mercado_farma import carregar_credenciais_mercadofarma, criar_driver
from src.mercadofarma_inventory import extrair_nome_produto, limpar_busca_catalogo, login_mercadofarma, selecionar_cnpj_catalogo

API_BASE = "https://api.cloudflare.com/client/v4"
DB_NAME = os.environ.get("CLOUDFLARE_D1_DATABASE", "painel-equipe-norte-db")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
HEADERS = {"authorization": f"Bearer {API_TOKEN}", "content-type": "application/json"}
FUSO = ZoneInfo("America/Sao_Paulo")


def agora() -> str:
    return datetime.now(FUSO).isoformat()


def request(method: str, url: str, payload: dict | None = None) -> dict:
    ultimo = ""
    for tentativa in range(1, 6):
        resposta = requests.request(method, url, headers=HEADERS, json=payload, timeout=90)
        if resposta.status_code == 429 or resposta.status_code >= 500:
            ultimo = f"HTTP {resposta.status_code}: {resposta.text[:300]}"
            time.sleep(min(2 ** tentativa, 20))
            continue
        dados = resposta.json()
        if not resposta.ok or not dados.get("success", False):
            raise RuntimeError(f"Cloudflare D1 recusou a consulta: {dados.get('errors') or dados}")
        return dados
    raise RuntimeError(f"Falha temporária repetida na Cloudflare: {ultimo}")


def database_id() -> str:
    if not ACCOUNT_ID or not API_TOKEN:
        raise RuntimeError("Credenciais do Cloudflare D1 não configuradas.")
    dados = request("GET", f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database?per_page=100")
    banco = next((item for item in dados.get("result", []) if item.get("name") == DB_NAME), None)
    valor = str((banco or {}).get("uuid", "")).strip()
    if not valor:
        raise RuntimeError(f"Banco D1 não encontrado: {DB_NAME}")
    return valor


def query(db: str, sql: str, params: list | None = None) -> list[dict]:
    dados = request("POST", f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{db}/query", {"sql": sql, "params": params or []})
    resultados = dados.get("result") or []
    if not resultados or not resultados[0].get("success", False):
        raise RuntimeError(f"Consulta D1 não concluída: {resultados}")
    return resultados[0].get("results") or []


def execute(db: str, sql: str, params: list | None = None) -> None:
    query(db, sql, params)


def ean_do_card(card, sap: str) -> str:
    candidatos: set[str] = set()
    textos = [card.text or ""]
    for seletor in ["span", "small", "p"]:
        try:
            textos.extend(element.text or "" for element in card.find_elements(By.CSS_SELECTOR, seletor))
        except Exception:
            pass
    for texto in textos:
        for numero in re.findall(r"(?<!\d)\d{8,14}(?!\d)", texto):
            if numero != sap:
                candidatos.add(numero)
    ean13 = sorted(item for item in candidatos if len(item) == 13)
    if len(ean13) == 1:
        return ean13[0]
    ean14 = sorted(item for item in candidatos if len(item) == 14)
    if len(ean14) == 1:
        return ean14[0]
    return next(iter(candidatos)) if len(candidatos) == 1 else ""


def preencher_busca_catalogo(driver, campo, valor: str) -> None:
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'}); arguments[0].focus();", campo)
        campo.send_keys(valor)
        campo.send_keys(Keys.ENTER)
        return
    except Exception as erro_teclado:
        print(f"Busca SAP por teclado indisponível; usando preenchimento compatível com o campo React: {type(erro_teclado).__name__}")

    driver.execute_script(
        """
        const el = arguments[0];
        const value = arguments[1];
        el.scrollIntoView({block:'center'});
        el.focus();
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        """,
        campo,
        valor,
    )
    time.sleep(0.3)
    try:
        ActionChains(driver).send_keys(Keys.ENTER).perform()
    except Exception:
        driver.execute_script(
            """
            const el=arguments[0];
            for (const tipo of ['keydown','keypress','keyup']) {
              el.dispatchEvent(new KeyboardEvent(tipo,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
            }
            """,
            campo,
        )


def pesquisar_sap(driver, sap: str) -> tuple[str, str, str, str]:
    campo = limpar_busca_catalogo(driver)
    preencher_busca_catalogo(driver, campo, sap)
    time.sleep(1.8)
    cards = [card for card in driver.find_elements(By.CSS_SELECTOR, "div[data-testid^='produtoCard-']") if card.is_displayed()]
    if not cards:
        return "NAO_ENCONTRADO", "", "", "Nenhum produto encontrado para o SAP."

    candidatos: list[tuple[str, str]] = []
    for card in cards:
        ean = ean_do_card(card, sap)
        nome = extrair_nome_produto(card)
        if ean:
            candidatos.append((ean, nome))
    unicos = {(ean, nome) for ean, nome in candidatos}
    if len(unicos) == 1:
        ean, nome = next(iter(unicos))
        return "IDENTIFICADO", ean, nome, "Identificado no Catálogo A a Z pelo código SAP."
    if not unicos:
        return "AMBIGUO", "", "", f"{len(cards)} card(s) retornaram sem EAN inequívoco."
    resumo = "; ".join(f"{ean} - {nome}" for ean, nome in sorted(unicos)[:5])
    return "AMBIGUO", "", "", f"Mais de um produto retornado: {resumo}"


def atualizar(db: str, sap: str, status: str, ean: str, produto: str, mensagem: str) -> None:
    timestamp = agora()
    execute(db, "UPDATE desafio_gigantes_produtos SET ean=?,produto=?,status=?,tentativas=tentativas+1,ultima_consulta_em=?,mensagem=?,atualizado_em=? WHERE sku=?", [ean, produto, status, timestamp, mensagem[:1000], timestamp, sap])
    execute(db, "UPDATE desafio_gigantes_metas SET ean=?,produto_identificado=?,status_identificacao=?,atualizado_em=? WHERE sku=?", [ean, produto, status, timestamp, sap])


def resolver_cache_local(db: str) -> int:
    linhas = query(db, "SELECT d.sku,p.ean,p.descricao FROM desafio_gigantes_produtos d JOIN produtos p ON TRIM(COALESCE(p.sku,''))=TRIM(d.sku) WHERE d.status<>'IDENTIFICADO' AND TRIM(COALESCE(p.ean,''))<>''")
    total = 0
    for linha in linhas:
        sap = str(linha.get("sku", "")).strip()
        ean = re.sub(r"\D", "", str(linha.get("ean", "")))
        if not sap or not ean:
            continue
        atualizar(db, sap, "IDENTIFICADO", ean, str(linha.get("descricao", "")).strip(), "Identificado pelo cadastro local SAP/EAN já existente no painel.")
        total += 1
    return total


def carregar_acesso_mercado_farma() -> tuple[str, str, str]:
    login = carregar_login_bussola()
    credencial = carregar_credenciais_mercadofarma(login, exigir=True)
    usuario = str(credencial.get("usuario", "") or "").strip()
    senha = str(credencial.get("senha", "") or "").strip()
    fonte = str(credencial.get("fonte", "") or "").strip() or "configuração persistida"
    if not usuario or not senha:
        raise RuntimeError("O acesso GD do Mercado Farma não foi localizado na configuração persistida.")
    return usuario, senha, fonte


def main() -> int:
    usuario, senha, fonte = carregar_acesso_mercado_farma()
    print(f"Acesso Mercado Farma carregado de: {fonte}.")
    db = database_id()
    cache = resolver_cache_local(db)
    pendentes = query(db, "SELECT sku FROM desafio_gigantes_produtos WHERE status<>'IDENTIFICADO' AND (status='ERRO' OR ultima_consulta_em IS NULL OR substr(ultima_consulta_em,1,10)<>date('now','-3 hours')) ORDER BY CASE status WHEN 'PENDENTE' THEN 0 WHEN 'ERRO' THEN 1 ELSE 2 END,sku LIMIT 500")
    if not pendentes:
        print(f"Nenhum SAP pendente para hoje. {cache} identificado(s) pelo cache local.")
        return 0
    cnpjs = query(db, "SELECT cnpj FROM clientes WHERE carteira_importada=1 AND ativo=1 AND length(trim(cnpj))=14 ORDER BY CASE WHEN uf='TO' THEN 0 ELSE 1 END,cnpj LIMIT 1")
    if not cnpjs:
        raise RuntimeError("Nenhum CNPJ ativo do território disponível para abrir o Catálogo A a Z.")
    cnpj = str(cnpjs[0].get("cnpj", "")).strip()

    driver = criar_driver(headless=True)
    identificados = ambiguos = nao_encontrados = erros = 0
    try:
        login_mercadofarma(driver, usuario, senha, print)
        selecionar_cnpj_catalogo(driver, cnpj, print)
        for indice, item in enumerate(pendentes, 1):
            sap = str(item.get("sku", "")).strip()
            if not sap:
                continue
            try:
                status, ean, produto, mensagem = pesquisar_sap(driver, sap)
                atualizar(db, sap, status, ean, produto, mensagem)
                if status == "IDENTIFICADO": identificados += 1
                elif status == "AMBIGUO": ambiguos += 1
                elif status == "NAO_ENCONTRADO": nao_encontrados += 1
                print(f"[{indice}/{len(pendentes)}] SAP {sap}: {status} {ean} {produto}".strip())
            except Exception as exc:
                erros += 1
                atualizar(db, sap, "ERRO", "", "", f"{type(exc).__name__}: {str(exc)[:800]}")
                print(f"[{indice}/{len(pendentes)}] SAP {sap}: ERRO - {exc}")
    finally:
        driver.quit()
    print(f"Resumo: cache={cache}, identificados={identificados}, ambiguos={ambiguos}, nao_encontrados={nao_encontrados}, erros={erros}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
