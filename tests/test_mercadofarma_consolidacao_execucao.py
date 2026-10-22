import json
from pathlib import Path

import pandas as pd
import pytest

from scripts import consolidar_mercadofarma as consolidar
from scripts.resumir_mercadofarma_ufs import montar_resumo


def preparar(tmp_path, monkeypatch):
    base = tmp_path / 'data'
    base.mkdir()
    atual = tmp_path / 'run-atual'
    atual.mkdir()
    monkeypatch.setenv('MERCADOFARMA_ARTIFACTS_DIR', str(atual))
    monkeypatch.setenv('MERCADOFARMA_UFS', 'TO,PA')
    for chave, valor in {'ROOT': tmp_path, 'BASE_DIR': base, 'PARCIAIS_DIR': atual,
                          'FINAL_PATH': base / 'consolidado.csv',
                          'FINAL_XLSX_PATH': base / 'consolidado.xlsx',
                          'STATUS_PATH': base / 'status_mercadofarma.json'}.items():
        monkeypatch.setattr(consolidar, chave, valor)
    return base, atual


def linha(uf, preco):
    return {'UF': uf, 'EAN': '07896004700001', 'CNPJ_REFERENCIA': '00123456000100',
            'DISTRIBUIDORA': 'A', 'PRECO_SEM_IMPOSTO': preco, 'ESTOQUE': '12'}


def test_run_isolado_preserva_uf_com_falha_e_nao_republica_antigas(tmp_path, monkeypatch):
    base, atual = preparar(tmp_path, monkeypatch)
    pd.DataFrame([linha('TO', '10.25'), linha('PA', '12.50')]).to_csv(consolidar.FINAL_PATH, index=False)
    # Um status antigo versionado não pode vencer o status de erro atual.
    (base / 'status').mkdir()
    (base / 'status' / 'mercadofarma_PA.json').write_text(json.dumps({'uf': 'PA', 'status': 'sucesso'}))
    (atual / 'parciais' / 'parciais').mkdir(parents=True)
    (atual / 'status').mkdir()
    for uf, status in [('TO', 'sucesso'), ('PA', 'erro')]:
        pd.DataFrame([linha(uf, '9.99')]).to_csv(atual / 'parciais' / 'parciais' / f'mercadofarma_{uf}.csv', index=False)
        (atual / 'status' / f'mercadofarma_{uf}.json').write_text(json.dumps({'uf': uf, 'status': status}))
    assert consolidar.main() == 0
    primeira = consolidar.FINAL_PATH.read_bytes()
    assert consolidar.main() == 0
    assert consolidar.FINAL_PATH.read_bytes() == primeira
    df = consolidar.ler_csv(consolidar.FINAL_PATH)
    assert df.set_index('UF')['PRECO_SEM_IMPOSTO'].to_dict() == {'TO': '9.99', 'PA': '12.50'}
    assert set(df.EAN) == {'07896004700001'}
    assert json.loads(consolidar.STATUS_PATH.read_text())['ufs_atualizadas'] == ['TO']
    from openpyxl import load_workbook
    livro = load_workbook(consolidar.FINAL_XLSX_PATH)
    assert livro['TO']['B2'].value == '07896004700001'
    assert livro['TO']['E2'].value == 9.99
    assert livro['TO']['F2'].value == 12


def test_csv_sem_status_atual_nao_e_dado_novo(tmp_path, monkeypatch):
    base, atual = preparar(tmp_path, monkeypatch)
    pd.DataFrame([linha('TO', '10.25')]).to_csv(consolidar.FINAL_PATH, index=False)
    pd.DataFrame([linha('TO', '0.01')]).to_csv(atual / 'mercadofarma_TO.csv', index=False)
    consolidar.main()
    assert json.loads(consolidar.STATUS_PATH.read_text())['ufs_atualizadas'] == []
    assert consolidar.ler_csv(consolidar.FINAL_PATH).iloc[0]['PRECO_SEM_IMPOSTO'] == '10.25'


def test_turso_ok_publicacao_falhou_nao_inventa_falha_de_extracao(tmp_path):
    (tmp_path / 'status').mkdir()
    (tmp_path / 'status' / 'mercadofarma_TO.json').write_text(json.dumps({'uf': 'TO', 'status': 'sucesso'}))
    resultado = montar_resumo(['TO'], tmp_path, 'success', 'success', 'success', 'failure')
    assert resultado['status'] == 'erro'
    assert 'dados sincronizados' in resultado['mensagem']
    assert 'UF TO | SUCESSO' in resultado['mensagem']
    assert 'Publicação do arquivo: failure' in resultado['erro']


def test_workflow_nao_disputa_main_com_outros_escritores():
    workflow = Path('.github/workflows/mercadofarma.yml').read_text()
    assert 'git push' not in workflow
    assert 'git pull --rebase' not in workflow
    assert 'contents: read' in workflow
    assert 'consolidado-mercadofarma-${{ github.run_id }}-${{ github.run_attempt }}' in workflow
    assert 'MERCADOFARMA_ARTIFACTS_DIR' in workflow
