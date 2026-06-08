from __future__ import annotations

import pandas as pd
import streamlit as st

from src.datas import hoje_brasilia
from src.tratamento import STATUS_CANCELADO, STATUS_FATURADOS


def _opcoes(series: pd.Series) -> list[str]:
    if series is None or series.empty:
        return []
    valores = series.dropna().astype(str).str.strip()
    valores = valores[valores.ne("")]
    return sorted(valores.unique().tolist())


def _opcoes_consultores(clientes: pd.DataFrame, vendas: pd.DataFrame) -> list[str]:
    fontes: list[pd.Series] = []
    if "nome_rep" in clientes.columns:
        fontes.append(clientes["nome_rep"])
    if "consultor" in vendas.columns:
        fontes.append(vendas["consultor"])
    if not fontes:
        return []
    valores = pd.concat(fontes, ignore_index=True).dropna().astype(str).str.strip()
    valores = valores[valores.ne("")]
    valores = valores[~valores.str.contains(r"\s*/\s*", regex=True, na=False)]
    normalizados: dict[str, str] = {}
    for valor in valores:
        chave = " ".join(valor.upper().split())
        normalizados.setdefault(chave, valor)
    return [normalizados[chave] for chave in sorted(normalizados)]


def _meses_disponiveis(datas: pd.Series) -> list[str]:
    datas_validas = pd.to_datetime(datas, errors="coerce").dropna()
    if datas_validas.empty:
        return []
    periodos = datas_validas.dt.to_period("M").astype(str)
    return sorted(periodos.unique().tolist())


def _rotulo_mes(ano_mes: str) -> str:
    try:
        periodo = pd.Period(ano_mes, freq="M")
    except Exception:
        return str(ano_mes)
    return periodo.to_timestamp().strftime("%m/%Y")


def _limites_mes(ano_mes: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    periodo = pd.Period(ano_mes, freq="M")
    return periodo.start_time.normalize(), periodo.end_time.normalize()


def _datas_faturamento(vendas: pd.DataFrame) -> pd.Series:
    if vendas is None or vendas.empty or "data_de_faturamento" not in vendas.columns:
        indice = vendas.index if isinstance(vendas, pd.DataFrame) else None
        return pd.Series(pd.NaT, index=indice, dtype="datetime64[ns]")
    return pd.to_datetime(vendas["data_de_faturamento"], errors="coerce")


def filtrar_periodo_faturamento(
    vendas: pd.DataFrame,
    inicio: object,
    fim: object,
    apenas_faturados: bool = True,
) -> pd.DataFrame:
    if vendas is None or vendas.empty:
        return vendas.copy() if vendas is not None else pd.DataFrame()

    base = vendas.copy()
    inicio_ts = pd.Timestamp(inicio).normalize()
    fim_ts = pd.Timestamp(fim).normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    datas = _datas_faturamento(base)
    filtrada = base[(datas >= inicio_ts) & (datas <= fim_ts)].copy()

    if apenas_faturados and "status_normalizado" in filtrada.columns:
        filtrada = filtrada[filtrada["status_normalizado"].isin(STATUS_FATURADOS)].copy()
    return filtrada


def _aplicar_filtro_status(vendas: pd.DataFrame, modo: str, status_sel: list[str] | None = None) -> pd.DataFrame:
    if vendas.empty or "status_normalizado" not in vendas.columns:
        return vendas.copy()
    status_sel = status_sel or []
    if modo == "Apenas faturados":
        return vendas[vendas["status_normalizado"].isin(STATUS_FATURADOS)].copy()
    if modo == "Todos exceto cancelados":
        return vendas[vendas["status_normalizado"].ne(STATUS_CANCELADO)].copy()
    if status_sel:
        return vendas[vendas["status_normalizado"].isin(status_sel)].copy()
    return vendas.copy()


def filtrar_busca(df: pd.DataFrame, termo: str, colunas: list[str] | None = None) -> pd.DataFrame:
    if df.empty or not termo:
        return df
    termo_norm = termo.strip().lower()
    colunas_busca = colunas or df.select_dtypes(include="object").columns.tolist()
    mascara = pd.Series(False, index=df.index)
    for coluna in colunas_busca:
        if coluna in df.columns:
            mascara = mascara | df[coluna].astype(str).str.lower().str.contains(termo_norm, na=False, regex=False)
    return df[mascara].copy()


def filtrar_vendas_operacionais(
    vendas: pd.DataFrame,
    clientes_filtrados: pd.DataFrame,
    filtros: dict[str, object],
    aplicar_status: bool = False,
) -> pd.DataFrame:
    if vendas.empty:
        return vendas.copy()
    inicio = pd.Timestamp(filtros.get("inicio")).normalize()
    fim = pd.Timestamp(filtros.get("fim")).normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    base = vendas.copy()

    data_faturamento = _datas_faturamento(base)
    fallback_data_pedido = pd.Series(pd.NaT, index=base.index)
    data_pedido = pd.to_datetime(
        base["data_base"] if "data_base" in base.columns else base.get("data_do_pedido", fallback_data_pedido),
        errors="coerce",
    )
    status = (
        base["status_normalizado"].fillna("").astype(str)
        if "status_normalizado" in base.columns
        else pd.Series("", index=base.index)
    )
    if "pedido_sem_nota" in base.columns:
        pedido_sem_nota = base["pedido_sem_nota"].fillna(False).astype(bool)
    else:
        nota_vazia = (
            base["nota_fiscal"].fillna("").astype(str).str.strip().eq("")
            if "nota_fiscal" in base.columns
            else pd.Series(False, index=base.index)
        )
        pedido_sem_nota = nota_vazia & status.ne(STATUS_CANCELADO)
    usar_data_pedido = pedido_sem_nota | status.eq(STATUS_CANCELADO) | data_faturamento.isna()
    datas_operacionais = data_faturamento.where(~usar_data_pedido, data_pedido)
    base = base[(datas_operacionais >= inicio) & (datas_operacionais <= fim)].copy()

    if aplicar_status:
        base = _aplicar_filtro_status(base, str(filtros.get("status_modo") or ""), filtros.get("status") or [])

    for coluna_filtro, coluna_base in [
        ("distribuidora", "distribuidora"),
        ("uf", "uf"),
        ("cidade", "cidade"),
        ("grupo_sip", "grupo_sip"),
        ("tipo_mix", "tipo_mix"),
    ]:
        valores = filtros.get(coluna_filtro) or []
        if valores:
            base = base[base[coluna_base].isin(valores)].copy()

    consultores = filtros.get("consultor") or []
    if consultores:
        base = base[base["consultor"].isin(consultores)].copy()

    if filtros.get("restringir_por_clientes") and clientes_filtrados is not None:
        cnpjs = set(clientes_filtrados["cnpj_limpo"].dropna().astype(str))
        base = base[base["cnpj_limpo"].astype(str).isin(cnpjs)].copy()

    return base


def aplicar_filtros_globais(
    vendas: pd.DataFrame,
    clientes: pd.DataFrame,
    chave: str = "global",
    mostrar_tipo_mix: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    vendas_filtradas = vendas.copy()
    clientes_filtrados = clientes.copy()

    datas = _datas_faturamento(vendas_filtradas)
    data_min = datas.min()
    data_max = datas.max()
    hoje_data = hoje_brasilia()
    hoje = pd.Timestamp(hoje_data)
    inicio_mes_atual = pd.Timestamp(hoje_data.replace(day=1))
    if pd.isna(data_min) or pd.isna(data_max):
        data_min = inicio_mes_atual
        data_max = hoje

    meses_base = _meses_disponiveis(datas)
    mes_atual = hoje.to_period("M").strftime("%Y-%m")
    meses_opcoes = sorted(set(meses_base + [mes_atual]))
    mes_padrao = mes_atual
    indice_mes = meses_opcoes.index(mes_padrao) if mes_padrao in meses_opcoes else 0

    with st.sidebar.expander("Filtros comerciais", expanded=False):
        mes_referencia = st.radio(
            "Mês",
            meses_opcoes,
            index=indice_mes,
            format_func=_rotulo_mes,
            horizontal=False,
            key=f"{chave}_mes_referencia",
        )
        inicio_mes, fim_mes = _limites_mes(mes_referencia)
        inicio = inicio_mes
        fim = fim_mes
        st.caption(f"Período: {inicio.strftime('%d/%m/%Y')} até {fim.strftime('%d/%m/%Y')}")

        consultores = _opcoes_consultores(clientes_filtrados, vendas_filtradas)
        consultor_sel = st.multiselect("Consultor", consultores, key=f"{chave}_consultor")

        distribuidoras = _opcoes(vendas_filtradas.get("distribuidora", pd.Series(dtype=str)))
        distribuidora_sel = st.multiselect("Distribuidora", distribuidoras, key=f"{chave}_distribuidora")

        ufs = _opcoes(
            pd.concat(
                [clientes_filtrados.get("uf", pd.Series(dtype=str)), vendas_filtradas.get("uf", pd.Series(dtype=str))],
                ignore_index=True,
            )
        )
        uf_sel = st.multiselect("UF", ufs, key=f"{chave}_uf")

        cidades = _opcoes(clientes_filtrados.get("cidade", pd.Series(dtype=str)))
        cidade_sel = st.multiselect("Cidade", cidades, key=f"{chave}_cidade")

        grupos = _opcoes(clientes_filtrados.get("grupo_sip", pd.Series(dtype=str)))
        grupo_sel = st.multiselect("Redes", grupos, key=f"{chave}_grupo")

        status_modo = st.radio(
            "Status do pedido",
            ["Apenas faturados", "Todos exceto cancelados", "Selecionar status"],
            index=0,
            key=f"{chave}_status_modo",
        )
        status_sel: list[str] = []
        if status_modo == "Selecionar status":
            status_opcoes = _opcoes(vendas_filtradas.get("status_normalizado", pd.Series(dtype=str)))
            status_sel = st.multiselect("Escolha os status", status_opcoes, default=STATUS_FATURADOS, key=f"{chave}_status_sel")

        tipo_mix_sel: list[str] = []
        if mostrar_tipo_mix:
            tipos = _opcoes(vendas_filtradas.get("tipo_mix", pd.Series(dtype=str)))
            tipo_mix_sel = st.multiselect("Tipo de mix", tipos, key=f"{chave}_tipo_mix")

    vendas_filtradas = filtrar_periodo_faturamento(vendas_filtradas, inicio, fim, apenas_faturados=False)
    vendas_filtradas = _aplicar_filtro_status(vendas_filtradas, status_modo, status_sel)

    if consultor_sel:
        clientes_filtrados = clientes_filtrados[clientes_filtrados["nome_rep"].isin(consultor_sel)].copy()
        vendas_filtradas = vendas_filtradas[vendas_filtradas["consultor"].isin(consultor_sel)].copy()
    if distribuidora_sel:
        vendas_filtradas = vendas_filtradas[vendas_filtradas["distribuidora"].isin(distribuidora_sel)].copy()
    if uf_sel:
        clientes_filtrados = clientes_filtrados[clientes_filtrados["uf"].isin(uf_sel)].copy()
        vendas_filtradas = vendas_filtradas[vendas_filtradas["uf"].isin(uf_sel)].copy()
    if cidade_sel:
        clientes_filtrados = clientes_filtrados[clientes_filtrados["cidade"].isin(cidade_sel)].copy()
        vendas_filtradas = vendas_filtradas[vendas_filtradas["cidade"].isin(cidade_sel)].copy()
    if grupo_sel:
        clientes_filtrados = clientes_filtrados[clientes_filtrados["grupo_sip"].isin(grupo_sel)].copy()
        vendas_filtradas = vendas_filtradas[vendas_filtradas["grupo_sip"].isin(grupo_sel)].copy()
    if tipo_mix_sel:
        vendas_filtradas = vendas_filtradas[vendas_filtradas["tipo_mix"].isin(tipo_mix_sel)].copy()

    restringir_por_clientes = bool(consultor_sel or uf_sel or cidade_sel or grupo_sel)
    cnpjs_permitidos = set(clientes_filtrados["cnpj_limpo"].dropna().astype(str))
    if restringir_por_clientes:
        vendas_filtradas = vendas_filtradas[vendas_filtradas["cnpj_limpo"].isin(cnpjs_permitidos)].copy()

    filtros = {
        "inicio": inicio,
        "fim": fim,
        "consultor": consultor_sel,
        "distribuidora": distribuidora_sel,
        "uf": uf_sel,
        "cidade": cidade_sel,
        "grupo_sip": grupo_sel,
        "status_modo": status_modo,
        "status": status_sel,
        "tipo_mix": tipo_mix_sel,
        "restringir_por_clientes": restringir_por_clientes,
        "mes_referencia": mes_referencia,
        "periodo_mes_completo": inicio.normalize() == inicio_mes and fim.normalize() == fim_mes,
        "usar_metas_historicas": pd.Period(mes_referencia, freq="M") < hoje.to_period("M"),
    }
    return vendas_filtradas, clientes_filtrados, filtros
