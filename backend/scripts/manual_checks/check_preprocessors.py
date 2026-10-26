"""Quick test for the preprocessor registry."""
from app.modules.code_conversion.preprocessors import preprocess, preprocess_with_metadata, get_registered_sources

print("=" * 60)
print("Registered preprocessors:", get_registered_sources())
print("=" * 60)

# Test PySpark cleaner
pyspark_code = """#!/usr/bin/env python3
import os
import sys
import logging
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

spark = SparkSession.builder \\
    .appName("OrdersETL") \\
    .config("spark.executor.memory", "4g") \\
    .getOrCreate()

def transform_orders(df):
    df = df.filter(F.col("status") != "CANCELLED")
    df = df.withColumn("year", F.year("order_date"))
    return df.groupBy("customer_id").agg(F.sum("amount").alias("total"))

def write_output(df):
    df.write.format("delta").mode("overwrite").saveAsTable("gold.orders")

if __name__ == "__main__":
    logger.info("Starting...")
    raw = spark.read.format("delta").table("bronze.raw_orders")
    result = transform_orders(raw)
    write_output(result)
    spark.stop()
"""

result = preprocess_with_metadata(pyspark_code, "test_orders.py", "PySpark (Databricks)")
print("\n--- PySpark Cleaning ---")
print(f"Original: {result['original_size']} bytes")
print(f"Cleaned:  {result['cleaned_size']} bytes")
print(f"Reduction: {result['reduction_percent']}%")
print(f"\nMetadata: {result['metadata']}")
print(f"\nCleaned content:\n{result['cleaned_content']}")

# Test Informatica cleaner
infa_xml = """<?xml version="1.0" encoding="UTF-8"?>
<POWERMART CREATION_DATE="08/25/2026" REPOSITORY_VERSION="186.90">
<REPOSITORY NAME="REP_EDW" VERSION="186" CODEPAGE="UTF-8" DATABASETYPE="Oracle">
<FOLDER NAME="MKTG" VERSION="1">
<FOLDERVERSION VALUE="12"/>
<SOURCE NAME="SRC_CUSTOMERS" DATABASETYPE="Oracle" OWNERNAME="RAW">
  <SOURCEFIELD DATATYPE="number" NAME="CUST_ID" PRECISION="10" KEYTYPE="PRIMARY KEY"/>
  <SOURCEFIELD DATATYPE="varchar2" NAME="FIRST_NAME" PRECISION="100"/>
</SOURCE>
<TARGET NAME="DIM_CUSTOMER" DATABASETYPE="Snowflake" OWNERNAME="EDW">
  <TARGETFIELD DATATYPE="varchar" NAME="FULL_NAME" PRECISION="200"/>
</TARGET>
<MAPPING NAME="m_dim_customer" ISVALID="YES" OBJECTVERSION="3" VERSIONNUMBER="5">
  <TRANSFORMATION NAME="EXP_DERIVED" TYPE="Expression" REUSABLE="NO">
    <TRANSFORMFIELD EXPRESSION="CONCAT(FIRST_NAME, ' ', LAST_NAME)" NAME="FULL_NAME" PORTTYPE="OUTPUT"/>
  </TRANSFORMATION>
  <CONNECTOR FROMFIELD="CUST_ID" FROMINSTANCE="SRC_CUSTOMERS" TOFIELD="CUST_ID" TOINSTANCE="EXP_DERIVED"/>
  <LAYOUT>
    <LAYOUTOBJECT NAME="SRC_CUSTOMERS" X="100" Y="200"/>
    <LAYOUTOBJECT NAME="EXP_DERIVED" X="500" Y="200"/>
  </LAYOUT>
</MAPPING>
<WORKFLOW NAME="wf_customer_360">
  <SESSION MAPPINGNAME="m_dim_customer" NAME="s_dim_customer"/>
  <ERPINFO/>
  <CHANGEMETADATA VERSION="1" USER="admin" TIMESTAMP="2026-08-25"/>
</WORKFLOW>
<REPOSITORYVERSION VALUE="186.90"/>
<CRCVALUE VALUE="abc123"/>
</FOLDER>
</REPOSITORY>
</POWERMART>"""

result2 = preprocess_with_metadata(infa_xml, "wf_customer_360.xml", "Informatica PowerCenter")
print("\n\n--- Informatica Cleaning ---")
print(f"Original: {result2['original_size']} bytes")
print(f"Cleaned:  {result2['cleaned_size']} bytes")
print(f"Reduction: {result2['reduction_percent']}%")
print(f"\nMetadata: {result2['metadata']}")
print(f"\nCleaned content:\n{result2['cleaned_content']}")
