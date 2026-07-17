from __future__ import annotations

import base64
import json
import secrets
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

import pandas as pd

from src.datas import agora_brasilia, hoje_brasilia
from src.persistencia import carregar_json, existe_persistido, salvar_json
from src.tratamento import normalizar_cnpj, slug_coluna


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SIP_FILE = DATA_DIR / "sip_grupos.json"


STATUS_RECADOS_VALIDOS = {"Pendente", "Em andamento", "Concluído"}


def normalizar_chave_sip(texto: object) -> str:
    return slug_coluna(texto)


def _novo_id_publico() -> str:
    """Gera um identificador público imprevisível, sem dados do cliente."""
    return secrets.token_urlsafe(24).replace("-", "").replace("_", "")


def _carregar_sips_bruto() -> list[dict]:
    if existe_persistido("sip"):
        dados_persistidos = carregar_json("sip", [])
        return dados_persistidos if isinstance(dados_persistidos, list) else []
    if not SIP_FILE.exists():
        return []
    try:
        dados = json.loads(SIP_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    return dados if isinstance(dados, list) else []


def _id_legado_previsivel(grupo: dict) -> bool:
    """Identifica cadastros antigos cujo ID era derivado do nome da SIP."""
    atual = str(grupo.get("id") or "").strip()
    nome = str(grupo.get("nome") or "").strip()
    if not atual:
        return True
    return normalizar_chave_sip(atual) in {
        normalizar_chave_sip(nome),
        normalizar_chave_sip(grupo.get("id_legado") or ""),
    }


def _migrar_seguranca_sips(grupos: list[dict]) -> tuple[list[dict], bool]:
    migrados: list[dict] = []
    alterou = False
    ids_usados: set[str] = set()

    for item in grupos:
        if not isinstance(item, dict):
            alterou = True
            continue
        grupo = dict(item)
        id_atual = str(grupo.get("id") or "").strip()

        if _id_legado_previsivel(grupo) or id_atual in ids_usados:
            if id_atual:
                grupo["id_legado"] = id_atual
            id_atual = _novo_id_publico()
            grupo["id"] = id_atual
            alterou = True

        ids_usados.add(id_atual)

        if "acesso_publico_ativo" not in grupo:
            grupo["acesso_publico_ativo"] = True
            alterou = True
        if "acesso_publico_expira_em" not in grupo:
            grupo["acesso_publico_expira_em"] = ""
            alterou = True

        migrados.append(grupo)

    return migrados, alterou


def carregar_sips() -> list[dict]:
    grupos, alterou = _migrar_seguranca_sips(_carregar_sips_bruto())
    if alterou:
        salvar_sips(grupos)
    return grupos


def salvar_sips(grupos: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SIP_FILE.write_text(json.dumps(grupos, ensure_ascii=False, indent=2), encoding="utf-8")
    salvar_json("sip", grupos, "Atualiza SIPs pelo painel")


def normalizar_grupo_sip(grupo: dict) -> dict:
    nome = str(grupo.get("nome", "")).strip()
    gid = str(grupo.get("id") or _novo_id_publico()).strip()
    cnpjs = [normalizar_cnpj(cnpj) for cnpj in grupo.get("cnpjs", [])]
    cnpjs = sorted({cnpj for cnpj in cnpjs if cnpj})
    redes = sorted({str(rede).strip() for rede in grupo.get("redes", []) if str(rede).strip()})
    recados = grupo.get("recados", [])
    if not isinstance(recados, list):
        recados = []
    return {
        "id": gid,
        "id_legado": str(grupo.get("id_legado") or "").strip(),
        "nome": nome,
        "redes": redes,
        "cnpjs": cnpjs,
        "meta_mes": float(grupo.get("meta_mes", 0) or 0),
        "pagamento_percentual": float(grupo.get("pagamento_percentual", 80) or 80),
        "acesso_publico_ativo": bool(grupo.get("acesso_publico_ativo", True)),
        "acesso_publico_expira_em": str(grupo.get("acesso_publico_expira_em") or "").strip(),
        "recados": [recado for recado in recados if isinstance(recado, dict)],
    }


def _data_expiracao(valor: object) -> date | None:
    texto = str(valor or "").strip()
    if not texto:
        return None
    try:
        return date.fromisoformat(texto[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(texto).date()
        except ValueError:
            return None


def acesso_publico_valido(grupo: dict, hoje: date | None = None) -> tuple[bool, str]:
    grupo = normalizar_grupo_sip(grupo)
    if not grupo["acesso_publico_ativo"]:
        return False, "Este acesso foi desativado pelo responsável do painel."
    expiracao = _data_expiracao(grupo["acesso_publico_expira_em"])
    if expiracao and (hoje or hoje_brasilia()) > expiracao:
        return False, "Este link de acesso expirou. Solicite um novo link ao responsável."
    return True, ""


def buscar_sip_publica(token: object) -> tuple[dict | None, str]:
    recebido = str(token or "").strip()
    if not recebido:
        return None, "Link de acesso inválido."

    for bruto in carregar_sips():
        grupo = normalizar_grupo_sip(bruto)
        if secrets.compare_digest(str(grupo["id"]), recebido):
            valido, motivo = acesso_publico_valido(grupo)
            return (grupo, "") if valido else (None, motivo)
    return None, "SIP não encontrada ou link inválido."


def atualizar_acesso_publico_sip(
    sip_id: str,
    ativo: bool,
    expira_em: date | str | None = None,
    regenerar_link: bool = False,
) -> str:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    for grupo in grupos:
        if grupo.get("id") != sip_id:
            continue
        grupo["acesso_publico_ativo"] = bool(ativo)
        if isinstance(expira_em, date):
            grupo["acesso_publico_expira_em"] = expira_em.isoformat()
        else:
            grupo["acesso_publico_expira_em"] = str(expira_em or "").strip()
        if regenerar_link:
            grupo["id_legado"] = grupo["id"]
            grupo["id"] = _novo_id_publico()
        salvar_sips(grupos)
        return str(grupo["id"])
    raise KeyError("SIP não encontrada.")


def opcoes_clientes_para_sip(clientes_resultado: pd.DataFrame) -> pd.DataFrame:
    if clientes_resultado.empty:
        return pd.DataFrame(columns=["label", "cnpj_limpo", "rede"])
    base = clientes_resultado[["cnpj_limpo", "nome_pdv", "cidade", "uf", "consultor", "grupo_sip"]].copy()
    base["rede"] = base["grupo_sip"].fillna("").astype(str)
    base["label"] = (
        base["nome_pdv"].fillna("").astype(str)
        + " - "
        + base["cnpj_limpo"].fillna("").astype(str)
        + " - "
        + base["rede"].fillna("").astype(str)
    )
    return base.sort_values(["rede", "nome_pdv", "cnpj_limpo"]).reset_index(drop=True)


def gerar_resumo_sips_manuais(clientes_resultado: pd.DataFrame) -> pd.DataFrame:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    if not grupos:
        return pd.DataFrame(
            columns=[
                "sip",
                "redes",
                "cnpjs",
                "consultores",
                "ol_sem_combate",
                "ol_prioritarios",
                "percentual_prioritarios",
                "ol_lancamentos",
                "percentual_lancamentos",
                "cnpjs_com_compra",
                "cnpjs_sem_compra",
                "meta_mes",
                "atingimento_meta",
            ]
        )

    clientes = clientes_resultado.copy()
    linhas: list[dict[str, object]] = []
    for grupo in grupos:
        membros = clientes[clientes["cnpj_limpo"].astype(str).isin(grupo["cnpjs"])].copy()
        ol_sem = float(membros["ol_sem_combate"].sum()) if not membros.empty else 0.0
        ol_pri = float(membros["ol_prioritarios"].sum()) if not membros.empty else 0.0
        ol_lan = float(membros["ol_lancamentos"].sum()) if not membros.empty else 0.0
        linhas.append(
            {
                "sip": grupo["nome"],
                "id": grupo["id"],
                "redes": ", ".join(grupo["redes"]),
                "cnpjs": len(grupo["cnpjs"]),
                "consultores": ", ".join(sorted({str(x) for x in membros.get("consultor", pd.Series(dtype=str)) if str(x).strip()})),
                "ol_sem_combate": ol_sem,
                "ol_prioritarios": ol_pri,
                "percentual_prioritarios": (ol_pri / ol_sem) if ol_sem else 0.0,
                "ol_lancamentos": ol_lan,
                "percentual_lancamentos": (ol_lan / ol_sem) if ol_sem else 0.0,
                "cnpjs_com_compra": int((membros["ol_sem_combate"] > 0).sum()) if not membros.empty else 0,
                "cnpjs_sem_compra": int((membros["ol_sem_combate"] <= 0).sum()) if not membros.empty else len(grupo["cnpjs"]),
                "meta_mes": grupo["meta_mes"],
                "atingimento_meta": (ol_sem / grupo["meta_mes"]) if grupo["meta_mes"] else 0.0,
            }
        )
    return pd.DataFrame(linhas).sort_values(["ol_sem_combate", "sip"], ascending=[False, True]).reset_index(drop=True)


def adicionar_sip(nome: str, redes: list[str], cnpjs: list[str], meta_mes: float, pagamento_percentual: float, sip_id: str | None = None) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    gid = str(sip_id or _novo_id_publico()).strip()
    existente = next((grupo for grupo in grupos if grupo.get("id") == gid), {})
    novo = normalizar_grupo_sip(
        {
            "id": gid,
            "id_legado": existente.get("id_legado", ""),
            "nome": nome,
            "redes": redes,
            "cnpjs": cnpjs,
            "meta_mes": meta_mes,
            "pagamento_percentual": pagamento_percentual,
            "acesso_publico_ativo": existente.get("acesso_publico_ativo", True),
            "acesso_publico_expira_em": existente.get("acesso_publico_expira_em", ""),
            "recados": existente.get("recados", []),
        }
    )
    grupos = [grupo for grupo in grupos if grupo.get("id") != gid]
    grupos.append(novo)
    salvar_sips(grupos)


def excluir_sip(sip_id: str) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    salvar_sips([grupo for grupo in grupos if grupo.get("id") != str(sip_id)])


def adicionar_recado_sip(sip_id: str, titulo: str, comentario: str, status: str, arquivo) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    if arquivo is None:
        raise ValueError("Selecione uma imagem para anexar.")
    conteudo = arquivo.getvalue()
    recado = {
        "id": str(uuid4()),
        "titulo": str(titulo or "").strip() or "Recado",
        "comentario": str(comentario or "").strip(),
        "status": status if status in STATUS_RECADOS_VALIDOS else "Pendente",
        "imagem_nome": getattr(arquivo, "name", "imagem"),
        "imagem_tipo": getattr(arquivo, "type", "") or "image/png",
        "imagem_base64": base64.b64encode(conteudo).decode("ascii"),
        "criado_em": agora_brasilia().isoformat(),
    }
    for grupo in grupos:
        if grupo.get("id") == sip_id:
            grupo.setdefault("recados", []).append(recado)
            salvar_sips(grupos)
            return
    raise KeyError("SIP não encontrada.")


def atualizar_status_recado_sip(sip_id: str, recado_id: str, status: str) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    for grupo in grupos:
        if grupo.get("id") != sip_id:
            continue
        for recado in grupo.get("recados", []):
            if recado.get("id") == recado_id:
                recado["status"] = status if status in STATUS_RECADOS_VALIDOS else recado.get("status", "Pendente")
                salvar_sips(grupos)
                return


def atualizar_recado_sip(sip_id: str, recado_id: str, titulo: str, comentario: str, status: str, arquivo=None) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    for grupo in grupos:
        if grupo.get("id") != sip_id:
            continue
        for recado in grupo.get("recados", []):
            if recado.get("id") != recado_id:
                continue
            recado["titulo"] = str(titulo or "").strip() or "Recado"
            recado["comentario"] = str(comentario or "").strip()
            recado["status"] = status if status in STATUS_RECADOS_VALIDOS else recado.get("status", "Pendente")
            recado["atualizado_em"] = agora_brasilia().isoformat()
            if arquivo is not None:
                conteudo = arquivo.getvalue()
                recado["imagem_nome"] = getattr(arquivo, "name", "imagem")
                recado["imagem_tipo"] = getattr(arquivo, "type", "") or "image/png"
                recado["imagem_base64"] = base64.b64encode(conteudo).decode("ascii")
            salvar_sips(grupos)
            return
    raise KeyError("SIP ou recado não encontrado.")


def excluir_recado_sip(sip_id: str, recado_id: str) -> None:
    grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
    for grupo in grupos:
        if grupo.get("id") == sip_id:
            grupo["recados"] = [recado for recado in grupo.get("recados", []) if recado.get("id") != recado_id]
            salvar_sips(grupos)
            return
