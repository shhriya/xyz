import os

import app.core.config  # noqa: F401  (loads backend/.env before the defaults below are read)

state = {
    "settings": {
        "provider": os.getenv("LLM_PROVIDER", "gemini"),
        "model": os.getenv("GEMINI_MODEL", os.getenv("LLM_MODEL", "gemini-2.5-pro")),
        "gemini_api_key": os.getenv("GEMINI_API_KEY", ""),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
        "ollama_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    },
    "source_connected": False,
    "connection_type": "Snowflake SQL",
    "connection_details": {},
    "saved_source_connections": [],
    "uploaded_files": [],
    "discovered_files": [],
    "cleaned_files": [],
    "metadata": {
        "summary": {
            "workflowCount": 0,
            "mappingCount": 0,
            "sourceTables": 0,
            "targetTables": 0,
            "lookupTables": 0,
            "transformationsDetected": 0
        },
        "workflows": [
            {
                "id": "wf_customer_360",
                "name": "wf_mktg_customer_360",
                "folder": "GLOBAL_EDW_MKTG",
                "mappings": ["m_stg_customers", "m_dim_customer_scd2", "m_fact_orders_daily"]
            },
            {
                "id": "wf_billing_recon",
                "name": "wf_finance_billing_recon",
                "folder": "FINANCE_CORE",
                "mappings": ["m_stg_invoices", "m_fct_monthly_billing"]
            }
        ],
        "mappings": [
            {
                "id": "m_dim_customer_scd2",
                "name": "m_dim_customer_scd2",
                "source": "SRC_RAW_CUSTOMERS (Oracle)",
                "target": "DIM_CUSTOMER (Snowflake)",
                "joins": ["SRC_RAW_CUSTOMERS INNER JOIN LKP_GEO_LOC ON SRC_RAW_CUSTOMERS.ZIP = LKP_GEO_LOC.ZIP_CODE"],
                "lookups": ["LKP_GEO_LOC", "LKP_CURRENCY_RATES"],
                "filters": ["SRC_RAW_CUSTOMERS.IS_ACTIVE = 'Y'", "SRC_RAW_CUSTOMERS.CREATED_DATE >= '2020-01-01'"],
                "expressions": [
                    "FULL_NAME = CONCAT(FIRST_NAME, ' ', LAST_NAME)",
                    "HASH_KEY = MD5(CONCAT(CUST_ID, FIRST_NAME, LAST_NAME, EMAIL))",
                    "EFFECTIVE_FROM = NVL(UPDATED_AT, CREATED_AT)"
                ],
                "columns": [
                    {"source": "CUST_ID", "target": "CUSTOMER_ID", "transformation": "DIRECT_MAP"},
                    {"source": "FIRST_NAME", "target": "FIRST_NAME", "transformation": "UPPER(TRIM())"},
                    {"source": "LAST_NAME", "target": "LAST_NAME", "transformation": "UPPER(TRIM())"},
                    {"source": "EMAIL_ADDR", "target": "EMAIL", "transformation": "LOWER()"},
                    {"source": "SYS_UPDATED_TS", "target": "VALID_FROM", "transformation": "SCD2_EFFECTIVE_DATE"},
                    {"source": "SYSTEM_FLAG", "target": "IS_CURRENT", "transformation": "DECODE(CURR_FLAG, 1, TRUE, FALSE)"}
                ]
            }
        ],
        "tables": [
            {
                "id": "tbl_1",
                "tableName": "RAW_CUSTOMERS",
                "database": "EDW_STAGE",
                "schema": "LANDING",
                "type": "Source",
                "columns": [
                    {"name": "CUST_ID", "datatype": "VARCHAR(50)", "isPk": True, "edited": False},
                    {"name": "FIRST_NAME", "datatype": "VARCHAR(100)", "isPk": False, "edited": False},
                    {"name": "LAST_NAME", "datatype": "VARCHAR(100)", "isPk": False, "edited": False},
                    {"name": "EMAIL_ADDR", "datatype": "VARCHAR(255)", "isPk": False, "edited": False},
                    {"name": "SYS_UPDATED_TS", "datatype": "TIMESTAMP_NTZ", "isPk": False, "edited": False}
                ]
            },
            {
                "id": "tbl_2",
                "tableName": "DIM_CUSTOMER",
                "database": "EDW_ANALYTICS",
                "schema": "CORE",
                "type": "Target",
                "columns": [
                    {"name": "CUSTOMER_SK", "datatype": "NUMBER(38,0)", "isPk": True, "edited": True},
                    {"name": "CUSTOMER_ID", "datatype": "VARCHAR(50)", "isPk": False, "edited": False},
                    {"name": "FULL_NAME", "datatype": "VARCHAR(200)", "isPk": False, "edited": False},
                    {"name": "EMAIL", "datatype": "VARCHAR(255)", "isPk": False, "edited": False},
                    {"name": "VALID_FROM", "datatype": "TIMESTAMP_NTZ", "isPk": False, "edited": False},
                    {"name": "VALID_TO", "datatype": "TIMESTAMP_NTZ", "isPk": False, "edited": False},
                    {"name": "IS_CURRENT", "datatype": "BOOLEAN", "isPk": False, "edited": False}
                ]
            }
        ],
        "aiDetections": {
            "scdType": "SCD Type 2",
            "loadStrategy": "Incremental Load",
            "mergeStrategy": "Merge on Surrogate Key",
            "timestampStrategy": "SYS_UPDATED_TS",
            "checkStrategy": "MD5 Hash Comparison",
            "confidenceScore": 98.4
        }
    },
    "prompts": {
        "mode": "Static",
        "staticVersion": "Generic Prompt v6.4 (Approved Enterprise)",
        "lastUpdated": "2026-08-10",
        "manualPrompts": {
            "p1": "Use the previously loaded source configuration inputs to determine transformation complexity and select the appropriate dbt architecture.\n\nIMPORTANT:Follow instructions strictly in the given order.Do not omit any required section.Do not add unsupported features.\n\nPRIORITY RULE:When input data contains explicit runtime behavior(e.g., load mode, update strategy, keys, merge logic),it OVERRIDES any default rule defined in this prompt.\n\nInput data is always more specific than prompt defaults.\n\nMULTI-WORKFLOW SUPPORT\n\nIn real enterprise projects a pipeline may consist of multiple workflows.Projects may contain tens or even hundreds of workflows.\n\nMultiple workflows may collectively represent one logical pipeline.\n\nThe system must therefore:\n\nSupport processing multiple workflows together \n\nCorrectly understand dependencies between workflows \n\nMaintain relationships between upstream and downstream workflows \n\nAvoid generating isolated pipelines when workflows are logically connected \n\nDetect reusable logic across workflows \n\nGenerate reusable dbt macros when similar logic appears across multiple workflows \n\nEnsure models generated from different workflows reference each other correctly using ref() \n\nExample scenario:\n\nIf multiple workflows share similar transformation logic,the system should detect the pattern and generate a reusable macroinstead of duplicating SQL across models.\n\nThe solution must support multi-workflow processingwhile preserving lineage and dependencies.\n\nConvert the provided configuration inputs into a complete dbt project for Snowflake.\n\nThe solution must be fully configuration-driven and production-oriented.\n\nINPUTS\n\nConnection configuration \n\nTransformation logic configuration \n\nNote:\n\nThe configuration inputs represent workflow mappings extracted from a transformation system.Use these configurations as the authoritative workflow logic input.\n\nSTRICT VALIDATION RULES\n\nUse only information present in the provided configuration inputs \n\nDo NOT invent source tables, columns, or business rules \n\nIf required details are missing, explicitly state assumptions \n\nTASKS\n\n1) IDENTIFY SOURCE TABLES\n\nExtract all source tables from the configuration inputs \n\nUse the configuration inputs to determine database and Bronze layer schema \n\nProvide Snowflake SQL CREATE TABLE scripts in the Bronze ingestion schema \n\nUse appropriate Snowflake datatypes \n\nInclude sample INSERT statements for dummy data \n\nSOURCE TABLE EXISTENCE DETECTION\n\nBefore generating CREATE TABLE scripts for any SOURCE or LOOKUP table:\n\n1. Extract all SOURCE and LOOKUP table names from configuration inputs.\n\n2. Use the database defined in profiles.yml target.database.\n\n3. Search for these tables inside the database using:\n\n   INFORMATION_SCHEMA.TABLES\n\n4. If a table exists:\n\n   - Capture its schema location\n\n   - Register it as a dbt source table\n\n   - Do NOT generate CREATE TABLE scripts\n\n5. If a table does NOT exist:\n\n   - Generate CREATE TABLE scripts in the Bronze ingestion schema\n\n6. Produce a summary listing:\n\nDetected Source Tables\n\nMissing Source Tables\n\nSchema locations of detected tables\n\nTRUTH TABLE DETECTION FOR VALIDATION\n\nTruth tables represent legacy ETL outputs defined as TARGET tables\n\nin configuration inputs.\n\nBefore generating validation models:\n\n1. Extract all TARGET table names from configuration inputs.\n\n2. Use the database defined in profiles.yml target.database.\n\n3. Search for these tables inside the database using:\n\n   INFORMATION_SCHEMA.TABLES\n\n4. If a table exists:\n\n   - Capture its schema location\n\n   - Register it as a validation source table in sources.yml\n\n   - Use it for dbt-audit-helper validation models\n\n5. If a table does NOT exist:\n\n   - Generate CREATE TABLE scripts using TARGET field definitions\n\n   - Generate INSERT statements with sample validation data\n\n   - Register the created table as a validation source\n\n6. Produce a summary listing:\n\n   • Detected Truth Tables\n\n   • Missing Truth Tables\n\n   • Schema locations of detected tables\n\n2) CREATE DBT SOURCE CONFIGURATION\n\nGenerate sources.yml referencing the Bronze ingestion schema.\n\nRules:\n\nDatabase and schema must come from connection configuration \n\nBronze ingestion schema must contain only physical source tables \n\nBronze ingestion tables must only be accessed via dbt source() \n\nBronze ingestion schema is read-only.\n\nMODEL BUILD ORDER AND DEPENDENCY RULES\n\nDEPENDENCY IMPLEMENTATION RULES:\n\nUse {{ source() }} for Bronze ingestion tables only \n\nUse {{ ref() }} for dbt model dependencies \n\nDo not hardcode database.schema.table names \n\nEnforce strict layer-by-layer lineage.\n\nLayers must follow:\n\nSOURCE TABLES→ BRONZE→ SILVER→ SNAPSHOT (if SCD Type 2)→ GOLD\n\nSnapshots must reference Silver models directly.\n\nDo NOT create GOLD models solely for snapshot input preparation.",
            "p2": "ARCHITECTURE SELECTION (CONFIG-DRIVEN)\n\nAnalyze the configuration inputs to determine transformation complexity.Choose architecture accordingly.\n\nSIMPLE LOGIC\n\nExample flow:\n\nSource → Bronze → Silver → Gold\n\nMODERATE COMPLEXITY\n\nExample flow:\n\nSource → Bronze → Silver (join layer)→ Silver (refinement layer)→ Gold\n\nHIGH COMPLEXITY\n\nExample flow:\n\nSource → Bronze→ Silver (standardization)→ Silver (integration)→ Silver (business-rule preparation)→ Gold\n\nLAYER RESPONSIBILITIES\n\nBRONZE\n\nClean and standardize raw data \n\nRename columns \n\nApply datatype casting \n\nMinimal transformations only — preserve original source schema structure \n\nSILVER\n\nApply transformation logic \n\nJoin Bronze tables \n\nCreate derived columns \n\nPrepare reusable, transformation-ready datasets for Gold layer consumption \n\nGOLD\n\nApply business logic and produce analytics-ready, domain-level outputs \n\nGenerate analytics-ready tables \n\nProduce final domain outputs \n\nDATABASE AND SCHEMA RULES\n\nTARGET RESOLUTION RULES\n\ndbt models must be created in the database and schema defined in profiles.yml target \n\nDo not override database or schema unless explicitly required \n\nDATABASE\n\nUse database from the configuration inputs.\n\nSCHEMAS\n\nBRONZE INGESTION LAYER\n\nContains only physical source tables \n\nNo dbt models allowed \n\nTARGET SCHEMA\n\nContains Bronze, Silver, and Gold models \n\nSNAPSHOT SCHEMA\n\nUsed for SCD Type 2 snapshots \n\nMATERIALIZATION BY LAYER\n\nBronze → VIEWSilver → EPHEMERAL or VIEW if reusedGold → Determined by configuration input behaviorSCD Type 2 → SNAPSHOT\n\nMaterialization priority hierarchy:\n\n1. If the model generates sequence-based surrogate keys → TABLE\n\n2. If the model is reused across multiple downstream models → VIEW\n\n3. Otherwise → EPHEMERAL\n\nMODEL NAMING RULES\n\nModel filenames must NOT be prefixed with layer names such as:\n\nbronze_silver_gold_\n\nFolder structure already represents the layer.\n\nCorrect example\n\nmodels/bronze/src_customer.sqlmodels/silver/int_customer.sqlmodels/gold/dim_customer.sql\n\nIncorrect example\n\nmodels/bronze/bronze_src_customer.sqlmodels/silver/silver_int_customer.sqlmodels/gold/gold_dim_customer.sql\n\nUse business-meaningful model names derived from transformation logicinstead of layer-prefixed filenames.\n\nSOURCE FRESHNESS\n\nConfigure freshness for each source:\n\nUse timestamp column from the configuration inputs if available.\n\nDefaults if not provided:\n\nwarn_after: 24 hourserror_after: 48 hours\n\nMACRO GENERATION\n\nGenerate reusable macros when common logic exists across models.\n\nExamples:\n\nIncremental filtering logic \n\nAudit columns \n\nTransformation logic reused across workflows \n\nSCD helper logic \n\nCreate macros only when beneficial.\n\nDBT_UTILS PACKAGE — CONDITIONAL FUNCTION GENERATION\n\nCRITICAL RULE:\n\nDo NOT add dbt_utils functions by default or speculatively.\n\nEach function below must only be generated when the pattern it addressesis explicitly present in the configuration inputs.\n\nScan the configuration inputs before deciding which functions to use.\n\nSupported dbt_utils functions and their trigger conditions\n\ndbt_utils.star()\n\nUSE WHEN:\n\nmapping selects all columns from a source table with no explicit column-level renaming or filtering.\n\nGenerates a dynamic column selector instead of a hardcoded column list.\n\ndbt_utils.generate_surrogate_key()\n\nUSE WHEN:\n\nmapping defines a surrogate key derived from multiple source columnsand the key must be deterministic and reproducible.\n\nDo NOT use this alongside Snowflake sequences — choose one approach based on configuration inputs.\n\ndbt_utils.deduplicate()\n\nUSE WHEN:\n\nmapping contains DISTINCT logic, a row_number deduplication pattern,or a transformation explicitly designed to eliminate duplicate records.\n\nRetains the latest row per key.\n\ndbt_utils.union_relations()\n\nUSE WHEN:\n\nmapping contains a Union transformation that combines two or more datasets.\n\nReplaces manually written UNION ALL SQL blocks.\n\ndbt_utils.safe_add / safe_divide / safe_subtract\n\nUSE WHEN:\n\nmapping contains arithmetic expressions on nullable columns,or any division operation.\n\nPrevents NULL propagation and divide-by-zero errors at runtime.\n\ndbt_utils.expression_is_true()\n\nUSE WHEN:\n\nmapping contains a Filter or Constraint transformation enforcing a business rule(e.g. amount > 0, status IN allowed values).\n\nGenerate as a dbt test, not as inline SQL.\n\ndbt_utils.equal_rowcount()\n\nUSE WHEN:\n\nmapping has a one-to-one source-to-target relationshipand row count parity must be validated.\n\nGenerate as a dbt test in the validation layer alongside dbt-audit-helper checks.\n\ndbt_utils.equality()\n\nUSE WHEN:\n\nfull column-level equivalence between the source target tableand the generated dbt model must be confirmed.\n\nGenerate as a dbt test in the validation layer when complete data parity is required.\n\nAdd dbt_utils to packages.yml only when at least one of the above functions is required.Do not include it otherwise.",
            "p3": "MODEL GENERATION\n\n3) BUILD BRONZE MODELS\n\nCreate Bronze models for every source table \n\nReference sources using {{ source() }} \n\nApply column renaming \n\nApply datatype casting \n\nNo business logic allowed \n\nMaterialization: VIEW\n\n4) IDENTIFY LOAD TYPE FROM CONFIGURATION INPUTS\n\nDetermine load behavior from configuration inputs.\n\na) FULL LOAD\n\nCreate Gold models as TABLE.\n\nb) INCREMENTAL LOAD\n\nUse dbt incremental models with:\n\nunique_key from configuration inputs \n\nwatermark column \n\nMERGE incremental strategy \n\nModels must be idempotent and re-runnable.\n\nc) SCD TYPE 2\n\nCreate dbt SNAPSHOT using strategy derived from configuration input behavior.\n\nSTRATEGY SELECTION RULES\n\n1) TIMESTAMP STRATEGY\n\nIf configuration inputs contain explicit update timestamp column(e.g. last_update_date, updated_at, row_modified_ts)\n\n→ use:\n\nstrategy='timestamp'\n\n→ set:\n\nupdated_at = that column\n\n2) CHECK STRATEGY — EFFECTIVE DATE COLUMNS PRESENT\n\nIf configuration inputs contain only effective_start_date / effective_end_date columns(e.g. eff_start_dt, eff_end_dt)but no update timestamp\n\n→ use:\n\nstrategy='check'\n\n→ generate check_cols dynamically from mapped attributes\n\n3) CHECK STRATEGY — CHANGE DETECTION COLUMNS PRESENT\n\nIf configuration inputs explicitly define change-detection columns\n\n→ use:\n\nstrategy='check'\n\n→ use those columns as check_cols\n\n4) MERGE / UPDATE FLAGS WITHOUT HISTORY TRACKING\n\nIf configuration inputs contain merge/update indicators but no history tracking\n\n→ DO NOT create snapshot→ use incremental model instead\n\n5) MULTIPLE INDICATORS PRESENT\n\nIf multiple indicators exist\n\n→ prioritize explicit timestamp column over check strategy\n\nSnapshots must track historical changes using configurationderived only from the configuration inputs.\n\nGold models derived from snapshots must represent the current-state dataset\n\nexposed for downstream analytics or reporting use.\n\nSnapshots represent historical state only and are not reporting endpoints.\n\nSNAPSHOT STRATEGY RESOLUTION RULE\n\nSnapshot strategy must NEVER be hardcoded.\n\nAlways infer strategy from configuration input mapping behavior:\n\ntimestamp column present → timestamp strategy \n\ncolumn comparison logic present → check strategy \n\nno change tracking logic → no snapshot \n\nFinal dimension models must be built from the snapshot.\n\nSCD TYPE 2 REQUIREMENT:\n\nSnapshots are never final reporting artifacts.\n\nA downstream Gold model MUST always be generated from the snapshot.\n\nThe Gold model must:\n\n- filter for dbt_valid_to IS NULL\n\n- expose current active records only\n\n- alias dbt metadata columns back to legacy equivalents if required\n\n- serve as the reporting-ready dimension layer\n\nGOLD MATERIALIZATION DECISION\n\nMaterialization must be determined from configuration input semantics.\n\nRules priority:\n\nIf configuration inputs explicitly specify materialization → use it \n\nIf incremental behavior is detected → use INCREMENTAL \n\nIf SCD Type 2 behavior exists → create snapshot \n\nIf model feeds BI/reporting → use VIEW \n\nIf batch processing large datasets → use TABLE \n\nIf insufficient information → default to TABLE",
            "p4": "TRANSFORMATION IMPLEMENTATION\n\nImplement transformations defined in the configuration inputs.\n\nRules:\n\nModels must exist only in target schema \n\nBronze ingestion schema must not contain dbt models \n\nUse Silver models when complexity requires \n\n If transformation logic is unsupported in dbt or Snowflake,  automatically generate an equivalent SQL-based alternative implementation.\n\nNever skip transformations due to framework limitations.\n\nPreserve transformation intent using native Snowflake SQL where required.\n\nDATA EXCEPTION HANDLING\n\nEnsure models do not fail due to bad data.\n\nUse Snowflake-safe SQL patterns:\n\nTRY_CAST \n\nTRY_TO_NUMBER \n\nTRY_TO_DATE \n\nHandle NULL values using COALESCE where appropriate.\n\nPrevent duplicate records using deterministic deduplication logic.\n\nEnsure joins do not cause row multiplication.\n\nHandle late-arriving data safely.\n\ncurDo not introduce new business rules.\n\nSURROGATE KEY HANDLING\n\nUse the surrogate key defined in the transformation logic.\n\nRules:\n\nDo not delete required surrogate key columns \n\nIf key already exists upstream → carry forward \n\nGenerate new surrogate key only if required \n\nGeneration method:\n\nCreate Snowflake sequence via dbt model pre-hook.\n\nPopulate using:\n\nseq_<model>.NEXTVAL AS surrogate_key\n\nSurrogate keys must NOT be used as incremental MERGE keys.\n\nUse stable business identifiers instead.\n\nIf surrogate keys are required for snapshot-based dimensions,\n\ngenerate them in the Silver layer before snapshot executionunless explicitly defined otherwise in the configuration inputs.\n\nIf a Snowflake sequence (.NEXTVAL) is used to generate a surrogate key,\n\nthe model MUST be materialized as TABLE.\n\nThis overrides default Silver materialization rules.\n\nSnapshots must not generate surrogate keys.\n\nSnapshots track historical state changes only and must reuse keys generated upstream.",
            "p5": "TEST GENERATION\n\nImplement all tests based on the configuration inputs.\n\nGenerate dbt tests appropriate for each layer.\n\nSOURCE TESTS\n\nnot_null \n\nuniqueness \n\nBRONZE TESTS\n\nnot_null on critical fields \n\nrelationship tests \n\nSILVER TESTS\n\nuniqueness checks \n\nrelationship validation \n\nGOLD TESTS\n\nprimary key uniqueness \n\nbusiness rule validation \n\nSNAPSHOT TESTS\n\none active record per business key \n\nCreate custom tests when transformation logic requires validation.\n\nSCHEMA YAML RULE\n\nGenerate exactly one schema.yml per folder:\n\nmodels/bronze/schema.ymlmodels/silver/schema.ymlmodels/gold/schema.ymlmodels/validation/schema.yml\n\nEach schema.yml must contain all models in that folder.\n\nDo NOT create one YAML per model.Do NOT create bronze_models.yml / silver_models.yml / gold_models.yml.\n\nsources.yml remains separate at:\n\nmodels/\n\nDBT-EXPECTATIONS — CONDITIONAL TEST GENERATION\n\nCRITICAL RULE:\n\nDo NOT add dbt-expectations tests by default.\n\nEach function below must only be generated when the specific pattern is detected in the configuration inputs.\n\nInspect the configuration inputs before generating any test.\n\nTABLE STRUCTURE TESTS\n\nexpect_table_columns_to_contain_set\n\nUSE WHEN:\n\nconfiguration inputs define mandatory columns that must always exist(e.g. ID, DATE)\n\nexpect_table_column_count_to_equal\n\nUSE WHEN:\n\nmapping outputs a fixed known number of columnsand schema drift must be detected\n\nexpect_table_columns_to_match_ordered_list\n\nUSE WHEN:\n\ncolumn order is explicitly enforced or significant for downstream consumers\n\nINTEGRITY & QUALITY TESTS\n\nexpect_column_values_to_be_unique\n\nUSE WHEN:\n\nconfiguration inputs designate a column as a primary or business key\n\nexpect_column_values_to_not_be_null\n\nUSE WHEN:\n\nconfiguration inputs mark a field as NOT NULLor the column is used as a join or filter key\n\nexpect_column_values_to_be_of_type\n\nUSE WHEN:\n\nmapping applies an explicit datatype cast\n\nexpect_compound_columns_to_be_unique\n\nUSE WHEN:\n\nconfiguration inputs define a composite unique key across multiple columns\n\nBUSINESS LOGIC TESTS\n\nexpect_column_values_to_be_in_set\n\nUSE WHEN:\n\nmapping restricts a column to an enumerated set of allowed values\n\nexpect_column_values_to_be_between\n\nUSE WHEN:\n\nmapping defines numeric or date range constraints(e.g. price ≥ 0, priority 0–9)\n\nexpect_column_values_to_match_regex\n\nUSE WHEN:\n\nmapping enforces a text pattern on a column(e.g. phone number, postal code)\n\nexpect_column_pair_values_A_to_be_greater_than_B\n\nUSE WHEN:\n\nmapping defines comparison logic between two numeric or date columns(e.g. end_date > start_date)\n\nMONITORING & FRESHNESS TESTS\n\nexpect_table_aggregation_to_equal_other_table\n\nUSE WHEN:\n\nvalidation requires aggregate totals to match between source and generated model\n\nexpect_row_values_to_have_recent_data\n\nUSE WHEN:\n\nconfiguration inputs define a timestamp column and freshness enforcement is required\n\nDefault threshold:\n\n2 days\n\nunless specified otherwise in configuration inputs.\n\nexpect_column_values_to_have_consistent_casing\n\nUSE WHEN:\n\nmapping processes categorical text fields where inconsistent casing would affect downstream usage\n\nAdd dbt-expectations to packages.yml only when at least one test above is required.\n\nDo not include otherwise.\n\nAUTOMATIC VALIDATION MODEL GENERATION USING DBT-AUDIT-HELPER\n\nTRUTH TABLE EXISTENCE DETECTION RULE\n\nTruth tables represent legacy ETL outputs defined as TARGET tables\n\nin configuration inputs.\n\nExtract TARGET tables from configuration inputs.\n\nSearch these tables inside:\n\nprofiles.yml target.database\n\nusing INFORMATION_SCHEMA.TABLES.\n\nIf truth tables exist:\n\n• capture schema location\n\n• register them as validation sources in sources.yml\n\n• use them for dbt-audit-helper validation models\n\nIf truth tables do NOT exist:\n\n• generate CREATE TABLE scripts using TARGET field definitions\n\n• generate INSERT sample validation records\n\n• register them as validation sources after creation\n\nDo NOT assume a fixed validation schema.\n\nTruth table schema must always be detected dynamically.\n\nVALIDATION PARITY RULE FOR SCD TYPE 2:\n\nWhen comparing a Gold SCD Type 2 model to a Truth Table:\n\n- exclude dbt_valid_from\n\n- exclude dbt_valid_to\n\n- exclude dbt_scd_id\n\n- exclude any dbt snapshot metadata columns\n\nunless those columns explicitly exist in the Truth Table schema.\n\nValidation comparisons must operate only on business columns shared between both relations.\n\nEACH VALIDATION PAIR MUST GENERATE\n\ncompare_row_counts \n\ncompare_relation_columns \n\ncompare_and_classify_relation_rows \n\ncompare_all_columns \n\ncompare_column_values \n\nVALIDATION MODEL RULES\n\nValidation models must:\n\nreference Gold outputs using ref() \n\nreference truth tables using source() \n\nexecute after Gold model creation \n\nmaterialize as TABLE by default \n\nallow optional VIEW materialization \n\nValidation models must compare reference or truth tables only with Gold-layer outputs.\n\nSilver and Snapshot layers must not be used as validation comparison targets\n\nunless explicitly specified in configuration inputs.\n\nEXAMPLE OUTPUT FILES\n\nvalidation_row_diff_<model>.sqlvalidation_schema_diff_<model>.sqlvalidation_column_diff_<model>.sqlvalidation_rowcount_diff_<model>.sqlvalidation_value_diff_<model>.sql\n\nVALIDATION PAIR DETECTION STRATEGY\n\nValidation table pairing must follow this priority order:\n\nconfiguration inputs target definition \n\nworkflow lineage relationships \n\nnaming convention matching \n\n       4.    If configuration inputs define TARGET tables but they are not found\n\n inside profiles.yml target.database using INFORMATION_SCHEMA.TABLES:\n\nAttempt matching using naming conventions:\n\ndim_<entity>\n\nfact_<entity>\n\ngold_<entity>\n\nSearch candidate tables using INFORMATION_SCHEMA.TABLES\n\ninside profiles.yml target.database\n\nIf still unresolved:\n\nskip validation model generation and log missing validation mapping.\n\nNAMING CONVENTION EXAMPLE\n\nSRC_<ENTITY>SOURCE ↔ dim<entity>SRC_<ENTITY>SOURCE ↔ fact<entity>SRC_<ENTITY>SOURCE ↔ gold<entity>",
            "p6": "DBT PROJECT STRUCTURE\n\nGenerate project using standard dbt layout.\n\nmodels/  sources.yml  bronze/  silver/  gold/snapshots/macros/tests/docs/\n\nEXECUTION PLAN GENERATION\n\nAnalyze dbt lineage and determine execution order.\n\nExample dependency order:\n\nBronze → Silver → Snapshot → Gold → Tests\n\nGenerate dbt commands based on actual architecture.\n\nExample:\n\ndbt run --select bronzedbt snapshotdbt run --select golddbt test\n\nProvide dbt build only if safe.\n\nDOCUMENTATION FILES\n\nCreate the following files:\n\ndocs/implementation_guide.mddocs/styleguide.md\n\nIMPLEMENTATION GUIDE REQUIREMENTS\n\nImplementation guide must include:\n\narchitecture reasoning \n\nexecution plan \n\nassumptions \n\nlimitations \n\nSTYLE GUIDE REQUIREMENTS\n\nStyle guide must include:\n\nfolder structure \n\nnaming conventions \n\ndependency rules \n\nSQL standards \n\ntesting standards \n\nAll documentation must be written as Markdown files."
},
        "variables": {
            "targetDatabase": "SNOWFLAKE_PROD_DB",
            "bronzeSchema": "RAW_STAGING",
            "silverSchema": "EDW_SILVER",
            "goldSchema": "EDW_GOLD",
            "snapshotSchema": "EDW_SNAPSHOTS",
            "dbtVersion": "1.8.0",
            "materializationDefault": "incremental",
            "generateTests": True,
            "generateSnapshots": True,
            "generateDocs": True,
            "generateMacros": True
        }
    },
    "migrationConfig": {
        "dbtTarget": "Snowflake",
        "loadType": "Incremental",
        "materialization": "incremental",
        "namingConvention": "snake_case",
        "surrogateKeyStrategy": "dbt_utils.generate_surrogate_key",
        "sequenceGeneration": "dbt_utils.surrogate_key",
        "snapshotStrategy": "timestamp",
        "freshnessRules": "warn_after: 12h, error_after: 24h",
        "features": {
            "generateMacros": True,
            "generateSourcesYaml": True,
            "generateSchemaYaml": True,
            "generateSnapshots": True,
            "generateValidationModels": True,
            "generateAuditHelpers": True,
            "generateDocumentation": True
        }
    },
    "migrationExecution": {
        "status": "Idle",
        "progressPercentage": 0,
        "currentStage": 0,
        "stages": [
            {"id": 1, "name": "Parsing Source Files", "type": "system", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 2, "name": "Detecting Medallion Architecture", "type": "system", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 3, "name": "Running Prompt 1 — Source Identification", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 4, "name": "Running Prompt 2 — Architecture & Layer Design", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 5, "name": "Running Prompt 3 — Model Generation", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 6, "name": "Running Prompt 4 — Data Safety & Keys", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 7, "name": "Running Prompt 5 — Validation & Tests", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 8, "name": "Running Prompt 6 — Documentation", "type": "prompt", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 9, "name": "Building dbt Project Structure", "type": "system", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 10, "name": "Creating dbt Tests & Schemas", "type": "system", "status": "pending", "duration": "0s", "summary": ""},
            {"id": 11, "name": "Packaging Output Artifacts", "type": "system", "status": "pending", "duration": "0s", "summary": ""}
        ],
        "metrics": {
            "executionTime": "00:00:00",
            "tokensUsed": 0,
            "promptVersion": "v6.4",
            "filesGenerated": 0,
            "aiCost": "$0.00",
            "successRate": 0
        },
        "logs": []
    }
}
