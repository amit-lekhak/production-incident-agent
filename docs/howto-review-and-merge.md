# How to review and merge remediations

Decide on a diagnosis: merge a revert PR, approve a flag/watch/page action, ask for more evidence, or reject.

Humans gate every mutation. The model never writes to `main`. `POST /api/reviews` claims the pending review row once (compare-and-set on `decision = 'pending'`).

## Prerequisites

- An incident in `awaiting_review` with a `reviews.decision = 'pending'` row
- For `revert_pr`: a `recommendations.pr_number` (opened by the diagnosis pipeline)
- App running; GitHub token still valid if you will merge or close a PR

## Steps

1. Look at where the recommendation landed.

   - **/prs** lists pending reviews **with** a PR (`pr_number IS NOT NULL`). Buttons: **Merge PR**, **More evidence**, **Close PR**.
   - **/review** lists pending reviews **without** a PR. Buttons: **Approve**, **More evidence**, **Reject**. Used for `disable_flag`, `restart`, `watch`, `page_human`.

   Both pages post the same API. Only the labels change.

2. Open the incident if you want the timeline, hypotheses, and evidence quotes. Status must stay `awaiting_review` or the API returns 409.

3. Optionally type a note. It is stored on the review row and appended to `incident_events`.

4. Choose one decision:

   **Merge PR / Approve** posts `{ incidentId, decision: "approved" }`.

   - Claims the pending review
   - Runs `executeApprovedAction` (`src/lib/agent/actions.ts`)
   - `revert_pr`: merge the PR, create a production deployment, activate that SHA, clear chaos faults
   - `disable_flag`: set `feature_flags.enabled = false` for `action_target` (live checkout reads the flag; no redeploy)
   - `restart`: clear faults and re-activate the current deploy SHA
   - `watch`: note only
   - `page_human`: POST `PAGE_WEBHOOK_URL` if set; if unset, the page is noted locally and still succeeds
   - `watch` and `page_human` skip metric verify and go to `resolved`
   - Other mutating actions run `verifyRecovery` against the incident `trigger_metric`

   **More evidence** posts `{ decision: "more_evidence" }` and re-runs `runDiagnosisPipeline`. Prior revert PRs are closed as superseded. A new pending review replaces the old one.

   **Close PR / Reject** posts `{ decision: "rejected" }`, closes an open remediation PR if present, and sets status `closed_rejected`.

5. If approve + verify succeeds, the UI redirects to `/postmortems/{id}` when a postmortem row exists.

## Verification

- Review row is no longer `pending` (second click returns 409 `No pending review to claim`)
- `revert_pr` + Merge: GitHub PR is merged, a new production deployment exists, incident becomes `resolved` or `needs_human` if metrics stay hot
- `disable_flag`: `/sim/checkout` no longer takes the slow payments path when `payments_v2` is off
- Reject: PR closed, incident `closed_rejected`

## Troubleshooting

**409 `Incident is "…", expected awaiting_review`.** Status moved (auto-diagnose still running, or someone else decided). Refresh the incident page.

**409 `No pending review to claim`.** The CAS already fired. Do not retry approve.

**`No open revert PR on recommendation`.** Diagnose failed to open the PR (`needs_human` / `pr_open_failed`) or you are approving a stale row. Re-run diagnose.

**Verify failed, status `needs_human`.** The trigger metric did not fall below its threshold within `VERIFY_TIMEOUT_MS` (default 15s, `VERIFY_SAMPLES` default 3). Check **/ops** and the incident timeline. You can diagnose again from `needs_human`.

**Postmortem missing but incident resolved.** Postmortem failure is logged as `postmortem_failed` and does not reopen the incident. Read [Reference: Agent pipeline](reference-agent-pipeline.md).

**Webhook error on `page_human`.** If `PAGE_WEBHOOK_URL` is set and the POST fails, the action fails and the incident becomes `needs_human`. Unset the URL to keep paging local-only.
