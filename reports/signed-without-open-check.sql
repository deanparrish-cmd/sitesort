-- READ-ONLY. Past sign-offs whose "opened" time was written at the moment of
-- signing (before 2026-10-22 the server stamped viewed_at = now() when someone
-- signed a document they had never opened). Same second = almost certainly
-- never opened. From the #159 publish on, this can't happen any more.

-- 1. How many, per document type.
SELECT d.type, count(*) AS signoffs,
       count(*) FILTER (WHERE abs(extract(epoch FROM (dd.acknowledged_at - dd.viewed_at))) < 1) AS open_time_written_at_signing
  FROM document_distributions dd JOIN documents d ON d.id = dd.document_id
 WHERE dd.status = 'acknowledged'
 GROUP BY d.type ORDER BY 3 DESC;

-- 2. The method statements / permits / safety documents among them.
SELECT p.name AS project, d.name AS document, d.type, u.name AS signer, dd.acknowledged_at
  FROM document_distributions dd
  JOIN documents d ON d.id = dd.document_id
  JOIN projects p ON p.id = d.project_id
  JOIN users u ON u.id = dd.user_id
 WHERE dd.status = 'acknowledged' AND d.type IN ('method_statement', 'permit', 'safety')
   AND abs(extract(epoch FROM (dd.acknowledged_at - dd.viewed_at))) < 1
 ORDER BY dd.acknowledged_at DESC LIMIT 50;
