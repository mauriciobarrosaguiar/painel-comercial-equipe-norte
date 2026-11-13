# Classificação farmacêutica — Mercado Farma

A classificação sanitária por **EAN/apresentação** é independente do MIX comercial (LINHA, PRIORITÁRIO, LANÇAMENTO, COMBATE).

## Categorias do painel

| Código | Rótulo | Regra |
|---|---|---|
| OTC | OTC / MIP | Medicamento isento de prescrição conforme LMIP e registro da apresentação |
| PRESCRICAO | Sob prescrição | Necessita receita, sem enquadramento específico nas outras duas categorias |
| CONTROLADO | Controlado | Sujeito a controle especial conforme Portaria SVS/MS nº 344/1998 e atualizações |
| ANTIMICROBIANO | Antimicrobiano | Medicamento sujeito a regras específicas de prescrição para antimicrobianos |
| NAO_CLASSIFICADO | A classificar | Ainda não verificado; nunca presumir OTC ou receita |

A categoria é uma **etiqueta principal de segmentação comercial**, não substitui a análise regulatória completa (receituário, retenção, restrições). Em apresentações com requisitos sobrepostos, documentar a regra de prevalência na fonte de classificação antes de salvar.

## Passo a passo

1. Aplique a migração `web/migrations/10026_classificacao_farmaceutica.sql` antes de publicar o código.
2. Acesse **Mercado Farma > Classificar medicamentos por EAN**.
3. Cole uma lista de até 500 linhas no formato `EAN;CATEGORIA;FONTE` (separadas por ponto e vírgula ou tabulação).
4. Confira cada EAN com fontes oficiais ou cadastro regulatório válido antes de salvar. Importação sem a fonte explícita ficará identificada como conferência manual.
5. Use **Tipo de medicamento** para consultar OTC, controlados, prescritos, antimicrobianos ou ainda não classificados.
6. É possível corrigir um produto individualmente no próprio card. O ajuste vale para todas as UFs e distribuidoras daquele EAN.

Exemplo ilustrativo (EAN fictício, NÃO é classificação real):

```csv
EAN;CATEGORIA;FONTE
7890000000000;NAO_CLASSIFICADO;Exemplo
```

## Fontes regulatórias para conferência

- LMIP (MIP): https://www.gov.br/anvisa/pt-br/setorregulado/regularizacao/medicamentos/medicamentos-isentos-de-prescricao/lista-de-medicamentos-isentos-de-prescricao-lmip
- Lista de substâncias controladas (Portaria 344/1998, atualizações): https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/lista-substancias
- RDC 471/2021 e atualizações (antimicrobianos): consultar AnvisaLegis.

**Nunca classifique pelo princípio ativo sozinho**: forma farmacêutica, concentração, indicação, via, apresentação e situação do registro podem importar. A classificação não pode ser derivada do campo `tipo_mix`.

## Garantias de escopo

- Não modifica dados de extração, preços, estoque, UF, distribuidoras, carrinho, metas ou MIX.
- Classificações persistem independentemente de novas extrações de preços.
- O filtro funciona antes do limite de resultados, na consulta SQL.
- O Excel do Mercado Farma acompanha o filtro de categoria e recebe uma coluna de classificação.
- Na ausência de classificação, os produtos aparecem em **A classificar**.
