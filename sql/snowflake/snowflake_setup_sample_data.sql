-- ==============================================================================
-- SNOWFLAKE SAMPLE DATASETUP SCRIPT FOR R-DATA MODERNIZATION ENGINE
-- Copy and paste this script into your Snowflake Worksheet / Web Console
-- ==============================================================================

-- 1. Create Database and Target Schema
CREATE DATABASE IF NOT EXISTS EXECUTIVE_ANALYTICS_DB;
USE DATABASE EXECUTIVE_ANALYTICS_DB;

CREATE SCHEMA IF NOT EXISTS BUSINESS_MART;
USE SCHEMA BUSINESS_MART;

-- 2. Create Revenue & Billing Fact Table
CREATE OR REPLACE TABLE FACT_REVENUE_INVOICES (
    INVOICE_ID VARCHAR(50),
    CUSTOMER_NAME VARCHAR(100),
    REGION VARCHAR(50),
    INVOICE_DATE DATE,
    AMOUNT NUMBER(12,2),
    STATUS VARCHAR(20),
    DSO_DAYS INT
);

-- Insert Sample Live Invoices
INSERT INTO FACT_REVENUE_INVOICES VALUES
('INV-1001', 'Acme Corp Enterprise', 'North America', '2026-01-15', 4850000.00, 'PAID', 28),
('INV-1002', 'Apex Global Tech', 'North America', '2026-01-20', 3920000.00, 'OVERDUE', 62),
('INV-1003', 'Nexus Systems Inc', 'Europe', '2026-02-05', 3150000.00, 'PAID', 30),
('INV-1004', 'Summit Healthcare', 'Europe', '2026-02-12', 2840000.00, 'PAID', 25),
('INV-1005', 'Horizon Media Group', 'North America', '2026-02-18', 2450000.00, 'OVERDUE', 55),
('INV-1006', 'Vanguard Financial', 'Asia Pacific', '2026-03-01', 2100000.00, 'PAID', 32),
('INV-1007', 'Starlight Retail', 'Asia Pacific', '2026-03-10', 1890000.00, 'OPEN', 15),
('INV-1008', 'Omni Logistics', 'Latin America', '2026-03-15', 1650000.00, 'OPEN', 12),
('INV-1009', 'Quantum AI Labs', 'North America', '2026-03-22', 1420000.00, 'PAID', 22),
('INV-1010', 'Atlas Cloud Systems', 'Middle East', '2026-03-28', 1280000.00, 'PAID', 29);

-- 3. Create Operating Expenses Fact Table
CREATE OR REPLACE TABLE FACT_OPERATING_EXPENSES (
    EXPENSE_ID VARCHAR(50),
    DEPARTMENT VARCHAR(100),
    EXPENSE_DATE DATE,
    AMOUNT NUMBER(12,2),
    BUDGET_LIMIT NUMBER(12,2)
);

-- Insert Sample Live Expenses
INSERT INTO FACT_OPERATING_EXPENSES VALUES
('EXP-201', 'R&D & Product Engineering', '2026-01-31', 9662800.00, 10000000.00),
('EXP-202', 'Sales & Growth Marketing', '2026-01-31', 7673400.00, 8000000.00),
('EXP-203', 'IT & Cloud Infrastructure', '2026-01-31', 5684000.00, 6000000.00),
('EXP-204', 'General & Administrative', '2026-01-31', 3410400.00, 3500000.00),
('EXP-205', 'Customer Support Ops', '2026-01-31', 1989400.00, 2000000.00);

-- 4. Create Analytical Reporting View
CREATE OR REPLACE VIEW VW_EXECUTIVE_SUMMARY AS
SELECT 
    f.REGION,
    SUM(f.AMOUNT) AS TOTAL_REVENUE,
    COUNT(f.INVOICE_ID) AS INVOICE_COUNT,
    AVG(f.DSO_DAYS) AS AVG_DSO
FROM FACT_REVENUE_INVOICES f
GROUP BY f.REGION;

-- Verification Query
SELECT 'Snowflake Setup Complete! Found ' || COUNT(*) || ' Records in FACT_REVENUE_INVOICES' AS STATUS 
FROM FACT_REVENUE_INVOICES;
