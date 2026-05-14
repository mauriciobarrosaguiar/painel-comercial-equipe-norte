from __future__ import annotations

import argparse
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path


BUSSOLA_URL = "https://bussolaweb.bussola.mercadofarma.com.br/login"
MESES_PT = {
    1: ("Jan", "Janeiro"),
    2: ("Fev", "Fevereiro"),
    3: ("Mar", "Marco", "Março"),
    4: ("Abr", "Abril"),
    5: ("Mai", "Maio"),
    6: ("Jun", "Junho"),
    7: ("Jul", "Julho"),
    8: ("Ago", "Agosto"),
    9: ("Set", "Setembro"),
    10: ("Out", "Outubro"),
    11: ("Nov", "Novembro"),
    12: ("Dez", "Dezembro"),
}
MESES_REV = {nome.lower(): mes for mes, nomes in MESES_PT.items() for nome in nomes}


def log(mensagem: str) -> None:
    print(mensagem, flush=True)


def periodo_historico_padrao(hoje: date | None = None) -> tuple[date, date]:
    hoje = hoje or date.today()
    inicio_mes_atual = date(hoje.year, hoje.month, 1)
    inicio = add_months(inicio_mes_atual, -12)
    fim = inicio_mes_atual - timedelta(days=1)
    return inicio, fim


def add_months(data: date, meses: int) -> date:
    total = data.year * 12 + data.month - 1 + meses
    ano = total // 12
    mes = total % 12 + 1
    return date(ano, mes, min(data.day, 28))


def parse_data(valor: str) -> date:
    return datetime.strptime(valor, "%d/%m/%Y").date()


def screenshot(page, pasta: Path, nome: str) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(pasta / nome), full_page=True)


def salvar_erro(page, pasta: Path, exc: Exception) -> None:
    log(f"Erro: {exc}")
    screenshot(page, pasta, "debug_error.png")
    (pasta / "debug_error.html").write_text(page.content(), encoding="utf-8")


def primeiro_visivel(locator):
    for indice in range(locator.count()):
        item = locator.nth(indice)
        try:
            if item.is_visible():
                return item
        except Exception:
            continue
    return locator.first


def ler_mes_exibido(page) -> tuple[int, int, str]:
    candidatos = page.locator(
        ".rdp-caption_label, .rdp-caption span, .rdp-caption_start span, [data-slot='caption-label'], span"
    )
    textos = []
    for indice in range(min(candidatos.count(), 80)):
        item = candidatos.nth(indice)
        try:
            if item.is_visible():
                texto = item.inner_text(timeout=1000).strip()
                if texto:
                    textos.append(texto)
        except Exception:
            continue
    for texto in textos:
        match = re.search(r"([A-Za-zÀ-ÿ]{3,9})\s+(\d{4})", texto)
        if not match:
            continue
        mes_nome = match.group(1).lower()
        ano = int(match.group(2))
        if mes_nome in MESES_REV:
            return MESES_REV[mes_nome], ano, texto
    raise RuntimeError(f"Nao consegui identificar o mes exibido no calendario. Textos: {textos[:10]}")


def navegar_para_mes(page, alvo: date, debug_dir: Path) -> None:
    for _ in range(36):
        mes, ano, caption = ler_mes_exibido(page)
        log(f"Mes atual exibido: {caption}")
        if mes == alvo.month and ano == alvo.year:
            return
        atual_ordem = ano * 12 + mes
        alvo_ordem = alvo.year * 12 + alvo.month
        if atual_ordem > alvo_ordem:
            log("Voltando para mes anterior")
            page.locator("button[name='previous-month']").click()
        else:
            log("Avancando para proximo mes")
            page.locator("button[name='next-month']").click()
        page.wait_for_timeout(250)
    screenshot(page, debug_dir, "debug_error_mes.png")
    raise RuntimeError(f"Nao consegui navegar ate {alvo:%m/%Y}")


def selecionar_data(page, alvo: date, debug_dir: Path) -> None:
    navegar_para_mes(page, alvo, debug_dir)
    log(f"Selecionando dia {alvo.day:02d}")
    botoes = page.locator("button[name='day']")
    for indice in range(botoes.count()):
        botao = botoes.nth(indice)
        try:
            texto = botao.inner_text(timeout=1000).strip()
            classe = botao.get_attribute("class") or ""
            if texto == str(alvo.day) and "day-outside" not in classe and botao.is_visible():
                botao.click()
                page.wait_for_timeout(300)
                return
        except Exception:
            continue
    screenshot(page, debug_dir, f"debug_error_dia_{alvo:%Y_%m_%d}.png")
    raise RuntimeError(f"Nao encontrei o dia {alvo:%d/%m/%Y} dentro do mes exibido")


def login_bussola(page, usuario: str, senha: str, debug_dir: Path) -> None:
    log("Abrindo Bussola")
    page.goto(BUSSOLA_URL, wait_until="domcontentloaded", timeout=90000)
    screenshot(page, debug_dir, "debug_01_login.png")

    log("Clicando em Entrar")
    page.get_by_role("link", name=re.compile("Entrar", re.I)).click(timeout=30000)

    log("Clicando em Active Directory")
    page.get_by_text(re.compile("Active Directory", re.I)).click(timeout=45000)

    log("Preenchendo login")
    page.locator("#userNameInput").fill(usuario, timeout=60000)
    page.locator("#passwordInput").fill(senha, timeout=30000)
    page.locator("#submitButton").click()
    page.wait_for_url(lambda url: "login" not in url.lower(), timeout=90000)
    screenshot(page, debug_dir, "debug_02_pos_login.png")


def abrir_filtros_calendario(page, debug_dir: Path) -> None:
    log("Clicando em Filtros")
    page.get_by_role("button", name=re.compile("Filtros", re.I)).click(timeout=45000)
    screenshot(page, debug_dir, "debug_03_filtros_aberto.png")

    log("Abrindo calendario")
    page.locator("#date").click(timeout=30000)
    page.wait_for_selector("button[name='previous-month']", timeout=30000)
    screenshot(page, debug_dir, "debug_04_calendario_aberto.png")


def validar_periodo(page, inicio: date, fim: date) -> None:
    log("Clicando em Concluir")
    page.get_by_role("button", name=re.compile("Concluir", re.I)).click(timeout=30000)
    esperado = f"{inicio:%d/%m/%Y} - {fim:%d/%m/%Y}"
    campo = page.locator("#date").inner_text(timeout=10000).strip()
    log(f"Periodo no campo: {campo}")
    if esperado not in campo:
        raise RuntimeError(f"Periodo selecionado incorreto. Esperado '{esperado}', obtido '{campo}'.")


def executar(args) -> None:
    from playwright.sync_api import sync_playwright

    usuario = args.usuario or os.getenv("BUSSOLA_USUARIO")
    senha = args.senha or os.getenv("BUSSOLA_SENHA")
    if not usuario or not senha:
        raise SystemExit("Informe --usuario/--senha ou as variaveis BUSSOLA_USUARIO/BUSSOLA_SENHA.")

    inicio, fim = (parse_data(args.inicio), parse_data(args.fim)) if args.inicio and args.fim else periodo_historico_padrao()
    debug_dir = Path(args.debug_dir)
    debug_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless, slow_mo=args.slow_mo)
        context = browser.new_context(viewport={"width": 1366, "height": 900}, accept_downloads=True)
        page = context.new_page()
        try:
            login_bussola(page, usuario, senha, debug_dir)
            abrir_filtros_calendario(page, debug_dir)
            selecionar_data(page, inicio, debug_dir)
            screenshot(page, debug_dir, "debug_05_mes_inicial.png")
            selecionar_data(page, fim, debug_dir)
            screenshot(page, debug_dir, "debug_06_data_selecionada.png")
            validar_periodo(page, inicio, fim)
            log("Debug concluido com periodo correto.")
        except Exception as exc:
            salvar_erro(page, debug_dir, exc)
            raise
        finally:
            context.close()
            browser.close()


def main() -> None:
    inicio_padrao, fim_padrao = periodo_historico_padrao()
    parser = argparse.ArgumentParser(description="Debug visual do calendario do Bussola Web.")
    parser.add_argument("--usuario", default="")
    parser.add_argument("--senha", default="")
    parser.add_argument("--inicio", default=inicio_padrao.strftime("%d/%m/%Y"))
    parser.add_argument("--fim", default=fim_padrao.strftime("%d/%m/%Y"))
    parser.add_argument("--debug-dir", default="debug_bussola")
    parser.add_argument("--headless", action="store_true", help="Rodar sem janela. O padrao e visual.")
    parser.add_argument("--slow-mo", type=int, default=500)
    executar(parser.parse_args())


if __name__ == "__main__":
    main()
