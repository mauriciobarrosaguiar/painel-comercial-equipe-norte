from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

from src.datas import agora_brasilia
from src.loader import DATA_DIR, carregar_mercado_farma
from src.mercadofarma_inventory import login_mercadofarma, processar_ean_catalogo, selecionar_cnpj_catalogo
from src.persistencia import salvar_bytes
from src.tratamento import converter_numero, formatar_moeda, normalizar_cnpj, normalizar_ean, padronizar_colunas


COLUNAS_MERCADO = [
    "consultor",
    "uf",
    "cnpj_referencia",
    "ean",
    "produto",
    "distribuidora",
    "estoque",
    "desconto",
    "pf_dist",
    "pf_fabrica",
    "preco_com_imposto",
    "preco_sem_imposto",
    "data_atualizacao",
    "status",
    "erro",
]


def _texto(valor: object) -> str:
    return "" if valor is None or pd.isna(valor) else str(valor).strip()


def preparar_mercado_farma(df: pd.DataFrame | None) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=COLUNAS_MERCADO)
    base = df.copy()
    if all(str(col).startswith("Unnamed") for col in base.columns) and len(base) > 0:
        base.columns = base.iloc[0].tolist()
        base = base.iloc[1:].copy()
    base = padronizar_colunas(base)
    aliases = {
        "cnpj": "cnpj_referencia",
        "cnpj_ref": "cnpj_referencia",
        "cnpj_referencia": "cnpj_referencia",
        "ean": "ean",
        "nome_do_produto": "produto",
        "produto": "produto",
        "principio_ativo": "produto",
        "distribuidora": "distribuidora",
        "estoque": "estoque",
        "desconto": "desconto",
        "desconto_percent": "desconto",
        "desconto_percentual": "desconto",
        "pf_dist_r": "pf_dist",
        "pf_dist": "pf_dist",
        "pf_fabrica_r": "pf_fabrica",
        "pf_fabrica": "pf_fabrica",
        "preco_final_r": "preco_com_imposto",
        "preco_final": "preco_com_imposto",
        "preco_com_imposto": "preco_com_imposto",
        "sem_imposto_r": "preco_sem_imposto",
        "sem_imposto": "preco_sem_imposto",
        "preco_sem_imposto": "preco_sem_imposto",
        "data": "data_atualizacao",
        "data_atualizacao": "data_atualizacao",
        "status": "status",
        "erro": "erro",
        "uf": "uf",
        "consultor": "consultor",
    }
    for origem, destino in aliases.items():
        if origem in base.columns and destino not in base.columns:
            base = base.rename(columns={origem: destino})
    for coluna in COLUNAS_MERCADO:
        if coluna not in base.columns:
            base[coluna] = 0 if coluna in {"estoque", "desconto", "pf_dist", "pf_fabrica", "preco_com_imposto", "preco_sem_imposto"} else ""

    base["cnpj_referencia"] = base["cnpj_referencia"].apply(normalizar_cnpj)
    base["ean"] = base["ean"].apply(normalizar_ean)
    for coluna in ["produto", "distribuidora", "consultor", "uf", "status", "erro"]:
        base[coluna] = base[coluna].apply(_texto)
    base["uf"] = base["uf"].str.upper()
    for coluna in ["estoque", "desconto", "pf_dist", "pf_fabrica", "preco_com_imposto", "preco_sem_imposto"]:
        base[coluna] = base[coluna].apply(converter_numero)
    base["desconto"] = base["desconto"].where(base["desconto"] <= 1, base["desconto"] / 100)
    base["data_atualizacao"] = pd.to_datetime(base["data_atualizacao"], errors="coerce", dayfirst=True)
    return base[COLUNAS_MERCADO].reset_index(drop=True)


def mercado_farma_atual() -> pd.DataFrame:
    return preparar_mercado_farma(carregar_mercado_farma())


def salvar_mercado_farma(df: pd.DataFrame) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    destino = DATA_DIR / "mercado_farma.xlsx"
    base = df[COLUNAS_MERCADO].copy() if not df.empty else pd.DataFrame(columns=COLUNAS_MERCADO)
    with pd.ExcelWriter(destino, engine="openpyxl") as writer:
        base.to_excel(writer, sheet_name="Mercado Farma", index=False)
    salvar_bytes("mercado_farma", destino.read_bytes(), "Atualiza Mercado Farma pelo painel")
    return destino


def dataframe_excel_bytes(df: pd.DataFrame) -> bytes:
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Mercado Farma", index=False)
    return buffer.getvalue()


def obter_eans_para_consulta(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> list[str]:
    fontes: list[pd.Series] = []
    if produtos_mix is not None and not produtos_mix.empty:
        coluna = "ean_limpo" if "ean_limpo" in produtos_mix.columns else "ean"
        if coluna in produtos_mix.columns:
            fontes.append(produtos_mix[coluna])
    if vendas is not None and not vendas.empty and "ean_limpo" in vendas.columns:
        fontes.append(vendas["ean_limpo"])
    if not fontes:
        return []
    valores = pd.concat(fontes, ignore_index=True).dropna().astype(str).map(normalizar_ean)
    valores = valores[valores.ne("")]
    return sorted(valores.unique().tolist())


def ufs_por_consultor(clientes: pd.DataFrame) -> dict[str, list[dict[str, str]]]:
    if clientes is None or clientes.empty:
        return {}
    base = clientes.copy()
    for coluna in ["nome_rep", "uf", "cnpj_limpo"]:
        if coluna not in base.columns:
            base[coluna] = ""
    base = base[base["cnpj_limpo"].astype(str).str.strip().ne("")].copy()
    if "cliente_ativo" in base.columns:
        base = base[base["cliente_ativo"].fillna(True)].copy()
    retorno: dict[str, list[dict[str, str]]] = {}
    for (consultor, uf), grupo in base.groupby(["nome_rep", "uf"], dropna=False):
        consultor_txt = _texto(consultor) or "SEM CONSULTOR"
        uf_txt = _texto(uf).upper()
        if not uf_txt:
            continue
        cnpj = str(grupo["cnpj_limpo"].dropna().astype(str).iloc[0])
        retorno.setdefault(consultor_txt, []).append({"uf": uf_txt, "cnpj": cnpj})
    for consultor in retorno:
        retorno[consultor] = sorted(retorno[consultor], key=lambda item: item["uf"])
    return retorno


def criar_driver(headless: bool = True):
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1366,900")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option("excludeSwitches", ["enable-logging"])
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=options)


def converter_linhas_extrator(linhas: list[dict], consultor: str, uf: str, cnpj: str) -> list[dict]:
    agora = agora_brasilia().strftime("%d/%m/%Y %H:%M:%S")
    convertidas: list[dict] = []
    for item in linhas:
        convertidas.append(
            {
                "consultor": consultor,
                "uf": uf,
                "cnpj_referencia": cnpj,
                "ean": normalizar_ean(item.get("EAN", "")),
                "produto": _texto(item.get("NOME DO PRODUTO", "")),
                "distribuidora": _texto(item.get("DISTRIBUIDORA", "")),
                "estoque": converter_numero(item.get("ESTOQUE", 0)),
                "desconto": converter_numero(item.get("DESCONTO (%)", 0)),
                "pf_dist": converter_numero(item.get("PF DIST. (R$)", 0)),
                "pf_fabrica": converter_numero(item.get("PF FABRICA (R$)", 0)),
                "preco_com_imposto": converter_numero(item.get("PREÇO FINAL (R$)", item.get("PREÃ‡O FINAL (R$)", 0))),
                "preco_sem_imposto": converter_numero(item.get("SEM IMPOSTO (R$)", 0)),
                "data_atualizacao": agora,
                "status": _texto(item.get("STATUS", "OK")) or "OK",
                "erro": _texto(item.get("ERRO", "")),
            }
        )
    return convertidas


def extrair_mercado_farma(
    credenciais: list[dict[str, str]],
    clientes: pd.DataFrame,
    produtos_mix: pd.DataFrame,
    vendas: pd.DataFrame,
    *,
    headless: bool = True,
    limite_eans: int | None = None,
    log_fn: Callable[[str], None] | None = None,
) -> Path:
    eans = obter_eans_para_consulta(produtos_mix, vendas)
    if limite_eans:
        eans = eans[: int(limite_eans)]
    if not eans:
        raise RuntimeError("Não encontrei EANs em Produtos / Mix ou nas vendas para consultar o Mercado Farma.")

    mapa_ufs = ufs_por_consultor(clientes)
    if not mapa_ufs:
        raise RuntimeError("Não encontrei CNPJs com UF na base de clientes.")

    existentes = mercado_farma_atual()
    resultados: list[dict] = [] if existentes.empty else existentes.to_dict("records")

    for cred in credenciais:
        consultor = _texto(cred.get("consultor", ""))
        usuario = _texto(cred.get("usuario", ""))
        senha = _texto(cred.get("senha", ""))
        alvos = mapa_ufs.get(consultor, [])
        if not alvos or not usuario or not senha:
            continue
        for alvo in alvos:
            driver = None
            uf = alvo["uf"]
            cnpj = alvo["cnpj"]
            try:
                if callable(log_fn):
                    log_fn(f"{consultor} / {uf}: abrindo Mercado Farma")
                driver = criar_driver(headless=headless)
                login_mercadofarma(driver, usuario, senha, log_fn=log_fn)
                selecionar_cnpj_catalogo(driver, cnpj, log_fn=log_fn)
                for pos, ean in enumerate(eans, start=1):
                    if callable(log_fn):
                        log_fn(f"{consultor} / {uf}: consultando {pos}/{len(eans)} - {ean}")
                    try:
                        linhas = processar_ean_catalogo(driver, ean)
                        resultados.extend(converter_linhas_extrator(linhas, consultor, uf, cnpj))
                    except Exception as exc:
                        resultados.append(
                            {
                                "consultor": consultor,
                                "uf": uf,
                                "cnpj_referencia": cnpj,
                                "ean": ean,
                                "produto": "",
                                "distribuidora": "",
                                "estoque": 0,
                                "desconto": 0,
                                "pf_dist": 0,
                                "pf_fabrica": 0,
                                "preco_com_imposto": 0,
                                "preco_sem_imposto": 0,
                                "data_atualizacao": agora_brasilia().strftime("%d/%m/%Y %H:%M:%S"),
                                "status": "ERRO",
                                "erro": str(exc),
                            }
                        )
            finally:
                if driver is not None:
                    driver.quit()

    if not resultados:
        raise RuntimeError("Nenhum preço foi extraído. Verifique logins, senhas e CNPJs.")
    return salvar_mercado_farma(preparar_mercado_farma(pd.DataFrame(resultados)))


def melhor_preco_por_ean(df: pd.DataFrame) -> pd.DataFrame:
    base = preparar_mercado_farma(df)
    if base.empty:
        return base
    validos = base[(base["estoque"] > 0) & (base["preco_sem_imposto"] > 0)].copy()
    if validos.empty:
        validos = base.copy()
    return validos.sort_values(["uf", "ean", "preco_sem_imposto", "estoque"], ascending=[True, True, True, False]).drop_duplicates(["uf", "ean"])


def formatar_tabela_mercado(df: pd.DataFrame) -> pd.DataFrame:
    base = preparar_mercado_farma(df)
    colunas = {
        "consultor": "Consultor",
        "uf": "UF",
        "cnpj_referencia": "CNPJ referência",
        "ean": "EAN",
        "produto": "Produto",
        "distribuidora": "Distribuidora",
        "estoque": "Estoque",
        "desconto": "Desconto",
        "pf_dist": "PF Dist.",
        "pf_fabrica": "PF Fábrica",
        "preco_com_imposto": "Preço com imposto",
        "preco_sem_imposto": "Preço sem imposto",
        "data_atualizacao": "Atualizado em",
        "status": "Status",
        "erro": "Erro",
    }
    base = base.rename(columns=colunas)
    for coluna in ["PF Dist.", "PF Fábrica", "Preço com imposto", "Preço sem imposto"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_moeda)
    if "Desconto" in base.columns:
        base["Desconto"] = base["Desconto"].apply(lambda valor: f"{float(valor or 0) * 100:,.2f}%".replace(",", "X").replace(".", ",").replace("X", "."))
    if "Atualizado em" in base.columns:
        base["Atualizado em"] = pd.to_datetime(base["Atualizado em"], errors="coerce", dayfirst=True).dt.strftime("%d/%m/%Y %H:%M")
        base["Atualizado em"] = base["Atualizado em"].fillna("-")
    return base
