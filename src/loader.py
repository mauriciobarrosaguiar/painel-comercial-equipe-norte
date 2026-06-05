from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st

from src.configuracoes import aplicar_ajustes_vendedores
from src.datas import agora_brasilia
from src.persistencia import carregar_bytes, criar_backup, existe_persistido, restaurar_backup, salvar_bytes
from src.tratamento import (
    COLUNAS_ACOES,
    COLUNAS_BUSSOLA,
    COLUNAS_CONTATO,
    COLUNAS_PAINEL,
    COLUNAS_PRODUTOS_MIX,
    TIPO_SEM_CLASSIFICACAO,
    deduplicar_exportacao_bussola,
    normalizar_ean,
    padronizar_colunas,
    preparar_acoes,
    preparar_base_vendas,
    preparar_painel_equipe,
    preparar_produtos_mix,
    validar_colunas_esperadas,
)


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
MERCADO_FARMA_CONSOLIDADO = DATA_DIR / "mercadofarma" / "mercadofarma_consolidado.csv"

ARQUIVOS_PADRAO = {
    "bussola": DATA_DIR / "bussola.xlsx",
    "painel": DATA_DIR / "PAINEL EQUIPE NORTE.xlsx",
    "acoes": DATA_DIR / "template_acoes_promocionais.xlsx",
    "produtos_mix": DATA_DIR / "template_produtos_mix.xlsx",
    "mercado_farma": DATA_DIR / "mercado_farma.xlsx",
    "produtos_mercado_farma": DATA_DIR / "produtos.xlsx",
    "bussola_historico": DATA_DIR / "bussola_historico.xlsx",
}

ABAS_PADRAO = {
    "bussola": "Pedidos",
    "painel": "Planilha1",
    "acoes": 0,
    "produtos_mix": 0,
    "mercado_farma": 0,
    "produtos_mercado_farma": 0,
    "bussola_historico": "Pedidos",
}


def _uploads_sessao() -> dict[str, dict[str, object]]:
    return st.session_state.setdefault("uploads_bases", {})


def _versao_cache(chave: str) -> str:
    return str(st.session_state.get(f"{chave}_updated_at", "") or "")


def _ler_excel_upload(conteudo: bytes, sheet_name: str | int = 0) -> pd.DataFrame:
    if not conteudo:
        return pd.DataFrame()
    return pd.read_excel(BytesIO(conteudo), sheet_name=sheet_name, dtype=str, engine="openpyxl")


def _formatar_mb(tamanho_bytes: int) -> str:
    return f"{tamanho_bytes / (1024 * 1024):.2f} MB"


def _celula_vazia(valor: object) -> bool:
    if valor is None:
        return True
    if pd.isna(valor):
        return True
    return str(valor).strip().lower() in {"", "nan", "none", "<na>", "nat", "null"}


def _colunas_unicas(cabecalho: list[object]) -> list[str]:
    nomes: list[str] = []
    contagem: dict[str, int] = {}
    for idx, valor in enumerate(cabecalho):
        nome = str(valor).strip() if not _celula_vazia(valor) else f"Unnamed: {idx}"
        ocorrencias = contagem.get(nome, 0)
        contagem[nome] = ocorrencias + 1
        nomes.append(nome if ocorrencias == 0 else f"{nome}.{ocorrencias}")
    return nomes


def _ler_painel_upload(conteudo: bytes) -> pd.DataFrame:
    if not conteudo:
        return pd.DataFrame()
    try:
        from openpyxl import load_workbook

        wb = load_workbook(BytesIO(conteudo), read_only=True, data_only=True)
        ws = wb[ABAS_PADRAO["painel"]] if ABAS_PADRAO["painel"] in wb.sheetnames else wb.worksheets[0]
        cabecalho: list[str] | None = None
        linhas: list[list[object]] = []
        vazias_consecutivas = 0
        for linha in ws.iter_rows(values_only=True):
            valores = list(linha)
            if all(_celula_vazia(valor) for valor in valores):
                if cabecalho is not None:
                    vazias_consecutivas += 1
                    if vazias_consecutivas >= 500:
                        break
                continue
            vazias_consecutivas = 0
            if cabecalho is None:
                cabecalho = _colunas_unicas(valores)
                continue
            if len(valores) < len(cabecalho):
                valores.extend([""] * (len(cabecalho) - len(valores)))
            linhas.append(valores[: len(cabecalho)])
        wb.close()
        return pd.DataFrame(linhas, columns=cabecalho or [])
    except Exception:
        try:
            return _ler_excel_upload(conteudo, ABAS_PADRAO["painel"])
        except ValueError:
            return _ler_excel_upload(conteudo, 0)


def _cnpj_valido(cnpj: object) -> bool:
    texto = str(cnpj or "").strip()
    return bool(texto and texto.isdigit() and len(texto) == 14 and texto != "0" * 14 and len(set(texto)) > 1)


def _linha_util(serie: pd.Series) -> bool:
    for valor in serie:
        if not _celula_vazia(valor):
            return True
    return False


def _compactar_upload_painel(conteudo: bytes) -> tuple[bytes, int]:
    painel_raw = _ler_painel_upload(conteudo)
    painel = preparar_painel_equipe(painel_raw)
    colunas_compactas_padrao = COLUNAS_PAINEL + COLUNAS_CONTATO + ["cnpj_limpo", "grupo_sip", "cliente_ativo"]
    if painel.empty:
        compacto = pd.DataFrame(columns=colunas_compactas_padrao)
    else:
        colunas_usuario = [col for col in COLUNAS_PAINEL + COLUNAS_CONTATO if col in painel.columns]
        if colunas_usuario:
            painel = painel[painel[colunas_usuario].apply(_linha_util, axis=1)]
        painel = painel[painel["cnpj_limpo"].apply(_cnpj_valido)]
        painel = painel.drop_duplicates("cnpj_limpo", keep="first").reset_index(drop=True)
        colunas_compactas = [col for col in colunas_compactas_padrao if col in painel.columns]
        compacto = painel[colunas_compactas].copy()

    saida = BytesIO()
    with pd.ExcelWriter(saida, engine="openpyxl") as writer:
        compacto.to_excel(writer, sheet_name="Planilha1", index=False)
    return saida.getvalue(), int(len(compacto.index))


def _tem_coluna(df: pd.DataFrame, nomes: list[str]) -> bool:
    if df is None or df.empty:
        return False
    colunas = set(padronizar_colunas(df).columns)
    return any(nome in colunas for nome in nomes)


def _validar_upload_produtos_mix(conteudo: bytes) -> tuple[bool, str]:
    try:
        bruto = _ler_excel_upload(conteudo, ABAS_PADRAO["produtos_mix"])
    except Exception as exc:
        return False, f"Nao consegui ler o arquivo: {exc}"

    if bruto.empty:
        return False, "O arquivo esta vazio."
    if not _tem_coluna(bruto, ["ean"]):
        return False, "A coluna EAN nao foi encontrada."
    if not _tem_coluna(bruto, ["produto", "principio_ativo", "nome_do_produto", "descricao"]):
        return False, "A coluna Produto nao foi encontrada."
    if not _tem_coluna(bruto, ["tipo_mix", "tipo", "mix", "classificacao", "categoria"]):
        return False, "A coluna Tipo Mix nao foi encontrada."

    tratado = preparar_produtos_mix(bruto)
    eans_validos = int(tratado["ean_limpo"].dropna().astype(str).str.strip().ne("").sum()) if "ean_limpo" in tratado else 0
    classificados = tratado[tratado["tipo_mix"].ne(TIPO_SEM_CLASSIFICACAO)] if "tipo_mix" in tratado else pd.DataFrame()
    if eans_validos < 10:
        return False, "A planilha precisa ter pelo menos 10 EANs validos."
    if classificados.empty:
        return False, "Todos os produtos ficaram SEM CLASSIFICACAO."
    return True, ""


def _validar_upload_produtos_mercado_farma(conteudo: bytes) -> tuple[bool, str]:
    try:
        bruto = _ler_excel_upload(conteudo, ABAS_PADRAO["produtos_mercado_farma"])
    except Exception as exc:
        return False, f"Nao consegui ler a planilha produtos.xlsx: {exc}"
    if bruto.empty:
        return False, "A planilha produtos.xlsx esta vazia."
    base = padronizar_colunas(bruto)
    coluna = "ean" if "ean" in base.columns else base.columns[0] if len(base.columns) else ""
    eans = base[coluna].dropna().astype(str).map(normalizar_ean) if coluna else pd.Series(dtype=str)
    total = int(eans[eans.ne("")].nunique())
    if total <= 0:
        return False, "A planilha precisa conter EANs validos."
    return True, f"{total} EANs validos encontrados."


def _validar_upload_generico(chave: str, conteudo: bytes) -> tuple[bool, str]:
    if chave == "produtos_mix":
        return _validar_upload_produtos_mix(conteudo)
    if chave == "produtos_mercado_farma":
        return _validar_upload_produtos_mercado_farma(conteudo)
    try:
        bruto = _ler_painel_upload(conteudo) if chave == "painel" else _ler_excel_upload(conteudo, ABAS_PADRAO.get(chave, 0))
    except Exception as exc:
        return False, f"Nao consegui ler o arquivo enviado: {exc}"
    if bruto.empty:
        return False, "O arquivo enviado esta vazio."

    if chave in {"bussola", "bussola_historico"}:
        minimas = ["cnpj_pdv", "ean", "produto", "status_pedido", "pedido_id", "data_do_pedido", "preco_unitario_sem_imposto", "valor_faturado"]
        faltantes = [coluna for coluna in minimas if not _tem_coluna(bruto, [coluna])]
        if faltantes:
            return False, "A base Bussola precisa conter: " + ", ".join(minimas)
        if not (_tem_coluna(bruto, ["quantidade_atendida"]) or _tem_coluna(bruto, ["quantidade_faturada"])):
            return False, "A base Bussola precisa conter quantidade_atendida ou quantidade_faturada."
    elif chave == "painel":
        if not _tem_coluna(bruto, ["cnpj"]):
            return False, "A base de clientes precisa conter CNPJ."
        if not _tem_coluna(bruto, ["nome_pdv", "cliente", "razao_social", "nome"]):
            return False, "A base de clientes precisa conter Nome PDV."
        if not _tem_coluna(bruto, ["cidade"]):
            return False, "A base de clientes precisa conter Cidade."
        if not _tem_coluna(bruto, ["uf"]):
            return False, "A base de clientes precisa conter UF."
        if not _tem_coluna(bruto, ["nome_rep", "consultor", "representante"]):
            return False, "A base de clientes precisa conter Nome REP ou Consultor."
    elif chave == "acoes":
        if not _tem_coluna(bruto, ["campanha", "nome_acao", "tipo_acao"]):
            return False, "A base de acoes precisa conter campanha."
        if not (_tem_coluna(bruto, ["produto"]) or _tem_coluna(bruto, ["ean"])):
            return False, "A base de acoes precisa conter Produto ou EAN."
        if not (_tem_coluna(bruto, ["desconto"]) or _tem_coluna(bruto, ["data_inicio"]) or _tem_coluna(bruto, ["data_fim"])):
            return False, "A base de acoes precisa conter desconto ou validade."
    elif chave == "mercado_farma":
        if not _tem_coluna(bruto, ["ean"]):
            return False, "A base Mercado Farma precisa conter EAN."
        if not _tem_coluna(bruto, ["produto", "nome_do_produto"]):
            return False, "A base Mercado Farma precisa conter Produto."
        if not _tem_coluna(bruto, ["distribuidora"]):
            return False, "A base Mercado Farma precisa conter Distribuidora."
        if not _tem_coluna(bruto, ["preco_sem_imposto", "preco_final", "preco_final_r", "estoque"]):
            return False, "A base Mercado Farma precisa conter preco ou estoque."
    return True, ""


def _salvar_upload(chave: str, arquivo, conteudo: bytes, mensagem_backup: str | None = None) -> bool:
    tamanho_original = len(conteudo)
    clientes_validos: int | None = None
    if chave in {"bussola", "bussola_historico"}:
        bruto = _ler_excel_upload(conteudo, ABAS_PADRAO[chave])
        deduplicado = deduplicar_exportacao_bussola(bruto)
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            deduplicado.to_excel(writer, sheet_name=ABAS_PADRAO[chave], index=False)
        conteudo = buffer.getvalue()
    elif chave == "painel":
        conteudo, clientes_validos = _compactar_upload_painel(conteudo)

    atualizado_em = agora_brasilia().isoformat()
    if chave in {"produtos_mix", "produtos_mercado_farma", "bussola", "painel", "mercado_farma", "bussola_historico", "acoes"}:
        try:
            criar_backup(chave, mensagem_backup or f"Backup automatico antes de atualizar {chave}")
        except Exception:
            st.warning("Não foi possível criar backup automático, mas vou tentar salvar a nova base.")
    st.session_state[f"{chave}_updated_at"] = atualizado_em
    st.session_state[f"{chave}_uploaded_name"] = arquivo.name
    _uploads_sessao()[chave] = {
        "name": arquivo.name,
        "bytes": conteudo,
        "updated_at": atualizado_em,
        "size": len(conteudo),
    }
    salvar_bytes(chave, conteudo, f"Atualiza base {chave} pelo painel")
    if chave == "painel" and clientes_validos is not None:
        st.success(
            (
                f"Base de clientes tratada e salva: {clientes_validos:,} clientes válidos. "
                f"Tamanho reduzido de {_formatar_mb(tamanho_original)} para {_formatar_mb(len(conteudo))}."
            ).replace(",", ".")
        )
    st.cache_data.clear()
    return True


def registrar_upload(chave: str, arquivo) -> bool:
    if arquivo is None:
        return False
    conteudo = arquivo.getvalue()
    valido, mensagem = _validar_upload_generico(chave, conteudo)
    if not valido:
        st.error(f"Arquivo invalido para {chave}. A base anterior foi preservada. {mensagem}")
        return False
    if mensagem:
        st.info(mensagem)
    return _salvar_upload(chave, arquivo, conteudo)


def registrar_upload_produtos_mix(arquivo) -> bool:
    if arquivo is None:
        return False
    conteudo = arquivo.getvalue()
    valido, mensagem = _validar_upload_produtos_mix(conteudo)
    if not valido:
        st.error(
            "Arquivo de Produtos / Mix invalido. A base anterior foi preservada. "
            "Envie a planilha correta com EAN, Produto e Tipo Mix. "
            f"Detalhe: {mensagem}"
        )
        return False
    return _salvar_upload("produtos_mix", arquivo, conteudo, "Backup automatico de Produtos / Mix")


def registrar_upload_produtos_mercado_farma(arquivo) -> bool:
    if arquivo is None:
        return False
    conteudo = arquivo.getvalue()
    valido, mensagem = _validar_upload_produtos_mercado_farma(conteudo)
    if not valido:
        st.error(f"Arquivo produtos.xlsx invalido. A lista anterior foi preservada. {mensagem}")
        return False
    st.info(mensagem)
    return _salvar_upload("produtos_mercado_farma", arquivo, conteudo, "Backup automatico de produtos Mercado Farma")


def restaurar_backup_produtos_mix() -> bool:
    ok = restaurar_backup("produtos_mix")
    if ok:
        _uploads_sessao().pop("produtos_mix", None)
        st.session_state.pop("produtos_mix_updated_at", None)
        st.session_state.pop("produtos_mix_uploaded_name", None)
        st.cache_data.clear()
    return ok


def limpar_uploads() -> None:
    st.session_state["uploads_bases"] = {}
    st.cache_data.clear()


def fonte_ativa(chave: str) -> str:
    upload = _uploads_sessao().get(chave)
    if upload:
        return f"Upload salvo: {upload.get('name', '')}"
    if existe_persistido(chave):
        return "Base salva"
    if chave == "mercado_farma" and MERCADO_FARMA_CONSOLIDADO.exists():
        return "Consolidado GitHub Actions"
    caminho = ARQUIVOS_PADRAO[chave]
    return f"Pasta data: {caminho.name}" if caminho.exists() else "Arquivo não encontrado"


@st.cache_data(show_spinner=False)
def _ler_excel_bytes(conteudo: bytes, sheet_name: str | int, versao_cache: str = "") -> pd.DataFrame:
    return pd.read_excel(BytesIO(conteudo), sheet_name=sheet_name, dtype=str, engine="openpyxl")


@st.cache_data(show_spinner=False)
def _ler_excel_caminho(caminho: str, sheet_name: str | int, mtime: float, versao_cache: str = "") -> pd.DataFrame:
    return pd.read_excel(caminho, sheet_name=sheet_name, dtype=str, engine="openpyxl")


def _carregar_excel(chave: str) -> pd.DataFrame:
    upload = _uploads_sessao().get(chave)
    if upload and upload.get("bytes"):
        return _ler_excel_bytes(upload["bytes"], ABAS_PADRAO[chave], _versao_cache(chave))

    persistido = carregar_bytes(chave)
    if persistido:
        return _ler_excel_bytes(persistido, ABAS_PADRAO[chave], _versao_cache(chave))

    caminho = ARQUIVOS_PADRAO[chave]
    if not caminho.exists():
        return pd.DataFrame()
    return _ler_excel_caminho(str(caminho), ABAS_PADRAO[chave], caminho.stat().st_mtime, _versao_cache(chave))


def carregar_bussola() -> pd.DataFrame:
    return _carregar_excel("bussola")


def carregar_bussola_historico() -> pd.DataFrame:
    return _carregar_excel("bussola_historico")


def carregar_painel_equipe() -> pd.DataFrame:
    return _carregar_excel("painel")


def carregar_acoes() -> pd.DataFrame:
    return _carregar_excel("acoes")


def carregar_produtos_mix() -> pd.DataFrame:
    return _carregar_excel("produtos_mix")


def carregar_mercado_farma() -> pd.DataFrame:
    upload = _uploads_sessao().get("mercado_farma")
    if upload and upload.get("bytes"):
        return _ler_excel_bytes(upload["bytes"], ABAS_PADRAO["mercado_farma"], _versao_cache("mercado_farma"))

    persistido = carregar_bytes("mercado_farma")
    if persistido:
        return _ler_excel_bytes(persistido, ABAS_PADRAO["mercado_farma"], _versao_cache("mercado_farma"))

    if MERCADO_FARMA_CONSOLIDADO.exists():
        return pd.read_csv(MERCADO_FARMA_CONSOLIDADO, dtype=str, sep=None, engine="python")

    return _carregar_excel("mercado_farma")


def carregar_produtos_mercado_farma() -> pd.DataFrame:
    return _carregar_excel("produtos_mercado_farma")


def carregar_dados_tratados() -> dict[str, pd.DataFrame | list[str]]:
    bussola_atual_raw = carregar_bussola()
    bussola_historico_raw = carregar_bussola_historico()
    bussola_raw = bussola_atual_raw
    painel_raw = carregar_painel_equipe()
    acoes_raw = carregar_acoes()
    produtos_raw = carregar_produtos_mix()
    mercado_raw = carregar_mercado_farma()
    produtos_mercado_raw = carregar_produtos_mercado_farma()

    avisos: list[str] = []
    avisos.extend(validar_colunas_esperadas(bussola_raw, COLUNAS_BUSSOLA, "bussola.xlsx"))
    avisos.extend(validar_colunas_esperadas(painel_raw, COLUNAS_PAINEL, "PAINEL EQUIPE NORTE.xlsx"))
    if acoes_raw.empty:
        avisos.append("template_acoes_promocionais.xlsx: sem ações cadastradas. Use a tela Importar Bases para baixar o modelo.")
    if produtos_raw.empty:
        avisos.append("template_produtos_mix.xlsx: sem produtos classificados. Produtos vendidos ficarão como SEM CLASSIFICACAO.")
    else:
        avisos.extend(validar_colunas_esperadas(produtos_raw, COLUNAS_PRODUTOS_MIX, "template_produtos_mix.xlsx"))
    if not acoes_raw.empty:
        avisos.extend(validar_colunas_esperadas(acoes_raw, COLUNAS_ACOES, "template_acoes_promocionais.xlsx"))

    clientes = aplicar_ajustes_vendedores(preparar_painel_equipe(painel_raw))
    produtos_mix = preparar_produtos_mix(produtos_raw)
    acoes = preparar_acoes(acoes_raw)
    vendas = preparar_base_vendas(bussola_raw, clientes, produtos_mix)

    return {
        "vendas": vendas,
        "clientes": clientes,
        "produtos_mix": produtos_mix,
        "acoes": acoes,
        "avisos": avisos,
        "raw_bussola": bussola_atual_raw,
        "raw_bussola_historico": bussola_historico_raw,
        "raw_bussola_completa": bussola_raw,
        "raw_painel": painel_raw,
        "raw_acoes": acoes_raw,
        "raw_produtos_mix": produtos_raw,
        "mercado_farma": mercado_raw,
        "produtos_mercado_farma": produtos_mercado_raw,
    }


def modelo_acoes() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUNAS_ACOES)


def modelo_produtos_mix() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUNAS_PRODUTOS_MIX)
