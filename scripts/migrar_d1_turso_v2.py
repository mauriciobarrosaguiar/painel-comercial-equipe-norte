from __future__ import annotations

import base64
from typing import Any

import migrar_d1_turso as legacy


def turso_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        # A API HTTP do Turso espera JSON number para f64, não string.
        return {"type": "float", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            "type": "blob",
            "base64": base64.b64encode(bytes(value)).decode("ascii"),
        }
    return {"type": "text", "value": str(value)}


legacy.turso_value = turso_value


if __name__ == "__main__":
    legacy.main()
