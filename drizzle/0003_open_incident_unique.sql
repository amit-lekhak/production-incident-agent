-- One open incident per (service, alert_rule). Partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS incidents_open_per_rule_uidx
  ON incidents (service_id, alert_rule_id)
  WHERE status NOT IN ('resolved', 'closed_rejected')
    AND alert_rule_id IS NOT NULL;
