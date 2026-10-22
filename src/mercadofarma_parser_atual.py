from __future__ import annotations

from src.mercadofarma_inventory import processar_ean_catalogo


def processar_ean_catalogo_atualizado(driver, ean: str) -> list[dict]:
    """
    Compatibilidade do fluxo atual: toda a leitura do Mercado Farma fica
    centralizada no parser V8 portado para mercadofarma_inventory.
    """
    return processar_ean_catalogo(driver, ean)

def _texto_percentual(raiz) -> str:
    """Compatibilidade com relatórios/testes da V8: lê o desconto, sem confundi-lo com preço.

    O processamento real permanece em mercadofarma_inventory. Retorna o percentual
    exatamente como exibido (ex.: '61,17%'), não a fração decimal.
    """
    import re
    from selenium.webdriver.common.by import By

    # Primeiro, etiquetas específicas de desconto; em seguida, spans visíveis.
    for by, seletor in (
        (By.CSS_SELECTOR, "[data-testid^='tag-percentual_desconto-']"),
        (By.CSS_SELECTOR, "[class*='discount']"),
        (By.CSS_SELECTOR, "span"),
    ):
        try:
            elementos = raiz.find_elements(by, seletor)
        except Exception:
            continue
        for item in elementos:
            try:
                if not item.is_displayed():
                    continue
                texto = str(item.text or "")
            except Exception:
                continue
            encontrado = re.search(r"(\\d+(?:[.,]\\d+)?)\\s*%", texto)
            if encontrado:
                return encontrado.group(1) + "%"
    return ""
