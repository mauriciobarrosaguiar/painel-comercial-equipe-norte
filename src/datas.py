from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


FUSO_BRASILIA = ZoneInfo("America/Sao_Paulo")


def agora_brasilia() -> datetime:
    return datetime.now(FUSO_BRASILIA)


def hoje_brasilia() -> date:
    return agora_brasilia().date()


def datetime_arquivo_brasilia(caminho: Path) -> datetime | None:
    if not caminho.exists():
        return None
    return datetime.fromtimestamp(caminho.stat().st_mtime, tz=FUSO_BRASILIA)


def converter_datetime_brasilia(valor: object) -> datetime | None:
    if valor is None:
        return None
    try:
        data = pd.to_datetime(valor, errors="coerce")
    except Exception:
        return None
    if pd.isna(data):
        return None
    if isinstance(data, pd.Timestamp):
        data = data.to_pydatetime()
    if data.tzinfo is None:
        return data.replace(tzinfo=FUSO_BRASILIA)
    return data.astimezone(FUSO_BRASILIA)


def formatar_data_brasil(valor: object) -> str:
    data = converter_datetime_brasilia(valor)
    return "-" if data is None else data.strftime("%d/%m/%Y")


def formatar_datahora_brasil(valor: object) -> str:
    data = converter_datetime_brasilia(valor)
    return "-" if data is None else data.strftime("%d/%m/%Y %H:%M:%S")
