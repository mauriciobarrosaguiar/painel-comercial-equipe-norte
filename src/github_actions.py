from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import requests
import streamlit as st


WORKFLOW_MERCADO_FARMA = "mercadofarma.yml"
TZ_BRASILIA = ZoneInfo("America/Sao_Paulo")

STATUS_PT = {
    "completed": "concluído",
    "in_progress": "em andamento",
    "queued": "na fila",
    "requested": "solicitado",
    "waiting": "aguardando",
    "pending": "pendente",
}

CONCLUSAO_PT = {
    "success": "sucesso",
    "failure": "falhou",
    "cancelled": "cancelado",
    "skipped": "ignorado",
    "timed_out": "tempo esgotado",
    "action_required": "ação necessária",
    "neutral": "neutro",
    "startup_failure": "falha ao iniciar",
}


def _secret(nome: str, padrao: str = "") -> str:
    try:
        if nome in st.secrets:
            return str(st.secrets[nome])
    except Exception:
        pass
    return str(os.environ.get(nome, padrao) or padrao)


def _config() -> dict[str, str]:
    return {
        "token": _secret("GITHUB_TOKEN"),
        "repo": _secret("GITHUB_REPO", "mauriciobarrosaguiar/painel-comercial-equipe-norte"),
        "branch": _secret("GITHUB_BRANCH", "main"),
    }


def _headers() -> dict[str, str]:
    token = _config()["token"]
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(url: str, **params: Any) -> requests.Response:
    return requests.get(url, headers=_headers(), params=params or None, timeout=35)


def _formatar_datahora(valor: str | None) -> str:
    if not valor:
        return "-"
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        return dt.astimezone(TZ_BRASILIA).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(valor)


def traduzir_status(valor: str | None) -> str:
    texto = str(valor or "").strip()
    return STATUS_PT.get(texto, texto or "-")


def traduzir_conclusao(valor: str | None) -> str:
    texto = str(valor or "").strip()
    return CONCLUSAO_PT.get(texto, texto or "-")


def _uf_do_job(nome: str) -> str:
    match = re.search(r"\(([A-Z]{2})\)", str(nome or ""))
    return match.group(1) if match else ""


def _resumir_log(texto: str, limite_linhas: int = 80) -> str:
    if not texto:
        return "Não foi possível ler o log desta execução."
    linhas = [linha.strip() for linha in texto.splitlines() if linha.strip()]
    importantes: list[str] = []
    padroes = [
        "##[error]",
        "erro na extracao",
        "erro na extração",
        "runtimeerror",
        "traceback",
        "exception",
        "process completed with exit code",
        "nao encontrei",
        "não encontrei",
        "persistence_key",
        "falha",
        "error:",
    ]
    for linha in linhas:
        normalizada = linha.lower()
        if any(padrao in normalizada for padrao in padroes):
            importantes.append(linha)
    if not importantes:
        importantes = linhas[-limite_linhas:]
    return "\n".join(importantes[-limite_linhas:])


def _baixar_log_job(job_id: int) -> tuple[str, str]:
    cfg = _config()
    logs_url = f"https://api.github.com/repos/{cfg['repo']}/actions/jobs/{job_id}/logs"
    resp = _get(logs_url)
    if resp.status_code in {401, 403}:
        return logs_url, "Sem permissão para ler o log pela API. Abra o link da execução no GitHub."
    if resp.status_code == 404:
        return logs_url, "Log não encontrado no GitHub Actions."
    try:
        resp.raise_for_status()
    except Exception as exc:
        return logs_url, f"Não consegui ler o log ({resp.status_code}): {exc}"
    return logs_url, _resumir_log(resp.text)


def github_actions_disponivel() -> bool:
    cfg = _config()
    return bool(cfg["token"] and cfg["repo"])


def disparar_mercado_farma(ufs: list[str], limite_eans: int = 0, *, headless: bool = True) -> None:
    cfg = _config()
    if not github_actions_disponivel():
        raise RuntimeError("Configure GITHUB_TOKEN e GITHUB_REPO nos Secrets para disparar a atualização.")
    ufs_txt = ",".join(str(uf).strip().upper() for uf in ufs if str(uf).strip())
    payload = {
        "ref": cfg["branch"],
        "inputs": {
            "acao": "atualizar_mercadofarma_paralelo",
            "ufs": ufs_txt,
            "uf": ufs_txt,
            "limite_eans": str(int(limite_eans or 0)),
            "headless": "true" if headless else "false",
            "command_id": uuid4().hex,
        },
    }
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/workflows/{WORKFLOW_MERCADO_FARMA}/dispatches"
    resp = requests.post(url, headers=_headers(), json=payload, timeout=30)
    if resp.status_code not in {204, 201}:
        detalhe = resp.text[:500]
        raise RuntimeError(f"A atualização não foi aceita ({resp.status_code}): {detalhe}")


def _detalhar_jobs(run: dict[str, Any]) -> list[dict[str, Any]]:
    cfg = _config()
    run_id = run.get("id")
    if not run_id:
        return []
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/runs/{run_id}/jobs"
    resp = _get(url, per_page=100)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    dados = resp.json()
    jobs_raw = dados.get("jobs", []) if isinstance(dados, dict) else []
    jobs: list[dict[str, Any]] = []
    jobs_iter = jobs_raw if isinstance(jobs_raw, list) else []
    for job in jobs_iter:
        if not isinstance(job, dict):
            continue
        log_url = f"https://api.github.com/repos/{cfg['repo']}/actions/jobs/{job.get('id')}/logs"
        erro_resumo = ""
        if job.get("conclusion") == "failure" and job.get("id"):
            log_url, erro_resumo = _baixar_log_job(int(job["id"]))
        jobs.append(
            {
                "id": job.get("id"),
                "nome": job.get("name", ""),
                "uf": _uf_do_job(str(job.get("name", ""))),
                "status": job.get("status", ""),
                "status_pt": traduzir_status(job.get("status")),
                "conclusao": job.get("conclusion", ""),
                "conclusao_pt": traduzir_conclusao(job.get("conclusion")),
                "criado_em": _formatar_datahora(job.get("started_at") or job.get("created_at")),
                "finalizado_em": _formatar_datahora(job.get("completed_at")),
                "html_url": job.get("html_url", ""),
                "logs_url": log_url,
                "erro_resumo": erro_resumo,
            }
        )
    return jobs


def listar_execucoes_mercado_farma(limite: int = 5, *, detalhar: bool = True) -> list[dict[str, Any]]:
    cfg = _config()
    if not github_actions_disponivel():
        return []
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/workflows/{WORKFLOW_MERCADO_FARMA}/runs"
    resp = _get(url, per_page=max(1, min(limite, 20)))
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    dados = resp.json()
    runs_raw = dados.get("workflow_runs", []) if isinstance(dados, dict) else []
    runs: list[dict[str, Any]] = []
    runs_iter = runs_raw if isinstance(runs_raw, list) else []
    for run in runs_iter:
        if not isinstance(run, dict):
            continue
        jobs = _detalhar_jobs(run) if detalhar else []
        ufs_executadas = sorted({job["uf"] for job in jobs if job.get("uf")})
        ufs_com_erro = sorted({job["uf"] for job in jobs if job.get("uf") and job.get("conclusao") == "failure"})
        erro_resumo = "\n\n".join(job["erro_resumo"] for job in jobs if job.get("erro_resumo"))
        runs.append(
            {
                "id": run.get("id"),
                "criada_em": _formatar_datahora(run.get("created_at")),
                "status": run.get("status", ""),
                "status_pt": traduzir_status(run.get("status")),
                "conclusao": run.get("conclusion", ""),
                "conclusao_pt": traduzir_conclusao(run.get("conclusion")),
                "branch": run.get("head_branch", ""),
                "acao": run.get("display_title") or run.get("name") or "Mercado Farma",
                "uf": ", ".join(ufs_executadas) if ufs_executadas else "-",
                "ufs_executadas": ufs_executadas,
                "ufs_com_erro": ufs_com_erro,
                "url": run.get("html_url", ""),
                "jobs_url": run.get("jobs_url", ""),
                "logs_url": run.get("logs_url", ""),
                "jobs": jobs,
                "erro_resumo": erro_resumo or "",
            }
        )
    return runs
