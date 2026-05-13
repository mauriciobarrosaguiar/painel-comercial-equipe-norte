from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
BASE_DIR = ROOT / "data" / "mercadofarma"
PARCIAIS_DIR = BASE_DIR / "parciais"
FINAL_PATH = BASE_DIR / "mercadofarma_consolidado.csv"
STATUS_PATH = BASE_DIR / "status_mercadofarma.json"
TZ_BRASILIA = ZoneInfo("America/Sao_Paulo")


def log(msg: str) -> None:
    print(msg, flush=True)


def agora_brasilia_iso() -> str:
    return datetime.now(TZ_BRASILIA).isoformat()


def ler_csv(path: Path) -> pd.DataFrame:
    for sep in [",", ";"]:
        try:
            return pd.read_csv(path, dtype=str, sep=sep)
        except Exception:
            continue
    raise RuntimeError(f"Não consegui ler {path}")


def arquivos_parciais() -> list[Path]:
    if not PARCIAIS_DIR.exists():
        return []
    return sorted(PARCIAIS_DIR.rglob("mercadofarma_*.csv"))


def arquivos_status() -> list[Path]:
    if not BASE_DIR.exists():
        return []
    return sorted(BASE_DIR.rglob("mercadofarma_*.json"))


def normalizar_uf(df: pd.DataFrame) -> pd.DataFrame:
    base = df.copy()
    if "UF" not in base.columns and "uf" in base.columns:
        base = base.rename(columns={"uf": "UF"})
    if "UF" not in base.columns:
        base["UF"] = ""
    base["UF"] = base["UF"].astype(str).str.strip().str.upper()
    return base


def main() -> int:
    log("Iniciando consolidação dos arquivos Mercado Farma")
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    PARCIAIS_DIR.mkdir(parents=True, exist_ok=True)

    frames: list[pd.DataFrame] = []
    ufs_atualizadas: set[str] = set()
    for path in arquivos_parciais():
        try:
            df = normalizar_uf(ler_csv(path))
        except Exception as exc:
            log(f"Aviso: não consegui ler {path}: {exc}")
            continue
        if df.empty:
            log(f"Aviso: arquivo sem linhas ignorado: {path}")
            continue
        uf = str(df["UF"].dropna().astype(str).iloc[0]).strip().upper() if "UF" in df.columns and not df["UF"].dropna().empty else ""
        if uf:
            ufs_atualizadas.add(uf)
        frames.append(df)
        log(f"Arquivo parcial localizado: {path} ({len(df)} linhas)")

    anterior = pd.DataFrame()
    if FINAL_PATH.exists():
        try:
            anterior = normalizar_uf(ler_csv(FINAL_PATH))
            if ufs_atualizadas and not anterior.empty:
                anterior = anterior[~anterior["UF"].isin(ufs_atualizadas)].copy()
                log("Base anterior carregada para preservar UFs sem nova extração.")
        except Exception as exc:
            log(f"Aviso: não consegui carregar consolidado anterior: {exc}")

    if not frames and anterior.empty:
        log("Aviso: nenhuma UF gerou arquivo parcial e não existe consolidado anterior.")
        STATUS_PATH.write_text(
            json.dumps({"gerado_em": agora_brasilia_iso(), "ufs_atualizadas": [], "status": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return 0

    consolidado = pd.concat([anterior, *frames], ignore_index=True) if not anterior.empty else pd.concat(frames, ignore_index=True)
    subset = [col for col in ["UF", "EAN", "DISTRIBUIDORA", "CNPJ_REFERENCIA"] if col in consolidado.columns]
    if subset:
        consolidado = consolidado.drop_duplicates(subset=subset, keep="last")
    consolidado.to_csv(FINAL_PATH, index=False, encoding="utf-8-sig")

    status: list[dict] = []
    for path in arquivos_status():
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            log(f"Aviso: status inválido em {path}: {exc}")
            continue
        if isinstance(item, dict):
            status.append(item)

    resumo = {
        "gerado_em": agora_brasilia_iso(),
        "arquivo": str(FINAL_PATH.relative_to(ROOT)),
        "ufs_atualizadas": sorted(ufs_atualizadas),
        "total_linhas": int(len(consolidado)),
        "status": status,
    }
    STATUS_PATH.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Arquivo consolidado gerado com sucesso: {FINAL_PATH}")
    log(f"Total de linhas consolidadas: {len(consolidado)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
