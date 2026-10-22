"""Resumo seguro por UF para o painel, usando artifacts da execução atual."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path


def uf_valida(valor: str) -> bool:
    return bool(re.fullmatch(r"[A-Z]{2}", valor))


def resumo_uf(uf: str, raiz: Path) -> tuple[str, bool]:
    candidatos = list(raiz.rglob(f"mercadofarma_{uf}.json"))
    candidatos = [p for p in candidatos if p.parent.name == "status"]
    if not candidatos:
        return f"UF {uf} | ERRO | relatório de execução ausente (job interrompido ou artifact não gerado)", False
    try:
        dados = json.loads(candidatos[0].read_text(encoding="utf-8"))
        if str(dados.get("uf") or "").upper() != uf:
            raise ValueError("UF do arquivo não confere")
        if str(dados.get("status") or "").lower() == "sucesso":
            return f"UF {uf} | SUCESSO | {int(dados.get('total_produtos') or 0)} EANs extraídos", True
        etapa = str(dados.get("etapa") or "desconhecida").strip()[:80]
        erro = str(dados.get("erro") or "Falha sem mensagem registrada.").strip()
        erro = re.sub(r"[\r\n\t]+", " ", erro)[:450]
        # _extrair_alvo registra a subetapa antes do erro: login, selecao_cnpj, extracao.
        match_etapa = re.match(r"^(login|selecao_cnpj|catalogo|extracao):", erro, re.I)
        if match_etapa:
            etapa = match_etapa.group(1).lower()
        if "HTTPConnectionPool" in erro and "Read timed out" in erro:
            erro = "Navegador Selenium não respondeu à solicitação no tempo limite. Possível travamento ou lentidão; não comprova erro na senha. Detalhe: " + erro
        return f"UF {uf} | ERRO | etapa {etapa} | {erro}", False
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        return f"UF {uf} | ERRO | status inválido ({type(exc).__name__})", False


def montar_resumo(ufs: list[str], raiz: Path, extracao: str, consolidacao: str) -> dict:
    linhas = []
    falhas = []
    ok = 0
    for uf in ufs:
        linha, sucesso = resumo_uf(uf, raiz)
        linhas.append(linha)
        if sucesso:
            ok += 1
        else:
            falhas.append(linha)
    if not ufs:
        falhas.append("Nenhuma UF foi preparada; verifique a identificação de clientes ativos.")
    if extracao != "success" and not falhas:
        falhas.append(f"Resultado da etapa de extração: {extracao}.")
    if consolidacao != "success":
        falhas.append(f"Consolidação/sincronização: {consolidacao}. Consulte o workflow.")
    texto = f"Mercado Farma: {ok}/{len(ufs)} UFs concluídas.\n" + "\n".join(linhas)
    if consolidacao != "success":
        texto += f"\nConsolidação: {consolidacao}"
    return {
        "status": "erro" if falhas else "concluido",
        "mensagem": texto,
        "erro": "\n".join(falhas)[:3500],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ufs", default="")
    parser.add_argument("--artifacts", default="/tmp/mercadofarma-artifacts")
    parser.add_argument("--extracao", default="unknown")
    parser.add_argument("--consolidacao", default="unknown")
    args = parser.parse_args()
    ufs = sorted(set(uf.strip().upper() for uf in args.ufs.split(",") if uf.strip()))
    ufs = [uf for uf in ufs if uf_valida(uf)]
    resumo = montar_resumo(ufs, Path(args.artifacts), args.extracao, args.consolidacao)
    print(json.dumps(resumo, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
