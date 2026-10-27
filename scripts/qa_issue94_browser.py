"""Homologação da UI com APIs fictícias; nenhuma chamada ao painel ou fornecedor real.
Rodar: python -m playwright install chromium && python scripts/qa_issue94_browser.py
"""
import json
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/issue94'
OUT.mkdir(parents=True, exist_ok=True)
EAN = '7896004700001'
STAMP = '2026-10-22T15:00:00-03:00'
USER = dict(login='qa-local', nome='Maurício · HOMOLOGAÇÃO FICTÍCIA', consultor_id='qa')
CLIENT = dict(id='qa1', cnpj='00000000000191', nome='Farmácia Teste · Dados fictícios', cidade='Palmas', uf='TO', consultor=USER['nome'], gd='', faturamento_atual=90, faturamento_anterior=60, variacao_percentual=50, pedidos_atual=1, ticket_medio=90, produtos_comprados=1, produtos_prioritarios=0, produtos_lancamentos=0, ultima_compra='2026-10-22', dias_sem_comprar=0, prioridade='BAIXA', motivo_prioridade='Fixture')
ROW = dict(uf='TO', ean=EAN, produto='Produto de homologação', distribuidora='Distribuidora Teste', estoque=20, desconto=.5, pf_distribuidora=20, pf_fabrica=20, preco_com_imposto=12, preco_sem_imposto=10, melhor_preco=10, atualizado_em=STAMP)
DETAIL = dict(cliente=CLIENT, resumo=dict(faturamento=90, pedidos=1, produtos=1, ultima_compra='2026-10-22', prioritarios=0, lancamentos=0, ticket_medio=90), historico=[dict(ano_mes='2026-10', faturamento=90, pedidos=1, produtos=1)], produtos=[], pedidos=[], oportunidades=[])
INSIGHTS = dict(cliente=CLIENT, cobertura=dict(total=3, comprados=1, nao_comprados=2, percentual=33.3, inicio='2026-08-01', fim='2026-10-22', criterio='Itens faturados com EAN'), sugestoes=[dict(id='qa-prod', ean=EAN, produto=ROW['produto'], tipo_mix='LINHA', tipo='REPOSICAO', quantidade_sugerida=3, quantidade_3m=9, quantidade_6m=9, justificativa='Média de 3 unidades/mês.', ultima_compra='2026-10-22', ofertas=[dict(distribuidora=ROW['distribuidora'], uf='TO', estoque=20, preco=12, preco_com_imposto=12, preco_sem_imposto=10, atualizado_em=STAMP)])], avisos=['Histórico agregado sem EAN não identifica produtos.'])


def api(route):
    request = route.request
    assert request.method == 'GET', f'Escrita externa inesperada: {request.url}'
    parsed = urlparse(request.url)
    path = parsed.path
    if path == '/api/auth/session':
        data = dict(usuario=USER)
    elif path == '/api/health':
        data = dict(database='ok')
    elif path == '/api/dashboard':
        data = dict(filtros=dict(consultores=[], ufs=['TO','MT','PA'], aplicado=dict(rotulo='Homologação fictícia')), atualizado_em=STAMP)
    elif path == '/api/clientes':
        data = dict(periodo=dict(rotulo='Homologação fictícia'), resumo=dict(clientes_ativos=1, clientes_com_venda=1, clientes_sem_venda=0, cobertura_percentual=100, faturamento_total=90, ticket_medio_cliente=90, prioridades={}), paginacao=dict(pagina=1, paginas=1, total=1), filtros=dict(consultores=[], ufs=['TO'], cidades=['Palmas']), clientes=[CLIENT])
    elif path == '/api/clientes/detalhe':
        data = DETAIL
    elif path == '/api/clientes/inteligencia':
        data = INSIGHTS
    elif path == '/api/mercado-farma':
        selected = bool(parse_qs(parsed.query).get('cliente_cnpj'))
        data = dict(resumo=dict(registros=1, produtos=1, ufs=1, distribuidoras=1, com_estoque=1, atualizado_em=STAMP), resultados=[ROW], filtros=dict(ufs=['TO'], distribuidoras=[ROW['distribuidora']]), clientes=[CLIENT], cliente_selecionado=CLIENT if selected else None, uf_aplicada='TO', usuario=USER)
    elif path == '/api/automacoes':
        data = dict(comandos=[], extracoes=[], em_execucao=0, atualizado_em=STAMP)
    else:
        data = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(data))


def main():
    server = subprocess.Popen(['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174'], cwd=ROOT / 'web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', 5174), timeout=.2):
                    break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            for name, width, height in [('desktop', 1440, 1000), ('mobile', 390, 844)]:
                context = browser.new_context(viewport=dict(width=width, height=height))
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/api/**', api)
                page.goto('http://127.0.0.1:5174')
                expect(page.get_by_role('heading', name='Olá, Maurício')).to_be_visible()
                expect(page.get_by_role('heading', name='Visão Geral', exact=True)).to_have_count(0)
                expect(page.get_by_role('button', name='Baixar app', exact=True)).to_have_count(1)
                page.screenshot(path=str(OUT / f'depois-home-{name}.png'), full_page=True)
                page.get_by_role('button', name='Central de automações', exact=True).click()
                expect(page.get_by_role('heading', name='Central de Automações', exact=True)).to_be_visible()
                page.get_by_role('button', name='← Voltar ao painel', exact=True).click()
                page.get_by_role('button').filter(has=page.get_by_role('heading', name='Clientes', exact=True)).click()
                page.get_by_role('button', name='Ver ficha', exact=True).click()
                dialog = page.get_by_role('dialog')
                expect(dialog.get_by_role('heading', name='Sugestão de compras', exact=True)).to_be_visible()
                box = dialog.bounding_box()
                assert box['width'] >= width - 2 and box['x'] <= 1, box
                page.screenshot(path=str(OUT / f'depois-ficha-{name}.png'), full_page=True)
                # A ficha agora tem checkboxes de fornecedores e de produtos: usar seletor específico.
                fornecedor = dialog.get_by_role('checkbox', name='Distribuidora Teste')
                expect(fornecedor).to_be_checked()
                fornecedor.uncheck()
                expect(dialog.get_by_text('Sem oferta nas distribuidoras selecionadas')).to_be_visible()
                fornecedor.check()
                dialog.locator('.client-rec-select input[type="checkbox"]').check()
                dialog.get_by_role('button', name='Enviar selecionados ao carrinho do Mercado Farma →', exact=True).click()
                expect(page.get_by_role('heading', name='Carrinho', exact=True)).to_be_visible()
                expect(page.get_by_role('dialog')).to_contain_text(ROW['produto'])
                expect(page.get_by_role('dialog')).to_contain_text('00000000000191')
                expect(page.get_by_role('dialog')).to_contain_text('36,00')
                page.screenshot(path=str(OUT / f'depois-carrinho-{name}.png'), full_page=True)
                assert not errors, errors
                context.close()
                print(f'{name}: navegação → ficha em tela inteira → seleção → carrinho 3 unidades/TO/R$36,00; sem envio; OK')
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == '__main__':
    main()
