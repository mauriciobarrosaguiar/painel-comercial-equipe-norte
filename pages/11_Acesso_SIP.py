from __future__ import annotations

import pandas as pd
import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.datas import hoje_brasilia
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.mercado_farma import formatar_tabela_mercado, mercado_farma_atual, melhor_preco_por_ean
from src.sip_store import carregar_sips, normalizar_grupo_sip
from src.tratamento import STATUS_CANCELADO, STATUS_FATURADOS, formatar_data, formatar_moeda, formatar_percentual


def classe_status_recado(status: str) -> str:
    return {
        "Pendente": "recado-status-pendente",
        "Em andamento": "recado-status-em-andamento",
        "Concluído": "recado-status-concluido",
    }.get(status, "")


def imagem_recado_html(recado: dict) -> str:
    mime = str(recado.get("imagem_tipo") or "image/png")
    imagem = str(recado.get("imagem_base64") or "")
    if not imagem:
        return ""
    return f'<img src="data:{mime};base64,{imagem}" style="width:100%; border-radius:12px; border:1px solid #D7E5D5;" />'


def falta_regra(valor: float, meta: float, pagamento: float) -> float:
    return max(float(meta or 0) * (float(pagamento or 0) / 100) - float(valor or 0), 0)


def categoria_pedido(linha: pd.Series) -> str:
    status = str(linha.get("status_normalizado", ""))
    nota = str(linha.get("nota_fiscal", "") or "").strip()
    if status == STATUS_CANCELADO:
        return "Cancelado"
    if status in STATUS_FATURADOS and nota:
        return "Faturado / nota gerada"
    if not nota:
        return "Ainda não gerou nota"
    return "Em andamento"


def preparar_pedidos_sip(vendas_base: pd.DataFrame) -> pd.DataFrame:
    if vendas_base.empty:
        return pd.DataFrame(columns=["categoria", "pedido_id", "nota_fiscal", "status_pedido", "cnpj_limpo", "nome_pdv", "cidade", "uf", "data_base", "valor_vendido_sem_imposto"])
    agrupado = (
        vendas_base.groupby(
            ["pedido_id", "nota_fiscal", "status_pedido", "status_normalizado", "cnpj_limpo", "nome_pdv", "cidade", "uf", "data_base"],
            dropna=False,
        )
        .agg(valor_vendido_sem_imposto=("valor_vendido_sem_imposto", "sum"))
        .reset_index()
    )
    agrupado["categoria"] = agrupado.apply(categoria_pedido, axis=1)
    return agrupado.sort_values("data_base", ascending=False)


def filtrar_periodo(vendas: pd.DataFrame, inicio: object, fim: object) -> pd.DataFrame:
    if vendas.empty:
        return vendas.copy()
    return vendas[
        (pd.to_datetime(vendas["data_base"], errors="coerce") >= pd.Timestamp(inicio))
        & (pd.to_datetime(vendas["data_base"], errors="coerce") <= pd.Timestamp(fim) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1))
    ].copy()


def desconto_texto(valor: object) -> str:
    try:
        numero = float(valor or 0)
    except Exception:
        numero = 0.0
    return f"{numero * 100:,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def produto_card(item: pd.Series) -> None:
    desconto = float(item.get("desconto", 0) or 0)
    estoque = int(float(item.get("estoque", 0) or 0))
    st.markdown(
        f"""
        <div class="produto-card">
            <div class="produto-top">
                <span class="desconto-badge">{desconto_texto(desconto)}</span>
                <span class="produto-meta">{item.get('uf', '')}</span>
            </div>
            <div class="produto-nome">{item.get('produto', '') or 'Produto sem descrição'}</div>
            <div class="produto-meta">EMS Genéricos &nbsp; | &nbsp; {item.get('ean', '')}</div>
            <div class="preco-box">
                <div>
                    <div class="preco-dist">{item.get('distribuidora', '') or 'Distribuidora não identificada'}</div>
                    <div class="preco-estoque">{estoque} un. disponíveis</div>
                </div>
                <div>
                    <div class="preco-secundario">PF Dist.: {formatar_moeda(item.get('pf_dist', 0))}</div>
                    <div class="preco-principal">{formatar_moeda(item.get('preco_sem_imposto', 0))}</div>
                    <div class="preco-secundario">Com imposto: {formatar_moeda(item.get('preco_com_imposto', 0))}</div>
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
sip_id = str(st.query_params.get("sip", "") or "").strip()
grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
grupo = next((item for item in grupos if item.get("id") == sip_id), None)

if not grupo:
    titulo_pagina("Painel SIP")
    st.error("SIP não encontrada ou link inválido.")
    st.stop()

titulo_pagina(f"Painel SIP - {grupo['nome']}")

hoje = hoje_brasilia()
inicio_padrao = hoje.replace(day=1)
p1, p2, p3 = st.columns(3)
data_inicial = p1.date_input("Data inicial", value=inicio_padrao, format="DD/MM/YYYY", key=f"pub_sip_inicio_{sip_id}")
data_final = p2.date_input("Data final", value=hoje, format="DD/MM/YYYY", key=f"pub_sip_fim_{sip_id}")
status_sel = p3.selectbox("Status do pedido", ["Todos", "Faturados", "Sem nota", "Cancelados"], key=f"pub_sip_status_{sip_id}")

vendas_sip_total = vendas[vendas["cnpj_limpo"].astype(str).isin(grupo["cnpjs"])].copy()
vendas_sip = filtrar_periodo(vendas_sip_total, data_inicial, data_final)
clientes_resultado = gerar_resultado_cliente(vendas_sip, clientes)
membros_sip = clientes_resultado[clientes_resultado["cnpj_limpo"].astype(str).isin(grupo["cnpjs"])].copy()

ol = float(membros_sip["ol_sem_combate"].sum()) if not membros_sip.empty else 0
prio = float(membros_sip["ol_prioritarios"].sum()) if not membros_sip.empty else 0
lanc = float(membros_sip["ol_lancamentos"].sum()) if not membros_sip.empty else 0
meta = float(grupo.get("meta_mes", 0) or 0)
pagamento = float(grupo.get("pagamento_percentual", 80) or 80)

c1, c2, c3 = st.columns(3)
with c1:
    card_metrica("CNPJs", str(len(grupo["cnpjs"])))
with c2:
    card_metrica("Meta", formatar_moeda(meta))
with c3:
    card_metrica("Faturado", formatar_moeda(ol))
c4, c5, c6 = st.columns(3)
with c4:
    card_metrica("OL prioritários", formatar_moeda(prio))
with c5:
    card_metrica("OL lançamentos", formatar_moeda(lanc))
with c6:
    card_metrica("Falta regra", formatar_moeda(falta_regra(ol, meta, pagamento)))
st.markdown(
    f"<span class='pill-note'>Atingimento: {formatar_percentual(ol / meta if meta else 0)}</span>"
    f"<span class='pill-note'>Pagamento a partir de {pagamento:.0f}%</span>",
    unsafe_allow_html=True,
)

st.subheader("Pedidos e notas da SIP")
pedidos = preparar_pedidos_sip(vendas_sip)
if status_sel == "Faturados":
    pedidos = pedidos[pedidos["categoria"].eq("Faturado / nota gerada")].copy()
elif status_sel == "Sem nota":
    pedidos = pedidos[pedidos["categoria"].eq("Ainda não gerou nota")].copy()
elif status_sel == "Cancelados":
    pedidos = pedidos[pedidos["categoria"].eq("Cancelado")].copy()

faturados = pedidos[pedidos["categoria"].eq("Faturado / nota gerada")]
sem_nota = pedidos[pedidos["categoria"].eq("Ainda não gerou nota")]
cancelados = pedidos[pedidos["categoria"].eq("Cancelado")]
m1, m2, m3 = st.columns(3)
with m1:
    card_metrica("Pedidos faturados", str(len(faturados)), f"{formatar_moeda(faturados['valor_vendido_sem_imposto'].sum())} faturado")
with m2:
    card_metrica("Sem nota", str(len(sem_nota)), f"{formatar_moeda(sem_nota['valor_vendido_sem_imposto'].sum())} a faturar")
with m3:
    card_metrica("Cancelados", str(len(cancelados)), f"{formatar_moeda(cancelados['valor_vendido_sem_imposto'].sum())} cancelado")

pedidos_visual = pedidos.rename(
    columns={
        "categoria": "Categoria",
        "pedido_id": "Pedido",
        "nota_fiscal": "Nota fiscal",
        "status_pedido": "Status",
        "cnpj_limpo": "CNPJ",
        "nome_pdv": "Cliente",
        "cidade": "Cidade",
        "uf": "UF",
        "data_base": "Data pedido",
        "valor_vendido_sem_imposto": "Valor",
    }
)[["Categoria", "Pedido", "Nota fiscal", "Status", "CNPJ", "Cliente", "Cidade", "UF", "Data pedido", "Valor"]]
pedidos_visual["Data pedido"] = pedidos_visual["Data pedido"].apply(formatar_data)
pedidos_visual["Valor"] = pedidos_visual["Valor"].apply(formatar_moeda)
botao_download_excel(pedidos_visual, f"pedidos_{grupo['id']}.xlsx", "Extrair pedidos detalhados")
st.dataframe(pedidos_visual, width="stretch", height=320)

st.subheader("Vendas por CNPJ")
detalhe = formatar_tabela_metricas(
    membros_sip[
        ["cnpj_limpo", "nome_pdv", "consultor", "cidade", "uf", "ol_sem_combate", "ol_prioritarios", "ol_lancamentos", "ultima_compra", "status_comercial"]
    ]
).rename(
    columns={
        "cnpj_limpo": "CNPJ",
        "nome_pdv": "Cliente",
        "consultor": "Consultor",
        "cidade": "Cidade",
        "uf": "UF",
        "ol_sem_combate": "Faturado",
        "ol_prioritarios": "Prioritários",
        "ol_lancamentos": "Lançamentos",
        "ultima_compra": "Última compra",
        "status_comercial": "Status",
    }
)
dataframe_com_download(detalhe, f"vendas_cnpj_{grupo['id']}", altura=340)

st.subheader("Produtos com preço e estoque")
mercado = mercado_farma_atual()
ufs_sip = sorted({str(uf).upper() for uf in membros_sip["uf"].dropna().astype(str)}) if not membros_sip.empty else []
mercado_sip = mercado[mercado["uf"].isin(ufs_sip)].copy() if not mercado.empty else mercado
if mercado_sip.empty:
    st.info("Ainda não existe base de Mercado Farma para as UFs desta SIP.")
else:
    busca = st.text_input("Buscar produto, EAN ou distribuidora", key=f"pub_sip_busca_{sip_id}")
    if busca:
        termo = busca.strip().lower()
        mercado_sip = mercado_sip[
            mercado_sip["produto"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
            | mercado_sip["ean"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
            | mercado_sip["distribuidora"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
        ].copy()

    melhores = melhor_preco_por_ean(mercado_sip)
    for fatia in [melhores.iloc[i : i + 3] for i in range(0, min(len(melhores), 30), 3)]:
        cols = st.columns(3)
        for col, (_, item) in zip(cols, fatia.iterrows()):
            with col:
                produto_card(item)

    e1, e2 = st.columns(2)
    with e1:
        botao_download_excel(formatar_tabela_mercado(mercado_sip), f"produtos_preco_estoque_{grupo['id']}.xlsx", "Extrair produtos por UF")
    with e2:
        botao_download_excel(formatar_tabela_mercado(melhores), f"melhores_precos_{grupo['id']}.xlsx", "Extrair melhores preços")

recados = grupo.get("recados", [])
if recados:
    st.subheader("Recados e alinhamentos")
    for recado in recados:
        st.markdown(
            f"""
            <div class="recado-card">
                <div class="recado-title">{recado.get('titulo', 'Recado')}</div>
                <span class="recado-status {classe_status_recado(str(recado.get('status', 'Pendente')))}">{recado.get('status', 'Pendente')}</span>
                {imagem_recado_html(recado)}
                <div class="recado-comment">{recado.get('comentario', '')}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
