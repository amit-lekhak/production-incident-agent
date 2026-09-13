-- Add payments latency alert rule for payment_timeout chaos (idempotent).
INSERT INTO alert_rules (service_id, name, metric, operator, threshold, window_seconds, enabled)
SELECT s.id, 'Payments latency p99', 'payments_latency_p99', '>', 1500, 60, true
FROM services s
WHERE s.slug = 'relay-checkout'
  AND NOT EXISTS (
    SELECT 1 FROM alert_rules ar
    WHERE ar.service_id = s.id AND ar.metric = 'payments_latency_p99'
  );
