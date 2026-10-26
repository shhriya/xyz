"""Aggregate preprocessor output into the Step 2 metadata summary."""





def aggregate_metadata(metadata_list: list, source_type: str) -> dict:
    """Aggregate metadata from multiple files into a single summary."""
    s = source_type.lower()

    if "informatica" in s:
        all_mappings = []
        all_workflows = []
        all_sources = []
        all_targets = []
        all_transformations = []
        all_lookups = []
        all_filters = []
        all_expressions = []

        for m in metadata_list:
            all_mappings.extend(m.get("mappings", []))
            all_workflows.extend(m.get("workflows", []))
            all_sources.extend(m.get("sources", []))
            all_targets.extend(m.get("targets", []))
            all_transformations.extend(m.get("transformations", []))
            all_lookups.extend(m.get("lookups", []))
            all_filters.extend(m.get("filters", []))
            all_expressions.extend(m.get("expressions", []))

        return {
            "filesDiscovered": len(metadata_list),
            "workflowsFound": len(set(all_workflows)),
            "mappingsExtracted": len(set(all_mappings)),
            "sourceTables": len(set(all_sources)),
            "targetTables": len(set(all_targets)),
            "transformations": len(all_transformations),
            "lookups": len(all_lookups),
            "filters": len(all_filters),
            "expressions": len(all_expressions),
        }

    elif any(k in s for k in ["pyspark", "databricks", "spark"]):
        all_reads = []
        all_writes = []
        all_transforms = []
        all_udfs = []
        all_sql = []
        all_windows = []
        all_functions = []

        for m in metadata_list:
            all_reads.extend(m.get("reads", []))
            all_writes.extend(m.get("writes", []))
            all_transforms.extend(m.get("transformations", []))
            all_udfs.extend(m.get("udfs", []))
            all_sql.extend(m.get("sql_queries", []))
            all_windows.extend(m.get("window_functions", []))
            all_functions.extend(m.get("functions", []))

        return {
            "filesDiscovered": len(metadata_list),
            "notebooksFound": len([m for m in metadata_list if m.get("functions")]),
            "scriptsExtracted": len(metadata_list),
            "readOperations": len(all_reads),
            "writeOperations": len(all_writes),
            "transformations": sum(t.get("count", 1) for t in all_transforms),
            "udfs": len(all_udfs),
            "sqlQueries": len(all_sql),
            "windowFunctions": len(all_windows),
            "functions": len(all_functions),
        }

    return {"filesDiscovered": len(metadata_list)}
