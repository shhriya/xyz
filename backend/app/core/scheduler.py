import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.db.session import SessionLocal
from app.db.models import CdcPipelineModel
from app.modules.cdc_pipeline import service

logger = logging.getLogger("uvicorn.error")

scheduler = AsyncIOScheduler()

def _run_job(pipeline_id: str):
    try:
        service.start_run(pipeline_id)
    except Exception as e:
        logger.error(f"Scheduled CDC run failed for pipeline {pipeline_id}: {e}")

def schedule_pipeline(pipeline_id: str, schedule: str):
    unschedule_pipeline(pipeline_id) # remove existing if any
    
    if not schedule:
        return
        
    job_id = f"cdc_pipeline_{pipeline_id}"
    
    # Simple heuristic to determine if it's a cron expression or an interval.
    # E.g. "15m", "1h", "24h" vs "0 * * * *"
    try:
        if schedule.endswith('m'):
            trigger = IntervalTrigger(minutes=int(schedule[:-1]))
        elif schedule.endswith('h'):
            trigger = IntervalTrigger(hours=int(schedule[:-1]))
        elif schedule.endswith('d'):
            trigger = IntervalTrigger(days=int(schedule[:-1]))
        else:
            # Assume it's a cron expression
            trigger = CronTrigger.from_crontab(schedule)
            
        scheduler.add_job(_run_job, trigger, args=[pipeline_id], id=job_id, replace_existing=True)
        logger.info(f"Scheduled CDC pipeline {pipeline_id} with schedule: {schedule}")
    except Exception as e:
        logger.error(f"Failed to schedule CDC pipeline {pipeline_id} with {schedule}: {e}")

def unschedule_pipeline(pipeline_id: str):
    job_id = f"cdc_pipeline_{pipeline_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info(f"Unscheduled CDC pipeline {pipeline_id}")

def start_scheduler():
    if not scheduler.running:
        scheduler.start()
    
    with SessionLocal() as db:
        pipelines = db.query(CdcPipelineModel).filter_by(schedule_enabled=True).all()
        for p in pipelines:
            if p.schedule:
                schedule_pipeline(p.id, p.schedule)
