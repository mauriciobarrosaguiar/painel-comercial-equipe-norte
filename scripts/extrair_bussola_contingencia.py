from __future__ import annotations

import json
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
VISIBILIDADE_KEY = "bussola_visibilidade_contingencia"


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


def _consultores_para_contingencia(
    configuracao: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    configurados = _consultores_configurados(configuracao)
    esperados = [
        dict(item)
        for item in (configuracao.get("consultores_esperados") or [])
        if isinstance(item, dict) and texto(item.get("id"))
    ]
    if not configurados:
        raise RuntimeError(
            "A GD não trouxe dados do mês atual e nenhum consultor cadastrou o acesso de contingência."
        )

    por_id = {
        texto(item.get("consultor_id")): item
        for item in configurados
        if texto(item.get("consultor_id"))
    }
    ordenados = [
        por_id[texto(item.get("id"))]
        for item in esperados
        if texto(item.get("id")) in por_id
    ]
    ids_ordenados = {texto(item.get("consultor_id")) for item in ordenados}
    ordenados.extend(
        item
        for item in configurados
        if texto(item.get("consultor_id")) not in ids_ordenados
    )
    faltantes = [
        item
        for item in esperados
        if texto(item.get("id")) not in por_id
    ]
    return ordenados, esperados, faltantes


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
                    "consultores_ids": [],
                    "faltantes": [],
                    "falhas": [],
                    "completa": True,
                    "visibilidade": "equipe",
                }
            motivo_contingencia = "A planilha da GD não contém dados do mês atual."
            print(f"Bússola: {motivo_contingencia} Iniciando contingência.")
        except Exception as exc:
            motivo_contingencia = f"A extração da GD falhou: {exc}"
            print(f"Bússola: {motivo_contingencia} Iniciando contingência.")

    consultores, esperados, faltantes_credencial = _consultores_para_contingencia(configuracao)
    bases: list[pd.DataFrame] = []
    nomes: list[str] = []
    ids_extraidos: list[str] = []
    falhas: list[str] = []
    sem_dados_mes: list[str] = []

    for consultor in consultores:
        consultor_id = texto(consultor.get("consultor_id"))
        nome = texto(consultor.get("nome")) or consultor_id or "Consultor"
        print(f"Bússola: extraindo contingência de {nome}.")
        try:
            base = extrair_fn(
                texto(consultor.get("usuario")),
                texto(consultor.get("segredo")),
            )
        except Exception as exc:
            falhas.append(f"{nome}: {exc}")
            print(f"Bússola: falha no acesso de {nome}; os demais continuarão. Erro: {exc}")
            continue

        if not tem_dados_mes_atual(base, agora=agora):
            sem_dados_mes.append(nome)
            print(f"Bússola: {nome} não trouxe dados do mês atual e não será publicado neste ciclo.")
            continue

        base = base.copy()
        base["_credencial_origem"] = nome
        base["_consultor_contingencia_id"] = consultor_id
        bases.append(base)
        nomes.append(nome)
        if consultor_id:
            ids_extraidos.append(consultor_id)

    if not bases:
        detalhes = "; ".join(falhas + [f"{nome}: sem dados do mês atual" for nome in sem_dados_mes])
        complemento = f" Detalhes: {detalhes}." if detalhes else ""
        raise RuntimeError(
            "Nenhum acesso individual trouxe dados válidos do mês atual. A base anterior foi preservada."
            + complemento
        )

    consolidada = pd.concat(bases, ignore_index=True, sort=False)
    if consolidada.empty:
        raise RuntimeError(
            "As extrações individuais terminaram sem registros. A base anterior foi preservada."
        )

    ids_esperados = {texto(item.get("id")) for item in esperados if texto(item.get("id"))}
    ids_publicados = set(ids_extraidos)
    completa = bool(ids_esperados) and not faltantes_credencial and not falhas and not sem_dados_mes
    completa = completa and ids_esperados.issubset(ids_publicados)
    modo = "consultores" if completa else "consultores_parcial"
    visibilidade = "equipe" if completa else "individual"
    faltantes = [texto(item.get("nome")) or texto(item.get("id")) for item in faltantes_credencial]
    faltantes.extend(sem_dados_mes)

    print(
        f"Bússola: contingência {'completa' if completa else 'parcial'} com {len(nomes)} "
        f"consultores e {len(consolidada)} linhas antes da deduplicação."
    )
    return consolidada, modo, {
        "motivo": motivo_contingencia,
        "consultores_extraidos": len(nomes),
        "consultores_ids": ids_extraidos,
        "nomes": nomes,
        "faltantes": faltantes,
        "falhas": falhas,
        "completa": completa,
        "visibilidade": visibilidade,
        "consultores_esperados": len(ids_esperados),
    }


def _atualizar_consultor_dos_pedidos(
    legacy: Any,
    database_id: str,
    pedido_consultor: dict[str, str],
) -> None:
    por_consultor: dict[str, list[str]] = {}
    for pedido_id, consultor_id in pedido_consultor.items():
        if pedido_id and consultor_id:
            por_consultor.setdefault(consultor_id, []).append(pedido_id)

    for consultor_id, pedidos in por_consultor.items():
        for inicio in range(0, len(pedidos), 90):
            bloco = pedidos[inicio : inicio + 90]
            placeholders = ",".join("?" for _ in bloco)
            legacy.executar(
                database_id,
                f"UPDATE pedidos SET consultor_id=? WHERE ativo=1 AND origem='BUSSOLA' AND id IN ({placeholders})",
                [consultor_id, *bloco],
            )


def _registrar_visibilidade(
    legacy: Any,
    database_id: str,
    resultado: dict[str, Any],
) -> None:
    timestamp = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()
    modo = texto(resultado.get("visibilidade")) or "equipe"
    ids = sorted({texto(item) for item in (resultado.get("consultores_ids") or []) if texto(item)})
    payload = {
        "modo": modo,
        "fonte": texto(resultado.get("modo")) or "gd",
        "completa": bool(resultado.get("completa", modo == "equipe")),
        "consultores_ids": ids,
        "consultores_extraidos": int(resultado.get("consultores_extraidos") or 0),
        "consultores_esperados": int(resultado.get("consultores_esperados") or 0),
        "nomes": resultado.get("nomes") or [],
        "faltantes": resultado.get("faltantes") or [],
        "falhas": resultado.get("falhas") or [],
        "motivo": texto(resultado.get("motivo")),
        "atualizado_em": timestamp,
    }
    legacy.executar(
        database_id,
        """
        INSERT INTO configuracoes (chave,valor_json,atualizado_em)
        VALUES (?,?,?)
        ON CONFLICT(chave) DO UPDATE SET
          valor_json=excluded.valor_json,atualizado_em=excluded.atualizado_em
        """,
        [VISIBILIDADE_KEY, json.dumps(payload, ensure_ascii=False), timestamp],
    )

    if modo == "individual":
        total = payload["consultores_esperados"]
        publicados = payload["consultores_extraidos"]
        mensagem = (
            f"Contingência parcial: {publicados}/{total or '?'} consultores publicados. "
            "Cada consultor visualiza somente os próprios dados até a cobertura ficar completa."
        )
        status = "contingencia_parcial"
    elif payload["fonte"] == "consultores":
        mensagem = "Contingência completa: todos os consultores foram consolidados na visão da equipe."
        status = "conectada"
    else:
        mensagem = "Conexão validada pelo acesso principal da GD com dados do mês atual."
        status = "conectada"

    legacy.executar(
        database_id,
        "UPDATE integracao_credenciais SET status=?,mensagem_status=?,testado_em=? WHERE integracao='BUSSOLA'",
        [status, mensagem, timestamp],
    )


def sincronizar() -> None:
    from scripts import extrair_bussola_d1 as legacy
    from scripts import extrair_bussola_d1_corrigido as sincronizador

    configuracao = obter_configuracao_credenciais()
    extrair_original = legacy.extrair_base
    resultado: dict[str, Any] = {}
    pedido_consultor: dict[str, str] = {}

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
        try:
            base, modo, detalhes = extrair_com_contingencia(
                configuracao,
                extrair_original,
            )
        except Exception as exc:
            resultado.update({
                "modo": "consultores_parcial",
                "visibilidade": "individual",
                "completa": False,
                "consultores_ids": [],
                "consultores_extraidos": 0,
                "consultores_esperados": len(configuracao.get("consultores_esperados") or []),
                "faltantes": [],
                "falhas": [str(exc)],
                "motivo": str(exc),
            })
            raise
        resultado.update({"modo": modo, **detalhes})
        if modo.startswith("consultores"):
            for _, linha in base.iterrows():
                consultor_id = texto(linha.get("_consultor_contingencia_id"))
                pedido_origem = legacy.texto(linha.get("pedido_id"))
                nota_fiscal = legacy.texto(linha.get("nota_fiscal"))
                if consultor_id and pedido_origem:
                    pedido_id = legacy.id_estavel("ped", pedido_origem, nota_fiscal)
                    pedido_consultor[pedido_id] = consultor_id
        return base

    legacy.obter_credenciais = credenciais_principais
    legacy.extrair_base = extrair_base_validada
    try:
        sincronizador.sincronizar()
    except Exception:
        if resultado.get("visibilidade"):
            database_id = legacy.localizar_database_id()
            _registrar_visibilidade(legacy, database_id, resultado)
        raise

    database_id = legacy.localizar_database_id()
    if pedido_consultor:
        _atualizar_consultor_dos_pedidos(legacy, database_id, pedido_consultor)
    _registrar_visibilidade(legacy, database_id, resultado)

    if resultado.get("modo") == "consultores_parcial":
        print(
            "Bússola sincronizado em contingência parcial. Cada consultor publicado "
            "visualiza somente a própria carteira até todos concluírem o cadastro."
        )
    elif resultado.get("modo") == "consultores":
        print("Bússola sincronizado pela contingência completa dos consultores.")
    else:
        print("Bússola sincronizado pelo acesso principal da GD.")


if __name__ == "__main__":
    sincronizar()
