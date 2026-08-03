from __future__ import annotations

from scripts import extrair_bussola_d1 as legacy


def main() -> None:
    database_id = legacy.localizar_database_id()
    legacy.executar(
        database_id,
        """
        CREATE TABLE IF NOT EXISTS produtos_mix_sap (
          sku TEXT PRIMARY KEY,
          molecula TEXT,
          descricao TEXT,
          tipo_mix TEXT NOT NULL DEFAULT 'SEM CLASSIFICACAO',
          ativo INTEGER NOT NULL DEFAULT 1,
          importacao_id TEXT,
          atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- O template mensal contém somente as exceções do MIX.
        -- Todo produto não listado é produto de Linha e deve entrar
        -- no OL Sem Combate.
        UPDATE produtos
           SET tipo_mix='LINHA',
               mix_importacao_id=NULL,
               atualizado_em=CURRENT_TIMESTAMP
         WHERE ativo=1;

        UPDATE produtos
           SET tipo_mix=(
                 SELECT mapa.tipo_mix
                   FROM produtos_mix_sap mapa
                  WHERE mapa.ativo=1
                    AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
                  LIMIT 1
               ),
               mix_importacao_id=(
                 SELECT mapa.importacao_id
                   FROM produtos_mix_sap mapa
                  WHERE mapa.ativo=1
                    AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
                  LIMIT 1
               ),
               atualizado_em=CURRENT_TIMESTAMP
         WHERE EXISTS(
               SELECT 1
                 FROM produtos_mix_sap mapa
                WHERE mapa.ativo=1
                  AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
         );
        """,
    )
    print(
        "Classificação MIX aplicada: produtos não listados ficaram como Linha; "
        "Prioritários, Lançamentos e Combate foram aplicados pelo código SAP."
    )


if __name__ == "__main__":
    main()
