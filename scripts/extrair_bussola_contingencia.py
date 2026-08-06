from __future__ import annotations

import os
import time
from collections.abc import Callable
from typing import Any

import pandas as pd
import requests

PAINEL_BASE_URL = os.environ.get(
    "PAINEL_BASE_URL",
    "https://painel-equipe-norte.pages.dev",
).rstrip("/")


def texto(valor: Any) -> str:
    return str(valor or "").strip()


def credencial_completa(item: dict[str, Any] | None) -> bool:
    return bool(texto((item or {}).get("usuario")) and texto((item or {}).get("segredo")))


def obter_configuracao_credenciais() -> dict[str, Any]:
    admin_key = texto(os.environ.get("PAINEL_ADMIN_KEY"))
    if not admin_key:
        raise RuntimeError("Variável obrigatória ausente: PAINEL_ADMIN_KEY")

    url = f"{PAINEL_BASE_URL}/api/internal/bussola"
    ultimo_erro = ""
    for tentativa in range(1, 7):
        resposta = requests.get(
            url,
            headers={"x-admin-key": admin_key, "accept": "application/json"},
            timeout=45,
        )
        if resposta.status_code >= 500:
            ultimo_erro = f"HTTP {resposta.status_code}: {resposta.text[:300]}"
            time.sleep(min(tentativa * 10, 30))
            continue
        try:
            dados = resposta.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Resposta inválida da API interna: HTTP {resposta.status_code}"
            ) from exc
        if not resposta.ok:
            raise RuntimeError(
                dados.get("erro") or f"Falha ao buscar credenciais: HTTP {resposta.status_code}"
            )
        return dados
    raise RuntimeError(f"A API interna não ficou disponível: {ultimo_erro}")


def _datas_coluna(base: pd.DataFrame, coluna: str) -> pd.Series:
    if coluna not in base.columns:
        return pd.Series(pd.NaT, index=base.index, dtype="datetime64[ns]")
    valores = base[coluna]
    datas = pd.to_datetime(valores, errors="coerce", dayfirst=True)
    sem_data = datas.isna() & valores.notna()
    if sem_data.any():
        datas.loc[sem_data] = pd.to_datetime(
            valores.loc[sem_data], errors="coerce", dayfirst=False
        )
    if getattr(datas.dt, "tz", None) is not None:
        datas = datas.dt.tz_convert("America/Sao_Paulo").dt.tz_localize(None)
    return datas


def tem_dados_mes_atual(
    base: pd.DataFrame,
    agora: pd.Timestamp | None = None,
) -> bool:
    if base is None or base.empty:
        return False
    referencia = agora or pd.Timestamp.now(tz="America/Sao_Paulo")
    if referencia.tzinfo is not None:
        referencia = referencia.tz_convert("America/Sao_Paulo").tz_localize(None)
    periodo = referencia.to_period("M")

    for coluna in ("data_de_faturamento", "data_do_pedido"):
        datas = _datas_coluna(base, coluna)
        if datas.notna().any() and datas.dt.to_period("M").eq(periodo).any():
            return True
    return False


def _consultores_configurados(configuracao: dict[str, Any]) -> list[dict[str, Any]]:
    consultores = configuracao.get("consultores") or []
    if isinstance(consultores, dict):
        consultores = list(consultores.values())
    return [
        dict(item)
        for item in consultores
        if isinstance(item, dict) and credencial_completa(item)
    ]


def _consultores_para_contingencia(configuracao: dict[str, Any]) -> list[dict[str, Any]]:
    configurados = _consultores_configurados(configuracao)
    esperados = configuracao.get("consultores_esperados") or []
    if not esperados:
        if not configurados:
            raise RuntimeError(
                "A GD não trouxe dados do mês atual e nenhum consultor cadastrou o acesso de contingência."
            )
        return configurados

    por_id = {
        texto(item.get("consultor_id")): item
        for item in configurados
        if texto(item.get("consultor_id"))
    }
    faltantes = [
        texto(item.get("nome")) or texto(item.get("id"))
        for item in esperados
        if texto(item.get("id")) not in por_id
    ]
    if faltantes:
        raise RuntimeError(
            "A GD não trouxe dados do mês atual. A base anterior foi preservada porque "
            "a contingência ainda está incompleta. Faltam os acessos de: "
            + ", ".join(faltantes)
        )

    return [
        por_id[texto(item.get("id"))]
        for item in esperados
        if texto(item.get("id")) in por_id
    ]


def extrair_com_contingencia(
    configuracao: dict[str, Any],
    extrair_fn: Callable[[str, str], pd.DataFrame],
    agora: pd.Timestamp | None = None,
) -> tuple[pd.DataFrame, str, dict[str, Any]]:
    gd = configuracao.get("gd") or {
        "usuario": configuracao.get("usuario"),
        "segredo": configuracao.get("segredo"),
    }
    motivo_contingencia = "Acesso principal da GD não configurado."

    if credencial_completa(gd):
        try:
            print("Bússola: tentando primeiro o acesso principal da GD.")
            base_gd = extrair_fn(texto(gd.get("usuario")), texto(gd.get("segredo")))
            if tem_dados_mes_atual(base_gd, agora=agora):
                print("Bússola: a GD trouxe dados do mês atual; contingência não necessária.")
                return base_gd, "gd", {
                    "motivo": "GD com dados do mês atual",
                    "consultores_extraidos": 0,
                }
            motivo_contingencia = "A planilha da GD não contém dados do mês atual."
            print(f"Bússola: {motivo_contingencia} Iniciando contingência.")
        except Exception as exc:
            motivo_contingencia = f"A extração da GD falhou: {exc}"
            print(f"Bússola: {motivo_contingencia} Iniciando contingência.")

    consultores = _consultores_para_contingencia(configuracao)
    bases: list[pd.DataFrame] = []
    nomes: list[str] = []

    for consultor in consultores:
        nome = texto(consultor.get("nome")) or texto(consultor.get("consultor_id")) or "Consultor"
        print(f"Bússola: extraindo contingência de {nome}.")
        try:
            base = extrair_fn(
                texto(consultor.get("usuario")),
                texto(consultor.get("segredo")),
            )
        except Exception as exc:
            raise RuntimeError(
                f"A contingência foi interrompida no acesso de {nome}: {exc}. "
                "A base anterior foi preservada."
            ) from exc
        base = base.copy()
        base["_credencial_origem"] = nome
        bases.append(base)
        nomes.append(nome)

    if not bases:
        raise RuntimeError(
            "A contingência não encontrou nenhum acesso individual válido. A base anterior foi preservada."
        )

    consolidada = pd.concat(bases, ignore_index=True, sort=False)
    if consolidada.empty:
        raise RuntimeError(
            "As extrações individuais terminaram sem registros. A base anterior foi preservada."
        )
    if not tem_dados_mes_atual(consolidada, agora=agora):
        raise RuntimeError(
            "A GD e os acessos individuais não trouxeram dados do mês atual. "
            "A base anterior foi preservada."
        )

    print(
        f"Bússola: contingência concluída com {len(nomes)} consultores e "
        f"{len(consolidada)} linhas antes da deduplicação."
    )
    return consolidada, "consultores", {
        "motivo": motivo_contingencia,
        "consultores_extraidos": len(nomes),
        "nomes": nomes,
    }


def sincronizar() -> None:
    from scripts import extrair_bussola_d1 as legacy
    from scripts import extrair_bussola_d1_corrigido as sincronizador

    configuracao = obter_configuracao_credenciais()
    extrair_original = legacy.extrair_base
    resultado: dict[str, Any] = {}

    def credenciais_principais() -> tuple[str, str]:
        gd = configuracao.get("gd") or {
            "usuario": configuracao.get("usuario"),
            "segredo": configuracao.get("segredo"),
        }
        if credencial_completa(gd):
            return texto(gd.get("usuario")), texto(gd.get("segredo"))
        consultores = _consultores_configurados(configuracao)
        if consultores:
            return texto(consultores[0].get("usuario")), texto(consultores[0].get("segredo"))
        raise RuntimeError("Nenhuma credencial válida do Bússola está cadastrada.")

    def extrair_base_validada(_usuario: str, _segredo: str) -> pd.DataFrame:
        base, modo, detalhes = extrair_com_contingencia(
            configuracao,
            extrair_original,
        )
        resultado.update({"modo": modo, **detalhes})
        return base

    legacy.obter_credenciais = credenciais_principais
    legacy.extrair_base = extrair_base_validada
    sincronizador.sincronizar()

    if resultado.get("modo") == "consultores":
        print(
            "Bússola sincronizado pelo modo de contingência. "
            f"Motivo: {resultado.get('motivo', '')}"
        )
    else:
        print("Bússola sincronizado pelo acesso principal da GD.")


if __name__ == "__main__":
    sincronizar()
