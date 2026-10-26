"""Custom column types."""
import json
import logging
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import Text, TypeDecorator

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

_PREFIX = "fernet:"


@lru_cache(maxsize=1)
def _fernet() -> Optional[Fernet]:
    key = settings.app_encryption_key.strip()
    if not key:
        logger.warning("APP_ENCRYPTION_KEY is not set; saved credentials are stored unencrypted.")
        return None
    return Fernet(key.encode())


class EncryptedJSON(TypeDecorator):
    """JSON document stored as text, Fernet-encrypted when APP_ENCRYPTION_KEY is set.

    Values written without a key (or before encryption was enabled) are plain JSON and still readable.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        raw = json.dumps(value, default=str)
        f = _fernet()
        return _PREFIX + f.encrypt(raw.encode()).decode() if f else raw

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.startswith(_PREFIX):
            f = _fernet()
            if f is None:
                raise RuntimeError("Encrypted data found but APP_ENCRYPTION_KEY is not set.")
            try:
                value = f.decrypt(value[len(_PREFIX):].encode()).decode()
            except InvalidToken:
                raise RuntimeError(
                    "Saved credentials were encrypted with a different APP_ENCRYPTION_KEY. "
                    "Everyone sharing the database must use the same key in backend/.env."
                ) from None
        return json.loads(value)
