UPDATE training_use_cases
SET planned_hours = 40
WHERE planned_hours = 400;

UPDATE activity_report_use_case_entries aruce
SET planned_hours = 40
FROM training_use_cases tuc
WHERE aruce.use_case_id = tuc.id
  AND aruce.planned_hours = 400;
