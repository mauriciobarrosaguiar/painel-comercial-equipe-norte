from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime
from typing import Callable, Iterable, Optional

from selenium.common.exceptions import TimeoutException
from selenium.webdriver import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

DEFAULT_TIMEOUT = 25


def _emit(log_fn: Optional[Callable[[str], None]], msg: str) -> None:
    if callable(log_fn):
        log_fn(msg)


def wait(driver: WebDriver, seconds: int = DEFAULT_TIMEOUT) -> WebDriverWait:
    return WebDriverWait(driver, seconds)


def now_str() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M")


def clean_cnpj(cnpj: str) -> str:
    return re.sub(r"\D", "", str(cnpj or ""))


def safe_click(driver: WebDriver, element) -> None:
    try:
        element.click()
    except Exception:
        driver.execute_script("arguments[0].click();", element)


def click_first(driver: WebDriver, selectors: Iterable[tuple], timeout: int, desc: str):
    last = None
    for by, sel in selectors:
        try:
            el = wait(driver, timeout).until(EC.element_to_be_clickable((by, sel)))
            safe_click(driver, el)
            return el
        except Exception as exc:
            last = exc
    raise TimeoutException(f"Nao encontrei/clicavel: {desc}. Ultimo erro: {last}")


def wait_visible(driver: WebDriver, selectors: Iterable[tuple], timeout: int, desc: str):
    last = None
    for by, sel in selectors:
        try:
            return wait(driver, timeout).until(EC.visibility_of_element_located((by, sel)))
        except Exception as exc:
            last = exc
    raise TimeoutException(f"Nao encontrei visivel: {desc}. Ultimo erro: {last}")


def clear_and_type(element, text: str) -> None:
    element.click()
    element.send_keys(Keys.CONTROL, "a")
    element.send_keys(Keys.DELETE)
    element.send_keys(text)


def _texto_pagina(driver: WebDriver) -> str:
    try:
        return (driver.find_element(By.TAG_NAME, "body").text or "").strip()
    except Exception:
        return ""


def _mensagem_sem_vinculo(driver: WebDriver) -> str:
    texto = _normalize_label(_texto_pagina(driver))
    if "nao possui vinculo" in texto or "nao possui vinculo com ponto de venda" in texto:
        return "Representante nao possui vinculo com o ponto de venda solicitado."
    return ""


def extrair_valor_numerico(texto: str, tipo: str = "valor"):
    if not texto:
        return 0.0 if tipo != "estoque" else 0

    texto_limpo = str(texto).replace("R$", "").replace("\xa0", " ").strip()

    if tipo == "estoque":
        nums = re.findall(r"\d+", texto_limpo)
        return int(nums[0]) if nums else 0

    if tipo == "desconto":
        val_temp = texto_limpo.replace("%", "").strip()
        try:
            return float(val_temp.replace(",", ".")) / 100.0
        except Exception:
            return 0.0

    match = re.search(r"\d[\d\.,]*", texto_limpo)
    if not match:
        return 0.0

    try:
        return float(match.group(0).replace(".", "").replace(",", "."))
    except Exception:
        return 0.0


def _normalize_label(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", str(texto or "").lower())
    sem_acento = "".join(char for char in sem_acento if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", sem_acento).strip()


def _find_text_by_keywords(root, keywords: Iterable[str]) -> str:
    wanted = [_normalize_label(keyword) for keyword in keywords if keyword]
    if not wanted:
        return ""

    for by, selector in [
        (By.CSS_SELECTOR, "small"),
        (By.CSS_SELECTOR, "span"),
        (By.CSS_SELECTOR, "p"),
        (By.CSS_SELECTOR, "div"),
    ]:
        try:
            elements = root.find_elements(by, selector)
        except Exception:
            continue
        for element in elements:
            text = (element.text or "").strip()
            if not text:
                continue
            normalized = _normalize_label(text)
            if any(keyword in normalized for keyword in wanted):
                return text
    return ""


def login_mercadofarma(driver: WebDriver, usuario: str, senha: str, log_fn: Optional[Callable[[str], None]] = None) -> None:
    _emit(log_fn, "Abrindo Mercado Farma...")
    driver.get("https://www.mercadofarma.com.br/")

    try:
        click_first(driver, [(By.XPATH, "//button[contains(., 'Rejeitar')]")], timeout=4, desc="rejeitar cookies")
    except Exception:
        pass

    click_first(
        driver,
        [
            (By.XPATH, "//button[.//span[contains(text(), 'Entrar como representante')]]"),
            (By.XPATH, "//*[contains(., 'Entrar como representante') and (self::button or self::a or @role='button')]"),
        ],
        timeout=30,
        desc="Entrar como representante",
    )
    _emit(log_fn, "Etapa login: Active Directory")
    click_first(
        driver,
        [
            (By.ID, "social-saml"),
            (By.CSS_SELECTOR, "#social-saml"),
            (By.XPATH, "//*[contains(@id, 'social-saml') or contains(., 'Active Directory') or contains(., 'Diretório Ativo')]"),
        ],
        timeout=30,
        desc="Active Directory",
    )

    user = wait_visible(driver, [(By.ID, "userNameInput"), (By.NAME, "UserName")], timeout=60, desc="usuario")
    pwd = wait_visible(driver, [(By.ID, "passwordInput"), (By.NAME, "Password")], timeout=20, desc="senha")
    clear_and_type(user, usuario)
    clear_and_type(pwd, senha)

    click_first(driver, [(By.ID, "submitButton")], timeout=20, desc="entrar")
    wait(driver, 90).until(lambda d: "mercadofarma.com.br" in d.current_url.lower() and "adfs" not in d.current_url.lower())
    _emit(log_fn, "Login concluido.")


def selecionar_cnpj_catalogo(driver: WebDriver, cnpj: str, log_fn: Optional[Callable[[str], None]] = None) -> None:
    cnpj = clean_cnpj(cnpj)
    _emit(log_fn, f"Etapa selecao CNPJ: {cnpj}")

    campo = wait_visible(
        driver,
        [
            (By.CSS_SELECTOR, "input[placeholder*='CNPJ']"),
            (By.XPATH, "//input[contains(@placeholder,'CNPJ')]"),
        ],
        timeout=40,
        desc="campo CNPJ",
    )
    clear_and_type(campo, cnpj)
    time.sleep(2)

    item_xpath = (
        f"//*[@data-value and contains(@data-value, '{cnpj}')]"
        f"|//*[contains(., '{cnpj}') and "
        "(@role='option' or @role='button' or self::button or self::a)]"
    )
    try:
        item = wait(driver, 12).until(EC.element_to_be_clickable((By.XPATH, item_xpath)))
    except Exception as exc:
        msg_vinculo = _mensagem_sem_vinculo(driver)
        if msg_vinculo:
            raise TimeoutException(f"CNPJ {cnpj}: {msg_vinculo}") from exc
        raise TimeoutException(f"CNPJ {cnpj}: loja nao encontrada na base do Mercado Farma.") from exc

    safe_click(driver, item)
    time.sleep(2)

    _emit(log_fn, "Etapa catalogo: abrindo Catalogo A a Z")
    try:
        click_first(
            driver,
            [
                (By.XPATH, "//a[contains(., 'Catálogo A a Z') ]"),
                (By.XPATH, "//*[normalize-space()='Catálogo A a Z']"),
                (By.XPATH, "//a[contains(., 'Catalogo A a Z') ]"),
            ],
            timeout=15,
            desc="Catalogo A a Z",
        )
    except Exception as exc:
        msg_vinculo = _mensagem_sem_vinculo(driver)
        if msg_vinculo:
            raise TimeoutException(f"CNPJ {cnpj}: {msg_vinculo}") from exc
        raise
    wait_visible(driver, [(By.NAME, "term")], timeout=30, desc="campo de busca do catalogo")
    _emit(log_fn, "Catalogo carregado.")


def limpar_busca_catalogo(driver: WebDriver):
    campo = wait_visible(
        driver,
        [
            (By.NAME, "term"),
            (By.CSS_SELECTOR, "input[placeholder*='EAN']"),
            (By.CSS_SELECTOR, "input[placeholder*='Procure']"),
        ],
        timeout=20,
        desc="campo de busca do catalogo",
    )
    try:
        campo.click()
        campo.send_keys(Keys.CONTROL, "a")
        campo.send_keys(Keys.DELETE)
    except Exception:
        pass
    try:
        driver.execute_script(
            "arguments[0].value=''; arguments[0].dispatchEvent(new Event('input', {bubbles:true})); arguments[0].dispatchEvent(new Event('change', {bubbles:true}));",
            campo,
        )
    except Exception:
        pass
    return campo


def buscar_ean_catalogo(driver: WebDriver, ean: str) -> None:
    campo = limpar_busca_catalogo(driver)
    campo.send_keys(ean)
    campo.send_keys(Keys.ENTER)
    time.sleep(1.5)


def localizar_card_produto_por_ean(driver: WebDriver, ean: str):
    xpath_card = (
        f"//div[starts-with(@data-testid, 'produtoCard-') and "
        f".//span[normalize-space()='{ean}']]"
    )
    try:
        return wait(driver, 12).until(EC.presence_of_element_located((By.XPATH, xpath_card)))
    except Exception:
        fallback_xpath = (
            "//div[starts-with(@data-testid, 'produtoCard-') and .//small[@role='button' or self::small]]"
        )
        cards = wait(driver, 12).until(lambda d: [el for el in d.find_elements(By.XPATH, fallback_xpath) if el.is_displayed()])
        if len(cards) == 1:
            return cards[0]
        raise


def abrir_lista_distribuidoras(driver: WebDriver, card_produto):
    trigger = wait(driver, 10).until(
        lambda _d: next(
            (
                el
                for el in card_produto.find_elements(By.CSS_SELECTOR, "[data-slot='popover-trigger']")
                if el.is_displayed()
            ),
            None,
        )
    )
    if trigger is None:
        raise TimeoutException("Nao encontrei o trigger das distribuidoras no card do produto.")

    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", trigger)
    driver.execute_script("arguments[0].click();", trigger)

    popover_id = trigger.get_attribute("aria-controls")
    if popover_id:
        xpath_popover = f"//*[@id='{popover_id}' and @data-state='open']"
        return wait(driver, 8).until(EC.visibility_of_element_located((By.XPATH, xpath_popover)))

    return wait(driver, 8).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, "[data-slot='popover-content'][data-state='open']"))
    )


def extrair_nome_produto(card_produto) -> str:
    seletores = [
        "[data-testid*='produtoCard-descricao'] small",
        "[data-testid*='produtoCard-descricao']",
        "small.font-open-sans.font-semibold",
        "small[role='button']",
        "h5",
    ]
    for seletor in seletores:
        try:
            texto = card_produto.find_element(By.CSS_SELECTOR, seletor).text.strip()
            if texto:
                return texto
        except Exception:
            continue
    return ""


def fechar_popover(driver: WebDriver) -> None:
    try:
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.4)
    except Exception:
        pass


def rows_buybox(popover) -> list:
    selectors = [
        (By.CSS_SELECTOR, "[data-test-id='buybox-item']"),
        (By.CSS_SELECTOR, "[data-testid='buybox-item']"),
    ]
    for by, sel in selectors:
        rows = [e for e in popover.find_elements(by, sel) if e.is_displayed()]
        if rows:
            return rows
    return []


def safe_text(root, selectors: Iterable[tuple]) -> str:
    for by, sel in selectors:
        try:
            el = root.find_element(by, sel)
            text = (el.text or "").strip()
            if text:
                return text
        except Exception:
            continue
    return ""


def extract_buybox_row(row, ean: str, nome_produto: str) -> Optional[dict]:
    try:
        nome_dist = safe_text(
            row,
            [
                (By.CSS_SELECTOR, "p.font-open-sans"),
                (By.XPATH, ".//p[contains(@class,'font-open-sans') or contains(@class,'text-black')]"),
            ],
        )
        if not nome_dist:
            nome_dist = "DISTRIBUIDORA NAO IDENTIFICADA"

        estoque_txt = safe_text(
            row,
            [
                (By.CSS_SELECTOR, "small.text-primary"),
                (By.XPATH, ".//small[contains(@class,'text-primary')]"),
            ],
        )
        pf_dist_txt = _find_text_by_keywords(row, ["pf dist", "preco dist", "preco distribuidora"])
        pf_fabrica_txt = _find_text_by_keywords(row, ["pf fabrica", "preco fabrica", "preco de fabrica"])
        preco_final_txt = safe_text(row, [(By.CSS_SELECTOR, "h5"), (By.XPATH, ".//h5")])
        sem_imposto_txt = safe_text(row, [(By.XPATH, ".//small[contains(text(), 'Sem imposto')]")])
        desconto_txt = safe_text(row, [(By.XPATH, ".//span[contains(text(), '%')]")])

        return {
            "EAN": ean,
            "NOME DO PRODUTO": nome_produto,
            "DISTRIBUIDORA": nome_dist,
            "ESTOQUE": extrair_valor_numerico(estoque_txt, "estoque"),
            "DESCONTO (%)": extrair_valor_numerico(desconto_txt, "desconto"),
            "PF DIST. (R$)": extrair_valor_numerico(pf_dist_txt),
            "PF FABRICA (R$)": extrair_valor_numerico(pf_fabrica_txt),
            "PREÇO FINAL (R$)": extrair_valor_numerico(preco_final_txt),
            "SEM IMPOSTO (R$)": extrair_valor_numerico(sem_imposto_txt),
            "DATA": now_str(),
        }
    except Exception:
        return None


def build_not_found_row(ean: str) -> dict:
    return {
        "EAN": ean,
        "NOME DO PRODUTO": "Produto nao encontrado",
        "DISTRIBUIDORA": "",
        "ESTOQUE": 0,
        "DESCONTO (%)": 0.0,
        "PF DIST. (R$)": 0.0,
        "PF FABRICA (R$)": 0.0,
        "PREÇO FINAL (R$)": 0.0,
        "SEM IMPOSTO (R$)": 0.0,
        "DATA": now_str(),
        "STATUS": "NAO ENCONTRADO",
        "ERRO": "EAN nao encontrado no Mercado Farma",
    }


def processar_ean_catalogo(driver: WebDriver, ean: str) -> list[dict]:
    buscar_ean_catalogo(driver, ean)
    popover = None

    try:
        try:
            card_produto = localizar_card_produto_por_ean(driver, ean)
        except TimeoutException:
            return [build_not_found_row(ean)]
        nome_produto = extrair_nome_produto(card_produto) or "NOME NAO IDENTIFICADO"
        popover = abrir_lista_distribuidoras(driver, card_produto)
        wait(driver, 8).until(lambda _d: len(rows_buybox(popover)) > 0)

        registros = []
        for item in rows_buybox(popover):
            row = extract_buybox_row(item, ean, nome_produto)
            if row:
                registros.append(row)

        if not registros:
            raise TimeoutException("Nenhuma distribuidora pode ser lida no buybox.")

        return registros
    finally:
        fechar_popover(driver)
