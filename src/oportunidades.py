from __future__ import annotations

import pandas as pd

from src.calculos import gerar_resultado_cliente, gerar_resultado_sip
from src.sip_store import carregar_sips, normalizar_grupo_sip
from src.tratamento import normalizar_texto_alto


def _prioridade(cliente: pd.Series, motivo: str) -> str:
    foco = normalizar_texto_alto(cliente.get("foco_pex", ""))
    if "FOCO" in foco or foco in {"SIM", "S", "YES", "1"}:
        return "Alta"
    if "SIP" in motivo or "rede" in motivo.lower() or "sem compra" in motivo.lower():
        grupo = str(cliente.get("grupo_sip", "")).strip()
        if grupo and grupo not in {"SEM IDENTIFICACAO", str(cliente.get("nome_pdv", "")).strip().upper()}:
            return "Alta"
    if "prioritários" in motivo.lower() or "prioritarios" in motivo.lower() or "lançamentos" in motivo.lower() or "lancamentos" in motivo.lower():
        return "Média"
    return "Baixa"


def _linha(cliente: pd.Series, motivo: str, acao: str) -> dict[str, object]:
    return {
        "prioridade": _prioridade(cliente, motivo),
        "consultor": cliente.get("consultor", ""),
        "cliente": cliente.get("nome_pdv", ""),
        "cnpj": cliente.get("cnpj_limpo", ""),
        "grupo_sip": cliente.get("grupo_sip", ""),
        "cidade": cliente.get("cidade", ""),
        "uf": cliente.get("uf", ""),
        "motivo_alerta": motivo,
        "acao_sugerida": acao,
        "ol_sem_combate": cliente.get("ol_sem_combate", 0),
        "ol_prioritarios": cliente.get("ol_prioritarios", 0),
        "ol_lancamentos": cliente.get("ol_lancamentos", 0),
    }


def gerar_oportunidades(vendas: pd.DataFrame, clientes: pd.DataFrame, produtos_mix: pd.DataFrame | None = None) -> pd.DataFrame:
    clientes_resultado = gerar_resultado_cliente(vendas, clientes)
    if clientes_resultado.empty:
        return pd.DataFrame()

    oportunidades: list[dict[str, object]] = []
    sip = gerar_resultado_sip(vendas, clientes)
    redes_sem_compra = set()
    if not sip.empty:
        redes_sem_compra = set(
            sip[(sip["quantidade_cnpjs"] > 1) & (sip["cnpjs_sem_compra"] > 0)]["grupo_sip"].astype(str)
        )
    sips_por_cnpj: dict[str, list[str]] = {}
    for grupo in [normalizar_grupo_sip(item) for item in carregar_sips()]:
        for cnpj in grupo.get("cnpjs", []):
            sips_por_cnpj.setdefault(str(cnpj), []).append(grupo.get("nome", ""))

    for _, cliente in clientes_resultado.iterrows():
        ativo = bool(cliente.get("cliente_ativo", True))
        if not ativo:
            continue
        ol = float(cliente.get("ol_sem_combate", 0) or 0)
        pri = float(cliente.get("ol_prioritarios", 0) or 0)
        lan = float(cliente.get("ol_lancamentos", 0) or 0)
        foco = normalizar_texto_alto(cliente.get("foco_pex", ""))
        positivacao = normalizar_texto_alto(cliente.get("positivacao", ""))

        if ol <= 0:
            oportunidades.append(_linha(cliente, "Cliente sem compra no período", "Priorizar contato, confirmar estoque no distribuidor e montar pedido inicial."))
            if "FOCO" in foco or foco in {"SIM", "S", "YES", "1"}:
                oportunidades.append(_linha(cliente, "Cliente foco PEX sem compra", "Agendar visita consultiva e levar oferta de mix prioritário."))
            if positivacao and positivacao not in {"NAO", "N", "0", "-"}:
                oportunidades.append(_linha(cliente, "Cliente com positivação esperada, mas sem venda", "Checar barreiras de compra e registrar próximo passo com data."))
            if str(cliente.get("grupo_sip", "")) in redes_sem_compra:
                oportunidades.append(_linha(cliente, "Rede com CNPJ sem compra", "Usar compras das demais lojas da rede como argumento e abrir negociação por CNPJ."))
            if str(cliente.get("cnpj_limpo", "")) in sips_por_cnpj:
                oportunidades.append(_linha(cliente, "SIP com CNPJ sem compra", "Usar o cadastro de SIP para negociar o grupo e recuperar o CNPJ sem venda."))
            continue

        if pri <= 0:
            oportunidades.append(_linha(cliente, "Cliente comprou OL, mas não comprou prioritários", "Ofertar lista curta de prioritários aderente ao perfil do cliente."))
        elif ol > 0 and pri / ol < 0.05:
            oportunidades.append(_linha(cliente, "Produto prioritário com baixa venda", "Reforçar mix prioritário e negociar volume mínimo por visita."))

        if lan <= 0:
            oportunidades.append(_linha(cliente, "Cliente comprou OL, mas não comprou lançamentos", "Apresentar lançamentos com benefício comercial e argumento de giro."))
        elif ol > 0 and lan / ol < 0.03:
            oportunidades.append(_linha(cliente, "Produto lançamento com baixa penetração", "Adicionar lançamentos ao pedido recorrente e acompanhar recompra."))

    resultado = pd.DataFrame(oportunidades)
    if resultado.empty:
        return resultado
    ordem = {"Alta": 0, "Média": 1, "Media": 1, "Baixa": 2}
    resultado["_ordem"] = resultado["prioridade"].map(ordem).fillna(3)
    return resultado.sort_values(["_ordem", "consultor", "cliente", "motivo_alerta"]).drop(columns="_ordem").reset_index(drop=True)
