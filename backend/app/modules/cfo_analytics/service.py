"""
Universal Analytics & MCP Data Intelligence Engine.
Zero dummy data. Always queries real connected Snowflake instances directly.
"""

from typing import Dict, Any, List

import requests

# Cortex Agent calls do LLM-based text-to-SQL and then run the generated query on Snowflake;
# a suspended warehouse resuming alone can take 10-60s before the query even starts.
CORTEX_AGENT_TIMEOUT_SEC = 120


def get_analytics_dashboard_data(connection_id: str = None, domain: str = None, database: str = None, schema: str = None) -> Dict[str, Any]:
    """
    Zero dummy data. Directly routes to generate_live_telemetry to query real connected Snowflake instance.
    """
    from .connections import get_saved_connections
    from .snowflake_live import generate_live_telemetry

    conns = get_saved_connections()
    matched = next((c for c in conns if c.get("id") == connection_id), None)
    if not matched and conns:
        matched = conns[0]

    creds = matched or {}
    db = database or creds.get("database") or ""
    sch = schema or creds.get("schema") or ""

    return generate_live_telemetry(
        credentials=creds,
        database=db,
        schema=sch,
        domain=domain
    )


import os
import requests
import json
from .snowflake_live import get_shared_live_snowflake_connection

def _query_live_snowflake_sql(question: str, domain: str, creds: Dict[str, Any], db_name: str, sch_name: str) -> Dict[str, Any]:
    """
    Executes live SQL analysis directly on the authenticated Snowflake semantic layer (GOLD)
    using Gemini AI and real Snowflake tables.
    """
    try:
        conn, _ = get_shared_live_snowflake_connection(creds, scope="analytics")
    except Exception as e:
        return {
            "status": "error",
            "question": question,
            "answer": f"Could not connect to live Snowflake database: {str(e)}",
            "domain": domain
        }

    target_db = db_name or creds.get("database") or ""
    q_lower = question.lower()

    # 1. Determine or generate SQL query
    sql_query = ""
    title_context = "Live Snowflake Telemetry"

    # Prefer a dynamic table list from the active semantic model (Phase A) for this schema;
    # fall back to live INFORMATION_SCHEMA introspection so any gold schema works, not just
    # the hand-authored finance one.
    connection_id = creds.get("id") or creds.get("account") or ""
    table_list_text = ""
    try:
        from . import semantic_view_generator as _svg
        active_model = _svg.find_active_model(connection_id, target_db, sch_name) if target_db and sch_name else None
        if active_model:
            lines = []
            for t in active_model["tables"]:
                cols = [d["expr"] for d in t["dimensions"]] + [d["expr"] for d in t["time_dimensions"]] + [m["expr"] for m in t["measures"]]
                lines.append(f"- {target_db}.{active_model['schema']}.{t['name']} ({', '.join(cols)})")
            table_list_text = "\n".join(lines)
    except Exception:
        table_list_text = ""

    if not table_list_text and target_db and sch_name:
        try:
            conn_introspect, _ = get_shared_live_snowflake_connection(creds, scope="analytics")
            cur = conn_introspect.cursor()
            cur.execute(
                f'SELECT TABLE_NAME, COLUMN_NAME FROM "{target_db}".INFORMATION_SCHEMA.COLUMNS '
                f"WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME, ORDINAL_POSITION",
                (sch_name,),
            )
            by_table: Dict[str, List[str]] = {}
            for table, column in cur.fetchall():
                by_table.setdefault(table, []).append(column)
            cur.close()
            table_list_text = "\n".join(
                f"- {target_db}.{sch_name}.{t} ({', '.join(cols[:15])})" for t, cols in list(by_table.items())[:15]
            )
        except Exception:
            table_list_text = ""

    gemini_key = os.getenv("GEMINI_API_KEY", "")  # backend/.env is loaded by app.core.config
    from app.services.gemini_retry_client import resolve_models
    _cfo_models = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])
    if gemini_key and table_list_text:
        prompt_sql = f"""You are an expert Snowflake SQL analyst for database {target_db}.
Available tables:
{table_list_text}

Convert the following user question into a valid Snowflake SQL query:
Question: "{question}"

Rules:
1. Output ONLY the raw SQL query. No markdown, no explanation, no backticks.
2. Order results logically and limit to 20 rows.
"""
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{_cfo_models[0]}:generateContent?key={gemini_key}"
            r = requests.post(url, json={"contents": [{"parts": [{"text": prompt_sql}]}]}, timeout=8)
            if r.status_code == 200:
                raw_sql = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                raw_sql = raw_sql.replace("```sql", "").replace("```", "").strip()
                if raw_sql.upper().startswith("SELECT") or raw_sql.upper().startswith("WITH"):
                    sql_query = raw_sql
        except Exception:
            pass

    # Built-in robust pattern dispatcher fallback — legacy finance-schema keyword routing.
    # Only used when we have no dynamic table list (i.e. we couldn't introspect the schema and
    # no semantic model exists) but do have a target database, so this never fires bogus SQL
    # against an empty/unresolved database for a non-finance schema.
    if not sql_query and target_db and not table_list_text:
        if any(w in q_lower for w in ["region", "country", "geo", "revenue by region", "revenue by country"]):
            title_context = "Regional Revenue Distribution"
            sql_query = f"""
SELECT GEO_COUNTRY AS REGION, 
       ROUND(SUM(SUCCESSFUL_AMOUNT_USD), 2) AS REVENUE_USD, 
       SUM(SUCCESSFUL_TRANSACTIONS) AS TRANSACTION_COUNT,
       ROUND(AVG(SUCCESS_RATE_PCT), 1) AS AVG_SUCCESS_RATE_PCT
FROM {target_db}.GOLD.FCT_DAILY_TRANSACTION_SUMMARY
WHERE GEO_COUNTRY IS NOT NULL

GROUP BY GEO_COUNTRY
ORDER BY REVENUE_USD DESC;
""".strip()
        elif any(w in q_lower for w in ["customer", "client", "spender", "user"]):
            title_context = "Top Customer Accounts"
            sql_query = f"""
SELECT CUSTOMER_NAME, COUNTRY_CODE, SEGMENT, ROUND(TOTAL_SENT_USD, 2) AS TOTAL_SPENT_USD, MAX_RISK_SCORE
FROM {target_db}.GOLD.DIM_CUSTOMERS
ORDER BY TOTAL_SENT_USD DESC NULLS LAST
LIMIT 10;
""".strip()
        elif any(w in q_lower for w in ["fraud", "alert", "risk", "flagged"]):
            title_context = "Fraud & Risk Monitoring"
            sql_query = f"""
SELECT FRAUD_TYPE, SEVERITY, COUNT(*) AS ALERT_COUNT, ROUND(SUM(FLAGGED_AMOUNT_USD), 2) AS FLAGGED_USD
FROM {target_db}.GOLD.FCT_FRAUD_MONITORING
GROUP BY FRAUD_TYPE, SEVERITY
ORDER BY FLAGGED_USD DESC;
""".strip()
        elif any(w in q_lower for w in ["gateway", "processor", "latency"]):
            title_context = "Payment Gateway Performance"
            sql_query = f"""
SELECT GATEWAY_NAME, SUM(TOTAL_ATTEMPTS) AS TOTAL_ATTEMPTS, ROUND(AVG(SUCCESS_RATE_PCT), 1) AS SUCCESS_RATE_PCT, ROUND(AVG(AVG_LATENCY_MS), 0) AS LATENCY_MS
FROM {target_db}.GOLD.FCT_GATEWAY_PERFORMANCE
GROUP BY GATEWAY_NAME
ORDER BY TOTAL_ATTEMPTS DESC;
""".strip()
        else:
            title_context = "Financial Transaction Summary"
            sql_query = f"""
SELECT TRANSACTION_TYPE, 
       CHANNEL, 
       ROUND(SUM(SUCCESSFUL_AMOUNT_USD), 2) AS TOTAL_REVENUE_USD, 
       SUM(SUCCESSFUL_TRANSACTIONS) AS TRANSACTIONS,
       ROUND(AVG(SUCCESS_RATE_PCT), 1) AS SUCCESS_RATE_PCT
FROM {target_db}.GOLD.FCT_DAILY_TRANSACTION_SUMMARY
GROUP BY TRANSACTION_TYPE, CHANNEL
ORDER BY TOTAL_REVENUE_USD DESC;
""".strip()

    if not sql_query:
        return {
            "status": "error",
            "question": question,
            "answer": "Could not determine which tables to query. Configure a GEMINI_API_KEY, or generate a semantic model for this schema under the Semantic Model tab, so questions can be answered without keyword guessing.",
            "domain": domain,
        }

    # 2. Execute on live Snowflake
    try:
        cur = conn.cursor()
        cur.execute(sql_query)
        columns = [d[0] for d in cur.description]
        rows = cur.fetchall()
        cur.close()
    except Exception as e:
        return {
            "status": "error",
            "question": question,
            "answer": f"Snowflake SQL Execution Error: {str(e)}",
            "sql": sql_query,
            "domain": domain
        }

    # 3. Format result dataset
    data_results = []
    for r in rows:
        row_dict = {}
        for c, v in zip(columns, r):
            if hasattr(v, '__float__') and not isinstance(v, (bool, int)):
                row_dict[c] = float(v)
            else:
                row_dict[c] = str(v) if v is not None else "N/A"
        data_results.append(row_dict)

    # 4. Generate human-readable Markdown answer
    answer_text = ""
    if gemini_key:
        summary_prompt = f"""You are an executive AI financial analyst. Summarize this query result clearly and professionally for the user's question: '{question}'.
Query Executed: {sql_query}
Data: {json.dumps(data_results[:10])}

Output formatted markdown with concise bullet points, highlighting key numbers in bold, and providing a quick takeaway conclusion.
"""
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{_cfo_models[0]}:generateContent?key={gemini_key}"
            r = requests.post(url, json={"contents": [{"parts": [{"text": summary_prompt}]}]}, timeout=8)
            if r.status_code == 200:
                answer_text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            pass

    if not answer_text:
        lines = [f"### {title_context} (Live Snowflake Telemetry)\n"]
        total_val = sum(d.get("REVENUE_USD") or d.get("TOTAL_REVENUE_USD") or d.get("TOTAL_SPENT_USD") or d.get("FLAGGED_USD") or 0 for d in data_results)
        
        for idx, row in enumerate(data_results[:8], 1):
            key_label = row.get("REGION") or row.get("CUSTOMER_NAME") or row.get("GATEWAY_NAME") or row.get("FRAUD_TYPE") or row.get("TRANSACTION_TYPE") or f"Item {idx}"
            amt = None
            for f in ["REVENUE_USD", "TOTAL_REVENUE_USD", "TOTAL_SPENT_USD", "FLAGGED_USD"]:
                if f in row and row[f] is not None:
                    try:
                        amt = float(row[f])
                        break
                    except (ValueError, TypeError):
                        pass
            extra = f" | Transactions: {row.get('TRANSACTION_COUNT') or row.get('TRANSACTIONS') or row.get('ALERT_COUNT')}" if ('TRANSACTION_COUNT' in row or 'TRANSACTIONS' in row or 'ALERT_COUNT' in row) else ""
            if amt is not None:
                lines.append(f"- **{key_label}**: **${amt:,.2f} USD**{extra}")
            else:
                lines.append(f"- **{key_label}**: {json.dumps(row)}")
        
        if total_val > 0:
            lines.append(f"\n**Total Tracked Volume**: **${total_val:,.2f} USD**")
        answer_text = "\n".join(lines)

    return {
        "status": "success",
        "question": question,
        "domain": domain,
        "answer": answer_text,
        "sql": sql_query,
        "data": data_results[:50],
        # Cite the schema actually queried, not a hardcoded GOLD that may not be where the data is.
        "citations": [f"Live Snowflake: {target_db}.{sch_name}" if sch_name else f"Live Snowflake: {target_db}"],
        "followup_suggestions": [
            "Which region has the highest transaction volume?",
            "Show top customer accounts by spend",
            "What is our gateway success rate breakdown?"
        ]
    }


def query_ai_analyst(question: str, domain: str = None, context: Dict[str, Any] = None) -> Dict[str, Any]:
    domain = domain or "Custom"
    db_name = context.get("database", "") if context else ""
    sch_name = context.get("schema", "") if context else ""
    
    # Retrieve connection credentials from context
    creds = context.get("connection", {}) if context else {}
    if not creds:
        from .connections import get_saved_connections
        conns = get_saved_connections()
        creds = conns[0] if conns else {}

    # Which agent answers is decided by the schema currently selected, NOT by whatever agent was
    # last cached on the connection. Otherwise switching database/schema leaves the chat talking to
    # the previous project's agent while the dashboard has already moved on.
    connection_id = creds.get("id") or creds.get("account") or ""
    cortex_role = ""
    semantic_model = ""
    agent_source = "none"

    active_model = None
    try:
        from . import semantic_view_generator as _svg
        active_model = _svg.find_active_model(connection_id, db_name, sch_name)
    except Exception:
        active_model = None

    model_agent = (active_model or {}).get("agent") or {}
    if model_agent.get("fq_name"):
        semantic_model = str(model_agent["fq_name"]).strip()
        cortex_role = str(model_agent.get("role") or creds.get("cortexRole") or "").strip()
        agent_source = "semantic_model"
    elif not active_model:
        # No model for this schema yet — only reuse the connection's agent if it actually belongs
        # to the schema being viewed, so we never answer from a different project's data.
        conn_agent = str(creds.get("cortexSemanticModel", "")).strip()
        parts = conn_agent.split(".")
        if len(parts) == 3 and db_name and sch_name \
                and parts[0].upper() == str(db_name).upper() and parts[1].upper() == str(sch_name).upper():
            semantic_model = conn_agent
            cortex_role = str(creds.get("cortexRole", "")).strip()
            agent_source = "connection"

    # Carry the last two turns so short follow-ups ("Customer", "and last month?") resolve
    # against what was just discussed instead of being treated as a brand-new question.
    prior_turns = []
    for turn in ((context or {}).get("history") or [])[-2:]:
        text = str((turn or {}).get("text") or "").strip()
        if not text:
            continue
        role = "user" if str((turn or {}).get("role")) == "user" else "assistant"
        prior_turns.append({"role": role, "content": [{"type": "text", "text": text[:4000]}]})
    # The Cortex Agent API expects the exchange to start with a user turn.
    while prior_turns and prior_turns[0]["role"] != "user":
        prior_turns.pop(0)

    # Fall back to the key file configured via SNOWFLAKE_PRIVATE_KEY_PATH (never a file inside the repo)
    key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH")
    if not creds.get("privateKey") and not creds.get("private_key") and key_path and os.path.exists(key_path):
        try:
            with open(key_path, "r", encoding="utf-8") as kf:
                creds["privateKey"] = kf.read()
        except Exception:
            pass

    # When an agent is configured it is the ONLY answer path — no silent fallback to raw SQL,
    # so every answer is provably produced by the agent this tool created.
    agent_configured = bool(cortex_role and semantic_model and len(semantic_model.split(".")) == 3)

    def _agent_error(detail: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "question": question,
            "domain": domain,
            "answer": f"The Cortex agent could not answer this. {detail}",
            "citations": [f"Cortex Agent: {semantic_model} (role {cortex_role})"],
            "agent": semantic_model,
            "role": cortex_role,
        }

    if agent_configured:
        parts = semantic_model.split('.')
        if True:
            agent_db, agent_schema, agent_name = parts
            private_key_content = creds.get("privateKey") or creds.get("private_key")
            if not private_key_content:
                return _agent_error(
                    "No RSA private key is available on this connection. The Cortex Agent REST API "
                    "requires key-pair auth — add the private key under Edit Settings."
                )
            if private_key_content:
                try:
                    restricted_creds = dict(creds)
                    restricted_creds["role"] = cortex_role
                    conn, _ = get_shared_live_snowflake_connection(restricted_creds, scope="analytics")

                    import jwt
                    import hashlib
                    import base64
                    from datetime import datetime, timezone, timedelta
                    from cryptography.hazmat.primitives import serialization
                    from cryptography.hazmat.backends import default_backend

                    key_bytes = private_key_content.strip().encode("utf-8")
                    passphrase = creds.get("privateKeyPassphrase")
                    pwd = passphrase.encode("utf-8") if passphrase else None
                    p_key = serialization.load_pem_private_key(key_bytes, password=pwd, backend=default_backend())

                    public_key_der = p_key.public_key().public_bytes(
                        encoding=serialization.Encoding.DER,
                        format=serialization.PublicFormat.SubjectPublicKeyInfo
                    )
                    sha256hash = hashlib.sha256()
                    sha256hash.update(public_key_der)
                    public_key_fp = "SHA256:" + base64.b64encode(sha256hash.digest()).decode("utf-8")

                    account_raw = creds.get("account", "").upper()
                    account_raw = account_raw.replace("HTTPS://", "").replace("HTTP://", "").split(".SNOWFLAKECOMPUTING.COM")[0].split("/")[0]
                    account_clean = account_raw.replace(".", "-")
                    username = creds.get("username", "").upper()

                    qualified_username = f"{account_clean}.{username}"
                    issuer = f"{qualified_username}.{public_key_fp}"

                    now = datetime.now(timezone.utc)
                    jwt_payload = {
                        "iss": issuer,
                        "sub": qualified_username,
                        "iat": now,
                        "exp": now + timedelta(minutes=59)
                    }
                    jwt_token = jwt.encode(jwt_payload, p_key, algorithm="RS256")
                    host = conn.host

                    url = f"https://{host}/api/v2/databases/{agent_db}/schemas/{agent_schema}/agents/{agent_name}:run"
                    headers = {
                        "Authorization": f'Bearer {jwt_token}',
                        "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                    request_payload = {
                        "messages": [
                            *prior_turns,
                            {"role": "user", "content": [{"type": "text", "text": question}]},
                        ],
                        "stream": False
                    }
                    # Cortex Agent calls involve LLM-based SQL generation plus, often, a Snowflake warehouse
                    # resuming from suspend (cold start can itself take 10-60s) before the query even runs.
                    # 20s was cutting off legitimate answers; give it real room to finish.
                    response = requests.post(url, headers=headers, json=request_payload, timeout=CORTEX_AGENT_TIMEOUT_SEC)
                    if response.status_code == 200:
                        resp_data = response.json()
                        messages = resp_data.get("content", []) or resp_data.get("message", {}).get("content", [])
                        answer_text = ""
                        sql_query = ""
                        for item in messages:
                            if item.get("type") == "text":
                                answer_text += item.get("text", "") + "\n"
                            elif item.get("type") == "sql":
                                sql_query = item.get("statement", "")

                        data_results = []
                        if sql_query:
                            cursor = conn.cursor()
                            cursor.execute(sql_query)
                            columns = [desc[0] for desc in cursor.description]
                            rows = cursor.fetchall()
                            data_results = [dict(zip(columns, row)) for row in rows]
                            cursor.close()

                        return {
                            "status": "success",
                            "question": question,
                            "domain": domain,
                            "answer": answer_text.strip() or "Analysis complete.",
                            "sql": sql_query,
                            "data": data_results[:50],
                            "citations": [
                                f"Cortex Agent: {semantic_model} (role {cortex_role})",
                                f"Schema: {db_name}.{sch_name}",
                            ],
                            "agent": semantic_model,
                            "role": cortex_role,
                            "agent_source": agent_source,
                            "schema": f"{db_name}.{sch_name}",
                            "followup_suggestions": ["Show more details", "Export results"]
                        }
                    return _agent_error(f"Snowflake returned HTTP {response.status_code}: {response.text[:400]}")
                except requests.exceptions.Timeout:
                    return _agent_error(
                        f"The agent didn't respond within {CORTEX_AGENT_TIMEOUT_SEC}s. This is usually a "
                        "Snowflake warehouse resuming from suspend, or a complex question. Please try again — "
                        "the warehouse should be warm now and respond faster."
                    )
                except Exception as e:
                    return _agent_error(str(e))

    # No agent configured yet — answer from the schema directly so the chat still works before
    # the Semantic Model wizard has created one.
    return _query_live_snowflake_sql(question, domain, creds, db_name, sch_name)
