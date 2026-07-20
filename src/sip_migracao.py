from __future__ import annotations

import hashlib
from typing import Any

from src.tratamento import normalizar_cnpj, normalizar_texto, normalizar_texto_alto


def id_estavel(prefixo: str, *partes: object) -> str:
    chave = "|".join(str(parte or "").strip() for parte in partes).encode("utf-8")
    return f"{prefixo}-{hashlib.sha1(chave).hexdigest()[:28]}"


def numero(valor: object, padrao: float = 0.0) -> float:
    try:
        return float(valor if valor not in (None, "") else padrao)
    except (TypeError, ValueError):
        return padrao


def booleano(valor: object, padrao: bool = True) -> bool:
    if isinstance(valor, bool):
        return valor
    texto = normalizar_texto_alto(valor)
    if texto in {"0", "NAO", "N", "FALSE", "FALSO", "INATIVO"}:
        return False
    if texto in {"1", "SIM", "S", "TRUE", "VERDADEIRO", "ATIVO"}:
        return True
    return padrao


def normalizar_sips_para_d1(dados: object) -> dict[str, list[dict[str, Any]]]:
    resultado: dict[str, list[dict[str, Any]]] = {
        "sips": [],
        "redes": [],
        "sip_redes": [],
        "sip_clientes": [],
        "recados": [],
        "avisos": [],
    }
    if not isinstance(dados, list):
        resultado["avisos"].append({"tipo": "FORMATO", "referencia": "sip", "mensagem": "A base SIP não contém uma lista."})
        return resultado

    ids_usados: set[str] = set()
    redes_vistas: set[str] = set()
    for indice, bruto in enumerate(dados, start=1):
        if not isinstance(bruto, dict):
            resultado["avisos"].append({"tipo": "REGISTRO", "referencia": str(indice), "mensagem": "Registro SIP ignorado por formato inválido."})
            continue

        redes = sorted({normalizar_texto(item) for item in bruto.get("redes", []) if normalizar_texto(item)}) if isinstance(bruto.get("redes", []), list) else []
        id_original = normalizar_texto(bruto.get("id"))
        nome = normalizar_texto(bruto.get("nome")) or (redes[0] if redes else id_original)
        if not nome:
            resultado["avisos"].append({"tipo": "REGISTRO", "referencia": str(indice), "mensagem": "SIP sem ID, nome ou rede foi preservada apenas no arquivo legado."})
            continue

        sip_id = id_original or id_estavel("sip", nome, indice)
        if sip_id in ids_usados:
            sip_id = id_estavel("sip", sip_id, nome, indice)
            resultado["avisos"].append({"tipo": "ID_DUPLICADO", "referencia": id_original, "mensagem": "ID SIP duplicado recebeu uma chave técnica estável."})
        ids_usados.add(sip_id)

        resultado["sips"].append({
            "id": sip_id,
            "id_legado": normalizar_texto(bruto.get("id_legado")) or (id_original if sip_id != id_original else ""),
            "nome": nome,
            "meta_mes": numero(bruto.get("meta_mes")),
            "pagamento_percentual": numero(bruto.get("pagamento_percentual"), 80.0),
            "acesso_publico_ativo": 1 if booleano(bruto.get("acesso_publico_ativo"), True) else 0,
            "acesso_publico_expira_em": normalizar_texto(bruto.get("acesso_publico_expira_em")),
        })

        for rede in redes:
            rede_id = id_estavel("rede", normalizar_texto_alto(rede))
            if rede_id not in redes_vistas:
                redes_vistas.add(rede_id)
                resultado["redes"].append({"id": rede_id, "nome": rede})
            resultado["sip_redes"].append({"sip_id": sip_id, "rede_id": rede_id})

        cnpjs_brutos = bruto.get("cnpjs", [])
        if not isinstance(cnpjs_brutos, list):
            cnpjs_brutos = []
        for cnpj_bruto in cnpjs_brutos:
            cnpj = normalizar_cnpj(cnpj_bruto)
            if not cnpj or cnpj == "0" * 14:
                resultado["avisos"].append({"tipo": "CNPJ_INVALIDO", "referencia": normalizar_texto(cnpj_bruto), "mensagem": f"CNPJ inválido na SIP {nome}."})
                continue
            resultado["sip_clientes"].append({"sip_id": sip_id, "cnpj": cnpj})

        recados = bruto.get("recados", [])
        if not isinstance(recados, list):
            recados = []
        for recado_indice, recado in enumerate(recados, start=1):
            if not isinstance(recado, dict):
                continue
            recado_id = normalizar_texto(recado.get("id")) or id_estavel("siprec", sip_id, recado_indice, recado.get("titulo"))
            resultado["recados"].append({
                "id": recado_id,
                "sip_id": sip_id,
                "titulo": normalizar_texto(recado.get("titulo")) or "Recado",
                "comentario": normalizar_texto(recado.get("comentario")),
                "status": normalizar_texto(recado.get("status")) or "Pendente",
                "imagem_nome": normalizar_texto(recado.get("imagem_nome")),
                "imagem_tipo": normalizar_texto(recado.get("imagem_tipo")),
                "imagem_base64": normalizar_texto(recado.get("imagem_base64")),
                "criado_em": normalizar_texto(recado.get("criado_em")),
                "atualizado_em": normalizar_texto(recado.get("atualizado_em")),
            })

    return resultado
