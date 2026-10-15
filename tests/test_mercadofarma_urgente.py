from pathlib import Path


def test_workflow_mercadofarma_pessoal_alterna_backend_no_cutover():
    workflow = Path('.github/workflows/mercadofarma.yml').read_text(encoding='utf-8')
    assert 'automacoes/mercadofarma_atualizado.py' in workflow
    assert 'automacoes/mercadofarma_turso_atualizado.py' in workflow
    assert 'scripts/importar_mercadofarma_d1_filtrado.py' in workflow
    assert 'scripts/importar_mercadofarma_turso_filtrado.py' in workflow
    assert 'CLOUDFLARE_D1_API_TOKEN' in workflow
    assert 'TURSO_AUTH_TOKEN' in workflow
    assert 'config/turso-cutover-active.txt' in workflow
    assert '/api/internal/mercado-farma-credencial' in workflow
    assert "Detectar UFs da carteira do Maurício" in workflow
    assert "fromJSON(needs.preparar_ufs.outputs.ufs_json)" in workflow
    assert "default: \"\"" in workflow
    assert '\n  push:' not in workflow


def test_parser_atualizado_substitui_leitor_antigo():
    from src import mercado_farma as core
    from src.mercadofarma_parser_atual import processar_ean_catalogo_atualizado

    original = core.processar_ean_catalogo
    try:
        core.processar_ean_catalogo = processar_ean_catalogo_atualizado
        assert core.processar_ean_catalogo is processar_ean_catalogo_atualizado
    finally:
        core.processar_ean_catalogo = original


def test_parser_v8_preserva_decimais_e_percentuais():
    from src.mercadofarma_inventory import extrair_valor_numerico

    assert extrair_valor_numerico("R$ 37,19") == 37.19
    assert extrair_valor_numerico("37.19") == 37.19
    assert extrair_valor_numerico("R$ 1.234,56") == 1234.56
    assert extrair_valor_numerico("44,39%", "desconto") == 0.4439
    assert extrair_valor_numerico("21 un. disponíveis", "estoque") == 21


def test_parser_v8_usa_estrutura_nova_do_mercado_farma():
    source = Path("src/mercadofarma_inventory.py").read_text(encoding="utf-8")
    assert "produtoCard-descricao-" in source
    assert "data-slot='popover-trigger'" in source
    assert "data-test-id='buybox-item'" in source
    assert "tag-percentual_desconto-" in source
    assert "un. disponíveis" in source
    assert 'selectors_css=["del"]' in source
    assert 'selectors_css=["h5"]' in source
    assert "com\\s*imposto" in source


def test_workflow_mercadofarma_detecta_ufs_da_carteira():
    workflow = Path('.github/workflows/mercadofarma.yml').read_text(encoding='utf-8')
    assert "SELECT DISTINCT UPPER(TRIM(COALESCE(uf,''))) AS uf" in workflow
    assert "consultor_id='cons-1ee6626b98906f06c399a6ad350c'" in workflow
    assert "ufs_json" in workflow
    assert "matrix:" in workflow
    assert "fromJSON(needs.preparar_ufs.outputs.ufs_json)" in workflow
    assert "uf: [TO]" not in workflow
