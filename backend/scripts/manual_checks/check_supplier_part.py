from app.modules.code_conversion.skills_engine import skill_engine

code = """
supplier_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "SUPPLIER").load()
part_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "PART").load()
partsupp_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "PARTSUPP").load()
"""

res = skill_engine.execute_skills_pipeline({
    'uploaded_files': [{'filename': 'pyspark_job.py', 'content': code}],
    'discovered_files': [{'filename': 'pyspark_job.py', 'content': code}]
})

print("Generated files count:", len(res))
for k in sorted(res.keys()):
    print(" -", k)
