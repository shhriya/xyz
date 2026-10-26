-- ============================================================
-- 03_gold_views.sql
-- Run this in Snowflake after your RAW tables and data are inserted
-- ============================================================

USE DATABASE FINANCIAL_TXN_DB;
USE SCHEMA GOLD;

-- 1. Enriched Transactions View
-- Why: Combines transactions with customer names and segments.
-- This allows Cortex Analyst to answer "What is the revenue for Relanto Technologies?"
CREATE OR REPLACE VIEW SV_TRANSACTIONS_ENRICHED AS
SELECT 
    t.transaction_id,
    t.transaction_date,
    t.amount AS transaction_amount,
    t.currency_code,
    t.transaction_type,
    t.channel,
    t.status AS transaction_status,
    c_sender.customer_name AS sender_name,
    c_sender.segment AS sender_segment,
    c_receiver.customer_name AS receiver_name,
    c_receiver.segment AS receiver_segment
FROM FINANCIAL_TXN_DB.RAW.RAW_TRANSACTIONS t
LEFT JOIN FINANCIAL_TXN_DB.RAW.RAW_ACCOUNTS a_sender ON t.sender_account_id = a_sender.account_id
LEFT JOIN FINANCIAL_TXN_DB.RAW.RAW_CUSTOMERS c_sender ON a_sender.customer_id = c_sender.customer_id
LEFT JOIN FINANCIAL_TXN_DB.RAW.RAW_ACCOUNTS a_receiver ON t.receiver_account_id = a_receiver.account_id
LEFT JOIN FINANCIAL_TXN_DB.RAW.RAW_CUSTOMERS c_receiver ON a_receiver.customer_id = c_receiver.customer_id;

-- 2. Fraud Monitoring View
-- Why: Joins fraud alerts directly with the transaction amounts at risk.
CREATE OR REPLACE VIEW SV_FRAUD_MONITORING AS
SELECT 
    f.alert_id,
    f.detected_at::DATE AS alert_date,
    f.alert_type,
    f.risk_score,
    f.alert_status,
    t.amount AS flagged_amount,
    t.currency_code
FROM FINANCIAL_TXN_DB.RAW.RAW_FRAUD_ALERTS f
JOIN FINANCIAL_TXN_DB.RAW.RAW_TRANSACTIONS t ON f.transaction_id = t.transaction_id;

-- 3. Gateway Performance View
-- Why: Aggregates performance by day to provide clean metrics (latency, success rate, fees).
CREATE OR REPLACE VIEW SV_GATEWAY_PERFORMANCE AS
SELECT 
    created_at::DATE AS performance_date,
    gateway_name,
    COUNT(transaction_id) AS total_transactions,
    SUM(IFF(gateway_status = 'CAPTURED', 1, 0)) / NULLIF(COUNT(transaction_id), 0) * 100 AS success_rate,
    AVG(processing_time_ms) AS latency_ms,
    SUM(fee_amount) AS total_fees
FROM FINANCIAL_TXN_DB.RAW.RAW_PAYMENT_GATEWAYS
GROUP BY 1, 2;

-- 4. Settlement Reconciliation View
-- Why: Simplifies the raw settlements table specifically for discrepancy analysis.
CREATE OR REPLACE VIEW SV_SETTLEMENT_RECONCILIATION AS
SELECT 
    settlement_id,
    settlement_date,
    gateway_name,
    gross_amount AS expected_amount,
    net_amount AS actual_settled_amount,
    fee_amount,
    discrepancy_amount,
    settlement_status AS recon_status
FROM FINANCIAL_TXN_DB.RAW.RAW_SETTLEMENTS;
