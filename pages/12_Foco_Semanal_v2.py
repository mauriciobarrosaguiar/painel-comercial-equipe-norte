from __future__ import annotations

from pathlib import Path


ORIGINAL = Path(__file__).with_name("12_Foco_Semanal.py")
source = ORIGINAL.read_text(encoding="utf-8")

alvo = '''    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()
    return base
'''

ajuste = '''    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()

    # Correção do Foco Semanal:
    # quando o pedido ainda está sem nota/faturamento, a Bússola pode trazer
    # quantidade atendida/faturada e valor faturado como zero. Para a ação
    # semanal, contar a venda digitada usando quantidade solicitada e valor do
    # pedido sem imposto como fallback, sem contar pedidos cancelados.
    for coluna in [
        "quantidade_base",
        "quantidade_solicitada",
        "valor_vendido_sem_imposto",
        "valor_pedido_sem_imposto",
        "valor_total_solicitado_sem_imposto",
    ]:
        if coluna not in base.columns:
            base[coluna] = 0

    quantidade_base = pd.to_numeric(base["quantidade_base"], errors="coerce").fillna(0)
    quantidade_solicitada = pd.to_numeric(base["quantidade_solicitada"], errors="coerce").fillna(0)
    base["quantidade_base"] = np.where(quantidade_base.gt(0), quantidade_base, quantidade_solicitada)

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

if alvo not in source:
    raise RuntimeError("Nao foi possivel aplicar a correcao do Foco Semanal: trecho original nao encontrado.")

source = source.replace(alvo, ajuste, 1)
exec(compile(source, str(ORIGINAL), "exec"), {"__name__": "__main__", "__file__": str(ORIGINAL)})
