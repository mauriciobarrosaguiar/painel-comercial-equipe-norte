from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime
from urllib.parse import urlsplit
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
    if texto is None:
        return 0.0 if tipo != "estoque" else 0

    texto_limpo = str(texto).replace("R$", "").replace("\xa0", " ").strip()

    if tipo == "estoque":
        nums = re.findall(r"\d+", texto_limpo)
        return int(nums[0]) if nums else 0

    if tipo == "desconto":
        valor = re.sub(r"[^0-9,.-]", "", texto_limpo)
        if not valor:
            return 0.0
        try:
            return float(valor.replace(",", ".")) / 100.0
        except ValueError:
            return 0.0

    match = re.search(r"\d[\d\.,]*", texto_limpo)
    if not match:
        return 0.0

    valor_sujo = match.group(0)
    try:
        if "," in valor_sujo and "." in valor_sujo:
            valor_sujo = valor_sujo.replace(".", "").replace(",", ".")
        elif "," in valor_sujo:
            valor_sujo = valor_sujo.replace(",", ".")
        elif valor_sujo.count(".") > 1:
            partes = valor_sujo.split(".")
            valor_sujo = "".join(partes[:-1]) + "." + partes[-1]
        return float(valor_sujo)
    except ValueError:
        return 0.0


def _obter_texto(elemento) -> str:
    try:
        return (elemento.text or "").replace("\xa0", " ").strip()
    except Exception:
        return ""


def _primeiro_elemento_visivel(elementos):
    for elemento in elementos:
        try:
            if elemento.is_displayed():
                return elemento
        except Exception:
            continue
    return None


def _achar_elemento_visivel(container, selectors_css=None, xpaths=None):
    selectors_css = selectors_css or []
    xpaths = xpaths or []

    for seletor in selectors_css:
        try:
            elemento = _primeiro_elemento_visivel(container.find_elements(By.CSS_SELECTOR, seletor))
            if elemento:
                return elemento
        except Exception:
            pass

    for xpath in xpaths:
        try:
            elemento = _primeiro_elemento_visivel(container.find_elements(By.XPATH, xpath))
            if elemento:
                return elemento
        except Exception:
            pass

    return None


def _extrair_percentual_do_elemento(elemento) -> float:
    if not elemento:
        return 0.0
    texto = _obter_texto(elemento)
    match = re.search(r"(\d+(?:[\.,]\d+)?)\s*%", texto)
    if not match:
        return 0.0
    return extrair_valor_numerico(match.group(1) + "%", "desconto")

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

    def resultado_login(d):
        atual = str(d.current_url or "").lower()
        if "mercadofarma.com.br" in atual and "adfs" not in atual:
            return "ok"
        texto = _normalize_label(_texto_pagina(d))
        erros_credencial = [
            "incorrect user id or password",
            "usuario ou senha incorreto",
            "usuario e senha incorretos",
            "senha incorreta",
            "credenciais invalidas",
        ]
        if any(erro in texto for erro in erros_credencial):
            return "credencial_invalida"
        return False

    try:
        resultado = wait(driver, 90).until(resultado_login)
    except TimeoutException as exc:
        atual = urlsplit(str(driver.current_url or ""))
        local = f"{atual.scheme}://{atual.netloc}{atual.path}" if atual.netloc else atual.path
        tela = _texto_pagina(driver)
        tela = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "***@***", tela, flags=re.I)
        tela = re.sub(r"\s+", " ", tela).strip()[:1200]
        raise TimeoutException(
            f"ADFS nao retornou ao Mercado Farma. Pagina atual: {local or 'desconhecida'}. "
            f"Mensagem visivel: {tela or 'nenhuma'}"
        ) from exc

    if resultado == "credencial_invalida":
        raise RuntimeError(
            "O Mercado Farma recusou o usuario ou a senha. Atualize o acesso pessoal em "
            "Administracao > Acesso pessoal do Mercado Farma e execute novamente."
        )

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
    """
    O Mercado Farma novo expõe a descrição em
    div[data-testid^='produtoCard-descricao-']. A busca já foi feita pelo EAN,
    então o primeiro card visível é um fallback seguro quando o EAN não aparece
    no texto do card.
    """
    ean_limpo = re.sub(r"\D", "", str(ean or ""))

    def localizar(d):
        elementos = d.find_elements(By.CSS_SELECTOR, "div[data-testid^='produtoCard-descricao-']")
        visiveis = [el for el in elementos if el.is_displayed()]
        if not visiveis:
            return False

        for el in visiveis:
            try:
                bloco = el.find_element(By.XPATH, "ancestor::div[1]")
                texto = (_obter_texto(el) + " " + _obter_texto(bloco)).replace(" ", "")
                if ean_limpo and ean_limpo in re.sub(r"\D", "", texto):
                    return el
            except Exception:
                pass

        return visiveis[0]

    return wait(driver, 12).until(localizar)


def extrair_nome_produto(card_produto) -> str:
    elemento = _achar_elemento_visivel(
        card_produto,
        selectors_css=[
            "p[data-state='closed']",
            "[data-testid^='produtoCard-descricao-'] p",
            "p",
        ],
    )
    if elemento:
        return _obter_texto(elemento)
    return _obter_texto(card_produto)


def _localizar_trigger_distribuidora(driver: WebDriver, card_produto):
    candidatos = []

    try:
        candidatos.extend(
            card_produto.find_elements(
                By.CSS_SELECTOR,
                "[data-slot='popover-trigger'][aria-haspopup='dialog'], "
                "[data-slot='popover-trigger'][aria-controls]",
            )
        )
    except Exception:
        pass

    try:
        container = card_produto.find_element(
            By.XPATH,
            "ancestor::*[.//*[@data-slot='popover-trigger']][1]",
        )
        candidatos.extend(
            container.find_elements(
                By.CSS_SELECTOR,
                "[data-slot='popover-trigger'][aria-haspopup='dialog'], "
                "[data-slot='popover-trigger'][aria-controls]",
            )
        )
    except Exception:
        pass

    vistos = set()
    for elemento in candidatos:
        try:
            if not elemento.is_displayed():
                continue
            chave = getattr(elemento, "id", "") or str(id(elemento))
            if chave in vistos:
                continue
            vistos.add(chave)
            return elemento
        except Exception:
            continue

    try:
        container = card_produto.find_element(
            By.XPATH,
            "ancestor::*[.//*[@aria-haspopup='dialog' and @aria-controls]][1]",
        )
        for elemento in container.find_elements(
            By.CSS_SELECTOR,
            "[aria-haspopup='dialog'][aria-controls]",
        ):
            if elemento.is_displayed():
                return elemento
    except Exception:
        pass

    raise TimeoutException("Nao encontrei o botao da distribuidora no card do produto.")


def abrir_lista_distribuidoras(driver: WebDriver, card_produto):
    trigger = _localizar_trigger_distribuidora(driver, card_produto)

    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
        trigger,
    )
    time.sleep(0.25)

    try:
        aberto = (trigger.get_attribute("aria-expanded") or "").lower() == "true"
    except Exception:
        aberto = False

    if not aberto:
        safe_click(driver, trigger)

    try:
        wait(driver, 5).until(
            lambda _d: (
                (trigger.get_attribute("aria-expanded") or "").lower() == "true"
                or (trigger.get_attribute("data-state") or "").lower() == "open"
            )
        )
    except Exception:
        pass

    popover = None
    try:
        popover_id = trigger.get_attribute("aria-controls")
        if popover_id:
            popover = wait(driver, 8).until(
                EC.visibility_of_element_located(
                    (By.XPATH, f"//*[@id={repr(popover_id)} and @data-state='open']")
                )
            )
    except Exception:
        popover = None

    if popover is None:
        popover = wait(driver, 8).until(
            EC.visibility_of_element_located(
                (
                    By.CSS_SELECTOR,
                    "[data-slot='popover-content'][data-state='open'][role='dialog'], "
                    "[data-slot='popover-content'][data-state='open']",
                )
            )
        )
    return popover


def fechar_popover(driver: WebDriver) -> None:
    try:
        ActionChains(driver).send_keys(Keys.ESCAPE).perform()
    except Exception:
        pass
    time.sleep(0.3)


def rows_buybox(popover) -> list:
    try:
        itens = popover.find_elements(By.CSS_SELECTOR, "[data-test-id='buybox-item']")
        itens = [item for item in itens if item.is_displayed()]
        if itens:
            return itens
    except Exception:
        pass

    try:
        itens = popover.find_elements(By.CSS_SELECTOR, "[data-testid='buybox-item']")
        itens = [item for item in itens if item.is_displayed()]
        if itens:
            return itens
    except Exception:
        pass

    try:
        itens = popover.find_elements(
            By.XPATH,
            ".//div[.//small[contains(normalize-space(.), 'un. disponíveis') or "
            "contains(normalize-space(.), 'un. disponiveis')] and (.//h4 or .//h5) and .//p]",
        )
        return [item for item in itens if item.is_displayed()]
    except Exception:
        return []


def safe_text(root, selectors: Iterable[tuple]) -> str:
    for by, sel in selectors:
        try:
            el = root.find_element(by, sel)
            text = _obter_texto(el)
            if text:
                return text
        except Exception:
            continue
    return ""


def _extrair_nome_distribuidora(item) -> str:
    try:
        textos = []
        for p in item.find_elements(By.CSS_SELECTOR, "p"):
            if p.is_displayed():
                txt = _obter_texto(p)
                if txt:
                    textos.append(txt)
        return textos[0] if textos else ""
    except Exception:
        return ""


def _extrair_estoque(item) -> int:
    elemento = _achar_elemento_visivel(
        item,
        xpaths=[
            ".//small[contains(normalize-space(.), 'un. disponíveis')]",
            ".//small[contains(normalize-space(.), 'un. disponiveis')]",
        ],
    )
    return extrair_valor_numerico(_obter_texto(elemento), "estoque") if elemento else 0


def _extrair_desconto(item) -> float:
    elemento = _achar_elemento_visivel(
        item,
        selectors_css=["[data-testid^='tag-percentual_desconto-']"],
        xpaths=[".//span[contains(normalize-space(.), '%')]"],
    )
    return _extrair_percentual_do_elemento(elemento)


def _extrair_preco_fabrica(item) -> float:
    elemento = _achar_elemento_visivel(item, selectors_css=["del"], xpaths=[".//del"])
    return extrair_valor_numerico(_obter_texto(elemento)) if elemento else 0.0


def _extrair_h5_sem_imposto(item) -> float:
    elemento = _achar_elemento_visivel(item, selectors_css=["h5"], xpaths=[".//h5"])
    return extrair_valor_numerico(_obter_texto(elemento)) if elemento else 0.0


def _extrair_preco_com_imposto(item) -> float:
    try:
        elementos = item.find_elements(
            By.XPATH,
            ".//small[contains(translate(normalize-space(.), 'IMPOSTO', 'imposto'), 'com imposto:')]",
        )
        for el in elementos:
            txt = _obter_texto(el)
            match = re.search(r"com\s*imposto\s*:\s*(?:R\$)?\s*([0-9\.,]+)", txt, re.I)
            if match:
                return extrair_valor_numerico(match.group(1))
            valor = extrair_valor_numerico(txt)
            if valor:
                return valor
    except Exception:
        pass
    return 0.0


def extract_buybox_row(row, ean: str, nome_produto: str) -> Optional[dict]:
    try:
        nome_dist = _extrair_nome_distribuidora(row)
        if not nome_dist:
            return None

        estoque = _extrair_estoque(row)
        desconto = _extrair_desconto(row)
        pf_fabrica = _extrair_preco_fabrica(row)

        # A versão V8 fornecida passou a ler o valor riscado (<del>) como base
        # de preço da oferta. Mantemos também PF Fábrica no schema atual.
        pf_dist_txt = _find_text_by_keywords(row, ["pf dist", "preco dist", "preco distribuidora"])
        pf_dist = extrair_valor_numerico(pf_dist_txt) or pf_fabrica

        preco_sem_imposto = _extrair_h5_sem_imposto(row)
        preco_com_imposto = _extrair_preco_com_imposto(row)
        preco_final = preco_com_imposto if preco_com_imposto > 0 else preco_sem_imposto

        return {
            "EAN": ean,
            "NOME DO PRODUTO": nome_produto,
            "DISTRIBUIDORA": nome_dist,
            "ESTOQUE": estoque,
            "DESCONTO (%)": desconto,
            "PF DIST. (R$)": pf_dist,
            "PF FABRICA (R$)": pf_fabrica,
            "PREÇO FINAL (R$)": preco_final,
            "SEM IMPOSTO (R$)": preco_sem_imposto,
            "DATA": now_str(),
            "STATUS": "OK",
            "ERRO": "",
        }
    except Exception:
        return None


def _coletar_distribuidores_do_produto(popover, ean: str, nome_produto: str) -> list[dict]:
    time.sleep(0.25)
    itens = rows_buybox(popover)
    resultados: list[dict] = []
    chaves = set()

    for item in itens:
        row = extract_buybox_row(item, ean, nome_produto)
        if not row:
            continue
        chave = (
            str(row.get("DISTRIBUIDORA", "")).strip().lower(),
            int(row.get("ESTOQUE") or 0),
            round(float(row.get("PREÇO FINAL (R$)") or 0), 4),
        )
        if chave in chaves:
            continue
        chaves.add(chave)
        resultados.append(row)

    return resultados

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
        registros = _coletar_distribuidores_do_produto(popover, ean, nome_produto)

        if not registros:
            raise TimeoutException("Lista de distribuidoras nao identificada no popover do produto.")

        return registros
    finally:
        if popover is not None:
            fechar_popover(driver)

