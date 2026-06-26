from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.loader import DATA_DIR
from src.persistencia import criar_backup, salvar_bytes
from src.tratamento import (
    COLUNAS_BUSSOLA,
    converter_numero,
    deduplicar_exportacao_bussola,
    garantir_colunas,
    normalizar_texto,
    padronizar_colunas,
    renomear_alias,
    serie_data,
    slug_coluna,
)


COLUNAS_VALOR_FALLBACK = [
    "valor_faturado",
    "total_atendido_sem_imposto",
    "valor_total_solicitado_sem_imposto",
    "valor_total_solicitado_com_imposto",
    "total_atendido_com_imposto",
]

ALIASES_BUSSOLA = {
    "status_pedido": ["STATUS", "STATUS DO PEDIDO", "SITUACAO DO PEDIDO", "SITUAÇÃO DO PEDIDO"],
    "nota_fiscal": ["NF", "NOTA", "NOTA FISCAL", "NUMERO NF", "NÚMERO NF"],
    "pedido_id": ["PEDIDO", "ID PEDIDO", "NUMERO PEDIDO", "NÚMERO PEDIDO", "NUMERO DO PEDIDO", "NÚMERO DO PEDIDO"],
    "data_do_pedido": ["DATA", "DATA PEDIDO", "DATA DE PEDIDO", "DATA DO PEDIDO", "DT PEDIDO"],
    "data_de_faturamento": ["DATA FATURAMENTO", "DATA DE FATURAMENTO", "DATA DO FATURAMENTO", "DT FATURAMENTO"],
    "representante": ["REPRESENTANTE", "CONSULTOR", "NOME REP", "NOME REPRESENTANTE"],
    "cnpj_pdv": ["CNPJ", "CNPJ PDV", "CNPJ DO PDV", "DOCUMENTO PDV"],
    "centro_distribuicao": ["CENTRO DISTRIBUICAO", "CENTRO DISTRIBUIÇÃO", "DISTRIBUIDORA", "CD"],
    "uf_centro_distribuicao": ["UF CENTRO DISTRIBUICAO", "UF CENTRO DISTRIBUIÇÃO", "UF CD"],
    "ean": ["EAN", "CODIGO DE BARRAS", "CÓDIGO DE BARRAS", "COD BARRAS", "GTIN"],
    "sku_produto": ["SKU", "COD PRODUTO", "CÓD PRODUTO", "CODIGO PRODUTO", "CÓDIGO PRODUTO"],
    "produto": ["PRODUTO", "DESCRICAO", "DESCRIÇÃO", "NOME PRODUTO"],
    "quantidade_solicitada": ["QTD SOLICITADA", "QUANTIDADE SOLICITADA"],
    "quantidade_atendida": ["QTD ATENDIDA", "QUANTIDADE ATENDIDA"],
    "quantidade_faturada": ["QTD FATURADA", "QUANTIDADE FATURADA"],
    "quantidade_cancelada": ["QTD CANCELADA", "QUANTIDADE CANCELADA"],
    "preco_unitario_com_imposto": ["PRECO UNITARIO COM IMPOSTO", "PREÇO UNITÁRIO COM IMPOSTO"],
    "preco_unitario_sem_imposto": ["PRECO UNITARIO SEM IMPOSTO", "PREÇO UNITÁRIO SEM IMPOSTO", "PRECO SEM IMPOSTO", "PREÇO SEM IMPOSTO"],
    "valor_total_solicitado_com_imposto": ["VALOR TOTAL SOLICITADO COM IMPOSTO", "TOTAL SOLICITADO COM IMPOSTO"],
    "valor_total_solicitado_sem_imposto": ["VALOR TOTAL SOLICITADO SEM IMPOSTO", "TOTAL SOLICITADO SEM IMPOSTO"],
    "total_atendido_sem_imposto": ["TOTAL ATENDIDO SEM IMPOSTO", "VALOR ATENDIDO SEM IMPOSTO"],
    "total_atendido_com_imposto": ["TOTAL ATENDIDO COM IMPOSTO", "VALOR ATENDIDO COM IMPOSTO"],
    "valor_faturado": ["VALOR FATURADO", "FATURADO", "TOTAL FATURADO", "VALOR TOTAL FATURADO", "VALOR FATURADO SEM IMPOSTO"],
}


def _executar_extrator_bussola():
    import importlib

    import bussola_extrator

    modulo = importlib.reload(bussola_extrator)
    return modulo.executar


def _aplicar_aliases_bussola(df: pd.DataFrame) -> pd.DataFrame:
    base = padronizar_colunas(df) if df is not None else pd.DataFrame()
    for destino, aliases in ALIASES_BUSSOLA.items():
        base = renomear_alias(base, destino, aliases)
    return garantir_colunas(base, COLUNAS_BUSSOLA)


def _serie_valor_fallback(base: pd.DataFrame) -> pd.Series:
    valores = pd.Series(0.0, index=base.index, dtype=float)
    for coluna in COLUNAS_VALOR_FALLBACK:
        if coluna not in base.columns:
            continue
        serie = base[coluna].apply(converter_numero).astype(float)
        valores = valores.where(valores.gt(0), serie)

    if "quantidade_faturada" in base.columns and "preco_unitario_sem_imposto" in base.columns:
        qtd = base["quantidade_faturada"].apply(converter_numero).astype(float)
        preco = base["preco_unitario_sem_imposto"].apply(converter_numero).astype(float)
        calculado = qtd * preco
        valores = valores.where(valores.gt(0), calculado)

    if "quantidade_atendida" in base.columns and "preco_unitario_sem_imposto" in base.columns:
        qtd = base["quantidade_atendida"].apply(converter_numero).astype(float)
        preco = base["preco_unitario_sem_imposto"].apply(converter_numero).astype(float)
        calculado = qtd * preco
        valores = valores.where(valores.gt(0), calculado)

    return valores.fillna(0.0).astype(float)


def _preparar_exportacao_para_painel(df: pd.DataFrame, origem: str) -> pd.DataFrame:
    if df is None or df.empty:
        raise RuntimeError(f"{origem}: a extração não retornou linhas. A base anterior foi preservada.")

    base = _aplicar_aliases_bussola(df)
    base["valor_faturado"] = _serie_valor_fallback(base)

    if "quantidade_faturada" in base.columns and "quantidade_atendida" in base.columns:
        qtd_fat = base["quantidade_faturada"].apply(converter_numero).astype(float)
        qtd_at = base["quantidade_atendida"].apply(converter_numero).astype(float)
        base["quantidade_faturada"] = qtd_fat.where(qtd_fat.gt(0), qtd_at)

    if "data_de_faturamento" in base.columns and "data_do_pedido" in base.columns:
        data_fat = serie_data(base["data_de_faturamento"])
        data_ped = serie_data(base["data_do_pedido"])
        sem_faturamento = data_fat.isna() & data_ped.notna()
        base.loc[sem_faturamento, "data_de_faturamento"] = base.loc[sem_faturamento, "data_do_pedido"]

    base["pedido_id"] = base["pedido_id"].apply(normalizar_texto)
    base["cnpj_pdv"] = base["cnpj_pdv"].apply(normalizar_texto)
    base["ean"] = base["ean"].apply(normalizar_texto)
    base["produto"] = base["produto"].apply(normalizar_texto)

    sem_valor = int(base["valor_faturado"].fillna(0).le(0).sum())
    com_valor = int(base["valor_faturado"].fillna(0).gt(0).sum())
    datas_validas = int(serie_data(base["data_de_faturamento"]).notna().sum())
    pedidos_validos = int(base["pedido_id"].astype(str).str.strip().ne("").sum())

    if com_valor <= 0:
        raise RuntimeError(
            f"{origem}: a extração retornou {len(base)} linhas, mas todos os valores ficaram zerados. "
            "Isso normalmente indica mudança de coluna/formato no CSV da Bússola. A base anterior foi preservada."
        )
    if datas_validas <= 0:
        raise RuntimeError(
            f"{origem}: a extração retornou {len(base)} linhas, mas nenhuma data válida foi encontrada. "
            "A base anterior foi preservada."
        )
    if pedidos_validos <= 0:
        raise RuntimeError(
            f"{origem}: a extração retornou {len(base)} linhas, mas nenhum pedido válido foi encontrado. "
            "A base anterior foi preservada."
        )

    if sem_valor > 0:
        base["alerta_linha_sem_valor"] = base["valor_faturado"].fillna(0).le(0)

    return base.reset_index(drop=True)


def _salvar_bussola_validada(df: pd.DataFrame, destino: Path, origem: str, mensagem: str) -> Path:
    preparado = _preparar_exportacao_para_painel(df, origem)
    preparado = deduplicar_exportacao_bussola(preparado)
    criar_backup("bussola", "Backup automatico antes da extração Bússola")
    with pd.ExcelWriter(destino, engine="openpyxl") as writer:
        preparado.to_excel(writer, sheet_name="Pedidos", index=False)
    salvar_bytes("bussola", destino.read_bytes(), mensagem)
    return destino


def extrair_bussola_web(usuario: str, senha: str, headless: bool = False, log_fn=None) -> Path:
    executar = _executar_extrator_bussola()

    downloads = Path(__file__).resolve().parents[1] / "downloads_bussola"
    executar(
        usuario=usuario,
        senha=senha,
        saida=str(DATA_DIR),
        downloads=str(downloads),
        headless=headless,
        log_fn=log_fn,
    )

    pedidos = DATA_DIR / "Pedidos.xlsx"
    destino = DATA_DIR / "bussola.xlsx"
    if pedidos.exists():
        df = pd.read_excel(pedidos, dtype=str)
        return _salvar_bussola_validada(df, destino, "Bússola", "Atualiza Bússola pelo painel")
    if not destino.exists():
        raise FileNotFoundError("A extração terminou, mas não encontrei data/bussola.xlsx.")
    return destino


def extrair_bussola_web_todos(credenciais: list[dict[str, str]], headless: bool = False, log_fn=None) -> Path:
    executar = _executar_extrator_bussola()

    if not credenciais:
        raise ValueError("Nenhuma credencial de consultor cadastrada.")

    downloads_base = Path(__file__).resolve().parents[1] / "downloads_bussola"
    extracoes_base = DATA_DIR / "bussola_extracoes"
    frames: list[pd.DataFrame] = []
    erros: list[str] = []

    for idx, item in enumerate(credenciais, start=1):
        consultor = str(item.get("consultor", "")).strip()
        usuario = str(item.get("usuario", "")).strip()
        senha = str(item.get("senha", "")).strip()
        if not consultor or not usuario or not senha:
            erros.append(f"{consultor or 'Consultor sem nome'}: login ou senha não cadastrados.")
            continue

        etapa = "inicio"
        slug = slug_coluna(consultor) or f"consultor_{idx}"
        saida = extracoes_base / slug
        downloads = downloads_base / slug

        def log_local(msg: str) -> None:
            nonlocal etapa
            etapa = msg
            if callable(log_fn):
                log_fn(f"{consultor}: {msg}")

        try:
            log_local("iniciando extração")
            executar(
                usuario=usuario,
                senha=senha,
                saida=str(saida),
                downloads=str(downloads),
                headless=headless,
                log_fn=log_local,
            )
            pedidos = saida / "Pedidos.xlsx"
            csv = saida / "Pedidos_bussola.csv"
            if pedidos.exists():
                df = pd.read_excel(pedidos, dtype=str)
            elif csv.exists():
                df = pd.read_csv(csv, sep=";", dtype=str, encoding="utf-8-sig")
            else:
                raise FileNotFoundError("arquivo Pedidos.xlsx/Pedidos_bussola.csv não encontrado após extração")
            df["consultor_extracao"] = consultor
            df["login_extracao"] = usuario
            frames.append(df)
            log_local(f"ok - {len(df)} linhas")
        except Exception as exc:
            erros.append(f"{consultor}: erro na etapa '{etapa}'. Detalhe: {exc}")
            if callable(log_fn):
                log_fn(erros[-1])

    if not frames:
        detalhe = "\n".join(erros) if erros else "Nenhuma base retornou linhas."
        raise RuntimeError(f"Nenhuma extração foi concluída.\n{detalhe}")

    combinado = pd.concat(frames, ignore_index=True)
    destino = DATA_DIR / "bussola.xlsx"
    _salvar_bussola_validada(combinado, destino, "Bússola consolidada", "Atualiza Bússola pelo painel")

    if erros and callable(log_fn):
        log_fn("Extração concluída com alertas:")
        for erro in erros:
            log_fn(erro)
    return destino


def extrair_bussola_web_historico_todos(
    credenciais: list[dict[str, str]],
    data_inicial,
    data_final,
    headless: bool = False,
    log_fn=None,
) -> Path:
    executar = _executar_extrator_bussola()

    if not credenciais:
        raise ValueError("Nenhuma credencial cadastrada para extrair histórico.")

    data_inicio_txt = pd.Timestamp(data_inicial).strftime("%d/%m/%Y")
    data_fim_txt = pd.Timestamp(data_final).strftime("%d/%m/%Y")
    downloads_base = Path(__file__).resolve().parents[1] / "downloads_bussola" / "historico"
    extracoes_base = DATA_DIR / "bussola_historico_extracoes"
    frames: list[pd.DataFrame] = []
    erros: list[str] = []

    for idx, item in enumerate(credenciais, start=1):
        consultor = str(item.get("consultor", "")).strip()
        usuario = str(item.get("usuario", "")).strip()
        senha = str(item.get("senha", "")).strip()
        if not consultor or not usuario or not senha:
            erros.append(f"{consultor or 'Consultor sem nome'}: login ou senha não cadastrados.")
            continue

        etapa = "inicio"
        slug = slug_coluna(consultor) or f"consultor_{idx}"
        saida = extracoes_base / slug
        downloads = downloads_base / slug

        def log_local(msg: str) -> None:
            nonlocal etapa
            etapa = msg
            if callable(log_fn):
                log_fn(f"{consultor}: {msg}")

        try:
            log_local(f"iniciando histórico {data_inicio_txt} até {data_fim_txt}")
            executar(
                usuario=usuario,
                senha=senha,
                saida=str(saida),
                downloads=str(downloads),
                headless=headless,
                log_fn=log_local,
                data_inicial=data_inicio_txt,
                data_final=data_fim_txt,
            )
            pedidos = saida / "Pedidos.xlsx"
            csv = saida / "Pedidos_bussola.csv"
            if pedidos.exists():
                df = pd.read_excel(pedidos, dtype=str)
            elif csv.exists():
                df = pd.read_csv(csv, sep=";", dtype=str, encoding="utf-8-sig")
            else:
                raise FileNotFoundError("arquivo Pedidos.xlsx/Pedidos_bussola.csv não encontrado após extração histórica")
            df["consultor_extracao"] = consultor
            df["login_extracao"] = usuario
            frames.append(df)
            log_local(f"ok - {len(df)} linhas")
        except Exception as exc:
            erros.append(f"{consultor}: erro na etapa '{etapa}'. Detalhe: {exc}")
            if callable(log_fn):
                log_fn(erros[-1])

    if not frames:
        detalhe = "\n".join(erros) if erros else "Nenhuma base histórica retornou linhas."
        raise RuntimeError(f"Nenhuma extração histórica foi concluída.\n{detalhe}")

    combinado = deduplicar_exportacao_bussola(pd.concat(frames, ignore_index=True))
    destino = DATA_DIR / "bussola_historico.xlsx"
    with pd.ExcelWriter(destino, engine="openpyxl") as writer:
        combinado.to_excel(writer, sheet_name="Pedidos", index=False)
    salvar_bytes("bussola_historico", destino.read_bytes(), "Atualiza histórico Bússola pelo painel")

    if erros and callable(log_fn):
        log_fn("Extração histórica concluída com alertas:")
        for erro in erros:
            log_fn(erro)
    return destino
