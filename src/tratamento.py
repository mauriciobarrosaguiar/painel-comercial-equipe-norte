from __future__ import annotations

from decimal import Decimal, InvalidOperation
import math
import re
import unicodedata

import numpy as np
import pandas as pd

from src.datas import hoje_brasilia


TIPOS_MIX_VALIDOS = ["PRIORITARIO", "LANCAMENTO", "LINHA", "COMBATE"]
TIPO_SEM_CLASSIFICACAO = "SEM CLASSIFICACAO"
STATUS_FATURADOS = ["FATURADO", "FATURADO PARCIAL", "FATURADO RECUPERADO"]
STATUS_CANCELADO = "CANCELADO"
CHAVES_DEDUP_PEDIDOS = [
    "pedido_id",
    "nota_fiscal",
    "data_de_faturamento",
    "cnpj_pdv",
    "ean",
    "sku_produto",
    "valor_faturado",
]

COLUNAS_BUSSOLA = [
    "status_pedido",
    "nota_fiscal",
    "pedido_id",
    "data_do_pedido",
    "data_de_faturamento",
    "canal_de_vendas",
    "cod_representante",
    "representante",
    "cnpj_pdv",
    "centro_distribuicao",
    "uf_centro_distribuicao",
    "ean",
    "sku_produto",
    "produto",
    "quantidade_solicitada",
    "quantidade_atendida",
    "quantidade_faturada",
    "quantidade_cancelada",
    "preco_unitario_com_imposto",
    "preco_unitario_sem_imposto",
    "desconto_digitado",
    "desconto_aplicado_em_nota",
    "valor_total_solicitado_com_imposto",
    "valor_total_solicitado_sem_imposto",
    "total_atendido_sem_imposto",
    "total_atendido_com_imposto",
    "valor_faturado",
]

COLUNAS_PAINEL = [
    "cnpj",
    "nome_pdv",
    "cidade",
    "uf",
    "situacao",
    "grupo_economico",
    "rede_associacao",
    "bandeira",
    "nome_gd",
    "nome_rep",
    "setor_rep",
    "foco_pex",
    "positivacao",
]

COLUNAS_ACOES = [
    "campanha",
    "produto",
    "ean",
    "tipo_mix",
    "distribuidora",
    "desconto",
    "data_inicio",
    "data_fim",
    "consultor",
    "observacao",
    "status",
]

COLUNAS_PRODUTOS_MIX = ["ean", "produto", "tipo_mix"]

COLUNAS_CONTATO = [
    "proprietario_diretor",
    "comprador_gerente_de_compras",
    "cargo",
    "celular",
    "email",
]


def slug_coluna(valor: object) -> str:
    texto = "" if valor is None else str(valor)
    texto = texto.replace("\n", " ").replace("\r", " ").strip().lower()
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    texto = re.sub(r"[^a-z0-9]+", "_", texto)
    texto = re.sub(r"_+", "_", texto)
    return texto.strip("_")


def padronizar_colunas(df: pd.DataFrame) -> pd.DataFrame:
    base = df.copy()
    base.columns = [slug_coluna(col) for col in base.columns]
    return base


def _texto_vazio(valor: object) -> bool:
    if valor is None:
        return True
    if isinstance(valor, float) and math.isnan(valor):
        return True
    texto = str(valor).strip()
    return texto.lower() in {"", "nan", "none", "<na>", "nat", "null"}


def _texto_plano(valor: object) -> str:
    if _texto_vazio(valor):
        return ""
    texto = str(valor).strip()
    if re.fullmatch(r"\d+\.0+", texto):
        texto = texto.split(".", 1)[0]
    if re.fullmatch(r"\d+(\.\d+)?[eE][+-]?\d+", texto):
        try:
            texto = format(Decimal(texto), "f").split(".", 1)[0]
        except InvalidOperation:
            pass
    return texto


def normalizar_cnpj(valor: object) -> str:
    texto = _texto_plano(valor)
    digitos = re.sub(r"\D", "", texto)
    if not digitos:
        return ""
    if len(digitos) > 14:
        digitos = digitos[-14:]
    return digitos.zfill(14)


def normalizar_ean(valor: object) -> str:
    texto = _texto_plano(valor)
    digitos = re.sub(r"\D", "", texto)
    return digitos.strip()


def formatar_moeda(valor: object) -> str:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        numero = 0.0
    if not np.isfinite(numero):
        numero = 0.0
    texto = f"{numero:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {texto}"


def formatar_percentual(valor: object) -> str:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return "-"
    if not np.isfinite(numero):
        return "-"
    texto = f"{numero * 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{texto}%"


def formatar_data(valor: object) -> str:
    if pd.isna(valor):
        return "-"
    data = pd.to_datetime(valor, errors="coerce")
    if pd.isna(data):
        return "-"
    return data.strftime("%d/%m/%Y")


def normalizar_texto(valor: object) -> str:
    if _texto_vazio(valor):
        return ""
    return str(valor).strip()


def normalizar_texto_alto(valor: object) -> str:
    texto = normalizar_texto(valor)
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", texto).strip().upper()


def converter_numero(valor: object) -> float:
    if _texto_vazio(valor):
        return 0.0
    if isinstance(valor, (int, float, np.number)):
        numero = pd.to_numeric(valor, errors="coerce")
        return 0.0 if pd.isna(numero) else float(numero)
    texto = str(valor).strip().replace("R$", "").replace("%", "").replace(" ", "")
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif "," in texto:
        texto = texto.replace(",", ".")
    numero = pd.to_numeric(texto, errors="coerce")
    return 0.0 if pd.isna(numero) else float(numero)


def serie_numero(serie: pd.Series) -> pd.Series:
    return serie.apply(converter_numero).astype(float)


def serie_data(serie: pd.Series) -> pd.Series:
    texto = serie.astype(str)
    iso = texto.str.match(r"^\d{4}-\d{2}-\d{2}", na=False)
    datas = pd.Series(pd.NaT, index=serie.index, dtype="datetime64[ns]")
    if iso.any():
        datas.loc[iso] = pd.to_datetime(texto.loc[iso], errors="coerce")
    if (~iso).any():
        datas.loc[~iso] = pd.to_datetime(texto.loc[~iso], errors="coerce", dayfirst=True)
    return datas


def garantir_colunas(df: pd.DataFrame, colunas: list[str], valor_padrao: object = "") -> pd.DataFrame:
    base = df.copy()
    for coluna in colunas:
        if coluna not in base.columns:
            base[coluna] = valor_padrao
    return base


def renomear_alias(df: pd.DataFrame, destino: str, aliases: list[str]) -> pd.DataFrame:
    base = df.copy()
    if destino in base.columns:
        return base
    for alias in aliases:
        alias_slug = slug_coluna(alias)
        if alias_slug in base.columns:
            base = base.rename(columns={alias_slug: destino})
            return base
    return base


def normalizar_tipo_mix(valor: object) -> str:
    texto = normalizar_texto_alto(valor)
    texto = texto.replace("PRIORITARIOS", "PRIORITARIO")
    texto = texto.replace("PRIORITARIAS", "PRIORITARIO")
    texto = texto.replace("PRIORITARIA", "PRIORITARIO")
    texto = texto.replace("LANCAMENTOS", "LANCAMENTO")
    if not texto:
        return TIPO_SEM_CLASSIFICACAO
    if "COMBATE" in texto:
        return "COMBATE"
    if "PRIORITARIO" in texto:
        return "PRIORITARIO"
    if "LANCAMENTO" in texto:
        return "LANCAMENTO"
    if "LINHA" in texto:
        return "LINHA"
    return TIPO_SEM_CLASSIFICACAO


def status_pedido_normalizado(valor: object) -> str:
    texto = normalizar_texto_alto(valor)
    if "CANCEL" in texto:
        return STATUS_CANCELADO
    if "FATURADO" in texto and "RECUPER" in texto:
        return "FATURADO RECUPERADO"
    if "FATURADO" in texto and "PARCIAL" in texto:
        return "FATURADO PARCIAL"
    if "FATURADO" in texto:
        return "FATURADO"
    return texto or "SEM STATUS"


def validar_colunas_esperadas(df: pd.DataFrame, esperadas: list[str], nome_base: str) -> list[str]:
    if df is None or df.empty:
        return [f"{nome_base}: arquivo sem linhas carregadas. O painel abriu, mas alguns indicadores podem ficar vazios."]
    colunas = {slug_coluna(col) for col in df.columns}
    faltantes = [col for col in esperadas if slug_coluna(col) not in colunas]
    if not faltantes:
        return []
    return [f"{nome_base}: colunas ausentes preenchidas automaticamente: {', '.join(faltantes)}."]


def deduplicar_pedidos_bussola(vendas: pd.DataFrame) -> pd.DataFrame:
    if vendas is None or vendas.empty:
        return vendas.copy() if vendas is not None else pd.DataFrame()
    base = vendas.copy()
    chaves = [coluna for coluna in CHAVES_DEDUP_PEDIDOS if coluna in base.columns]
    if len(chaves) != len(CHAVES_DEDUP_PEDIDOS):
        return base

    chave_texto = base[chaves].astype("string").fillna("")
    mascara_chave_vazia = chave_texto.eq("").all(axis=1)
    com_chave = base.loc[~mascara_chave_vazia].drop_duplicates(chaves, keep="last")
    sem_chave = base.loc[mascara_chave_vazia]
    return pd.concat([com_chave, sem_chave], ignore_index=True)


def deduplicar_exportacao_bussola(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df.copy() if df is not None else pd.DataFrame()

    original = df.copy()
    base = padronizar_colunas(original)
    chaves = [coluna for coluna in CHAVES_DEDUP_PEDIDOS if coluna in base.columns]
    if len(chaves) != len(CHAVES_DEDUP_PEDIDOS):
        return original

    base["pedido_id"] = base["pedido_id"].apply(normalizar_texto)
    base["nota_fiscal"] = base["nota_fiscal"].apply(normalizar_texto)
    base["data_de_faturamento"] = serie_data(base["data_de_faturamento"])
    base["cnpj_pdv"] = base["cnpj_pdv"].apply(normalizar_cnpj)
    base["ean"] = base["ean"].apply(normalizar_ean)
    base["sku_produto"] = base["sku_produto"].apply(normalizar_texto)
    base["valor_faturado"] = serie_numero(base["valor_faturado"])

    chave_texto = base[chaves].astype("string").fillna("")
    mascara_chave_vazia = chave_texto.eq("").all(axis=1)
    indices_deduplicados = base.loc[~mascara_chave_vazia].drop_duplicates(chaves, keep="last").index
    indices_sem_chave = base.loc[mascara_chave_vazia].index
    indices = list(indices_deduplicados) + list(indices_sem_chave)
    return original.loc[indices].reset_index(drop=True)


def _valor_grupo_valido(valor: object) -> bool:
    texto = normalizar_texto_alto(valor)
    return texto not in {"", "-", "INDEPENDENTE", "NAN", "NONE", "SEM GRUPO"}


def _grupo_sip_linha(linha: pd.Series) -> str:
    for coluna in ["grupo_economico", "rede_associacao", "bandeira", "nome_pdv"]:
        valor = linha.get(coluna, "")
        if _valor_grupo_valido(valor):
            return normalizar_texto(valor).upper()
    return "SEM IDENTIFICACAO"


def preparar_painel_equipe(df: pd.DataFrame) -> pd.DataFrame:
    base = padronizar_colunas(df) if df is not None else pd.DataFrame()
    aliases = {
        "cnpj": ["CNPJ"],
        "nome_pdv": ["NOME PDV", "NOME FANTASIA", "RAZAO SOCIAL"],
        "cidade": ["CIDADE"],
        "uf": ["UF"],
        "situacao": ["SITUAÇÃO", "SITUACAO"],
        "grupo_economico": ["GRUPO ECONÔMICO", "GRUPO ECONOMICO"],
        "rede_associacao": ["REDE ASSOCIAÇÃO", "REDE ASSOCIACAO", "REDE\nASSOCIAÇÃO"],
        "bandeira": ["BANDEIRA"],
        "nome_gd": ["NOME GD", "NOME GD.1"],
        "nome_rep": ["NOME REP", "NOME CONSULTOR TERRIT.", "NOME CONSULTOR TERRIT", "REPRESENTANTE"],
        "setor_rep": ["SETOR REP", "SETOR CONSULTOR TERRIT.", "SETOR CONSULTOR TERRIT"],
        "foco_pex": ["FOCO PEX"],
        "positivacao": ["POSITIVAÇÃO", "POSITIVACAO"],
        "proprietario_diretor": ["PROPRIETÁRIO/DIRETOR", "PROPRIETARIO/DIRETOR"],
        "comprador_gerente_de_compras": ["COMPRADOR/GERENTE DE COMPRAS"],
        "cargo": ["CARGO"],
        "celular": ["CELULAR", "TELEFONE", "CONTATO"],
        "email": ["EMAIL", "E-MAIL"],
    }
    for destino, nomes in aliases.items():
        base = renomear_alias(base, destino, nomes)
    base = garantir_colunas(base, COLUNAS_PAINEL + COLUNAS_CONTATO)

    base["cnpj_limpo"] = base["cnpj"].apply(normalizar_cnpj)
    base["cnpj"] = base["cnpj_limpo"]
    for coluna in COLUNAS_PAINEL[1:] + COLUNAS_CONTATO:
        base[coluna] = base[coluna].apply(normalizar_texto)

    base["grupo_sip"] = base.apply(_grupo_sip_linha, axis=1)
    situacao = base["situacao"].apply(normalizar_texto_alto)
    base["cliente_ativo"] = ~situacao.str.contains("INATIV|CANCEL|ENCERR|BLOQUE", regex=True, na=False)
    base.loc[base["cnpj_limpo"].eq(""), "cliente_ativo"] = False
    base = base.drop_duplicates("cnpj_limpo", keep="first").reset_index(drop=True)
    return base


def preparar_produtos_mix(df: pd.DataFrame) -> pd.DataFrame:
    base = padronizar_colunas(df) if df is not None else pd.DataFrame()
    aliases = {
        "ean": ["EAN"],
        "produto": ["PRODUTO", "PRINCIPIO ATIVO", "NOME DO PRODUTO", "DESCRICAO"],
        "tipo_mix": [
            "TIPO MIX",
            "TIPO",
            "TIPO_MIX",
            "MIX",
            "CLASSIFICACAO",
            "CLASSIFICAÇÃO",
            "CATEGORIA",
            "MIX LANCAMENTOS",
            "LINHA/COMBATE/PRIORITARIOS/LANCAMENTOS",
            "LINHA COMBATE PRIORITARIOS LANCAMENTOS",
        ],
    }
    for destino, nomes in aliases.items():
        base = renomear_alias(base, destino, nomes)
    base = garantir_colunas(base, COLUNAS_PRODUTOS_MIX)
    if base.empty:
        return pd.DataFrame(columns=["ean", "produto", "tipo_mix", "ean_limpo"])

    base["ean_limpo"] = base["ean"].apply(normalizar_ean)
    base["ean"] = base["ean_limpo"]
    base["produto"] = base["produto"].apply(normalizar_texto)
    base["tipo_mix"] = base["tipo_mix"].apply(normalizar_tipo_mix)
    base = base[["ean", "produto", "tipo_mix", "ean_limpo"]]
    base = base[base["ean_limpo"].ne("") | base["produto"].ne("")]
    return base.drop_duplicates("ean_limpo", keep="first").reset_index(drop=True)


def preparar_acoes(df: pd.DataFrame) -> pd.DataFrame:
    base = padronizar_colunas(df) if df is not None else pd.DataFrame()
    aliases = {
        "campanha": ["CAMPANHA", "NOME ACAO", "NOME_ACAO", "TIPO ACAO", "TIPO_ACAO"],
        "produto": ["PRODUTO"],
        "ean": ["EAN"],
        "tipo_mix": ["TIPO MIX", "TIPO_MIX", "MIX"],
        "distribuidora": ["DISTRIBUIDORA", "CENTRO DISTRIBUICAO"],
        "desconto": ["DESCONTO"],
        "data_inicio": ["DATA INICIO", "DATA_INICIO", "INICIO"],
        "data_fim": ["DATA FIM", "DATA_FIM", "VALIDADE DA ACAO", "VALIDADE_DA_ACAO", "FIM"],
        "consultor": ["CONSULTOR", "REPRESENTANTE", "NOME REP"],
        "observacao": ["OBSERVACAO", "OBSERVAÇÃO", "CUPOM"],
        "status": ["STATUS"],
    }
    for destino, nomes in aliases.items():
        base = renomear_alias(base, destino, nomes)
    base = garantir_colunas(base, COLUNAS_ACOES)
    if base.empty:
        return pd.DataFrame(columns=COLUNAS_ACOES + ["ean_limpo"])

    base["ean_limpo"] = base["ean"].apply(normalizar_ean)
    base["ean"] = base["ean_limpo"]
    for coluna in ["campanha", "produto", "distribuidora", "consultor", "observacao", "status"]:
        base[coluna] = base[coluna].apply(normalizar_texto)
    base["tipo_mix"] = base["tipo_mix"].apply(normalizar_tipo_mix)
    base["desconto"] = base["desconto"].apply(converter_numero)
    base["data_fim"] = pd.to_datetime(base["data_fim"], errors="coerce", dayfirst=True)
    base["data_inicio"] = pd.to_datetime(base["data_inicio"], errors="coerce", dayfirst=True)

    sem_inicio = base["data_inicio"].isna() & base["data_fim"].notna()
    base.loc[sem_inicio, "data_inicio"] = base.loc[sem_inicio, "data_fim"].dt.to_period("M").dt.start_time

    hoje = pd.Timestamp(hoje_brasilia())
    sem_status = base["status"].eq("")
    base.loc[sem_status & base["data_fim"].notna() & (base["data_fim"] >= hoje), "status"] = "ATIVA"
    base.loc[sem_status & base["data_fim"].notna() & (base["data_fim"] < hoje), "status"] = "ENCERRADA"
    base.loc[base["status"].eq(""), "status"] = "CADASTRADA"

    base = base[COLUNAS_ACOES + ["ean_limpo"]]
    return base.reset_index(drop=True)


def preparar_base_vendas(
    bussola: pd.DataFrame,
    painel_equipe: pd.DataFrame,
    produtos_mix: pd.DataFrame,
) -> pd.DataFrame:
    vendas = padronizar_colunas(bussola) if bussola is not None else pd.DataFrame()
    vendas = garantir_colunas(vendas, COLUNAS_BUSSOLA)
    if vendas.empty:
        return pd.DataFrame(
            columns=COLUNAS_BUSSOLA
            + [
                "cnpj_limpo",
                "ean_limpo",
                "status_normalizado",
                "pedido_cancelado",
                "pedido_sem_nota",
                "quantidade_base",
                "valor_calculado_sem_imposto",
                "valor_vendido_sem_imposto",
                "valor_sem_nota_sem_imposto",
                "valor_pedido_sem_imposto",
                "nome_pdv",
                "cidade",
                "uf",
                "situacao",
                "grupo_sip",
                "nome_rep",
                "foco_pex",
                "positivacao",
                "cliente_ativo",
                "produto_mix",
                "tipo_mix",
                "consultor",
                "distribuidora",
                "ano_mes",
                "data_base",
            ]
        )

    vendas["cnpj_limpo"] = vendas["cnpj_pdv"].apply(normalizar_cnpj)
    vendas["ean_limpo"] = vendas["ean"].apply(normalizar_ean)
    vendas["cnpj_pdv"] = vendas["cnpj_limpo"]
    vendas["ean"] = vendas["ean_limpo"]
    vendas["pedido_id"] = vendas["pedido_id"].apply(normalizar_texto)
    vendas["nota_fiscal"] = vendas["nota_fiscal"].apply(normalizar_texto)
    vendas["sku_produto"] = vendas["sku_produto"].apply(normalizar_texto)
    vendas["status_pedido"] = vendas["status_pedido"].apply(normalizar_texto)
    vendas["status_normalizado"] = vendas["status_pedido"].apply(status_pedido_normalizado)

    for coluna in [
        "quantidade_solicitada",
        "quantidade_atendida",
        "quantidade_faturada",
        "quantidade_cancelada",
        "preco_unitario_com_imposto",
        "preco_unitario_sem_imposto",
        "desconto_digitado",
        "desconto_aplicado_em_nota",
        "valor_total_solicitado_com_imposto",
        "valor_total_solicitado_sem_imposto",
        "total_atendido_sem_imposto",
        "total_atendido_com_imposto",
        "valor_faturado",
    ]:
        vendas[coluna] = serie_numero(vendas[coluna])

    vendas["data_do_pedido"] = serie_data(vendas["data_do_pedido"])
    vendas["data_de_faturamento"] = serie_data(vendas["data_de_faturamento"])
    vendas["quantidade_base"] = np.where(
        vendas["quantidade_faturada"] > 0,
        vendas["quantidade_faturada"],
        np.where(vendas["quantidade_atendida"] > 0, vendas["quantidade_atendida"], 0),
    )
    vendas["valor_calculado_sem_imposto"] = vendas["quantidade_base"] * vendas["preco_unitario_sem_imposto"]
    vendas = deduplicar_pedidos_bussola(vendas)
    vendas["valor_vendido_sem_imposto"] = vendas["valor_faturado"]
    vendas["pedido_cancelado"] = vendas["status_normalizado"].eq(STATUS_CANCELADO)
    nota_vazia = vendas["nota_fiscal"].fillna("").astype(str).str.strip().eq("")
    vendas["pedido_sem_nota"] = nota_vazia & ~vendas["pedido_cancelado"]
    vendas["valor_sem_nota_sem_imposto"] = np.where(
        vendas["pedido_sem_nota"],
        vendas["valor_total_solicitado_sem_imposto"],
        0.0,
    )
    vendas["valor_pedido_sem_imposto"] = np.where(
        vendas["pedido_sem_nota"],
        vendas["valor_sem_nota_sem_imposto"],
        vendas["valor_vendido_sem_imposto"],
    )

    for coluna in ["representante", "centro_distribuicao", "uf_centro_distribuicao", "produto"]:
        vendas[coluna] = vendas[coluna].apply(normalizar_texto)

    clientes = painel_equipe.copy() if painel_equipe is not None else pd.DataFrame()
    clientes = garantir_colunas(
        clientes,
        [
            "cnpj_limpo",
            "nome_pdv",
            "cidade",
            "uf",
            "situacao",
            "grupo_sip",
            "nome_rep",
            "foco_pex",
            "positivacao",
            "cliente_ativo",
        ],
    )
    colunas_clientes = [
        "cnpj_limpo",
        "nome_pdv",
        "cidade",
        "uf",
        "situacao",
        "grupo_sip",
        "nome_rep",
        "foco_pex",
        "positivacao",
        "cliente_ativo",
    ]
    vendas = vendas.merge(clientes[colunas_clientes].drop_duplicates("cnpj_limpo"), on="cnpj_limpo", how="left")

    produtos = produtos_mix.copy() if produtos_mix is not None else pd.DataFrame()
    produtos = garantir_colunas(produtos, ["ean_limpo", "produto", "tipo_mix"])
    produtos = produtos.rename(columns={"produto": "produto_mix"})
    vendas = vendas.merge(produtos[["ean_limpo", "produto_mix", "tipo_mix"]].drop_duplicates("ean_limpo"), on="ean_limpo", how="left")

    if not produtos.empty:
        produtos_nome = produtos.copy()
        produtos_nome["produto_chave"] = produtos_nome["produto_mix"].apply(normalizar_texto_alto)
        produtos_nome["tipo_mix_nome"] = produtos_nome["tipo_mix"].apply(normalizar_tipo_mix)
        produtos_nome = produtos_nome[
            produtos_nome["produto_chave"].ne("")
            & produtos_nome["tipo_mix_nome"].ne(TIPO_SEM_CLASSIFICACAO)
        ].copy()
        contagem_nome = produtos_nome.groupby("produto_chave")["tipo_mix_nome"].nunique()
        nomes_unicos = set(contagem_nome[contagem_nome.eq(1)].index)
        mapa_tipo_nome = (
            produtos_nome[produtos_nome["produto_chave"].isin(nomes_unicos)]
            .drop_duplicates("produto_chave")
            .set_index("produto_chave")["tipo_mix_nome"]
            .to_dict()
        )
        vendas["produto_chave"] = vendas["produto"].apply(normalizar_texto_alto)
        sem_mix = vendas["tipo_mix"].isna() | vendas["tipo_mix"].astype(str).str.strip().eq("")
        vendas.loc[sem_mix, "tipo_mix"] = vendas.loc[sem_mix, "produto_chave"].map(mapa_tipo_nome)

    vendas["tipo_mix"] = vendas["tipo_mix"].fillna(TIPO_SEM_CLASSIFICACAO).apply(normalizar_tipo_mix)
    vendas["produto"] = vendas["produto"].where(vendas["produto"].ne(""), vendas["produto_mix"].fillna(""))
    vendas["produto"] = vendas["produto"].fillna("")
    vendas["nome_pdv"] = vendas["nome_pdv"].fillna("CLIENTE NAO LOCALIZADO")
    vendas["cidade"] = vendas["cidade"].fillna("")
    vendas["uf"] = vendas["uf"].fillna(vendas["uf_centro_distribuicao"]).fillna("")
    vendas["grupo_sip"] = vendas["grupo_sip"].fillna(vendas["nome_pdv"]).replace("", "SEM IDENTIFICACAO")
    vendas["consultor"] = vendas["nome_rep"].fillna("").where(vendas["nome_rep"].fillna("").ne(""), vendas["representante"])
    vendas["consultor"] = vendas["consultor"].fillna("SEM CONSULTOR").replace("", "SEM CONSULTOR")
    vendas["distribuidora"] = vendas["centro_distribuicao"].fillna("").replace("", "SEM DISTRIBUIDORA")
    vendas["ano_mes"] = vendas["data_do_pedido"].dt.to_period("M").astype(str)
    vendas["data_base"] = vendas["data_do_pedido"].fillna(vendas["data_de_faturamento"])
    return vendas.reset_index(drop=True)
