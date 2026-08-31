from __future__ import annotations

import argparse
import re
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

from scripts import importar_mercadofarma_d1 as d1
from src.configuracoes import carregar_login_bussola
from src.datas import agora_brasilia
from src.mercado_farma import carregar_credenciais_mercadofarma, criar_driver
from src.mercadofarma_inventory import login_mercadofarma, selecionar_cnpj_catalogo
from src.tratamento import normalizar_cnpj

URL_SELECIONAR_LOJA = "https://www.mercadofarma.com.br/selecionar-loja"
URL_PEDIDOS = "https://www.mercadofarma.com.br/meus-pedidos"
MAX_PAGINAS_PEDIDOS = 250
MAX_PAGINAS_ITENS = 100

RE_CRIADO = re.compile(
    r"Criado\s+(\d{2}/\d{2}/\d{4})\s+[àa]s\s+(\d{2}:\d{2})\s+por\s+([^\s]+)",
    re.IGNORECASE,
)
RE_PEDIDO = re.compile(r"PEDIDO\s+(\d+)", re.IGNORECASE)
RE_EAN = re.compile(r"\b(\d{8,14})\b")


def log(msg: str) -> None:
    print(msg, flush=True)


def texto(value: Any) -> str:
    return "" if value is None else str(value).strip()


def data_iso_br(value: str) -> str:
    try:
        return datetime.strptime(texto(value), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def validar_data_iso(value: str, nome: str) -> str:
    value = texto(value)
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{nome} deve estar no formato AAAA-MM-DD.") from exc
    return value


def numero_br(value: Any) -> float:
    raw = texto(value)
    if not raw or raw == "-":
        return 0.0
    negativo = raw.startswith("-") or "-R$" in raw.replace(" ", "")
    raw = raw.replace("R$", "").replace("%", "").replace(" ", "").replace("-", "")
    raw = re.sub(r"[^0-9,.-]", "", raw)
    if not raw:
        return 0.0
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        value_num = float(raw)
    except ValueError:
        return 0.0
    return -value_num if negativo else value_num


def inteiro(value: Any) -> int:
    try:
        return int(round(numero_br(value)))
    except Exception:
        return 0


def linhas_d1(data: dict) -> list[dict]:
    result = data.get("result") or []
    if not result or not isinstance(result[0], dict):
        return []
    rows = result[0].get("results") or []
    return rows if isinstance(rows, list) else []


def carregar_clientes(database_id: str, uf: str) -> list[dict]:
    dados = d1.executar(
        database_id,
        """
        SELECT
          c.cnpj,
          COALESCE(c.nome_fantasia,c.razao_social,'') AS cliente_nome,
          UPPER(TRIM(COALESCE(c.uf,''))) AS cliente_uf,
          COALESCE(co.nome,'') AS consultor_nome
        FROM clientes c
        LEFT JOIN consultores co ON co.id=c.consultor_id
        WHERE c.carteira_importada=1
          AND c.ativo=1
          AND UPPER(TRIM(COALESCE(c.uf,'')))=?
          AND LENGTH(TRIM(COALESCE(c.cnpj,'')))=14
        ORDER BY COALESCE(co.nome,''),COALESCE(c.nome_fantasia,c.razao_social,''),c.cnpj
        """,
        [uf],
    )
    saida: list[dict] = []
    vistos: set[str] = set()
    for item in linhas_d1(dados):
        cnpj = normalizar_cnpj(item.get("cnpj"))
        if not cnpj or cnpj in vistos:
            continue
        vistos.add(cnpj)
        saida.append({
            "cnpj": cnpj,
            "cliente_nome": texto(item.get("cliente_nome")),
            "cliente_uf": texto(item.get("cliente_uf")).upper(),
            "consultor_nome": texto(item.get("consultor_nome")),
        })
    return saida


def criar_execucao(database_id: str, uf: str, inicio: str, fim: str, total_clientes: int) -> str:
    execucao_id = d1.id_estavel("mfpe", uf, inicio, fim, agora_brasilia().isoformat())
    d1.executar(
        database_id,
        """
        INSERT INTO mercadofarma_pedidos_execucoes(
          id,uf,inicio_periodo,fim_periodo,status,clientes_total,iniciado_em,mensagem
        ) VALUES(?,?,?,?,?,?,?,?)
        """,
        [
            execucao_id, uf, inicio, fim, "executando", total_clientes,
            agora_brasilia().isoformat(),
            "Extração iniciada.",
        ],
    )
    return execucao_id


def atualizar_execucao(
    database_id: str,
    execucao_id: str,
    *,
    processados: int,
    erros: int,
    pedidos: int,
    itens: int,
    mensagem: str = "",
    status: str = "executando",
    erro: str = "",
    finalizar: bool = False,
) -> None:
    finalizado = agora_brasilia().isoformat() if finalizar else None
    d1.executar(
        database_id,
        """
        UPDATE mercadofarma_pedidos_execucoes
           SET status=?,
               clientes_processados=?,
               clientes_com_erro=?,
               pedidos_total=?,
               itens_total=?,
               mensagem=?,
               erro=?,
               finalizado_em=COALESCE(?,finalizado_em)
         WHERE id=?
        """,
        [
            status, processados, erros, pedidos, itens, texto(mensagem), texto(erro),
            finalizado, execucao_id,
        ],
    )


def card_root(driver, button):
    return driver.execute_script(
        """
        let node = arguments[0];
        for (let i = 0; node && i < 10; i++, node = node.parentElement) {
          const txt = (node.innerText || '').trim();
          if (/PEDIDO\s+\d+/i.test(txt) && /Distribuidor/i.test(txt) && /Total/i.test(txt)) return node;
        }
        return arguments[0].parentElement;
        """,
        button,
    )


def card_snapshots(driver) -> list[dict]:
    buttons = [
        item for item in driver.find_elements(By.XPATH, "//button[contains(normalize-space(.),'Detalhes do pedido')]")
        if item.is_displayed()
    ]
    snapshots: list[dict] = []
    vistos: set[str] = set()
    for button in buttons:
        try:
            root = card_root(driver, button)
            raw = texto(root.text)
        except StaleElementReferenceException:
            continue
        match_pedido = RE_PEDIDO.search(raw)
        match_criado = RE_CRIADO.search(raw)
        if not match_pedido or not match_criado:
            continue
        pedido_numero = match_pedido.group(1)
        if pedido_numero in vistos:
            continue
        vistos.add(pedido_numero)
        data_br, hora, criado_por = match_criado.groups()
        data_criacao = data_iso_br(data_br)

        linhas = [item.strip() for item in raw.splitlines() if item.strip()]
        status = ""
        try:
            pos = next(i for i, line in enumerate(linhas) if RE_PEDIDO.search(line))
            if pos + 1 < len(linhas) and linhas[pos + 1].lower() not in {"distribuidor", "laboratório", "laboratorio"}:
                status = linhas[pos + 1]
        except StopIteration:
            pass

        distribuidora = ""
        laboratorio = ""
        total = 0.0
        for index, line in enumerate(linhas):
            lower = line.lower()
            if lower == "distribuidor" and index + 1 < len(linhas):
                distribuidora = linhas[index + 1]
            elif lower in {"laboratório", "laboratorio"} and index + 1 < len(linhas):
                laboratorio = linhas[index + 1]
            elif lower == "total" and index + 1 < len(linhas):
                total = numero_br(linhas[index + 1])

        snapshots.append({
            "pedido_numero": pedido_numero,
            "status": status,
            "data_criacao": data_criacao,
            "hora_criacao": hora,
            "criado_em": f"{data_criacao}T{hora}:00-03:00" if data_criacao else "",
            "criado_por": criado_por,
            "distribuidora": distribuidora,
            "laboratorio": laboratorio,
            "total_pedido": total,
        })
    return snapshots


def localizar_card_por_pedido(driver, pedido_numero: str):
    for button in driver.find_elements(By.XPATH, "//button[contains(normalize-space(.),'Detalhes do pedido')]"):
        if not button.is_displayed():
            continue
        try:
            root = card_root(driver, button)
            if re.search(rf"PEDIDO\s+{re.escape(pedido_numero)}\b", texto(root.text), re.IGNORECASE):
                return root, button
        except StaleElementReferenceException:
            continue
    raise TimeoutException(f"Pedido {pedido_numero}: card não localizado para abrir detalhes.")


def modal_root(driver):
    heading = WebDriverWait(driver, 20).until(
        lambda d: next(
            (
                el for el in d.find_elements(By.XPATH, "//*[normalize-space()='Detalhes do pedido']")
                if el.is_displayed()
            ),
            None,
        )
    )
    root = driver.execute_script(
        """
        let node = arguments[0];
        for (let i = 0; node && i < 12; i++, node = node.parentElement) {
          const txt = (node.innerText || '');
          if (/Informações de pagamento/i.test(txt) && /Itens do pedido/i.test(txt)) return node;
        }
        return arguments[0].parentElement;
        """,
        heading,
    )
    return root


def abrir_detalhe(driver, pedido_numero: str):
    _, button = localizar_card_por_pedido(driver, pedido_numero)
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
    driver.execute_script("arguments[0].click();", button)
    return modal_root(driver)


def extrair_valor_label(raw: str, label: str) -> str:
    pattern = re.compile(rf"{re.escape(label)}\s+([^\n]+)", re.IGNORECASE)
    match = pattern.search(raw)
    return texto(match.group(1)) if match else ""


def extrair_resumo_modal(root, base: dict) -> dict:
    raw = texto(root.text)
    order = dict(base)
    order["subtotal"] = numero_br(extrair_valor_label(raw, "Subtotal do distribuidor"))
    order["total_pedido"] = numero_br(extrair_valor_label(raw, "Total do pedido")) or numero_br(base.get("total_pedido"))
    order["total_atendido"] = numero_br(extrair_valor_label(raw, "Total atendido"))
    order["total_faturado"] = numero_br(extrair_valor_label(raw, "Total faturado"))
    order["desconto"] = numero_br(extrair_valor_label(raw, "Desconto"))
    order["data_solicitacao"] = data_iso_br(extrair_valor_label(raw, "Data de solicitação"))
    order["data_emissao"] = data_iso_br(extrair_valor_label(raw, "Data de emissão"))
    order["pedido_distribuidor"] = re.sub(r"\D", "", extrair_valor_label(raw, "Nº Pedido distribuidor"))
    order["pedido_interno"] = re.sub(r"\D", "", extrair_valor_label(raw, "Nº Pedido interno"))
    order["numero_nfe"] = re.sub(r"\D", "", extrair_valor_label(raw, "Número da NFE"))

    distribuidora = extrair_valor_label(raw, "Distribuidora")
    if distribuidora and distribuidora != "-":
        order["distribuidora"] = distribuidora
    return order


def localizar_tabela_itens(root):
    tables = [table for table in root.find_elements(By.TAG_NAME, "table") if table.is_displayed()]
    for table in tables:
        header = texto(table.text).lower()
        if "produto" in header and "solicitado" in header and "faturado" in header and "status" in header:
            return table
    return None


def parse_produto(cell_text: str) -> tuple[str, str]:
    lines = [item.strip() for item in texto(cell_text).splitlines() if item.strip()]
    ean = ""
    for line in reversed(lines):
        match = RE_EAN.search(line)
        if match:
            ean = match.group(1)
            break
    product_lines = [line for line in lines if not (ean and ean in line)]
    produto = " ".join(product_lines).strip()
    return produto, ean


def extrair_itens_pagina(root) -> list[dict]:
    table = localizar_tabela_itens(root)
    if table is None:
        return []
    rows = [row for row in table.find_elements(By.CSS_SELECTOR, "tbody tr") if row.is_displayed()]
    if not rows:
        rows = [row for row in table.find_elements(By.TAG_NAME, "tr") if row.is_displayed()][1:]
    itens: list[dict] = []
    for row in rows:
        cells = [cell for cell in row.find_elements(By.TAG_NAME, "td") if cell.is_displayed()]
        if len(cells) < 9:
            continue
        produto, ean = parse_produto(cells[0].text)
        itens.append({
            "produto": produto,
            "ean": ean,
            "solicitado": numero_br(cells[1].text),
            "atendido": numero_br(cells[2].text),
            "cancelado": numero_br(cells[3].text),
            "faturado": numero_br(cells[4].text),
            "valor_unitario": numero_br(cells[5].text),
            "desconto": numero_br(cells[6].text),
            "total": numero_br(cells[7].text),
            "status": texto(cells[8].text),
        })
    return itens


def proximo_button(root):
    candidatos = root.find_elements(
        By.XPATH,
        ".//*[self::button or self::a][contains(normalize-space(.),'Próximo')]",
    )
    for button in candidatos:
        if not button.is_displayed():
            continue
        disabled = button.get_attribute("disabled")
        aria = texto(button.get_attribute("aria-disabled")).lower()
        classes = texto(button.get_attribute("class")).lower()
        if disabled is not None or aria == "true" or "disabled" in classes:
            continue
        return button
    return None


def assinatura_itens(root) -> str:
    table = localizar_tabela_itens(root)
    return texto(table.text)[:1500] if table is not None else ""


def extrair_todas_paginas_itens(driver, root) -> list[dict]:
    itens: list[dict] = []
    assinaturas: set[str] = set()
    for _ in range(MAX_PAGINAS_ITENS):
        current = assinatura_itens(root)
        if current and current in assinaturas:
            break
        if current:
            assinaturas.add(current)
        itens.extend(extrair_itens_pagina(root))
        button = proximo_button(root)
        if button is None:
            break
        before = current
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
        driver.execute_script("arguments[0].click();", button)
        try:
            WebDriverWait(driver, 12).until(lambda _d: assinatura_itens(root) != before)
        except Exception:
            break
        time.sleep(0.4)
    return itens


def fechar_modal(driver) -> None:
    ActionChains(driver).send_keys(Keys.ESCAPE).perform()
    try:
        WebDriverWait(driver, 5).until(
            lambda d: not any(
                el.is_displayed()
                for el in d.find_elements(By.XPATH, "//*[normalize-space()='Detalhes do pedido']")
            )
        )
        return
    except Exception:
        pass

    for button in driver.find_elements(By.XPATH, "//button[.//*[contains(@class,'lucide-x')] or @aria-label='Fechar']"):
        if button.is_displayed():
            driver.execute_script("arguments[0].click();", button)
            break
    WebDriverWait(driver, 8).until(
        lambda d: not any(
            el.is_displayed()
            for el in d.find_elements(By.XPATH, "//*[normalize-space()='Detalhes do pedido']")
        )
    )


def proximo_lista(driver):
    candidatos = driver.find_elements(
        By.XPATH,
        "//button[contains(normalize-space(.),'Próximo')] | //a[contains(normalize-space(.),'Próximo')]",
    )
    for button in reversed(candidatos):
        if not button.is_displayed():
            continue
        disabled = button.get_attribute("disabled")
        aria = texto(button.get_attribute("aria-disabled")).lower()
        classes = texto(button.get_attribute("class")).lower()
        if disabled is None and aria != "true" and "disabled" not in classes:
            return button
    return None


def assinatura_lista(driver) -> str:
    snapshots = card_snapshots(driver)
    return "|".join(item["pedido_numero"] for item in snapshots)


def selecionar_cliente(driver, cliente: dict) -> None:
    driver.get(URL_SELECIONAR_LOJA)
    selecionar_cnpj_catalogo(driver, cliente["cnpj"], log_fn=log)
    driver.get(URL_PEDIDOS)
    WebDriverWait(driver, 35).until(
        lambda d: "meus-pedidos" in d.current_url.lower()
        and (
            bool(d.find_elements(By.XPATH, "//*[contains(normalize-space(.),'Meus Pedidos')]"))
            or bool(d.find_elements(By.XPATH, "//button[contains(normalize-space(.),'Detalhes do pedido')]"))
        )
    )
    time.sleep(1)


def coletar_cliente(driver, cliente: dict, inicio: str, fim: str) -> tuple[list[dict], list[dict]]:
    pedidos: list[dict] = []
    itens: list[dict] = []
    paginas_vistas: set[str] = set()

    for pagina in range(1, MAX_PAGINAS_PEDIDOS + 1):
        snapshots = card_snapshots(driver)
        signature = "|".join(item["pedido_numero"] for item in snapshots)
        if signature and signature in paginas_vistas:
            break
        if signature:
            paginas_vistas.add(signature)

        log(f"{cliente['cnpj']}: página de pedidos {pagina} com {len(snapshots)} pedido(s).")
        datas_validas = [item["data_criacao"] for item in snapshots if item.get("data_criacao")]

        for snapshot in snapshots:
            data_criacao = snapshot.get("data_criacao", "")
            if not data_criacao or data_criacao < inicio or data_criacao > fim:
                continue

            pedido_numero = snapshot["pedido_numero"]
            log(f"{cliente['cnpj']}: abrindo pedido {pedido_numero} ({data_criacao}).")
            root = abrir_detalhe(driver, pedido_numero)
            try:
                order = extrair_resumo_modal(root, snapshot)
                order.update(cliente)
                order["id"] = d1.id_estavel("mfp", cliente["cnpj"], pedido_numero)
                order_items = extrair_todas_paginas_itens(driver, root)
                order["qtd_itens"] = len(order_items)
                order["extraido_em"] = agora_brasilia().isoformat()
                pedidos.append(order)

                for item in order_items:
                    position = len([x for x in itens if x.get("pedido_id") == order["id"]]) + 1
                    item.update({
                        "id": d1.id_estavel(
                            "mfpi", order["id"], str(position), texto(item.get("ean")), texto(item.get("produto"))
                        ),
                        "pedido_id": order["id"],
                        "cnpj": cliente["cnpj"],
                        "pedido_numero": pedido_numero,
                        "posicao": position,
                        "extraido_em": order["extraido_em"],
                    })
                    itens.append(item)
            finally:
                fechar_modal(driver)

        if datas_validas and max(datas_validas) < inicio:
            log(f"{cliente['cnpj']}: pedidos desta página já são anteriores ao período; paginação encerrada.")
            break

        button = proximo_lista(driver)
        if button is None:
            break
        before = assinatura_lista(driver)
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
        driver.execute_script("arguments[0].click();", button)
        try:
            WebDriverWait(driver, 15).until(lambda _d: assinatura_lista(driver) != before)
        except Exception:
            break
        time.sleep(0.5)

    return pedidos, itens


def persistir_cliente(database_id: str, pedidos: list[dict], itens: list[dict]) -> None:
    if not pedidos:
        return

    order_columns = [
        "id", "cnpj", "cliente_nome", "cliente_uf", "consultor_nome", "pedido_numero",
        "pedido_interno", "pedido_distribuidor", "status", "distribuidora", "laboratorio",
        "data_criacao", "hora_criacao", "criado_em", "criado_por", "data_solicitacao",
        "data_emissao", "numero_nfe", "subtotal", "total_pedido", "total_atendido",
        "total_faturado", "desconto", "qtd_itens", "extraido_em",
    ]
    order_rows = [[item.get(col, "") for col in order_columns] for item in pedidos]
    conflito = """ON CONFLICT(id) DO UPDATE SET
      cliente_nome=excluded.cliente_nome,
      cliente_uf=excluded.cliente_uf,
      consultor_nome=excluded.consultor_nome,
      pedido_interno=excluded.pedido_interno,
      pedido_distribuidor=excluded.pedido_distribuidor,
      status=excluded.status,
      distribuidora=excluded.distribuidora,
      laboratorio=excluded.laboratorio,
      data_criacao=excluded.data_criacao,
      hora_criacao=excluded.hora_criacao,
      criado_em=excluded.criado_em,
      criado_por=excluded.criado_por,
      data_solicitacao=excluded.data_solicitacao,
      data_emissao=excluded.data_emissao,
      numero_nfe=excluded.numero_nfe,
      subtotal=excluded.subtotal,
      total_pedido=excluded.total_pedido,
      total_atendido=excluded.total_atendido,
      total_faturado=excluded.total_faturado,
      desconto=excluded.desconto,
      qtd_itens=excluded.qtd_itens,
      extraido_em=excluded.extraido_em"""
    d1.executar_lotes(
        database_id,
        d1.consultas_multiplos_valores("mercadofarma_pedidos", order_columns, order_rows, conflito),
    )

    for order in pedidos:
        d1.executar(database_id, "DELETE FROM mercadofarma_pedido_itens WHERE pedido_id=?", [order["id"]])

    if itens:
        item_columns = [
            "id", "pedido_id", "cnpj", "pedido_numero", "posicao", "ean", "produto",
            "solicitado", "atendido", "cancelado", "faturado", "valor_unitario",
            "desconto", "total", "status", "extraido_em",
        ]
        item_rows = [[item.get(col, "") for col in item_columns] for item in itens]
        d1.executar_lotes(
            database_id,
            d1.consultas_multiplos_valores(
                "mercadofarma_pedido_itens",
                item_columns,
                item_rows,
                "ON CONFLICT(id) DO UPDATE SET "
                "ean=excluded.ean,produto=excluded.produto,solicitado=excluded.solicitado,"
                "atendido=excluded.atendido,cancelado=excluded.cancelado,faturado=excluded.faturado,"
                "valor_unitario=excluded.valor_unitario,desconto=excluded.desconto,total=excluded.total,"
                "status=excluded.status,extraido_em=excluded.extraido_em",
            ),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrai pedidos do Mercado Farma cliente por cliente.")
    parser.add_argument("--uf", required=True)
    parser.add_argument("--inicio", required=True)
    parser.add_argument("--fim", required=True)
    parser.add_argument("--limite-clientes", type=int, default=0)
    parser.add_argument("--visivel", action="store_true")
    args = parser.parse_args()

    uf = texto(args.uf).upper()
    inicio = validar_data_iso(args.inicio, "Data inicial")
    fim = validar_data_iso(args.fim, "Data final")
    if inicio > fim:
        raise ValueError("A data inicial não pode ser posterior à data final.")

    database_id = d1.localizar_database_id()
    clientes = carregar_clientes(database_id, uf)
    if args.limite_clientes > 0:
        clientes = clientes[: args.limite_clientes]
    if not clientes:
        raise RuntimeError(f"Nenhum cliente ativo com CNPJ foi encontrado para {uf}.")

    execucao_id = criar_execucao(database_id, uf, inicio, fim, len(clientes))
    processados = 0
    erros = 0
    pedidos_total = 0
    itens_total = 0
    driver = None

    try:
        cred = carregar_credenciais_mercadofarma(carregar_login_bussola(), exigir=True)
        usuario = texto(cred.get("usuario"))
        senha = texto(cred.get("senha"))
        driver = criar_driver(headless=not args.visivel)
        login_mercadofarma(driver, usuario, senha, log_fn=log)

        for index, cliente in enumerate(clientes, start=1):
            cnpj = cliente["cnpj"]
            log(f"[{uf}] Cliente {index}/{len(clientes)} - {cliente['cliente_nome']} - {cnpj}")
            try:
                selecionar_cliente(driver, cliente)
                pedidos, itens = coletar_cliente(driver, cliente, inicio, fim)
                persistir_cliente(database_id, pedidos, itens)
                pedidos_total += len(pedidos)
                itens_total += len(itens)
                log(f"{cnpj}: {len(pedidos)} pedido(s) e {len(itens)} item(ns) no período.")
            except Exception as exc:
                erros += 1
                log(f"{cnpj}: erro - {exc}")
                try:
                    driver.get(URL_SELECIONAR_LOJA)
                except Exception:
                    pass
            processados += 1
            atualizar_execucao(
                database_id,
                execucao_id,
                processados=processados,
                erros=erros,
                pedidos=pedidos_total,
                itens=itens_total,
                mensagem=f"Processando {uf}: {processados}/{len(clientes)} clientes.",
            )

        atualizar_execucao(
            database_id,
            execucao_id,
            processados=processados,
            erros=erros,
            pedidos=pedidos_total,
            itens=itens_total,
            mensagem=f"Concluído: {pedidos_total} pedidos e {itens_total} itens extraídos em {uf}.",
            status="concluido",
            finalizar=True,
        )
        return 0
    except Exception as exc:
        atualizar_execucao(
            database_id,
            execucao_id,
            processados=processados,
            erros=erros,
            pedidos=pedidos_total,
            itens=itens_total,
            status="erro",
            erro=str(exc),
            mensagem="Extração interrompida.",
            finalizar=True,
        )
        log(traceback.format_exc(limit=12))
        return 1
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
