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
    assert 'uf: [TO]' in workflow
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
