"""
PySpark / Databricks .py File Cleaner
======================================
Strips runtime boilerplate from PySpark scripts, keeping only the
business logic needed for dbt code generation.

STRIPS:
  - Import blocks (from pyspark.sql import *, import logging, etc.)
  - Logging setup (logging.getLogger, logger.setLevel)
  - Argparse / CLI argument parsing blocks
  - if __name__ == "__main__": runner blocks (keeps the function it calls)
  - Top-of-file docstrings and license headers
  - SparkSession.builder.config(...) cluster/executor configs
  - .option("driver", ...), .option("fetchsize", ...) JDBC driver tuning
  - Caching/persisting calls (.cache(), .persist(), .unpersist())
  - Repartition/coalesce calls
  - print() and logger.* statements
  - Comments and inline comments

KEEPS:
  - All function and class definitions
  - DataFrame transformations (.filter, .join, .groupBy, .withColumn, etc.)
  - SQL strings (spark.sql("..."))
  - Schema definitions (StructType, StructField)
  - UDF definitions
  - Window functions
  - Merge / upsert logic (Delta MERGE INTO)
  - spark.read / df.write calls (source/target identification)
"""

import re
from app.modules.code_conversion.preprocessors import BaseCleaner, register


# Patterns for lines to strip (compiled for performance)
IMPORT_PATTERN = re.compile(
    r'^\s*(from\s+\S+\s+import\s+|import\s+)',
    re.MULTILINE
)

LOGGING_PATTERNS = [
    re.compile(r'^\s*logging\.', re.MULTILINE),
    re.compile(r'^\s*logger\s*=\s*', re.MULTILINE),
    re.compile(r'^\s*logger\.\w+\(', re.MULTILINE),
    re.compile(r'^\s*log\.\w+\(', re.MULTILINE),
]

PRINT_PATTERN = re.compile(r'^\s*print\s*\(', re.MULTILINE)

# Argparse block detection
ARGPARSE_PATTERNS = [
    re.compile(r'^\s*parser\s*=\s*argparse\.', re.MULTILINE),
    re.compile(r'^\s*parser\.add_argument\(', re.MULTILINE),
    re.compile(r'^\s*args\s*=\s*parser\.parse_args\(', re.MULTILINE),
    re.compile(r'^\s*import\s+argparse', re.MULTILINE),
]

# SparkSession builder config noise
SPARK_CONFIG_PATTERNS = [
    re.compile(r'^\s*spark\s*=\s*SparkSession\.builder', re.MULTILINE),
    re.compile(r'^\s*\.config\s*\(', re.MULTILINE),
    re.compile(r'^\s*\.master\s*\(', re.MULTILINE),
    re.compile(r'^\s*\.appName\s*\(', re.MULTILINE),
    re.compile(r'^\s*\.enableHiveSupport\s*\(', re.MULTILINE),
    re.compile(r'^\s*\.getOrCreate\s*\(', re.MULTILINE),
]

# Runtime/infra noise to strip
RUNTIME_PATTERNS = [
    re.compile(r'\.\s*cache\s*\(\s*\)', re.MULTILINE),
    re.compile(r'\.\s*persist\s*\(', re.MULTILINE),
    re.compile(r'\.\s*unpersist\s*\(', re.MULTILINE),
    re.compile(r'\.\s*repartition\s*\(', re.MULTILINE),
    re.compile(r'\.\s*coalesce\s*\(', re.MULTILINE),
    re.compile(r'\.\s*checkpoint\s*\(', re.MULTILINE),
]

# JDBC option noise
JDBC_OPTION_PATTERN = re.compile(
    r'\.option\s*\(\s*"(?:driver|fetchsize|batchsize|numPartitions|partitionColumn|lowerBound|upperBound|isolationLevel|truncate|createTableColumnTypes|customSchema)"\s*,',
    re.IGNORECASE
)


@register
class PySparkCleaner(BaseCleaner):
    extensions = [".py"]
    source_type = "pyspark"

    def clean(self, raw_content: str, filename: str) -> str:
        """
        Clean PySpark .py script using regex-based stripping.
        Removes imports, logging, argparse, SparkSession builder configs,
        caching/persisting, and comments while keeping business logic.
        """
        content = raw_content

        # 1. Strip top-of-file docstrings / license headers
        # Match triple-quoted strings at the very beginning of the file
        content = re.sub(
            r'^(\s*"""[\s\S]*?"""\s*\n|\s*\'\'\'[\s\S]*?\'\'\'\s*\n)',
            '', content, count=1
        )

        # 2. Strip all import lines
        content = re.sub(
            r'^\s*(from\s+\S+\s+import\s+.*|import\s+.*)$',
            '', content, flags=re.MULTILINE
        )

        # 3. Strip logging setup and calls
        for pattern in LOGGING_PATTERNS:
            content = pattern.sub('', content)

        # 4. Strip print statements
        content = PRINT_PATTERN.sub('', content)

        # 5. Strip argparse blocks
        # First remove individual argparse lines
        for pattern in ARGPARSE_PATTERNS:
            content = pattern.sub('', content)

        # 6. Strip SparkSession.builder blocks
        # This is a multi-line pattern: spark = SparkSession.builder \
        #     .config(...) \
        #     .getOrCreate()
        content = re.sub(
            r'^\s*spark\s*=\s*SparkSession\.builder\b[\s\S]*?\.getOrCreate\s*\(\s*\)\s*$',
            '', content, flags=re.MULTILINE
        )
        # Also strip standalone SparkSession config lines
        for pattern in SPARK_CONFIG_PATTERNS:
            content = pattern.sub('', content)

        # 7. Strip if __name__ == "__main__": block
        # Keep the function call inside it for reference
        main_match = re.search(
            r'^if\s+__name__\s*==\s*["\']__main__["\']\s*:\s*\n((?:\s+.*\n)*)',
            content, re.MULTILINE
        )
        if main_match:
            # Extract function calls from the main block to preserve as comments
            main_body = main_match.group(1)
            func_calls = re.findall(r'^\s+(\w+\s*\(.*\))\s*$', main_body, re.MULTILINE)
            replacement = ''
            if func_calls:
                replacement = '# Entry points: ' + ', '.join(fc.strip() for fc in func_calls[:3]) + '\n'
            content = content[:main_match.start()] + replacement + content[main_match.end():]

        # 8. Strip inline comments (but preserve URLs and strings)
        content = re.sub(r'(?<=["\'])\s*#[^"\']*$', '', content, flags=re.MULTILINE)
        # Strip full-line comments
        content = re.sub(r'^\s*#(?!!).*$', '', content, flags=re.MULTILINE)

        # 9. Strip JDBC option noise
        content = JDBC_OPTION_PATTERN.sub('.option("...STRIPPED...",', content)

        # 10. Strip standalone .cache()/.persist()/.repartition() calls
        for pattern in RUNTIME_PATTERNS:
            content = pattern.sub('', content)

        # 11. Strip try/except boilerplate (keep the try body, remove except/finally)
        # This is simplified — strips empty except blocks
        content = re.sub(
            r'^\s*except\s*(?:Exception|BaseException|\w+Error)?\s*(?:as\s+\w+)?\s*:\s*\n(?:\s+(?:pass|logger\.\w+\(.*\)|print\(.*\)|raise)\s*\n)*',
            '', content, flags=re.MULTILINE
        )

        # 12. Strip os.path, sys.argv, and path construction lines
        content = re.sub(r'^\s*(?:os\.path\.|sys\.argv|os\.environ).*$', '', content, flags=re.MULTILINE)

        # 13. Collapse multiple blank lines
        content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)

        return content

    def get_metadata(self, raw_content: str, filename: str) -> dict:
        """Extract structured metadata from PySpark script."""
        metadata = {
            "source_type": "PySpark (Databricks)",
            "filename": filename,
            "reads": [],
            "writes": [],
            "transformations": [],
            "udfs": [],
            "sql_queries": [],
            "window_functions": [],
            "functions": [],
            "schemas": [],
        }

        # Extract spark.read operations
        for m in re.finditer(
            r'spark\.read\s*(?:\.format\s*\(\s*["\'](\w+)["\']\s*\))?\s*'
            r'(?:\.option\s*\([^)]*\)\s*)*'
            r'(?:\.(?:table|load)\s*\(\s*["\']([^"\']*)["\'])?',
            raw_content
        ):
            read_info = {}
            if m.group(1):
                read_info["format"] = m.group(1)
            if m.group(2):
                read_info["table"] = m.group(2)
            if read_info:
                metadata["reads"].append(read_info)

        # Also catch spark.table() calls
        for m in re.finditer(r'spark\.table\s*\(\s*["\']([^"\']*)["\']', raw_content):
            metadata["reads"].append({"table": m.group(1), "format": "table"})

        # Extract df.write / saveAsTable operations
        for m in re.finditer(
            r'\.write\s*(?:\.mode\s*\(\s*["\'](\w+)["\']\s*\))?\s*'
            r'(?:\.format\s*\(\s*["\'](\w+)["\']\s*\))?\s*'
            r'(?:\.(?:save|saveAsTable|insertInto)\s*\(\s*["\']([^"\']*)["\'])?',
            raw_content
        ):
            write_info = {}
            if m.group(1):
                write_info["mode"] = m.group(1)
            if m.group(2):
                write_info["format"] = m.group(2)
            if m.group(3):
                write_info["table"] = m.group(3)
            if write_info:
                metadata["writes"].append(write_info)

        # Extract DataFrame transformations
        transform_methods = [
            'filter', 'where', 'select', 'withColumn', 'drop', 'distinct',
            'groupBy', 'agg', 'join', 'union', 'unionByName', 'orderBy',
            'sort', 'limit', 'dropDuplicates', 'fillna', 'na.fill',
            'withColumnRenamed', 'crossJoin', 'pivot', 'unpivot'
        ]
        for method in transform_methods:
            count = len(re.findall(rf'\.{method}\s*\(', raw_content))
            if count > 0:
                metadata["transformations"].append({
                    "type": method,
                    "count": count
                })

        # Extract UDF definitions
        for m in re.finditer(r'(?:@udf|udf\s*\()\s*.*\ndef\s+(\w+)', raw_content):
            metadata["udfs"].append(m.group(1))
        # Also F.udf() assignments
        for m in re.finditer(r'(\w+)\s*=\s*(?:F\.)?udf\s*\(', raw_content):
            metadata["udfs"].append(m.group(1))

        # Extract spark.sql() queries
        for m in re.finditer(r'spark\.sql\s*\(\s*(?:"""([\s\S]*?)"""|"([^"]*)")', raw_content):
            query = m.group(1) or m.group(2)
            if query:
                metadata["sql_queries"].append(query.strip()[:200])  # Truncate long queries

        # Extract Window function usage
        for m in re.finditer(r'Window\.partitionBy\s*\(([^)]*)\)', raw_content):
            metadata["window_functions"].append({
                "partitionBy": m.group(1).strip()
            })

        # Extract function definitions
        for m in re.finditer(r'^def\s+(\w+)\s*\(', raw_content, re.MULTILINE):
            metadata["functions"].append(m.group(1))

        # Extract schema definitions
        for m in re.finditer(r'StructType\s*\(\s*\[', raw_content):
            metadata["schemas"].append("StructType defined")

        return metadata
