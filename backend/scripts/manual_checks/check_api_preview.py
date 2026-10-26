import requests

url = 'http://localhost:8000/api/migration/preview'

# 1. Test empty initial prediction (when no files exist or uploadedFiles is empty)
res1 = requests.post(url, json={
    'uploadedFiles': [],
    'discoveredFiles': [],
    'cleanedFiles': []
}).json()

print('Initial predictions (empty files payload):')
print('  bronzeModels:', res1.get('estimatedOutputs', {}).get('bronzeModels'))
print('  totalFiles:', res1.get('estimatedOutputs', {}).get('totalFiles'))
print('  topBronze:', res1.get('layerBreakdown', {}).get('Bronze', {}).get('topModel'))

# 2. Test preprocessed SUPPLIER/PART/PARTSUPP source code
code = """
supplier_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "SUPPLIER").load()
part_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "PART").load()
partsupp_df = spark.read.format("snowflake").options(**sfOptions).option("dbtable", "PARTSUPP").load()
"""

res2 = requests.post(url, json={
    'uploadedFiles': [{'filename': 'pyspark_job.py', 'content': code}],
    'discoveredFiles': [{'filename': 'pyspark_job.py', 'content': code}],
    'cleanedFiles': [{'filename': 'pyspark_job.py', 'content': code}]
}).json()

print('\nPreprocessed predictions (SUPPLIER, PART, PARTSUPP):')
print('  bronzeModels:', res2.get('estimatedOutputs', {}).get('bronzeModels'))
print('  silverModels:', res2.get('estimatedOutputs', {}).get('silverModels'))
print('  snapshotModels:', res2.get('estimatedOutputs', {}).get('snapshots'))
print('  goldModels:', res2.get('estimatedOutputs', {}).get('goldModels'))
print('  totalFiles:', res2.get('estimatedOutputs', {}).get('totalFiles'))
print('  topBronze:', res2.get('layerBreakdown', {}).get('Bronze', {}).get('topModel'))
print('  bronzeModelsList:', res2.get('layerBreakdown', {}).get('Bronze', {}).get('models'))
print('  topSilver:', res2.get('layerBreakdown', {}).get('Silver', {}).get('topModel'))
print('  topSnapshot:', res2.get('layerBreakdown', {}).get('Snapshot', {}).get('topModel'))
print('  topGold:', res2.get('layerBreakdown', {}).get('Gold', {}).get('topModel'))
