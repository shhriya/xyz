import json
import re
from app.modules.code_conversion.preprocessors import BaseCleaner, register


# Tags to completely remove from XML (with all children)
STRIP_TAGS = {
    'LAYOUT',
    'ERPINFO',
    'CHANGEMETADATA',
    'CHANGEHISTORY',
    'FOLDERVERSION',
    'REPOSITORYVERSION',
    'CRCVALUE',
    'SHORTCUT',
    'METAEXTENSION',        # PowerCenter internal extension metadata
    'SESSIONEXTENSION',     # Session-level runtime config
}

# Attributes to remove from all kept tags (runtime/internal noise)
STRIP_ATTRIBUTES = {
    'CRCVALUE',
    'REPOSITORYNAME',
    'POWERCENTERVERSION',
    'CODEPAGE',
    'REPOSITORYVERSION',
    'OBJECTVERSION',
    'VERSIONNUMBER',
    'ISVALID',             # PowerCenter validation flag
    'REUSABLE',            # Reusability flag — not needed for dbt
}

# Tags whose content we definitely want to keep in XML
KEEP_TAGS = {
    'MAPPING',
    'TRANSFORMATION',
    'TRANSFORMFIELD',
    'CONNECTOR',
    'SOURCE',
    'TARGET',
    'SOURCEFIELD',
    'TARGETFIELD',
    'WORKFLOW',
    'SESSION',
    'MAPPLET',
    'MAPPINGVARIABLE',
    'TABLEATTRIBUTE',
    'LOOKUP',
    'FILTER',
    'JOINER',
    'AGGREGATOR',
    'ROUTER',
    'SEQUENCE',
    'SORTER',
    'EXPRESSION',
    'NORMALIZER',
    'UNION',
    'RANK',
    'XMLPARSER',
    'XMLGENERATOR',
    'UPDATESTRATEGY',
    'STOREDPROCEDURE',
    'ASSOCIATEDSOURCEINSTANCE',
    'INSTANCE',
    'GROUP',
    'GROUPENTRY',
}


def _is_json_content(content: str, filename: str) -> bool:
    """Check if the content is JSON (IICS mapping definition)."""
    if filename.lower().endswith(".json"):
        return True
    stripped = content.strip()
    return (stripped.startswith("{") and stripped.endswith("}")) or (stripped.startswith("[") and stripped.endswith("]"))


def _clean_iics_mapping_json(raw_content: str, filename: str) -> str:
    """
    Cleans IICS mapping JSON definitions (from .DTEMPLATE.zip or raw JSON).
    Strips internal IDs, canvas layout coordinates, and annotation metadata.
    Preserves all transformation logic, expressions, source/target tables, and connectors.
    """
    try:
        raw_dict = json.loads(raw_content)
    except Exception:
        return raw_content

    content = raw_dict.get("content", raw_dict) if isinstance(raw_dict, dict) else raw_dict
    if not isinstance(content, dict):
        return json.dumps(raw_dict, indent=2)

    mapping_name = content.get("name") or filename.replace(".mapping.json", "").replace(".json", "")

    # Build transformation ID-to-Name map
    id_to_tx = {}
    for t in content.get("transformations", []):
        for k in ["$$ID", "id", "ID"]:
            if k in t:
                id_to_tx[t[k]] = t.get("name")

    # Clean and resolve links
    cleaned_links = []
    incoming_counts = {t.get("name"): 0 for t in content.get("transformations", []) if t.get("name")}
    outgoing_counts = {t.get("name"): 0 for t in content.get("transformations", []) if t.get("name")}

    for l in content.get("links", []):
        f_id = l.get("fromTransformation", {}).get("##ID") or l.get("fromTransformation", {}).get("$$ID")
        t_id = l.get("toTransformation", {}).get("##ID") or l.get("toTransformation", {}).get("$$ID")
        f_name = id_to_tx.get(f_id)
        t_name = id_to_tx.get(t_id)

        if not f_name and "name" in l and "." in l["name"]:
            f_name = l["name"].split(".")[0]

        if f_name and t_name:
            cleaned_links.append({"from": f_name, "to": t_name})
            outgoing_counts[f_name] = outgoing_counts.get(f_name, 0) + 1
            incoming_counts[t_name] = incoming_counts.get(t_name, 0) + 1
        elif "from" in l and "to" in l:
            src = str(l["from"]).split(":")[0]
            tgt = str(l["to"]).split(":")[0]
            cleaned_links.append({"from": src, "to": tgt})
            outgoing_counts[src] = outgoing_counts.get(src, 0) + 1
            incoming_counts[tgt] = incoming_counts.get(tgt, 0) + 1

    cleaned_txs = []
    metadata_sources = []
    metadata_targets = []

    for t in content.get("transformations", []):
        name = t.get("name", "tx")

        # Determine type
        tx_type = "Transformation"
        if incoming_counts.get(name, 0) == 0 and outgoing_counts.get(name, 0) > 0:
            tx_type = "Source"
        elif outgoing_counts.get(name, 0) == 0 and incoming_counts.get(name, 0) > 0:
            tx_type = "Target"
        elif "Lookup" in name or "lookupCondition" in t or "lookupConditions" in t:
            tx_type = "Lookup"
        elif "Router" in name or "groupFilterConditions" in t:
            tx_type = "Router"
        elif "Filter" in name:
            tx_type = "Filter"
        elif "Sequence" in name or "midstream" in t:
            tx_type = "SequenceGenerator"
        elif "Sorter" in name:
            tx_type = "Sorter"
        elif "Expression" in name:
            tx_type = "Expression"

        # Check for table name inside dataAdapter
        da = t.get("dataAdapter", {})
        table_name = None
        for fld in da.get("dataAdapter", {}).get("fields", []) if isinstance(da, dict) else []:
            for p in fld.get("properties", []):
                if p.get("name") == "parentObject" and p.get("value"):
                    table_name = p.get("value")
                    break
            if table_name:
                break

        if not table_name and tx_type in ["Source", "Target"]:
            table_name = name

        if tx_type == "Source" and table_name:
            metadata_sources.append(table_name)
        elif tx_type == "Target" and table_name:
            metadata_targets.append(table_name)

        # Fields with expressions and datatypes
        cleaned_fields = []
        for f in t.get("fields", []):
            fname = f.get("name")
            expr = f.get("expression")
            dtype = f.get("nativeType") or f.get("datatype") or f.get("javaType") or "VARCHAR"

            f_item = {"name": fname}
            if expr:
                f_item["expression"] = expr
            if dtype:
                f_item["datatype"] = dtype
            cleaned_fields.append(f_item)

        cleaned_tx = {
            "name": name,
            "type": tx_type,
            "fields": cleaned_fields[:35]
        }
        if table_name:
            cleaned_tx["table"] = table_name

        if t.get("lookupCondition"):
            cleaned_tx["lookupCondition"] = t.get("lookupCondition")
        if t.get("groupFilterConditions"):
            cleaned_tx["groupFilterConditions"] = [
                fc.get("condition") or fc.get("filterCondition") for fc in t.get("groupFilterConditions") if fc
            ]

        cleaned_txs.append(cleaned_tx)

    cleaned_data = {
        "mapping_name": mapping_name,
        "document_type": content.get("documentType", "MAPPING"),
        "sources": list(dict.fromkeys(metadata_sources)),
        "targets": list(dict.fromkeys(metadata_targets)),
        "transformations": cleaned_txs,
        "links": cleaned_links
    }

    return json.dumps(cleaned_data, indent=2)


def _get_iics_metadata(raw_content: str, filename: str) -> dict:
    """Extract metadata from IICS mapping JSON."""
    metadata = {
        "source_type": "Informatica Intelligent Cloud Services (IICS)",
        "filename": filename,
        "mappings": [],
        "workflows": [],
        "sources": [],
        "targets": [],
        "transformations": [],
        "lookups": [],
        "filters": [],
        "expressions": [],
    }

    try:
        raw_dict = json.loads(raw_content)
        content = raw_dict.get("content", raw_dict) if isinstance(raw_dict, dict) else raw_dict
    except Exception:
        return metadata

    if not isinstance(content, dict):
        return metadata

    mapping_name = content.get("name") or filename.replace(".mapping.json", "").replace(".json", "")
    metadata["mappings"].append(mapping_name)

    # Resolve links to determine source and target roles
    id_to_tx = {}
    for t in content.get("transformations", []):
        for k in ["$$ID", "id", "ID"]:
            if k in t:
                id_to_tx[t[k]] = t.get("name")

    incoming_counts = {t.get("name"): 0 for t in content.get("transformations", []) if t.get("name")}
    outgoing_counts = {t.get("name"): 0 for t in content.get("transformations", []) if t.get("name")}

    for l in content.get("links", []):
        f_id = l.get("fromTransformation", {}).get("##ID") or l.get("fromTransformation", {}).get("$$ID")
        t_id = l.get("toTransformation", {}).get("##ID") or l.get("toTransformation", {}).get("$$ID")
        f_name = id_to_tx.get(f_id)
        t_name = id_to_tx.get(t_id)

        if not f_name and "name" in l and "." in l["name"]:
            f_name = l["name"].split(".")[0]

        if f_name and t_name:
            outgoing_counts[f_name] = outgoing_counts.get(f_name, 0) + 1
            incoming_counts[t_name] = incoming_counts.get(t_name, 0) + 1

    for t in content.get("transformations", []):
        name = t.get("name", "tx")
        tx_type = "Transformation"
        if incoming_counts.get(name, 0) == 0 and outgoing_counts.get(name, 0) > 0:
            tx_type = "Source"
        elif outgoing_counts.get(name, 0) == 0 and incoming_counts.get(name, 0) > 0:
            tx_type = "Target"
        elif "Lookup" in name or "lookupCondition" in t or "lookupConditions" in t:
            tx_type = "Lookup"
        elif "Router" in name or "groupFilterConditions" in t:
            tx_type = "Router"
        elif "Filter" in name:
            tx_type = "Filter"
        elif "Sequence" in name or "midstream" in t:
            tx_type = "SequenceGenerator"
        elif "Sorter" in name:
            tx_type = "Sorter"
        elif "Expression" in name:
            tx_type = "Expression"

        metadata["transformations"].append({"name": name, "type": tx_type})

        # Table resolution
        da = t.get("dataAdapter", {})
        table_name = None
        for fld in da.get("dataAdapter", {}).get("fields", []) if isinstance(da, dict) else []:
            for p in fld.get("properties", []):
                if p.get("name") == "parentObject" and p.get("value"):
                    table_name = p.get("value")
                    break
            if table_name:
                break

        if not table_name and tx_type in ["Source", "Target"]:
            table_name = name

        if tx_type == "Source" and table_name:
            metadata["sources"].append(table_name)
        elif tx_type == "Target" and table_name:
            metadata["targets"].append(table_name)

        # Lookups
        if t.get("lookupCondition"):
            metadata["lookups"].append(str(t.get("lookupCondition")))
        if t.get("lookupConditions"):
            metadata["lookups"].append(str(t.get("lookupConditions")))

        # Filters
        if t.get("groupFilterConditions"):
            for fc in t.get("groupFilterConditions"):
                cond = fc.get("condition") or fc.get("filterCondition")
                if cond:
                    metadata["filters"].append(str(cond))

        # Expressions
        for f in t.get("fields", []):
            fname = f.get("name")
            expr = f.get("expression")
            if expr and fname:
                metadata["expressions"].append({"field": fname, "expression": expr})

    metadata["sources"] = list(dict.fromkeys(metadata["sources"]))
    metadata["targets"] = list(dict.fromkeys(metadata["targets"]))

    return metadata


@register
class InformaticaCleaner(BaseCleaner):
    extensions = [".xml", ".json", ".zip"]
    source_type = "informatica"

    def clean(self, raw_content: str, filename: str) -> str:
        """
        Clean Informatica PowerCenter XML export or IICS JSON mapping.
        """
        if _is_json_content(raw_content, filename):
            return _clean_iics_mapping_json(raw_content, filename)

        content = raw_content

        # 1. Strip XML comments
        content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)

        # 2. Strip XML declaration and DOCTYPE
        content = re.sub(r'<\?xml[^?]*\?>', '', content)
        content = re.sub(r'<!DOCTYPE[^>]*>', '', content)

        # 3. Strip tags we don't need (with all their children)
        for tag in STRIP_TAGS:
            # Self-closing tags: <TAG ... />
            content = re.sub(
                rf'<{tag}\b[^>]*/>', '', content, flags=re.IGNORECASE
            )
            # Opening + closing tags: <TAG ...>...</TAG>
            content = re.sub(
                rf'<{tag}\b[^>]*>.*?</{tag}\s*>',
                '', content, flags=re.DOTALL | re.IGNORECASE
            )

        # 4. Strip noisy attributes from remaining tags
        for attr in STRIP_ATTRIBUTES:
            # Remove ATTR="value" patterns
            content = re.sub(
                rf'\s+{attr}\s*=\s*"[^"]*"', '', content, flags=re.IGNORECASE
            )

        # 5. Remove empty TABLEATTRIBUTE entries (no meaningful expression)
        # Keep only TABLEATTRIBUTE with NAME containing 'Lookup', 'Expression', 'Filter', 'Sql'
        content = re.sub(
            r'<TABLEATTRIBUTE\s+NAME\s*=\s*"(?!.*(?:Lookup|Expression|Filter|Sql|Join|Source|Target|Tracing Level|Transformation Scope))[^"]*"\s+VALUE\s*=\s*"[^"]*"\s*/>',
            '', content, flags=re.IGNORECASE
        )

        # 6. Clean up excessive whitespace between XML tags
        content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)

        # 7. Remove lines that are just whitespace
        lines = [line for line in content.split('\n') if line.strip()]
        content = '\n'.join(lines)

        return content

    def get_metadata(self, raw_content: str, filename: str) -> dict:
        """Extract structured metadata from Informatica XML or IICS JSON."""
        if _is_json_content(raw_content, filename):
            return _get_iics_metadata(raw_content, filename)

        metadata = {
            "source_type": "Informatica PowerCenter",
            "filename": filename,
            "mappings": [],
            "workflows": [],
            "sources": [],
            "targets": [],
            "transformations": [],
            "lookups": [],
            "filters": [],
            "expressions": [],
        }

        # Extract MAPPING names
        for m in re.finditer(r'<MAPPING\s+[^>]*NAME\s*=\s*"([^"]*)"', raw_content, re.IGNORECASE):
            metadata["mappings"].append(m.group(1))

        # Extract WORKFLOW names
        for m in re.finditer(r'<WORKFLOW\s+[^>]*NAME\s*=\s*"([^"]*)"', raw_content, re.IGNORECASE):
            metadata["workflows"].append(m.group(1))

        # Extract SOURCE table names (use word boundary to avoid matching OWNERNAME, BUSINESSNAME)
        for m in re.finditer(r'<SOURCE\s+[^>]*\bNAME\s*=\s*"([^"]*)"', raw_content, re.IGNORECASE):
            if m.group(1) and not m.group(1).startswith(('SQ_', 'sq_')):
                metadata["sources"].append(m.group(1))

        # Extract TARGET table names
        for m in re.finditer(r'<TARGET\s+[^>]*\bNAME\s*=\s*"([^"]*)"', raw_content, re.IGNORECASE):
            metadata["targets"].append(m.group(1))

        # Extract TRANSFORMATION names and types
        for m in re.finditer(
            r'<TRANSFORMATION\s+[^>]*NAME\s*=\s*"([^"]*)"[^>]*TYPE\s*=\s*"([^"]*)"',
            raw_content, re.IGNORECASE
        ):
            metadata["transformations"].append({
                "name": m.group(1),
                "type": m.group(2)
            })

        # Extract lookup conditions from TABLEATTRIBUTE
        for m in re.finditer(
            r'<TABLEATTRIBUTE\s+NAME\s*=\s*"Lookup Sql Override"\s+VALUE\s*=\s*"([^"]*)"',
            raw_content, re.IGNORECASE
        ):
            metadata["lookups"].append(m.group(1))

        # Extract filter conditions
        for m in re.finditer(
            r'<TABLEATTRIBUTE\s+NAME\s*=\s*"Filter Condition"\s+VALUE\s*=\s*"([^"]*)"',
            raw_content, re.IGNORECASE
        ):
            metadata["filters"].append(m.group(1))

        # Extract expression transformations
        for m in re.finditer(
            r'<TRANSFORMFIELD\s+[^>]*EXPRESSION\s*=\s*"([^"]*)"[^>]*NAME\s*=\s*"([^"]*)"',
            raw_content, re.IGNORECASE
        ):
            if m.group(1) and m.group(1) != m.group(2):  # Skip identity expressions
                metadata["expressions"].append({
                    "field": m.group(2),
                    "expression": m.group(1)
                })

        return metadata
