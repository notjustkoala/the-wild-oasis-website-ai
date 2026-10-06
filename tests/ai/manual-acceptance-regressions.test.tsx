import { render, screen } from "@testing-library/react";
import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import { policyEvidencePlan } from "@/app/_ai/policies/policy-evidence-plan";
import AiAnswer from "@/app/_components/AiAnswer";

it("accepts complete G3 grammar while rejecting unknown guest identities", () => {
  const prepared = preparePolicyQuery("入住前 7 天取消和入住前 3 天取消，分别如何收费？退款由谁处理？", { allowStaffScope: false });
  expect(prepared.searchable).toBe(true);
  expect(policyEvidencePlan(prepared.sanitized, false).some(plan => plan.documentIds.includes("cancellation-refund"))).toBe(true);
  expect(preparePolicyQuery("替阿不都热依木咨询退款由谁负责？", { allowStaffScope: false }).searchable).toBe(false);
});
it("renders formatting and entities without model-created footnotes", () => {
  render(<AiAnswer text={"**政策说明**&#x20;按实际来源回答[^1]。\n\n[^1]: exception-handling-sop v1 — Initial review"} />);
  expect(screen.getByText("政策说明").tagName).toBe("STRONG");
  expect(document.body.textContent).toContain("按实际来源回答");
  expect(document.body.textContent).not.toMatch(/\[\^|&#|exception-handling/);
});
it("does not execute encoded HTML or generated links", () => {
  const { container } = render(<AiAnswer text={"&#x3c;img src=x onerror=alert(1)&#x3e; [click](javascript:alert(1))"} />);
  expect(container.querySelector("img,script,iframe,a")).toBeNull();
});
