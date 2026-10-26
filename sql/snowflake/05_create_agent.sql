-- ============================================================
-- 05_create_agent.sql
-- Run this in Snowflake AFTER you have created the SEMANTIC VIEWs
-- ============================================================

USE DATABASE FINANCIAL_TXN_DB;
USE SCHEMA SEMANTIC;

CREATE OR REPLACE AGENT FINANCE_ANALYST_AGENT
  COMMENT = 'Cross-domain financial analytics agent for CFO Dashboard'
  PROFILE = '{"display_name": "Finance Data Analyst", "color": "emerald"}'
  FROM SPECIFICATION
$$
models:
  orchestration: auto
 
instructions:
  response: |
    Answer concisely. Always state which data domain the answer came from.
    Show the numbers in a table when there is more than one row.
    When discussing currency, assume USD unless specified otherwise.
  orchestration: |
    Route fraud alerts, risk scores, and flagged amount questions to FraudAnalytics.
    Route payment gateway performance, latency, and processing fee questions to GatewayAnalytics.
    Route settlement reconciliations, discrepancies, gross amounts, and net payouts to SettlementAnalytics.
    If a question spans domains, call each relevant tool and combine the results.
    Never guess a domain — ask the user to clarify instead.
  sample_questions:
    - question: "How many fraud alerts did we have last week and what was the average risk score?"
    - question: "Which gateway had the lowest success rate yesterday?"
    - question: "What is the total discrepancy amount in our settlements this month?"
 
tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: FraudAnalytics
      description: "Fraud alerts, risk scores, detection types, and transaction amounts flagged for fraud."
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: GatewayAnalytics
      description: "Payment gateway latency, success rates, retries, and processing fees."
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: SettlementAnalytics
      description: "Settlement reconciliations, gross vs net amounts, fee deductions, and discrepancies."
  - tool_spec:
      type: data_to_chart
      name: Charts
      description: "Render query results as a chart when a visual helps."
 
tool_resources:
  FraudAnalytics:
    semantic_view: FINANCIAL_TXN_DB.GOLD.SV_FRAUD_MONITORING
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
      query_timeout: 120
  GatewayAnalytics:
    semantic_view: FINANCIAL_TXN_DB.GOLD.SV_GATEWAY_PERFORMANCE
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
      query_timeout: 120
  SettlementAnalytics:
    semantic_view: FINANCIAL_TXN_DB.GOLD.SV_SETTLEMENT_RECONCILIATION
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
      query_timeout: 120
$$;
