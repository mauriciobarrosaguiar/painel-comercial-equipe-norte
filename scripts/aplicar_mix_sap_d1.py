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

        UPDATE produtos
           SET tipo_mix=COALESCE((
                 SELECT mapa.tipo_mix
                   FROM produtos_mix_sap mapa
                  WHERE mapa.ativo=1
                    AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
                  LIMIT 1
               ),tipo_mix),
               mix_importacao_id=COALESCE((
                 SELECT mapa.importacao_id
                   FROM produtos_mix_sap mapa
                  WHERE mapa.ativo=1
                    AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
                  LIMIT 1
               ),mix_importacao_id),
               atualizado_em=CURRENT_TIMESTAMP
         WHERE EXISTS(
               SELECT 1
                 FROM produtos_mix_sap mapa
                WHERE mapa.ativo=1
                  AND TRIM(mapa.sku)=TRIM(COALESCE(produtos.sku,''))
         );
        """,
    )
    print("Classificações de MIX por código SAP aplicadas aos produtos extraídos do Bússola.")


if __name__ == "__main__":
    main()
