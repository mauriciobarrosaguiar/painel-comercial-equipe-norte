from __future__ import annotations

from scripts import importar_mercadofarma_d1 as d1


def main() -> None:
    database_id = d1.localizar_database_id()
    d1.executar(
        database_id,
        """
        INSERT INTO mercado_farma_precos_historico (
          id,extracao_id,uf,cnpj_referencia,produto_id,ean,produto,distribuidora,
          estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,
          preco_sem_imposto,status,erro,extraido_em
        )
        SELECT
          'mfh-' || lower(hex(randomblob(16))),
          (SELECT id FROM extracoes WHERE tipo='MERCADO_FARMA' AND status='concluido' ORDER BY finalizado_em DESC LIMIT 1),
          uf,cnpj_referencia,produto_id,ean,produto,distribuidora,
          estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,
          preco_sem_imposto,status,erro,
          COALESCE(atualizado_em,CURRENT_TIMESTAMP)
        FROM mercado_farma_precos
        """,
    )
    print("Histórico do Mercado Farma preservado no D1.")


if __name__ == "__main__":
    main()
