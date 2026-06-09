from __future__ import annotations

from pathlib import Path


ORIGINAL = Path(__file__).with_name("12_Foco_Semanal.py")
source = ORIGINAL.read_text(encoding="utf-8")

alvo_vendas = '''    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()
    return base
'''

ajuste_vendas = '''    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()

    # Correção do Foco Semanal:
    # 1) Venda lançada sem nota entra pela quantidade solicitada.
    # 2) Visão de atendimento fica separada pela quantidade atendida/faturada.
    for coluna in [
        "quantidade_base",
        "quantidade_solicitada",
        "quantidade_atendida",
        "quantidade_faturada",
        "valor_vendido_sem_imposto",
        "valor_pedido_sem_imposto",
        "valor_total_solicitado_sem_imposto",
    ]:
        if coluna not in base.columns:
            base[coluna] = 0

    quantidade_base = pd.to_numeric(base["quantidade_base"], errors="coerce").fillna(0)
    quantidade_solicitada = pd.to_numeric(base["quantidade_solicitada"], errors="coerce").fillna(0)
    quantidade_atendida = pd.to_numeric(base["quantidade_atendida"], errors="coerce").fillna(0)
    quantidade_faturada = pd.to_numeric(base["quantidade_faturada"], errors="coerce").fillna(0)

    base["quantidade_vendida_acao"] = np.where(quantidade_base.gt(0), quantidade_base, quantidade_solicitada)
    base["quantidade_atendida_acao"] = np.where(quantidade_faturada.gt(0), quantidade_faturada, quantidade_atendida)
    base["quantidade_pendente_acao"] = np.maximum(base["quantidade_vendida_acao"] - base["quantidade_atendida_acao"], 0)
    base["quantidade_base"] = base["quantidade_vendida_acao"]

    valor_faturado = pd.to_numeric(base["valor_vendido_sem_imposto"], errors="coerce").fillna(0)
    valor_pedido = pd.to_numeric(base["valor_pedido_sem_imposto"], errors="coerce").fillna(0)
    valor_solicitado = pd.to_numeric(base["valor_total_solicitado_sem_imposto"], errors="coerce").fillna(0)
    base["valor_vendido_sem_imposto"] = np.select(
        [valor_faturado.gt(0), valor_pedido.gt(0)],
        [valor_faturado, valor_pedido],
        default=valor_solicitado,
    )
    return base
'''

if alvo_vendas not in source:
    raise RuntimeError("Nao foi possivel aplicar a correcao do Foco Semanal: trecho de vendas nao encontrado.")
source = source.replace(alvo_vendas, ajuste_vendas, 1)

alvo_agreg = '''    agreg = (
        base.groupby(["consultor", "ean_limpo"], dropna=False)
        .agg(
            quantidade_vendida=("quantidade_base", "sum"),
            valor_vendido=("valor_vendido_sem_imposto", "sum"),
            pedidos=("pedido_id", "nunique"),
            clientes=("cnpj_limpo", "nunique"),
        )
        .reset_index()
        .rename(columns={"ean_limpo": "ean"})
    )
    resultado = agreg.merge(produtos, on="ean", how="left")
    for coluna in ["quantidade_vendida", "valor_vendido", "pedidos", "clientes"]:
        resultado[coluna] = pd.to_numeric(resultado.get(coluna, 0), errors="coerce").fillna(0)
    return resultado[["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]]
'''

ajuste_agreg = '''    agreg = (
        base.groupby(["consultor", "ean_limpo"], dropna=False)
        .agg(
            quantidade_vendida=("quantidade_vendida_acao", "sum"),
            quantidade_atendida=("quantidade_atendida_acao", "sum"),
            quantidade_pendente=("quantidade_pendente_acao", "sum"),
            valor_vendido=("valor_vendido_sem_imposto", "sum"),
            pedidos=("pedido_id", "nunique"),
            clientes=("cnpj_limpo", "nunique"),
        )
        .reset_index()
        .rename(columns={"ean_limpo": "ean"})
    )
    resultado = agreg.merge(produtos, on="ean", how="left")
    for coluna in ["quantidade_vendida", "quantidade_atendida", "quantidade_pendente", "valor_vendido", "pedidos", "clientes"]:
        resultado[coluna] = pd.to_numeric(resultado.get(coluna, 0), errors="coerce").fillna(0)
    return resultado[["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "quantidade_atendida", "quantidade_pendente", "valor_vendido", "pedidos", "clientes"]]
'''

if alvo_agreg not in source:
    raise RuntimeError("Nao foi possivel aplicar a visao de atendimento: trecho de agregacao nao encontrado.")
source = source.replace(alvo_agreg, ajuste_agreg, 1)

inserir_funcao = '''

def _atendimento_formatado(resultado: pd.DataFrame) -> pd.DataFrame:
    colunas = [
        "Consultor",
        "Molécula",
        "EAN",
        "Produto",
        "Qtd vendida/pedida",
        "Qtd atendida",
        "Qtd pendente",
        "% atendido",
    ]
    if resultado.empty:
        return pd.DataFrame(columns=colunas)
    tabela = resultado.copy()
    for coluna in ["quantidade_vendida", "quantidade_atendida", "quantidade_pendente"]:
        if coluna not in tabela.columns:
            tabela[coluna] = 0
        tabela[coluna] = pd.to_numeric(tabela[coluna], errors="coerce").fillna(0)
    tabela["percentual_atendido"] = np.where(
        tabela["quantidade_vendida"].gt(0),
        tabela["quantidade_atendida"] / tabela["quantidade_vendida"],
        0,
    )
    tabela = tabela.sort_values(["consultor", "molecula", "produto"]).reset_index(drop=True)
    tabela["quantidade_vendida"] = tabela["quantidade_vendida"].map(lambda valor: f"{float(valor):,.0f}".replace(",", "."))
    tabela["quantidade_atendida"] = tabela["quantidade_atendida"].map(lambda valor: f"{float(valor):,.0f}".replace(",", "."))
    tabela["quantidade_pendente"] = tabela["quantidade_pendente"].map(lambda valor: f"{float(valor):,.0f}".replace(",", "."))
    tabela["percentual_atendido"] = tabela["percentual_atendido"].apply(formatar_percentual)
    return tabela.rename(
        columns={
            "consultor": "Consultor",
            "molecula": "Molécula",
            "ean": "EAN",
            "produto": "Produto",
            "quantidade_vendida": "Qtd vendida/pedida",
            "quantidade_atendida": "Qtd atendida",
            "quantidade_pendente": "Qtd pendente",
            "percentual_atendido": "% atendido",
        }
    )[colunas]


def _incluir_atendimento_consultor(tabela: pd.DataFrame, vendas_filtradas: pd.DataFrame) -> pd.DataFrame:
    if tabela.empty:
        return tabela
    saida = tabela.copy()
    if vendas_filtradas is None or vendas_filtradas.empty:
        saida.insert(saida.columns.get_loc("QTD VENDIDA") + 1, "QTD ATENDIDA", 0)
        saida.insert(saida.columns.get_loc("QTD ATENDIDA") + 1, "QTD PENDENTE", 0)
        return saida
    base = vendas_filtradas.copy()
    for coluna in ["quantidade_atendida_acao", "quantidade_pendente_acao"]:
        if coluna not in base.columns:
            base[coluna] = 0
        base[coluna] = pd.to_numeric(base[coluna], errors="coerce").fillna(0)
    resumo = base.groupby("consultor", dropna=False).agg(
        qtd_atendida=("quantidade_atendida_acao", "sum"),
        qtd_pendente=("quantidade_pendente_acao", "sum"),
    ).reset_index()
    resumo["CONSULTOR"] = resumo["consultor"].astype(str)
    saida = saida.merge(resumo[["CONSULTOR", "qtd_atendida", "qtd_pendente"]], on="CONSULTOR", how="left")
    saida["QTD ATENDIDA"] = pd.to_numeric(saida.pop("qtd_atendida"), errors="coerce").fillna(0).round().astype(int)
    saida["QTD PENDENTE"] = pd.to_numeric(saida.pop("qtd_pendente"), errors="coerce").fillna(0).round().astype(int)
    cols = list(saida.columns)
    for coluna in ["QTD ATENDIDA", "QTD PENDENTE"]:
        cols.remove(coluna)
    pos = cols.index("QTD VENDIDA") + 1 if "QTD VENDIDA" in cols else len(cols)
    cols[pos:pos] = ["QTD ATENDIDA", "QTD PENDENTE"]
    return saida[cols]
'''

marcador_funcao = '''
def _montar_eans_preview(selecionados: list[str], eans_manuais: str, catalogo: pd.DataFrame) -> list[str]:
'''
if marcador_funcao not in source:
    raise RuntimeError("Nao foi possivel inserir funcoes de atendimento: marcador nao encontrado.")
source = source.replace(marcador_funcao, inserir_funcao + marcador_funcao, 1)

alvo_tabela = '''    st.markdown("#### Resultado por consultor")
    tabela_metas = _tabela_meta_consultores(acao, vendas_acao, produtos_acao, clientes, vendas)
    if tabela_metas.empty:
        st.info("Nenhum consultor encontrado para montar a visão da ação.")
    else:
        st.dataframe(tabela_metas, use_container_width=True, height=min(420, 74 + 36 * len(tabela_metas)))
        botao_download_excel(tabela_metas, f"foco_semanal_consultores_{acao.get('id', 'acao')}.xlsx", "Baixar resultado por consultor")

    with st.expander("Resultado por consultor e molécula", expanded=False):
'''

ajuste_tabela = '''    st.markdown("#### Resultado por consultor")
    tabela_metas = _tabela_meta_consultores(acao, vendas_acao, produtos_acao, clientes, vendas)
    tabela_metas = _incluir_atendimento_consultor(tabela_metas, vendas_acao)
    if tabela_metas.empty:
        st.info("Nenhum consultor encontrado para montar a visão da ação.")
    else:
        st.dataframe(tabela_metas, use_container_width=True, height=min(420, 74 + 36 * len(tabela_metas)))
        botao_download_excel(tabela_metas, f"foco_semanal_consultores_{acao.get('id', 'acao')}.xlsx", "Baixar resultado por consultor")

    with st.expander("Atendimento por quantidade", expanded=False):
        atendimento = _atendimento_formatado(resultado)
        if atendimento.empty:
            st.info("Nenhum atendimento encontrado nesta ação e período.")
        else:
            dataframe_com_download(atendimento, f"foco_semanal_atendimento_{acao.get('id', 'acao')}", altura=330)

    with st.expander("Resultado por consultor e molécula", expanded=False):
'''

if alvo_tabela not in source:
    raise RuntimeError("Nao foi possivel adicionar a tabela de atendimento: trecho da tela nao encontrado.")
source = source.replace(alvo_tabela, ajuste_tabela, 1)

source = source.replace(
    '    total_valor = float(resultado["valor_vendido"].sum()) if not resultado.empty else 0\n',
    '    total_valor = float(resultado["valor_vendido"].sum()) if not resultado.empty else 0\n    total_atendido = float(resultado["quantidade_atendida"].sum()) if not resultado.empty and "quantidade_atendida" in resultado.columns else 0\n',
    1,
)
source = source.replace(
    '    m1, m2, m3, m4 = st.columns(4)\n',
    '    m1, m2, m3, m4, m5 = st.columns(5)\n',
    1,
)
source = source.replace(
    '''    with m2:
        card_metrica("Valor vendido", formatar_moeda(total_valor))
    with m3:
        card_metrica("CNPJs positivados", str(total_cnpjs))
    with m4:
        card_metrica("Moléculas na ação", str(moleculas))
''',
    '''    with m2:
        card_metrica("Quantidade atendida", f"{total_atendido:,.0f}".replace(",", "."))
    with m3:
        card_metrica("Valor vendido", formatar_moeda(total_valor))
    with m4:
        card_metrica("CNPJs positivados", str(total_cnpjs))
    with m5:
        card_metrica("Moléculas na ação", str(moleculas))
''',
    1,
)

exec(compile(source, str(ORIGINAL), "exec"), {"__name__": "__main__", "__file__": str(ORIGINAL)})
