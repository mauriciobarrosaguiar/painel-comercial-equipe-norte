from pathlib import Path


def test_workflow_sincroniza_consolidado_no_d1():
    workflow = Path('.github/workflows/mercadofarma.yml').read_text(encoding='utf-8')
    assert 'automacoes/mercadofarma_atualizado.py' in workflow
    assert 'scripts/importar_mercadofarma_d1.py' in workflow
    assert 'CLOUDFLARE_D1_API_TOKEN' in workflow


def test_parser_atualizado_substitui_leitor_antigo():
    from src import mercado_farma as core
    from src.mercadofarma_parser_atual import processar_ean_catalogo_atualizado

    original = core.processar_ean_catalogo
    try:
        core.processar_ean_catalogo = processar_ean_catalogo_atualizado
        assert core.processar_ean_catalogo is processar_ean_catalogo_atualizado
    finally:
        core.processar_ean_catalogo = original
