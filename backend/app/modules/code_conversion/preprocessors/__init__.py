"""
Plugin-Based Preprocessing Pipeline
====================================
Registry-based architecture: each source type registers a cleaner.
Adding a new source = one new file + @register decorator. No changes to core.

Usage:
    from app.modules.code_conversion.preprocessors import preprocess
    cleaned = preprocess(raw_content, filename, source_type)
"""

import re


class BaseCleaner:
    """Base interface every source-specific cleaner must implement."""
    extensions = []       # e.g. [".xml"]
    source_type = ""      # e.g. "informatica"

    def clean(self, raw_content: str, filename: str) -> str:
        """
        Takes raw file content, returns cleaned content with only the
        parts the LLM needs for dbt code generation.
        """
        raise NotImplementedError

    def get_metadata(self, raw_content: str, filename: str) -> dict:
        """
        Optional: extract structured metadata from the file.
        Returns a dict with source-specific fields.
        """
        return {}


# --- Registry -----------------------------------------------------------

CLEANERS: dict[str, BaseCleaner] = {}


def register(cleaner_class):
    """
    Decorator to register a cleaner class in the global registry.

    Usage:
        @register
        class MySourceCleaner(BaseCleaner):
            source_type = "my_source"
            extensions = [".sql"]
            ...
    """
    instance = cleaner_class()
    CLEANERS[instance.source_type] = instance
    return cleaner_class


# --- Default / Fallback Cleaner ------------------------------------------

def default_clean(content: str) -> str:
    """
    Generic fallback for any source type without a dedicated cleaner.
    - Collapse multiple blank lines into one
    - Strip block comments (/* ... */)
    - Strip single-line comments (-- and #)
    - Trim trailing whitespace on every line
    - Remove lines that are purely whitespace
    """
    # Strip block comments
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

    lines = content.split('\n')
    cleaned_lines = []
    prev_blank = False

    for line in lines:
        # Strip trailing whitespace
        stripped = line.rstrip()

        # Skip single-line comments (but keep SQL/code lines that start with --)
        trimmed = stripped.lstrip()
        if trimmed.startswith('#') and not trimmed.startswith('#!'):
            continue
        if trimmed.startswith('--') and len(trimmed) > 2 and trimmed[2] == ' ':
            # This is a comment like "-- this is a comment"
            continue

        # Collapse blank lines
        if not stripped:
            if prev_blank:
                continue
            prev_blank = True
        else:
            prev_blank = False

        cleaned_lines.append(stripped)

    result = '\n'.join(cleaned_lines).strip()
    return result


# --- Public API ----------------------------------------------------------

def preprocess(raw_content: str, filename: str, source_type: str) -> str:
    """
    Main entry point. Delegates to the registered cleaner for the source_type,
    or falls back to default_clean.
    """
    # Normalize source type for lookup
    lookup_key = _normalize_source_type(source_type)
    cleaner = CLEANERS.get(lookup_key)

    if cleaner:
        cleaned = cleaner.clean(raw_content, filename)
        # Always run default_clean as a final pass for whitespace normalization
        return default_clean(cleaned)
    else:
        return default_clean(raw_content)


def preprocess_with_metadata(raw_content: str, filename: str, source_type: str) -> dict:
    """
    Preprocess and also extract structured metadata.
    Returns: { "cleaned_content": str, "metadata": dict }
    """
    lookup_key = _normalize_source_type(source_type)
    cleaner = CLEANERS.get(lookup_key)

    if cleaner:
        cleaned = cleaner.clean(raw_content, filename)
        cleaned = default_clean(cleaned)
        metadata = cleaner.get_metadata(raw_content, filename)
    else:
        cleaned = default_clean(raw_content)
        metadata = {}

    return {
        "cleaned_content": cleaned,
        "metadata": metadata,
        "original_size": len(raw_content),
        "cleaned_size": len(cleaned),
        "reduction_percent": round((1 - len(cleaned) / max(len(raw_content), 1)) * 100, 1)
    }


def get_registered_sources() -> list[str]:
    """Return list of all registered source types."""
    return list(CLEANERS.keys())


def _normalize_source_type(source_type: str) -> str:
    """Normalize source type string for registry lookup."""
    s = source_type.lower().strip()
    if "informatica" in s:
        return "informatica"
    if "pyspark" in s or "databricks" in s or "spark" in s:
        return "pyspark"
    return s


# --- Auto-import all cleaner modules so they self-register ---------------
# Each cleaner module uses @register at class definition time.

from app.modules.code_conversion.preprocessors import informatica       # noqa: F401, E402
from app.modules.code_conversion.preprocessors import pyspark_cleaner   # noqa: F401, E402
