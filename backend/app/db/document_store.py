"""Ordered key -> JSON document storage on top of the *_DocumentMixin tables.

Mirrors how the old *_store.json files behaved (whole-store load/save, insertion order kept),
so the feature modules only had to swap their _load/_save helpers.
"""
import threading
from typing import Any, Callable, Dict, List, Optional, Type

from app.db.session import SessionLocal, retry_on_disconnect


class DocumentStore:
    def __init__(self, model: Type):
        self.model = model
        self.lock = threading.RLock()

    @retry_on_disconnect
    def get(self, key: str) -> Optional[Any]:
        with SessionLocal() as db:
            row = db.get(self.model, key)
            return row.data if row else None

    @retry_on_disconnect
    def put(self, key: str, data: Any) -> None:
        with self.lock, SessionLocal() as db:
            row = db.get(self.model, key)
            if row:
                row.data = data
            else:
                last = db.query(self.model.position).order_by(self.model.position.desc()).first()
                db.add(self.model(key=key, data=data, position=(last[0] + 1) if last else 0))
            db.commit()

    @retry_on_disconnect
    def load_dict(self) -> Dict[str, Any]:
        with SessionLocal() as db:
            rows = db.query(self.model).order_by(self.model.position).all()
            return {r.key: r.data for r in rows}

    @retry_on_disconnect
    def save_dict(self, data: Dict[str, Any]) -> None:
        """Replace the whole store with `data`, keeping its order."""
        with self.lock, SessionLocal() as db:
            existing = {r.key: r for r in db.query(self.model).all()}
            for pos, (key, value) in enumerate(data.items()):
                row = existing.pop(key, None)
                if row is None:
                    db.add(self.model(key=key, data=value, position=pos))
                else:
                    row.data, row.position = value, pos
            for row in existing.values():
                db.delete(row)
            db.commit()

    def load_list(self) -> List[Any]:
        return list(self.load_dict().values())

    def save_list(self, items: List[Dict[str, Any]], key: Callable[[Dict[str, Any]], str]) -> None:
        self.save_dict({key(item): item for item in items})
