-- The rows of an applied import assessment stay immutable, with one narrow exception: the ledger of a charge may be moved when the ledger of its term
-- is changed in the master and the person chose to move the transactions already posted (the background ledger move sets namo.ledger_reassign for its
-- own transaction). Nothing but that ledger may differ, and only on the term rows; the audit trail records the change.
CREATE OR REPLACE FUNCTION "namo"."guard_assessment_children"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id integer; posted boolean;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."assessmentId" ELSE NEW."assessmentId" END;
  SELECT "isPosted" INTO posted FROM public."PurchaseImportAssessment" WHERE id = parent_id;
  IF coalesce(posted, false) THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PurchaseImportAssessmentTerm' AND current_setting('namo.ledger_reassign', true) = 'on'
       AND (to_jsonb(NEW) - 'generalLedgerId') = (to_jsonb(OLD) - 'generalLedgerId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Rows of an applied import assessment are immutable; reverse the assessment first.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
