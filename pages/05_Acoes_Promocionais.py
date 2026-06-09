from __future__ import annotations

from html import escape
from io import BytesIO
import json

import pandas as pd
import streamlit as st

from src.acoes import analisar_acoes_promocionais
from src.calculos import formatar_tabela_metricas
from src.datas import hoje_brasilia
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.persistencia import salvar_bytes
from src.tratamento import (
    COLUNAS_ACOES,
    TIPO_SEM_CLASSIFICACAO,
    formatar_moeda,
    formatar_percentual,
    normalizar_ean,
)


def _consultores_disponiveis(clientes: pd.DataFrame, vendas: pd.DataFrame) -> list[str]:
    fontes: list[pd.Series] = []
    if clientes is not None and not clientes.empty and "nome_rep" in clientes.columns:
        fontes.append(clientes["nome_rep"])
    if vendas is not None and not vendas.empty and "consultor" in vendas.columns:
        fontes.append(vendas["consultor"])
    if not fontes:
        return []
    base = pd.concat(fontes, ignore_index=True).dropna().astype(str).str.strip()
    return sorted({nome for nome in base if nome})


def _catalogo_produtos(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    fontes: list[pd.DataFrame] = []
    if produtos_mix is not None and not produtos_mix.empty:
        mix = produtos_mix.copy()
        if "ean_limpo" not in mix.columns and "ean" in mix.columns:
            mix["ean_limpo"] = mix["ean"].astype(str)
        fontes.append(mix[["ean_limpo", "produto", "tipo_mix"]])
    if vendas is not None and not vendas.empty:
        fontes.append(vendas[["ean_limpo", "produto", "tipo_mix"]])
    if not fontes:
        return pd.DataFrame(columns=["label", "ean", "produto", "tipo_mix"])

    base = pd.concat(fontes, ignore_index=True).fillna("")
    base["ean"] = base["ean_limpo"].astype(str).str.strip()
    base["produto"] = base["produto"].astype(str).str.strip()
    base["tipo_mix"] = base["tipo_mix"].astype(str).str.strip().replace("", TIPO_SEM_CLASSIFICACAO)
    base = base[base["ean"].ne("")].drop_duplicates("ean", keep="first")
    base["label"] = base.apply(
        lambda linha: f"{linha['produto'] or 'Produto sem nome'} | {linha['ean']}",
        axis=1,
    )
    return base.sort_values(["produto", "ean"]).reset_index(drop=True)


def _metas_consultores_json(tabela: pd.DataFrame) -> str:
    if tabela is None or tabela.empty:
        return ""
    base = tabela.copy()
    base["ativo"] = base["ativo"].fillna(False).astype(bool)
    base = base[base["ativo"]].copy()
    if base.empty:
        return ""
    registros = []
    for _, linha in base.iterrows():
        registros.append(
            {
                "consultor": str(linha.get("consultor", "")).strip(),
                "ativo": True,
                "meta_unidades": float(linha.get("meta_unidades", 0) or 0),
                "meta_cnpjs": float(linha.get("meta_cnpjs", 0) or 0),
            }
        )
    return json.dumps(registros, ensure_ascii=False)


def _salvar_acoes(df: pd.DataFrame) -> None:
    base = df.copy()
    for coluna in COLUNAS_ACOES:
        if coluna not in base.columns:
            base[coluna] = ""
    saida = BytesIO()
    with pd.ExcelWriter(saida, engine="openpyxl") as writer:
        base[COLUNAS_ACOES].to_excel(writer, index=False, sheet_name="Foco Semanal")
    salvar_bytes("acoes", saida.getvalue(), "Atualiza foco semanal pelo painel")
    st.cache_data.clear()


def _linhas_foco(
    nome: str,
    data_inicio,
    data_fim,
    produtos: pd.DataFrame,
    eans_extra: list[str],
    meta_unidades: float,
    meta_cnpjs: float,
    tipo_meta: str,
    escopo_meta: str,
    meta_consultores: str,
) -> pd.DataFrame:
    linhas: list[dict[str, object]] = []
    for _, produto in produtos.iterrows():
        linhas.append(
            {
                "campanha": nome,
                "produto": produto.get("produto", ""),
                "ean": produto.get("ean", ""),
                "tipo_mix": produto.get("tipo_mix", TIPO_SEM_CLASSIFICACAO),
                "distribuidora": "",
                "desconto": 0,
                "data_inicio": data_inicio,
                "data_fim": data_fim,
                "consultor": "",
                "observacao": "",
                "status": "ATIVA",
                "meta_unidades": meta_unidades,
                "meta_cnpjs": meta_cnpjs,
                "tipo_meta_unidades": tipo_meta,
                "escopo_meta": escopo_meta,
                "meta_consultores": meta_consultores,
            }
        )
    for ean in eans_extra:
        linhas.append(
            {
                "campanha": nome,
                "produto": "",
                "ean": ean,
                "tipo_mix": TIPO_SEM_CLASSIFICACAO,
                "distribuidora": "",
                "desconto": 0,
                "data_inicio": data_inicio,
                "data_fim": data_fim,
                "consultor": "",
                "observacao": "",
                "status": "ATIVA",
                "meta_unidades": meta_unidades,
                "meta_cnpjs": meta_cnpjs,
                "tipo_meta_unidades": tipo_meta,
                "escopo_meta": escopo_meta,
                "meta_consultores": meta_consultores,
            }
        )
    return pd.DataFrame(linhas, columns=COLUNAS_ACOES)


def _formatar_data_card(valor: object) -> str:
    data = pd.to_datetime(valor, errors="coerce")
    return "-" if pd.isna(data) else data.strftime("%d/%m/%Y")


def _numero_card(valor: object) -> str:
    try:
        numero = float(valor or 0)
    except (TypeError, ValueError):
        numero = 0.0
    if abs(numero - round(numero)) < 0.001:
        return f"{int(round(numero))}"
    return f"{numero:.1f}".replace(".", ",")


def _status_classe(status: object) -> str:
    texto = str(status or "").upper()
    if "BATIDA" in texto:
        return "status-good"
    if "ANDAMENTO" in texto:
        return "status-warn"
    return "status-bad" if "SEM META" not in texto else "status-warn"


def _texto_qtd(acao: pd.Series) -> tuple[str, str]:
    meta = float(acao.get("meta_unidades", 0) or 0)
    if meta <= 0:
        return _numero_card(acao.get("quantidade_vendida", 0)), "Sem meta de unidades"
    if str(acao.get("tipo_meta_unidades", "")).upper() == "POR_PRODUTO":
        valor = f"{_numero_card(acao.get('quantidade_meta_base', 0))}/{_numero_card(meta)}"
        nota = f"{int(acao.get('produtos_batidos', 0) or 0)}/{int(acao.get('produtos_meta', 0) or 0)} produtos batidos"
        return valor, nota
    return f"{_numero_card(acao.get('quantidade_vendida', 0))}/{_numero_card(meta)}", "Produtos somados"


def _desenhar_cards(analise: pd.DataFrame) -> None:
    for fatia in [analise.iloc[i : i + 2] for i in range(0, len(analise), 2)]:
        cols = st.columns(2)
        for col, (_, acao) in zip(cols, fatia.iterrows()):
            qtd_txt, qtd_nota = _texto_qtd(acao)
            meta_cnpjs = float(acao.get("meta_cnpjs", 0) or 0)
            cnpj_txt = (
                f"{_numero_card(acao.get('cnpjs_positivados', 0))}/{_numero_card(meta_cnpjs)}"
                if meta_cnpjs > 0
                else _numero_card(acao.get("cnpjs_positivados", 0))
            )
            status = str(acao.get("status_meta", ""))
            with col:
                st.markdown(
                    f"""
                    <div class="consultor-card">
                        <div class="consultor-name">{escape(str(acao['campanha'] or 'Foco semanal'))}</div>
                        <div class="contact-line"><b>Produtos:</b> {escape(str(acao['produto'] or '-'))}</div>
                        <div class="contact-line"><b>Consultor:</b> {escape(str(acao['consultor'] or 'Todos'))}</div>
                        <div class="contact-line"><b>Período:</b> {_formatar_data_card(acao['data_inicio'])} a {_formatar_data_card(acao['data_fim'])}</div>
                        <div class="mini-grid">
                            <div class="mini-metric"><div class="mini-label">Qtd</div><div class="mini-value">{qtd_txt}</div></div>
                            <div class="mini-metric"><div class="mini-label">CNPJs</div><div class="mini-value">{cnpj_txt}</div></div>
                            <div class="mini-metric"><div class="mini-label">Ating.</div><div class="mini-value">{formatar_percentual(acao['atingimento_geral'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Falta qtd</div><div class="mini-value">{_numero_card(acao['falta_unidades'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Falta CNPJ</div><div class="mini-value">{_numero_card(acao['falta_cnpjs'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Status</div><div class="mini-value {_status_classe(status)}">{escape(status)}</div></div>
                        </div>
                        <div class="metric-note">{escape(qtd_nota)} | OL: {formatar_moeda(acao['ol_durante_acao'])}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]
acoes = dados["acoes"]

titulo_pagina("Foco Semanal", "Produtos da ação agrupados por molécula, consultor e período cadastrado.")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="acoes", mostrar_tipo_mix=False)
consultores = _consultores_disponiveis(clientes_f, vendas_f)
catalogo = _catalogo_produtos(produtos_mix, vendas)
label_para_produto = catalogo.set_index("label").to_dict("index") if not catalogo.empty else {}

with st.expander("Cadastrar nova ação", expanded=acoes.empty):
    nome = st.text_input("Nome da ação", placeholder="Ex.: BISOPROLOL 2,5MG E 5MG")
    c1, c2 = st.columns(2)
    data_inicio = c1.date_input("Data inicial", value=hoje_brasilia(), format="DD/MM/YYYY")
    data_fim = c2.date_input("Data final", value=hoje_brasilia(), format="DD/MM/YYYY")

    produtos_sel = st.multiselect("Produtos da ação", options=catalogo["label"].tolist() if not catalogo.empty else [])
    eans_extra_txt = st.text_area("EANs adicionais, se precisar", placeholder="Um EAN por linha")

    m1, m2, m3 = st.columns([1, 1, 1.2])
    meta_unidades = m1.number_input("Meta mínima de unidades", min_value=0.0, step=1.0, value=12.0)
    meta_cnpjs = m2.number_input("Meta mínima de PDV/CNPJ positivado", min_value=0.0, step=1.0, value=12.0)
    modo_unidades = m3.radio(
        "Como contar unidades",
        ["Somando os produtos", "Meta em cada produto"],
        horizontal=True,
    )
    tipo_meta = "POR_PRODUTO" if modo_unidades == "Meta em cada produto" else "SOMANDO"

    escopo_label = st.radio(
        "Aplicação da meta",
        ["Meta padrão para todos os consultores", "Meta separada por consultor"],
        horizontal=True,
    )
    escopo_meta = "POR_CONSULTOR" if escopo_label == "Meta separada por consultor" else "PADRAO"
    metas_editadas = pd.DataFrame()
    if escopo_meta == "POR_CONSULTOR":
        metas_base = pd.DataFrame(
            {
                "ativo": True,
                "consultor": consultores,
                "meta_unidades": float(meta_unidades),
                "meta_cnpjs": float(meta_cnpjs),
            }
        )
        metas_editadas = st.data_editor(
            metas_base,
            use_container_width=True,
            hide_index=True,
            disabled=["consultor"],
            column_config={
                "ativo": st.column_config.CheckboxColumn("Usar", default=True),
                "consultor": st.column_config.TextColumn("Consultor"),
                "meta_unidades": st.column_config.NumberColumn("Meta unidades", min_value=0, step=1),
                "meta_cnpjs": st.column_config.NumberColumn("Meta CNPJs", min_value=0, step=1),
            },
        )

    salvar = st.button("Salvar foco semanal", use_container_width=True)

    if salvar:
        eans_extra = [normalizar_ean(linha) for linha in eans_extra_txt.splitlines()]
        eans_extra = [ean for ean in eans_extra if ean]
        produtos_df = pd.DataFrame([label_para_produto[label] for label in produtos_sel]) if produtos_sel else pd.DataFrame()
        erros = []
        if not nome.strip():
            erros.append("Informe o nome da ação.")
        if pd.Timestamp(data_fim) < pd.Timestamp(data_inicio):
            erros.append("A data final precisa ser maior ou igual à data inicial.")
        if produtos_df.empty and not eans_extra:
            erros.append("Selecione pelo menos um produto ou informe EANs adicionais.")
        meta_consultores = _metas_consultores_json(metas_editadas) if escopo_meta == "POR_CONSULTOR" else ""
        if escopo_meta == "POR_CONSULTOR" and not meta_consultores:
            erros.append("Marque pelo menos um consultor para a meta separada.")

        if erros:
            for erro in erros:
                st.warning(erro)
        else:
            novas = _linhas_foco(
                nome.strip(),
                data_inicio,
                data_fim,
                produtos_df,
                eans_extra,
                float(meta_unidades),
                float(meta_cnpjs),
                tipo_meta,
                escopo_meta,
                meta_consultores,
            )
            base_atual = acoes.copy()
            if not base_atual.empty:
                base_atual = base_atual[~base_atual["campanha"].astype(str).str.upper().eq(nome.strip().upper())].copy()
            final = pd.concat([base_atual, novas], ignore_index=True)
            _salvar_acoes(final)
            st.success("Foco semanal salvo. Recarregando os resultados...")
            st.rerun()

c1, c2 = st.columns([1, 2])
mes_ref = c1.date_input("Mês de referência", value=hoje_brasilia().replace(day=1), format="DD/MM/YYYY")
busca = c2.text_input("Buscar foco, produto, EAN ou consultor")
inicio_mes = pd.Timestamp(mes_ref).replace(day=1)
fim_mes = inicio_mes + pd.offsets.MonthEnd(0)

if acoes.empty:
    st.info("Nenhum foco semanal cadastrado.")
    st.stop()

acoes_mes = acoes[
    (
        (pd.to_datetime(acoes["data_inicio"], errors="coerce") <= fim_mes)
        & (pd.to_datetime(acoes["data_fim"], errors="coerce") >= inicio_mes)
    )
    | acoes["status"].astype(str).str.upper().str.contains("ATIVA", na=False)
].copy()

analise = analisar_acoes_promocionais(acoes_mes, vendas_f, consultores=consultores)
analise = filtrar_busca(analise, busca, ["campanha", "produto", "ean", "consultor", "distribuidora", "status_meta"])

st.subheader("Ações do período")
if analise.empty:
    st.info("Sem focos para o mês selecionado.")
else:
    _desenhar_cards(analise)

with st.expander("Detalhes do foco semanal", expanded=False):
    colunas = [
        "campanha",
        "produto",
        "ean",
        "consultor",
        "data_inicio",
        "data_fim",
        "meta_unidades",
        "quantidade_vendida",
        "quantidade_meta_base",
        "falta_unidades",
        "meta_cnpjs",
        "cnpjs_positivados",
        "falta_cnpjs",
        "atingimento_unidades",
        "atingimento_cnpjs",
        "atingimento_geral",
        "tipo_meta_unidades",
        "status_meta",
        "ol_durante_acao",
    ]
    tabela = formatar_tabela_metricas(analise[colunas]).rename(
        columns={
            "campanha": "Foco",
            "produto": "Produtos",
            "ean": "EAN",
            "consultor": "Consultor",
            "data_inicio": "Data início",
            "data_fim": "Data fim",
            "meta_unidades": "Meta unidades",
            "quantidade_vendida": "Qtd vendida",
            "quantidade_meta_base": "Qtd usada na meta",
            "falta_unidades": "Falta unidades",
            "meta_cnpjs": "Meta CNPJs",
            "cnpjs_positivados": "CNPJs positivados",
            "falta_cnpjs": "Falta CNPJs",
            "atingimento_unidades": "Ating. unidades",
            "atingimento_cnpjs": "Ating. CNPJs",
            "atingimento_geral": "Ating. geral",
            "tipo_meta_unidades": "Tipo meta unidades",
            "status_meta": "Status meta",
            "ol_durante_acao": "OL durante",
        }
    )
    dataframe_com_download(tabela, "foco_semanal")
