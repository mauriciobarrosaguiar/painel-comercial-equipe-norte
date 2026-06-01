from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.loader import DATA_DIR
from src.persistencia import salvar_bytes
from src.tratamento import deduplicar_exportacao_bussola, slug_coluna


def _executar_extrator_bussola():
    import importlib

    import bussola_extrator

    modulo = importlib.reload(bussola_extrator)
    return modulo.executar


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
        df = deduplicar_exportacao_bussola(df)
        with pd.ExcelWriter(destino, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Pedidos", index=False)
    if not destino.exists():
        raise FileNotFoundError("A extração terminou, mas não encontrei data/bussola.xlsx.")
    salvar_bytes("bussola", destino.read_bytes(), "Atualiza Bússola pelo painel")
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

    combinado = deduplicar_exportacao_bussola(pd.concat(frames, ignore_index=True))
    destino = DATA_DIR / "bussola.xlsx"
    with pd.ExcelWriter(destino, engine="openpyxl") as writer:
        combinado.to_excel(writer, sheet_name="Pedidos", index=False)
    salvar_bytes("bussola", destino.read_bytes(), "Atualiza Bússola pelo painel")

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
