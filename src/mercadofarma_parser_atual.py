from __future__ import annotations

import re
from typing import Iterable

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By

from src import mercadofarma_inventory as antigo


_PERCENTUAL_RE = re.compile(r"(?<!\d)(\d{1,3}(?:[\.,]\d{1,2})?)\s*%")


def _texto(root, selectors: Iterable[tuple]) -> str:
    return antigo.safe_text(root, selectors)


def _texto_percentual(root) -> str:
    """Lê o desconto visível da própria oferta, sem herdar o badge de outra distribuidora."""
    if root is None:
        return ""
    candidatos: list[tuple[int, int, str]] = []
    seletores = [
        "[data-testid*='discount']",
        "[data-test-id*='discount']",
        "[class*='discount']",
        "span",
        "small",
        "p",
        "div",
    ]
    vistos: set[str] = set()
    for seletor in seletores:
        try:
            elementos = root.find_elements(By.CSS_SELECTOR, seletor)
        except Exception:
            continue
        for elemento in elementos:
            identificador = getattr(elemento, "id", "") or str(id(elemento))
            if identificador in vistos:
                continue
            vistos.add(identificador)
            try:
                if hasattr(elemento, "is_displayed") and not elemento.is_displayed():
                    continue
                texto = (elemento.text or "").strip()
            except Exception:
                continue
            if not texto:
                continue
            for percentual in _PERCENTUAL_RE.findall(texto):
                valor = float(percentual.replace(",", "."))
                if 0 <= valor <= 100:
                    exato = 0 if _PERCENTUAL_RE.fullmatch(texto) else 1
                    candidatos.append((exato, len(texto), f"{percentual}%"))
    if not candidatos:
        try:
            texto_raiz = (root.text or "").strip()
        except Exception:
            texto_raiz = ""
        correspondencia = _PERCENTUAL_RE.search(texto_raiz)
        return correspondencia.group(0) if correspondencia else ""
    candidatos.sort(key=lambda item: (item[0], item[1]))
    return candidatos[0][2]


def _linhas_genericas(popover) -> list:
    candidatos = []
    vistos: set[str] = set()

    seletores = [
        "[data-test-id='buybox-item']",
        "[data-testid='buybox-item']",
        "[data-testid*='buybox-item']",
        "[role='option']",
    ]
    for seletor in seletores:
        try:
            for item in popover.find_elements(By.CSS_SELECTOR, seletor):
                if not item.is_displayed():
                    continue
                identificador = getattr(item, 'id', '') or str(id(item))
                if identificador not in vistos:
                    vistos.add(identificador)
                    candidatos.append(item)
        except Exception:
            continue

    if candidatos:
        return candidatos

    try:
        precos = popover.find_elements(By.XPATH, ".//*[self::h4 or self::h5][contains(normalize-space(.),'R$')]")
    except Exception:
        precos = []

    for preco in precos:
        atual = preco
        escolhido = None
        for _ in range(6):
            try:
                atual = atual.find_element(By.XPATH, "..")
                texto = (atual.text or '').strip().lower()
            except Exception:
                break
            if 'dispon' in texto and 'r$' in texto:
                escolhido = atual
                break
        if escolhido is None:
            continue
        identificador = getattr(escolhido, 'id', '') or str(id(escolhido))
        if identificador not in vistos:
            vistos.add(identificador)
            candidatos.append(escolhido)

    return candidatos


def _extrair_linha(root, ean: str, nome_produto: str, desconto_root=None):
    nome_dist = _texto(root, [
        (By.CSS_SELECTOR, "p.font-open-sans"),
        (By.CSS_SELECTOR, "p"),
        (By.XPATH, ".//p[contains(@class,'text-neutral-low-medium') or contains(@class,'font-semibold')]")
    ])
    estoque_txt = _texto(root, [
        (By.CSS_SELECTOR, "small.text-primary"),
        (By.XPATH, ".//*[contains(normalize-space(.),'disponíveis') or contains(normalize-space(.),'disponiveis')]")
    ])
    pf_dist_txt = antigo._find_text_by_keywords(root, ['pf dist', 'preco dist', 'preco distribuidora'])
    pf_fabrica_txt = antigo._find_text_by_keywords(root, ['pf fabrica', 'preco fabrica', 'preco de fabrica'])
    preco_final_txt = _texto(root, [
        (By.CSS_SELECTOR, 'h4'),
        (By.CSS_SELECTOR, 'h5'),
        (By.XPATH, ".//*[self::h4 or self::h5][contains(normalize-space(.),'R$')]")
    ])
    sem_imposto_txt = antigo._find_text_by_keywords(root, ['sem imposto'])
    desconto_txt = _texto_percentual(desconto_root or root)

    if not nome_dist or not preco_final_txt:
        return None

    return {
        'EAN': ean,
        'NOME DO PRODUTO': nome_produto,
        'DISTRIBUIDORA': nome_dist,
        'ESTOQUE': antigo.extrair_valor_numerico(estoque_txt, 'estoque'),
        'DESCONTO (%)': antigo.extrair_valor_numerico(desconto_txt, 'desconto'),
        'PF DIST. (R$)': antigo.extrair_valor_numerico(pf_dist_txt),
        'PF FABRICA (R$)': antigo.extrair_valor_numerico(pf_fabrica_txt),
        'PREÇO FINAL (R$)': antigo.extrair_valor_numerico(preco_final_txt),
        'SEM IMPOSTO (R$)': antigo.extrair_valor_numerico(sem_imposto_txt),
        'DATA': antigo.now_str(),
        'STATUS': 'OK',
        'ERRO': '',
    }


def _extrair_buybox_principal(card_produto, ean: str, nome_produto: str) -> list[dict]:
    try:
        buybox = card_produto.find_element(By.CSS_SELECTOR, "[data-testid*='produtoCard-buybox']")
    except Exception:
        return []
    linha = _extrair_linha(buybox, ean, nome_produto, desconto_root=card_produto)
    return [linha] if linha else []


def processar_ean_catalogo_atualizado(driver, ean: str) -> list[dict]:
    antigo.buscar_ean_catalogo(driver, ean)
    popover = None
    try:
        try:
            card_produto = antigo.localizar_card_produto_por_ean(driver, ean)
        except TimeoutException:
            return [antigo.build_not_found_row(ean)]

        nome_produto = antigo.extrair_nome_produto(card_produto)
        if not nome_produto:
            nome_produto = _texto(card_produto, [
                (By.CSS_SELECTOR, "[data-testid*='produtoCard-descricao'] p"),
                (By.CSS_SELECTOR, "[data-testid*='produtoCard-descricao']"),
                (By.CSS_SELECTOR, 'h2'),
            ]) or 'NOME NAO IDENTIFICADO'

        principal = _extrair_buybox_principal(card_produto, ean, nome_produto)

        try:
            popover = antigo.abrir_lista_distribuidoras(driver, card_produto)
            linhas = _linhas_genericas(popover)
            registros = []
            for item in linhas:
                linha = _extrair_linha(item, ean, nome_produto, desconto_root=item)
                if linha:
                    registros.append(linha)
            if registros:
                unicos = {}
                for linha in registros:
                    chave = str(linha.get('DISTRIBUIDORA', '')).strip().upper()
                    if chave:
                        unicos[chave] = linha
                return list(unicos.values()) or registros
        except Exception:
            pass

        if principal:
            return principal
        raise TimeoutException('Nenhuma distribuidora pôde ser lida no card do produto.')
    finally:
        if popover is not None:
            antigo.fechar_popover(driver)
