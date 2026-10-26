"""Built-in demo legacy sources (Informatica XML and PySpark) used when no real source is connected."""





def get_discovered_demo_files(source_type: str, folder_path: str = "") -> list:
    """Return a rich list of discovered files matching the source type and folder path."""
    s = source_type.lower()
    base_folder = folder_path.strip() if folder_path.strip() else ("/Shared/ETL/pyspark_jobs/" if "spark" in s else "GLOBAL_EDW_MKTG")

    if "informatica" in s:
        return [
            {
                "id": "file-infa-1",
                "filename": "wf_mktg_customer_360.xml",
                "path": f"{base_folder}/wf_mktg_customer_360.xml",
                "fileSize": "7.8 KB",
                "sizeBytes": len(_DEMO_INFORMATICA_XML.encode('utf-8')),
                "lineCount": len(_DEMO_INFORMATICA_XML.splitlines()),
                "extension": "xml",
                "category": "Workflow & Mapping XML",
                "content": _DEMO_INFORMATICA_XML,
                "selected": True
            },
            {
                "id": "file-infa-2",
                "filename": "wf_finance_billing_recon.xml",
                "path": f"{base_folder}/wf_finance_billing_recon.xml",
                "fileSize": "3.1 KB",
                "sizeBytes": len(_DEMO_INFORMATICA_XML_2.encode('utf-8')),
                "lineCount": len(_DEMO_INFORMATICA_XML_2.splitlines()),
                "extension": "xml",
                "category": "Workflow & Mapping XML",
                "content": _DEMO_INFORMATICA_XML_2,
                "selected": True
            },
            {
                "id": "file-infa-3",
                "filename": "m_stg_sales_transactions.xml",
                "path": f"{base_folder}/mappings/m_stg_sales_transactions.xml",
                "fileSize": "4.6 KB",
                "sizeBytes": 4712,
                "lineCount": 86,
                "extension": "xml",
                "category": "Mapping XML",
                "content": _DEMO_INFORMATICA_XML_3,
                "selected": True
            },
            {
                "id": "file-infa-4",
                "filename": "wf_inventory_snapshot_daily.xml",
                "path": f"{base_folder}/snapshots/wf_inventory_snapshot_daily.xml",
                "fileSize": "5.2 KB",
                "sizeBytes": 5320,
                "lineCount": 94,
                "extension": "xml",
                "category": "Workflow XML",
                "content": _DEMO_INFORMATICA_XML,
                "selected": False
            }
        ]
    elif any(k in s for k in ["pyspark", "databricks", "spark"]):
        clean_base = folder_path.strip().rstrip('/')
        folder_last = clean_base.split('/')[-1] if clean_base else "version"
        
        # Derive prefix (e.g. "version3" -> "V3", "version2" -> "V2", "orders" -> "Orders")
        if folder_last.lower().startswith("version") and len(folder_last) > 7:
            ver_num = folder_last[7:]
            prefix = f"V{ver_num}"
        else:
            prefix = folder_last.title().replace("_", "").replace("-", "") or "V2"

        # Return Medallion notebooks for this specific workspace folder
        return [
            {
                "id": f"dbx-{folder_last}-1",
                "filename": f"{prefix}_Bronze_Data_Loading.py",
                "path": f"{clean_base}/{prefix}_Bronze_Data_Loading",
                "fileSize": "3.8 KB",
                "sizeBytes": len(_DEMO_PYSPARK_BRONZE.encode('utf-8')),
                "lineCount": len(_DEMO_PYSPARK_BRONZE.splitlines()),
                "extension": "py",
                "category": "Databricks Python Notebook",
                "content": _DEMO_PYSPARK_BRONZE.replace("V2_", f"{prefix}_"),
                "selected": True
            },
            {
                "id": f"dbx-{folder_last}-2",
                "filename": f"{prefix}_Silver_Transformations.py",
                "path": f"{clean_base}/{prefix}_Silver_Transformations",
                "fileSize": "4.6 KB",
                "sizeBytes": len(_DEMO_PYSPARK_SILVER.encode('utf-8')),
                "lineCount": len(_DEMO_PYSPARK_SILVER.splitlines()),
                "extension": "py",
                "category": "Databricks Python Notebook",
                "content": _DEMO_PYSPARK_SILVER.replace("V2_", f"{prefix}_"),
                "selected": True
            },
            {
                "id": f"dbx-{folder_last}-3",
                "filename": f"{prefix}_Gold_Final_Output.py",
                "path": f"{clean_base}/{prefix}_Gold_Final_Output",
                "fileSize": "4.1 KB",
                "sizeBytes": len(_DEMO_PYSPARK_GOLD.encode('utf-8')),
                "lineCount": len(_DEMO_PYSPARK_GOLD.splitlines()),
                "extension": "py",
                "category": "Databricks Python Notebook",
                "content": _DEMO_PYSPARK_GOLD.replace("V2_", f"{prefix}_"),
                "selected": True
            }
        ]
    return []


def get_demo_files(source_type: str) -> list:
    """Return demo/sample files for preprocessing demonstration."""
    discovered = get_discovered_demo_files(source_type)
    return [{"filename": f["filename"], "content": f.get("content", "")} for f in discovered if f.get("selected", True)]


# ---- Demo content for Informatica ----
_DEMO_INFORMATICA_XML = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE POWERMART SYSTEM "powrmart.dtd">
<POWERMART CREATION_DATE="08/25/2026" REPOSITORY_VERSION="186.90">
<REPOSITORY NAME="REP_GLOBAL_EDW" VERSION="186" CODEPAGE="UTF-8" DATABASETYPE="Oracle">
<FOLDER NAME="GLOBAL_EDW_MKTG" GROUP="" OWNER="admin" SHARED="NOTSHARED" DESCRIPTION="Marketing Customer 360 ETL" VERSION="1">
<FOLDERVERSION VALUE="12"/>

<!-- Source Definition -->
<SOURCE BUSINESSNAME="" DATABASETYPE="Oracle" DBDNAME="ORACLE_PROD" DESCRIPTION="Raw customer master" NAME="SRC_RAW_CUSTOMERS" OBJECTVERSION="1" OWNERNAME="RAW" VERSIONNUMBER="1">
  <SOURCEFIELD BUSINESSNAME="" DATATYPE="number" DESCRIPTION="Customer ID" FIELDNUMBER="1" FIELDPROPERTY="0" FIELDTYPE="ELEMITEM" HIDDEN="NO" KEYTYPE="PRIMARY KEY" LENGTH="10" LEVEL="0" NAME="CUST_ID" NULLABLE="NOTNULL" OCCURS="0" OFFSET="0" PHYSICALLENGTH="10" PHYSICALOFFSET="0" PICTURETEXT="" PRECISION="10" SCALE="0" USAGE_FLAGS=""/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="2" LENGTH="100" NAME="FIRST_NAME" PRECISION="100" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="3" LENGTH="100" NAME="LAST_NAME" PRECISION="100" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="4" LENGTH="200" NAME="EMAIL" PRECISION="200" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="5" LENGTH="20" NAME="ZIP" PRECISION="20" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="6" LENGTH="1" NAME="IS_ACTIVE" PRECISION="1" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="date" FIELDNUMBER="7" LENGTH="19" NAME="CREATED_DATE" PRECISION="19" NULLABLE="NULL"/>
  <SOURCEFIELD DATATYPE="timestamp" FIELDNUMBER="8" LENGTH="26" NAME="UPDATED_AT" PRECISION="26" NULLABLE="NULL"/>
</SOURCE>

<!-- Target Definition -->
<TARGET BUSINESSNAME="" DATABASETYPE="Snowflake" DESCRIPTION="Dimension Customer SCD2" NAME="DIM_CUSTOMER" OBJECTVERSION="1" TABLENAME="DIM_CUSTOMER" CONSTRAINT="" OWNERNAME="EDW">
  <TARGETFIELD BUSINESSNAME="" DATATYPE="number" DESCRIPTION="Surrogate Key" FIELDNUMBER="1" KEYTYPE="PRIMARY KEY" NAME="CUSTOMER_KEY" NULLABLE="NOTNULL" PICTURETEXT="" PRECISION="38" SCALE="0"/>
  <TARGETFIELD DATATYPE="varchar" FIELDNUMBER="2" NAME="FULL_NAME" PRECISION="200" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="varchar" FIELDNUMBER="3" NAME="EMAIL" PRECISION="200" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="varchar" FIELDNUMBER="4" NAME="CITY" PRECISION="100" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="varchar" FIELDNUMBER="5" NAME="STATE" PRECISION="50" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="varchar" FIELDNUMBER="6" NAME="HASH_KEY" PRECISION="64" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="timestamp" FIELDNUMBER="7" NAME="EFFECTIVE_FROM" NULLABLE="NULL"/>
  <TARGETFIELD DATATYPE="timestamp" FIELDNUMBER="8" NAME="EFFECTIVE_TO" NULLABLE="NULL"/>
</TARGET>

<!-- Mapping Definition -->
<MAPPING DESCRIPTION="Customer 360 Dimension SCD2" ISVALID="YES" NAME="m_dim_customer_scd2" OBJECTVERSION="3" VERSIONNUMBER="5">

  <TRANSFORMATION DESCRIPTION="Lookup for geo location" NAME="LKP_GEO_LOC" OBJECTVERSION="1" REUSABLE="NO" TYPE="Lookup Procedure" VERSIONNUMBER="1">
    <TRANSFORMFIELD DATATYPE="string" DEFAULTVALUE="" DESCRIPTION="" EXPRESSION="CUST_ID" NAME="CUST_ID" PORTTYPE="INPUT" PRECISION="10" SCALE="0"/>
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="ZIP" NAME="ZIP_CODE" PORTTYPE="INPUT" PRECISION="20"/>
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="CITY" NAME="CITY" PORTTYPE="OUTPUT" PRECISION="100"/>
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="STATE" NAME="STATE" PORTTYPE="OUTPUT" PRECISION="50"/>
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="COUNTRY" NAME="COUNTRY" PORTTYPE="OUTPUT" PRECISION="50"/>
    <TABLEATTRIBUTE NAME="Lookup Sql Override" VALUE="SELECT ZIP_CODE, CITY, STATE, COUNTRY FROM GEO_LOCATIONS WHERE ACTIVE_FLAG = &apos;Y&apos;"/>
    <TABLEATTRIBUTE NAME="Lookup condition" VALUE="SRC_RAW_CUSTOMERS.ZIP = LKP_GEO_LOC.ZIP_CODE"/>
    <TABLEATTRIBUTE NAME="Lookup Caching Enabled" VALUE="YES"/>
    <TABLEATTRIBUTE NAME="Lookup cache directory name" VALUE="$PMCacheDir"/>
    <TABLEATTRIBUTE NAME="Lookup Cache File Name Prefix" VALUE=""/>
    <TABLEATTRIBUTE NAME="Lookup Data Cache Size" VALUE="Auto"/>
    <TABLEATTRIBUTE NAME="Lookup Index Cache Size" VALUE="Auto"/>
  </TRANSFORMATION>

  <TRANSFORMATION DESCRIPTION="Lookup for currency rates" NAME="LKP_CURRENCY_RATES" OBJECTVERSION="1" REUSABLE="NO" TYPE="Lookup Procedure" VERSIONNUMBER="1">
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="CUST_ID" NAME="CUST_ID" PORTTYPE="INPUT" PRECISION="10"/>
    <TRANSFORMFIELD DATATYPE="decimal" EXPRESSION="EXCHANGE_RATE" NAME="EXCHANGE_RATE" PORTTYPE="OUTPUT" PRECISION="10" SCALE="4"/>
    <TABLEATTRIBUTE NAME="Lookup Sql Override" VALUE="SELECT CUST_ID, EXCHANGE_RATE FROM CURRENCY_RATES WHERE RATE_DATE = TRUNC(SYSDATE)"/>
  </TRANSFORMATION>

  <TRANSFORMATION DESCRIPTION="Filter active customers" NAME="FIL_ACTIVE_CUSTOMERS" OBJECTVERSION="1" REUSABLE="NO" TYPE="Filter" VERSIONNUMBER="1">
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="IS_ACTIVE" NAME="IS_ACTIVE" PORTTYPE="INPUT" PRECISION="1"/>
    <TRANSFORMFIELD DATATYPE="date" EXPRESSION="CREATED_DATE" NAME="CREATED_DATE" PORTTYPE="INPUT" PRECISION="19"/>
    <TABLEATTRIBUTE NAME="Filter Condition" VALUE="IS_ACTIVE = &apos;Y&apos; AND CREATED_DATE &gt;= TO_DATE(&apos;2020-01-01&apos;, &apos;YYYY-MM-DD&apos;)"/>
  </TRANSFORMATION>

  <TRANSFORMATION DESCRIPTION="Expression to build derived columns" NAME="EXP_DERIVED_COLS" OBJECTVERSION="1" REUSABLE="NO" TYPE="Expression" VERSIONNUMBER="1">
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="CONCAT(FIRST_NAME, &apos; &apos;, LAST_NAME)" NAME="FULL_NAME" PORTTYPE="OUTPUT" PRECISION="200"/>
    <TRANSFORMFIELD DATATYPE="string" EXPRESSION="MD5(CONCAT(CUST_ID, FIRST_NAME, LAST_NAME, EMAIL))" NAME="HASH_KEY" PORTTYPE="OUTPUT" PRECISION="64"/>
    <TRANSFORMFIELD DATATYPE="timestamp" EXPRESSION="IIF(ISNULL(UPDATED_AT), CREATED_DATE, UPDATED_AT)" NAME="EFFECTIVE_FROM" PORTTYPE="OUTPUT" PRECISION="26"/>
  </TRANSFORMATION>

  <CONNECTOR FROMFIELD="CUST_ID" FROMINSTANCE="SRC_RAW_CUSTOMERS" FROMINSTANCETYPE="Source Definition" TOFIELD="CUST_ID" TOINSTANCE="LKP_GEO_LOC" TOINSTANCETYPE="Lookup Procedure"/>
  <CONNECTOR FROMFIELD="ZIP" FROMINSTANCE="SRC_RAW_CUSTOMERS" FROMINSTANCETYPE="Source Definition" TOFIELD="ZIP_CODE" TOINSTANCE="LKP_GEO_LOC" TOINSTANCETYPE="Lookup Procedure"/>
  <CONNECTOR FROMFIELD="FULL_NAME" FROMINSTANCE="EXP_DERIVED_COLS" FROMINSTANCETYPE="Expression" TOFIELD="FULL_NAME" TOINSTANCE="DIM_CUSTOMER" TOINSTANCETYPE="Target Definition"/>
  <CONNECTOR FROMFIELD="HASH_KEY" FROMINSTANCE="EXP_DERIVED_COLS" FROMINSTANCETYPE="Expression" TOFIELD="HASH_KEY" TOINSTANCE="DIM_CUSTOMER" TOINSTANCETYPE="Target Definition"/>

  <!-- LAYOUT element (GUI coordinates — stripped by preprocessor) -->
  <LAYOUT>
    <LAYOUTOBJECT NAME="SRC_RAW_CUSTOMERS" X="100" Y="200" WIDTH="300" HEIGHT="150"/>
    <LAYOUTOBJECT NAME="LKP_GEO_LOC" X="500" Y="200" WIDTH="250" HEIGHT="120"/>
    <LAYOUTOBJECT NAME="EXP_DERIVED_COLS" X="800" Y="200" WIDTH="300" HEIGHT="180"/>
    <LAYOUTOBJECT NAME="DIM_CUSTOMER" X="1200" Y="200" WIDTH="280" HEIGHT="160"/>
  </LAYOUT>

</MAPPING>

<!-- WORKFLOW -->
<WORKFLOW DESCRIPTION="Customer 360 Workflow" ISENABLED="YES" NAME="wf_mktg_customer_360" SCHEDULERTYPE="REUSABLE" VERSIONNUMBER="3">
  <SESSION DESCRIPTION="Session for Customer 360" ISVALID="YES" MAPPINGNAME="m_dim_customer_scd2" NAME="s_m_dim_customer_scd2" REUSABLE="NO" SORTORDER="Binary">
    <SESSIONEXTENSION NAME="Relational Writer" SUBTYPE="Relational Writer" TRANSFORMATIONTYPE="Target Definition" DSQINSTNAME="SQ_SRC_RAW_CUSTOMERS" SINSTANCENAME="DIM_CUSTOMER">
    </SESSIONEXTENSION>
  </SESSION>
  <ERPINFO/>
  <CHANGEMETADATA VERSION="1" USER="admin" TIMESTAMP="2026-08-25 10:00:00"/>
</WORKFLOW>

<REPOSITORYVERSION VALUE="186.90"/>
<CRCVALUE VALUE="abc123def456"/>

</FOLDER>
</REPOSITORY>
</POWERMART>'''


_DEMO_INFORMATICA_XML_2 = '''<?xml version="1.0" encoding="UTF-8"?>
<POWERMART CREATION_DATE="08/25/2026" REPOSITORY_VERSION="186.90">
<REPOSITORY NAME="REP_GLOBAL_EDW" VERSION="186" CODEPAGE="UTF-8">
<FOLDER NAME="FINANCE_CORE" VERSION="1">
<FOLDERVERSION VALUE="8"/>

<SOURCE NAME="SRC_RAW_INVOICES" DATABASETYPE="Oracle" DBDNAME="ORACLE_PROD" OWNERNAME="RAW">
  <SOURCEFIELD DATATYPE="number" FIELDNUMBER="1" NAME="INVOICE_ID" PRECISION="10" KEYTYPE="PRIMARY KEY" NULLABLE="NOTNULL"/>
  <SOURCEFIELD DATATYPE="number" FIELDNUMBER="2" NAME="CUSTOMER_ID" PRECISION="10"/>
  <SOURCEFIELD DATATYPE="decimal" FIELDNUMBER="3" NAME="AMOUNT" PRECISION="15" SCALE="2"/>
  <SOURCEFIELD DATATYPE="date" FIELDNUMBER="4" NAME="INVOICE_DATE" PRECISION="19"/>
  <SOURCEFIELD DATATYPE="varchar2" FIELDNUMBER="5" NAME="STATUS" PRECISION="20"/>
</SOURCE>

<TARGET NAME="FCT_MONTHLY_BILLING" DATABASETYPE="Snowflake" OWNERNAME="EDW">
  <TARGETFIELD DATATYPE="number" FIELDNUMBER="1" NAME="BILLING_KEY" PRECISION="38" KEYTYPE="PRIMARY KEY"/>
  <TARGETFIELD DATATYPE="number" FIELDNUMBER="2" NAME="CUSTOMER_ID" PRECISION="10"/>
  <TARGETFIELD DATATYPE="decimal" FIELDNUMBER="3" NAME="TOTAL_AMOUNT" PRECISION="18" SCALE="2"/>
  <TARGETFIELD DATATYPE="number" FIELDNUMBER="4" NAME="INVOICE_COUNT" PRECISION="10"/>
  <TARGETFIELD DATATYPE="date" FIELDNUMBER="5" NAME="BILLING_MONTH" PRECISION="10"/>
</TARGET>

<MAPPING NAME="m_fct_monthly_billing" DESCRIPTION="Monthly billing aggregation" ISVALID="YES" OBJECTVERSION="2">
  <TRANSFORMATION NAME="AGG_MONTHLY_BILLING" TYPE="Aggregator" DESCRIPTION="Aggregate invoices by customer and month">
    <TRANSFORMFIELD DATATYPE="number" EXPRESSION="CUSTOMER_ID" NAME="CUSTOMER_ID" PORTTYPE="INPUT/OUTPUT" PRECISION="10"/>
    <TRANSFORMFIELD DATATYPE="date" EXPRESSION="TRUNC(INVOICE_DATE, &apos;MM&apos;)" NAME="BILLING_MONTH" PORTTYPE="OUTPUT" PRECISION="10"/>
    <TRANSFORMFIELD DATATYPE="decimal" EXPRESSION="SUM(AMOUNT)" NAME="TOTAL_AMOUNT" PORTTYPE="OUTPUT" PRECISION="18" SCALE="2"/>
    <TRANSFORMFIELD DATATYPE="number" EXPRESSION="COUNT(INVOICE_ID)" NAME="INVOICE_COUNT" PORTTYPE="OUTPUT" PRECISION="10"/>
    <TABLEATTRIBUTE NAME="Group By" VALUE="CUSTOMER_ID, TRUNC(INVOICE_DATE, &apos;MM&apos;)"/>
  </TRANSFORMATION>

  <TRANSFORMATION NAME="FIL_PAID_INVOICES" TYPE="Filter" DESCRIPTION="Keep only paid invoices">
    <TABLEATTRIBUTE NAME="Filter Condition" VALUE="STATUS = &apos;PAID&apos;"/>
  </TRANSFORMATION>

  <CONNECTOR FROMFIELD="CUSTOMER_ID" FROMINSTANCE="SRC_RAW_INVOICES" TOFIELD="CUSTOMER_ID" TOINSTANCE="AGG_MONTHLY_BILLING"/>
  <CONNECTOR FROMFIELD="TOTAL_AMOUNT" FROMINSTANCE="AGG_MONTHLY_BILLING" TOFIELD="TOTAL_AMOUNT" TOINSTANCE="FCT_MONTHLY_BILLING"/>

  <LAYOUT>
    <LAYOUTOBJECT NAME="SRC_RAW_INVOICES" X="100" Y="150"/>
    <LAYOUTOBJECT NAME="AGG_MONTHLY_BILLING" X="500" Y="150"/>
  </LAYOUT>
</MAPPING>

<WORKFLOW NAME="wf_finance_billing_recon" DESCRIPTION="Finance Billing Reconciliation">
  <SESSION MAPPINGNAME="m_fct_monthly_billing" NAME="s_m_fct_monthly_billing"/>
  <ERPINFO/>
  <CHANGEMETADATA VERSION="1" USER="finance_admin" TIMESTAMP="2026-08-20"/>
</WORKFLOW>

<REPOSITORYVERSION VALUE="186.90"/>
<CRCVALUE VALUE="xyz789"/>
</FOLDER>
</REPOSITORY>
</POWERMART>'''


_DEMO_INFORMATICA_XML_3 = '''<?xml version="1.0" encoding="UTF-8"?>
<POWERMART CREATION_DATE="08/25/2026" REPOSITORY_VERSION="186.90">
<REPOSITORY NAME="REP_GLOBAL_EDW" VERSION="186" CODEPAGE="UTF-8">
<FOLDER NAME="GLOBAL_EDW_MKTG" VERSION="1">
<SOURCE NAME="SRC_RAW_TRANSACTIONS" DATABASETYPE="Oracle" OWNERNAME="RAW">
  <SOURCEFIELD DATATYPE="number" FIELDNUMBER="1" NAME="TXN_ID" PRECISION="12" KEYTYPE="PRIMARY KEY"/>
  <SOURCEFIELD DATATYPE="number" FIELDNUMBER="2" NAME="CUST_ID" PRECISION="10"/>
  <SOURCEFIELD DATATYPE="decimal" FIELDNUMBER="3" NAME="AMOUNT" PRECISION="12" SCALE="2"/>
  <SOURCEFIELD DATATYPE="timestamp" FIELDNUMBER="4" NAME="TXN_TIMESTAMP" PRECISION="26"/>
</SOURCE>
<TARGET NAME="STG_TRANSACTIONS" DATABASETYPE="Snowflake" OWNERNAME="EDW">
  <TARGETFIELD DATATYPE="number" FIELDNUMBER="1" NAME="TXN_KEY" PRECISION="38" KEYTYPE="PRIMARY KEY"/>
  <TARGETFIELD DATATYPE="number" FIELDNUMBER="2" NAME="CUST_ID" PRECISION="10"/>
  <TARGETFIELD DATATYPE="decimal" FIELDNUMBER="3" NAME="AMOUNT_USD" PRECISION="14" SCALE="2"/>
</TARGET>
<MAPPING NAME="m_stg_sales_transactions" DESCRIPTION="Sales transactions staging">
  <TRANSFORMATION NAME="EXP_TXN_CLEAN" TYPE="Expression">
    <TRANSFORMFIELD DATATYPE="decimal" EXPRESSION="AMOUNT * 1.0" NAME="AMOUNT_USD" PORTTYPE="OUTPUT"/>
  </TRANSFORMATION>
  <CONNECTOR FROMFIELD="AMOUNT" FROMINSTANCE="SRC_RAW_TRANSACTIONS" TOFIELD="AMOUNT_USD" TOINSTANCE="STG_TRANSACTIONS"/>
</MAPPING>
</FOLDER>
</REPOSITORY>
</POWERMART>'''


# ---- Demo content for PySpark ----
_DEMO_PYSPARK_FILE = '''#!/usr/bin/env python3
"""
Orders Transformation Pipeline
Processes raw orders data into daily aggregated facts.
Author: Data Engineering Team
Last Modified: 2026-08-25
License: MIT
"""

import os
import sys
import logging
import argparse
from datetime import datetime, timedelta

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DecimalType, DateType

# Logging setup
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
logger.addHandler(handler)

# Argument parsing
parser = argparse.ArgumentParser(description="Orders ETL Pipeline")
parser.add_argument("--env", default="prod", help="Environment")
parser.add_argument("--date", default=None, help="Processing date")
args = parser.parse_args()

# SparkSession
spark = SparkSession.builder \\
    .appName("OrdersTransformation") \\
    .config("spark.sql.shuffle.partitions", "200") \\
    .config("spark.executor.memory", "4g") \\
    .config("spark.driver.memory", "2g") \\
    .config("spark.sql.adaptive.enabled", "true") \\
    .enableHiveSupport() \\
    .getOrCreate()


def read_raw_orders() -> DataFrame:
    """Read raw orders from bronze layer."""
    logger.info("Reading raw orders from bronze...")
    return spark.read.format("delta").table("bronze.raw_orders")


def read_customers() -> DataFrame:
    """Read customer dimension."""
    print("Loading customer data...")
    return spark.table("silver.dim_customers")


def transform_orders(df_orders: DataFrame, df_customers: DataFrame) -> DataFrame:
    """Apply business transformations to orders."""

    # Filter out cancelled orders
    df_filtered = df_orders.filter(F.col("status") != "CANCELLED")

    # Add derived columns
    df_enriched = df_filtered \\
        .withColumn("order_year", F.year("order_date")) \\
        .withColumn("order_month", F.month("order_date")) \\
        .withColumn("amount_usd", F.col("amount") * F.col("exchange_rate"))

    # Join with customers
    df_joined = df_enriched.join(
        df_customers.select("customer_id", "customer_name", "segment", "region"),
        on="customer_id",
        how="left"
    )

    # Window function: rank orders per customer
    window_spec = Window.partitionBy("customer_id").orderBy(F.col("order_date").desc())
    df_ranked = df_joined.withColumn("order_rank", F.row_number().over(window_spec))

    return df_ranked


def aggregate_daily_orders(df: DataFrame) -> DataFrame:
    """Aggregate orders by customer and date."""
    return df.groupBy("customer_id", "order_date", "segment") \\
        .agg(
            F.sum("amount_usd").alias("total_spend"),
            F.count("*").alias("order_count"),
            F.avg("amount_usd").alias("avg_order_value"),
            F.max("order_rank").alias("max_rank")
        )


def classify_customer_tier(spend):
    """UDF to classify customer tier based on spend."""
    if spend is None:
        return "UNKNOWN"
    elif spend > 10000:
        return "GOLD"
    elif spend > 5000:
        return "SILVER"
    else:
        return "BRONZE"

classify_tier_udf = F.udf(classify_customer_tier, StringType())


def write_to_gold(df: DataFrame):
    """Write aggregated data to gold layer."""
    logger.info("Writing to gold layer...")
    df = df.withColumn("customer_tier", classify_tier_udf(F.col("total_spend")))

    df.cache()
    df.repartition(10)

    df.write \\
        .format("delta") \\
        .mode("overwrite") \\
        .option("overwriteSchema", "true") \\
        .saveAsTable("gold.fct_daily_orders")

    print(f"Written {df.count()} rows to gold.fct_daily_orders")


def run_quality_checks(df: DataFrame):
    """Run data quality assertions."""
    null_count = df.filter(F.col("customer_id").isNull()).count()
    assert null_count == 0, f"Found {null_count} null customer_ids"

    neg_count = df.filter(F.col("total_spend") < 0).count()
    assert neg_count == 0, f"Found {neg_count} negative spend values"


if __name__ == "__main__":
    logger.info("Starting Orders ETL Pipeline...")
    raw_orders = read_raw_orders()
    customers = read_customers()
    transformed = transform_orders(raw_orders, customers)
    aggregated = aggregate_daily_orders(transformed)
    run_quality_checks(aggregated)
    write_to_gold(aggregated)
    logger.info("Pipeline complete.")
    spark.stop()
'''


_DEMO_PYSPARK_FILE_2 = '''#!/usr/bin/env python3
"""
Customer ETL Pipeline
SCD Type 2 customer dimension processing.
"""

import os
import sys
import logging
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

spark = SparkSession.builder \\
    .appName("CustomerSCD2") \\
    .config("spark.sql.shuffle.partitions", "100") \\
    .getOrCreate()

customer_schema = StructType([
    StructField("customer_id", IntegerType(), False),
    StructField("first_name", StringType(), True),
    StructField("last_name", StringType(), True),
    StructField("email", StringType(), True),
    StructField("phone", StringType(), True),
    StructField("address", StringType(), True),
    StructField("city", StringType(), True),
    StructField("state", StringType(), True),
    StructField("zip_code", StringType(), True),
    StructField("created_at", TimestampType(), True),
    StructField("updated_at", TimestampType(), True),
])


def read_source_customers() -> DataFrame:
    logger.info("Reading source customers...")
    return spark.read.format("delta").table("bronze.raw_customers")


def read_existing_dim() -> DataFrame:
    return spark.table("silver.dim_customers")


def build_scd2(df_new: DataFrame, df_existing: DataFrame) -> DataFrame:
    """Build SCD Type 2 dimension."""
    # Create hash key for change detection
    df_new = df_new.withColumn(
        "hash_key",
        F.md5(F.concat_ws("|",
            F.col("first_name"), F.col("last_name"),
            F.col("email"), F.col("phone"),
            F.col("address"), F.col("city")
        ))
    )

    # Full name derived column
    df_new = df_new.withColumn(
        "full_name",
        F.concat_ws(" ", F.col("first_name"), F.col("last_name"))
    )

    # Identify new and changed records via left anti join
    df_changed = df_new.join(
        df_existing.select("customer_id", "hash_key").alias("existing"),
        on=["customer_id", "hash_key"],
        how="left_anti"
    )

    # Add SCD2 tracking columns
    df_changed = df_changed \\
        .withColumn("effective_from", F.current_timestamp()) \\
        .withColumn("effective_to", F.lit(None).cast(TimestampType())) \\
        .withColumn("is_current", F.lit(True))

    # Window for dedup
    w = Window.partitionBy("customer_id").orderBy(F.col("updated_at").desc())
    df_deduped = df_changed.withColumn("rn", F.row_number().over(w)).filter(F.col("rn") == 1).drop("rn")

    return df_deduped


def write_dim_customers(df: DataFrame):
    logger.info("Writing SCD2 dimension...")
    df.cache()
    df.write.format("delta").mode("append").saveAsTable("silver.dim_customers")
    print(f"Written {df.count()} new/changed customer records")


if __name__ == "__main__":
    src = read_source_customers()
    existing = read_existing_dim()
    scd2 = build_scd2(src, existing)
    write_dim_customers(scd2)
    spark.stop()
'''


_DEMO_PYSPARK_FILE_3 = '''#!/usr/bin/env python3
"""
Product Dimension Pipeline
"""
import logging
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F

logger = logging.getLogger(__name__)

spark = SparkSession.builder.appName("ProductDim").getOrCreate()


def read_products() -> DataFrame:
    return spark.read.format("delta").table("bronze.raw_products")


def transform_products(df: DataFrame) -> DataFrame:
    df = df.filter(F.col("is_active") == True)
    df = df.withColumn("product_category_upper", F.upper(F.col("category")))
    df = df.withColumn("price_tier",
        F.when(F.col("price") > 100, "PREMIUM")
         .when(F.col("price") > 50, "MID")
         .otherwise("BUDGET")
    )
    df = df.dropDuplicates(["product_id"])
    df = df.select("product_id", "product_name", "product_category_upper", "price", "price_tier")
    return df


def write_products(df: DataFrame):
    df.write.format("delta").mode("overwrite").saveAsTable("silver.dim_products")


spark.sql("""
    CREATE OR REPLACE VIEW gold.v_product_summary AS
    SELECT product_category_upper as category,
           COUNT(*) as product_count,
           AVG(price) as avg_price,
           MAX(price) as max_price
    FROM silver.dim_products
    GROUP BY product_category_upper
""")

if __name__ == "__main__":
    products = read_products()
    transformed = transform_products(products)
    write_products(transformed)
    spark.stop()
'''


_DEMO_PYSPARK_FILE_4 = '''#!/usr/bin/env python3
"""
Fact Daily Transactions Pipeline
"""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.appName("FactTransactions").getOrCreate()

def run_pipeline():
    df_txn = spark.read.format("delta").table("bronze.raw_transactions")
    df_agg = df_txn.groupBy("cust_id", F.to_date("txn_timestamp").alias("txn_date")) \\
        .agg(
            F.sum("amount").alias("total_daily_spend"),
            F.count("txn_id").alias("total_txns")
        )
    df_agg.write.format("delta").mode("overwrite").saveAsTable("gold.fct_daily_transactions")

if __name__ == "__main__":
    run_pipeline()
    spark.stop()
'''


_DEMO_PYSPARK_BRONZE = '''# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # V2_Bronze_Data_Loading
# MAGIC Ingest raw transactional data into Delta Bronze layer.

# COMMAND ----------
import logging
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DecimalType, TimestampType

spark = SparkSession.builder.appName("V2_Bronze_Loading").getOrCreate()

schema_raw = StructType([
    StructField("order_id", StringType(), False),
    StructField("customer_id", StringType(), True),
    StructField("order_amount", DecimalType(12, 2), True),
    StructField("currency", StringType(), True),
    StructField("order_status", StringType(), True),
    StructField("created_timestamp", TimestampType(), True)
])

def load_bronze():
    df_raw = spark.read.format("json") \\
        .schema(schema_raw) \\
        .load("/mnt/raw_data/orders/")
    
    df_bronze = df_raw.withColumn("ingestion_time", F.current_timestamp()) \\
                      .withColumn("source_file", F.input_file_name())
    
    df_bronze.write.format("delta") \\
        .mode("append") \\
        .saveAsTable("bronze.orders_raw")

if __name__ == "__main__":
    load_bronze()
'''


_DEMO_PYSPARK_SILVER = '''# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # V2_Silver_Transformations
# MAGIC Cleanses, deduplicates, and enriches bronze orders into silver layer.

# COMMAND ----------
import logging
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

spark = SparkSession.builder.appName("V2_Silver_Transformations").getOrCreate()

def clean_and_transform_orders():
    df_bronze = spark.table("bronze.orders_raw")
    
    # Filter active and valid orders
    df_valid = df_bronze.filter(F.col("order_status").isin(["COMPLETED", "SHIPPED", "PROCESSING"]))
    
    # Deduplicate by order_id keeping latest ingestion
    w = Window.partitionBy("order_id").orderBy(F.col("created_timestamp").desc())
    df_dedup = df_valid.withColumn("row_num", F.row_number().over(w)) \\
                       .filter(F.col("row_num") == 1) \\
                       .drop("row_num")
    
    # Standardize currency and derived fields
    df_silver = df_dedup \\
        .withColumn("order_amount_usd", 
            F.when(F.col("currency") == "EUR", F.col("order_amount") * 1.08)
             .when(F.col("currency") == "GBP", F.col("order_amount") * 1.27)
             .otherwise(F.col("order_amount"))
        ) \\
        .withColumn("order_date", F.to_date("created_timestamp")) \\
        .withColumn("order_year", F.year("created_timestamp")) \\
        .withColumn("order_month", F.month("created_timestamp"))
        
    df_silver.write.format("delta") \\
        .mode("overwrite") \\
        .option("overwriteSchema", "true") \\
        .saveAsTable("silver.orders_cleaned")

if __name__ == "__main__":
    clean_and_transform_orders()
'''


_DEMO_PYSPARK_GOLD = '''# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # V2_Gold_Final_Output
# MAGIC Aggregates customer daily performance metrics into Gold analytical fact tables.

# COMMAND ----------
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.appName("V2_Gold_Final_Output").getOrCreate()

def build_gold_facts():
    df_silver = spark.table("silver.orders_cleaned")
    
    df_gold_daily = df_silver.groupBy("customer_id", "order_date", "order_year", "order_month") \\
        .agg(
            F.sum("order_amount_usd").alias("total_daily_revenue"),
            F.count("order_id").alias("total_orders"),
            F.avg("order_amount_usd").alias("avg_order_value"),
            F.min("created_timestamp").alias("first_order_time"),
            F.max("created_timestamp").alias("last_order_time")
        ) \\
        .withColumn("is_high_value_day", F.col("total_daily_revenue") > 5000)
        
    df_gold_daily.write.format("delta") \\
        .mode("overwrite") \\
        .saveAsTable("gold.fct_customer_daily_orders")

if __name__ == "__main__":
    build_gold_facts()
'''


LEGACY_SOURCE_SQL = """/* Legacy Informatica SQL Query / PySpark Extract */
SELECT 
    CUST_ID,
    UPPER(TRIM(FIRST_NAME)) AS FIRST_NAME,
    UPPER(TRIM(LAST_NAME)) AS LAST_NAME,
    LOWER(EMAIL_ADDR) AS EMAIL_ADDR,
    NVL(SYS_UPDATED_TS, SYSDATE) AS SYS_UPDATED_TS,
    DECODE(CURR_FLAG, 1, 'Y', 'N') AS IS_ACTIVE
FROM EDW_STAGE.LANDING.SRC_RAW_CUSTOMERS
WHERE IS_ACTIVE = 'Y';"""
